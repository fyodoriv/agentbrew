#![forbid(unsafe_code)]

use chrono::{DateTime, SecondsFormat, Utc};
use rustix::fd::OwnedFd;
use rustix::fs::{self, AtFlags, FileType, FlockOperation, Mode, OFlags, Stat};
use rustix::io::Errno;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAX_BYTES: usize = 64 * 1024;
const MAX_COMMITS: usize = 256;
const DIRECTORY: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW);
const PRIVATE_READ: OFlags = OFlags::RDONLY
    .union(OFlags::CLOEXEC)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::NONBLOCK);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidInput,
    InvalidState,
    UnsafeTarget,
    UnsupportedTarget,
    Busy,
    StaleRun,
    Io,
}

impl Error {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid-input",
            Self::InvalidState => "invalid-state",
            Self::UnsafeTarget => "unsafe-target",
            Self::UnsupportedTarget => "unsupported-target",
            Self::Busy => "busy",
            Self::StaleRun => "stale-run",
            Self::Io => "io",
        }
    }
}

fn target_error(error: Errno) -> Error {
    match error {
        Errno::LOOP | Errno::NOTDIR | Errno::ISDIR => Error::UnsafeTarget,
        _ => Error::Io,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultKind {
    Green,
    Degraded,
    Blocked,
}

impl ResultKind {
    pub fn parse(value: &str) -> Result<Self, Error> {
        match value {
            "green" => Ok(Self::Green),
            "degraded" => Ok(Self::Degraded),
            "blocked" => Ok(Self::Blocked),
            _ => Err(Error::InvalidInput),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Green => "green",
            Self::Degraded => "degraded",
            Self::Blocked => "blocked",
        }
    }
}

fn valid_label(value: &str) -> bool {
    let mut bytes = value.bytes();
    let alphanumeric = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    value.len() <= 64
        && bytes.next().is_some_and(alphanumeric)
        && bytes.all(|b| alphanumeric(b) || matches!(b, b'_' | b'-'))
}

fn add_commit(map: &mut BTreeMap<String, String>, repo: String, sha: String) -> Result<(), Error> {
    if map.len() >= MAX_COMMITS
        || !valid_label(&repo)
        || !(7..=64).contains(&sha.len())
        || !sha.bytes().all(|b| b.is_ascii_hexdigit())
        || map.contains_key(&repo)
    {
        return Err(Error::InvalidInput);
    }
    map.insert(repo, sha.to_ascii_lowercase());
    Ok(())
}

fn deserialize_commits<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<String, String>, D::Error> {
    struct Commits;
    impl<'de> Visitor<'de> for Commits {
        type Value = BTreeMap<String, String>;

        fn expecting(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
            out.write_str("a bounded map of unique repository labels")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut commits = BTreeMap::new();
            while let Some((repo, sha)) = map.next_entry()? {
                add_commit(&mut commits, repo, sha)
                    .map_err(|_| serde::de::Error::custom("invalid commit map"))?;
            }
            Ok(commits)
        }
    }
    deserializer.deserialize_map(Commits)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    finished_at: String,
    result: ResultKind,
    #[serde(deserialize_with = "deserialize_commits")]
    commits: BTreeMap<String, String>,
}

impl Record {
    pub fn new(
        finished_at: String,
        result: ResultKind,
        commits: Vec<(String, String)>,
    ) -> Result<Self, Error> {
        let mut validated = BTreeMap::new();
        for (repo, sha) in commits {
            add_commit(&mut validated, repo, sha)?;
        }
        Self {
            finished_at,
            result,
            commits: validated,
        }
        .normalize()
    }

    fn instant(&self) -> Result<DateTime<Utc>, Error> {
        DateTime::parse_from_rfc3339(&self.finished_at)
            .map(|t| t.with_timezone(&Utc))
            .map_err(|_| Error::InvalidInput)
    }

    fn normalize(mut self) -> Result<Self, Error> {
        if self.commits.is_empty() && self.result != ResultKind::Blocked {
            return Err(Error::InvalidInput);
        }
        self.finished_at = self.instant()?.to_rfc3339_opts(SecondsFormat::AutoSi, true);
        // UTC conversion can cross the four-digit year boundary.
        self.instant()?;
        Ok(self)
    }

    pub fn human_lines(&self, label: &str) -> String {
        let mut out = format!("{label}: {} {}\n", self.finished_at, self.result.label());
        for (repo, sha) in &self.commits {
            out.push_str(&format!("  {repo}: {sha}\n"));
        }
        out
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Report {
    Missing {
        record: Option<Record>,
        record_sha256: Option<String>,
    },
    Present {
        record: Record,
        record_sha256: String,
    },
    Recorded {
        record: Record,
        record_sha256: String,
        changed: bool,
    },
}

impl Report {
    pub fn human(&self) -> String {
        match self {
            Self::Missing { .. } => "First run: no previous checkup record\n".into(),
            Self::Present { record, .. } => record.human_lines("Previous completed checkup"),
            Self::Recorded { record, .. } => record.human_lines("Recorded completed checkup"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Identity {
    dev: u64,
    ino: u64,
}

impl From<Stat> for Identity {
    fn from(stat: Stat) -> Self {
        Self {
            dev: stat.st_dev as u64,
            ino: stat.st_ino as u64,
        }
    }
}

fn owned_directory(fd: &OwnedFd) -> Result<(), Error> {
    let stat = fs::fstat(fd).map_err(target_error)?;
    if stat.st_uid != rustix::process::geteuid().as_raw() || stat.st_mode & 0o022 != 0 {
        return Err(Error::UnsafeTarget);
    }
    Ok(())
}

fn private_file(stat: &Stat, uid: u32) -> Result<(), Error> {
    if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
        || stat.st_uid != uid
        || stat.st_nlink != 1
        || stat.st_mode & 0o7177 != 0
    {
        return Err(Error::UnsafeTarget);
    }
    Ok(())
}

fn file_identity(stat: Stat) -> Result<Identity, Error> {
    private_file(&stat, rustix::process::geteuid().as_raw())?;
    Ok(stat.into())
}

#[cfg(target_os = "macos")]
fn qualified_volume(fd: &OwnedFd) -> Result<(), Error> {
    let volume = fs::fstatfs(fd).map_err(target_error)?;
    if volume.f_fstypename[..5] != [97, 112, 102, 115, 0]
        || volume.f_flags & libc::MNT_LOCAL as u32 == 0
    {
        return Err(Error::UnsupportedTarget);
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn qualified_volume(_: &OwnedFd) -> Result<(), Error> {
    Err(Error::UnsupportedTarget)
}

fn directory_at(parent: &OwnedFd, name: &Path, create: bool) -> Result<Option<OwnedFd>, Error> {
    match fs::openat(parent, name, DIRECTORY, Mode::empty()) {
        Ok(fd) => Ok(Some(fd)),
        Err(Errno::NOENT) if create => {
            owned_directory(parent)?;
            qualified_volume(parent)?;
            match fs::mkdirat(parent, name, Mode::from_bits_truncate(0o700)) {
                Ok(()) | Err(Errno::EXIST) => {}
                Err(error) => return Err(target_error(error)),
            }
            fs::openat(parent, name, DIRECTORY, Mode::empty())
                .map(Some)
                .map_err(target_error)
        }
        Err(Errno::NOENT) => Ok(None),
        Err(error) => Err(target_error(error)),
    }
}

fn leaf_identity(dir: &OwnedFd, name: &str) -> Result<Option<Identity>, Error> {
    match fs::statat(dir, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(stat) => file_identity(stat).map(Some),
        Err(Errno::NOENT) => Ok(None),
        Err(error) => Err(target_error(error)),
    }
}

struct Saved {
    record: Record,
    hash: String,
    identity: Identity,
}

fn read_record(dir: &OwnedFd, name: &str) -> Result<Option<Saved>, Error> {
    let Some(identity) = leaf_identity(dir, name)? else {
        return Ok(None);
    };
    let fd = fs::openat(dir, name, PRIVATE_READ, Mode::empty()).map_err(target_error)?;
    let stat = fs::fstat(&fd).map_err(target_error)?;
    if file_identity(stat)? != identity {
        return Err(Error::UnsafeTarget);
    }
    let len = usize::try_from(stat.st_size).map_err(|_| Error::InvalidState)?;
    if len > MAX_BYTES {
        return Err(Error::InvalidState);
    }
    let mut bytes = vec![0; len];
    let mut file = File::from(fd);
    file.read_exact(&mut bytes).map_err(|_| Error::Io)?;
    if file.read(&mut [0]).map_err(|_| Error::Io)? != 0 {
        return Err(Error::InvalidState);
    }
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| Error::InvalidState)?;
    Ok(Some(Saved {
        record: record.normalize().map_err(|_| Error::InvalidState)?,
        hash: hash(&bytes),
        identity,
    }))
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn lock(dir: &OwnedFd, name: &str) -> Result<(OwnedFd, Identity), Error> {
    let previous = leaf_identity(dir, name)?;
    let flags =
        OFlags::RDWR | OFlags::CREATE | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK;
    let fd = fs::openat(dir, name, flags, Mode::from_bits_truncate(0o600)).map_err(target_error)?;
    let identity = file_identity(fs::fstat(&fd).map_err(target_error)?)?;
    if previous.is_some_and(|old| old != identity) {
        return Err(Error::UnsafeTarget);
    }
    fs::flock(&fd, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
        if error == Errno::WOULDBLOCK {
            Error::Busy
        } else {
            target_error(error)
        }
    })?;
    if leaf_identity(dir, name)? != Some(identity) {
        return Err(Error::UnsafeTarget);
    }
    Ok((fd, identity))
}

struct Temporary<'a> {
    dir: &'a OwnedFd,
    name: String,
    identity: Identity,
    published: bool,
}

impl<'a> Temporary<'a> {
    fn create(dir: &'a OwnedFd) -> Result<(Self, File), Error> {
        // Process scope. Used only to disambiguate exclusive temporary names.
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let flags =
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::CLOEXEC | OFlags::NOFOLLOW;
        for _ in 0..128 {
            let name = format!(
                ".record-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            match fs::openat(dir, name.as_str(), flags, Mode::from_bits_truncate(0o600)) {
                Ok(fd) => {
                    let identity = file_identity(fs::fstat(&fd).map_err(target_error)?)?;
                    return Ok((
                        Self {
                            dir,
                            name,
                            identity,
                            published: false,
                        },
                        File::from(fd),
                    ));
                }
                Err(Errno::EXIST) => continue,
                Err(error) => return Err(target_error(error)),
            }
        }
        Err(Error::Io)
    }
}

impl Drop for Temporary<'_> {
    fn drop(&mut self) {
        if !self.published && leaf_identity(self.dir, &self.name) == Ok(Some(self.identity)) {
            let _ = fs::unlinkat(self.dir, self.name.as_str(), AtFlags::empty());
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Publication {
    BeforeRename,
    AfterRename,
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self, Error> {
        let mut parts = root.components();
        if parts.next() != Some(Component::RootDir)
            || root == Path::new("/")
            || !parts.all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(Error::UnsafeTarget);
        }
        Ok(Self { root })
    }

    fn directory(&self, create: bool) -> Result<Option<OwnedFd>, Error> {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return Err(Error::UnsupportedTarget);
        }
        let mut fd = fs::open("/", DIRECTORY, Mode::empty()).map_err(target_error)?;
        for part in self.root.components().skip(1) {
            let Some(next) = directory_at(&fd, Path::new(part.as_os_str()), create)? else {
                return Ok(None);
            };
            fd = next;
        }
        owned_directory(&fd)?;
        qualified_volume(&fd)?;
        let result = directory_at(&fd, Path::new("checkups"), create)?;
        if let Some(dir) = &result {
            owned_directory(dir)?;
            qualified_volume(dir)?;
        }
        Ok(result)
    }

    pub fn show(&self, checkup: &str) -> Result<Report, Error> {
        if !valid_label(checkup) {
            return Err(Error::InvalidInput);
        }
        let saved = match self.directory(false)? {
            Some(dir) => read_record(&dir, &format!("{checkup}.json"))?,
            None => None,
        };
        Ok(match saved {
            None => Report::Missing {
                record: None,
                record_sha256: None,
            },
            Some(saved) => Report::Present {
                record: saved.record,
                record_sha256: saved.hash,
            },
        })
    }

    pub fn record(&self, checkup: &str, record: Record) -> Result<Report, Error> {
        self.publish(checkup, record, |_| Ok(()))
    }

    /// Run an in-process operation while a matching record's native writer
    /// lock is held. The operation must not call this store's writer.
    pub fn with_current<T>(
        &self,
        checkup: &str,
        expected_hash: &str,
        operation: impl FnOnce(&Record) -> Result<T, Error>,
    ) -> Result<T, Error> {
        if !valid_label(checkup)
            || expected_hash.len() != 64
            || !expected_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(Error::InvalidInput);
        }
        let dir = self.directory(false)?.ok_or(Error::StaleRun)?;
        let lock_name = format!(".{checkup}.lock");
        let identity = leaf_identity(&dir, &lock_name)?.ok_or(Error::StaleRun)?;
        let lock = fs::openat(&dir, lock_name.as_str(), PRIVATE_READ, Mode::empty())
            .map_err(target_error)?;
        if file_identity(fs::fstat(&lock).map_err(target_error)?)? != identity {
            return Err(Error::UnsafeTarget);
        }
        fs::flock(&lock, FlockOperation::NonBlockingLockShared).map_err(|error| {
            if error == Errno::WOULDBLOCK {
                Error::Busy
            } else {
                target_error(error)
            }
        })?;
        if leaf_identity(&dir, &lock_name)? != Some(identity) {
            return Err(Error::UnsafeTarget);
        }
        let held = self.directory(false)?.ok_or(Error::UnsafeTarget)?;
        if Identity::from(fs::fstat(&dir).map_err(target_error)?)
            != Identity::from(fs::fstat(&held).map_err(target_error)?)
        {
            return Err(Error::UnsafeTarget);
        }
        let saved = read_record(&dir, &format!("{checkup}.json"))?.ok_or(Error::StaleRun)?;
        if saved.hash != expected_hash {
            return Err(Error::StaleRun);
        }
        let result = operation(&saved.record);
        drop(lock);
        result
    }

    fn publish(
        &self,
        checkup: &str,
        record: Record,
        mut checkpoint: impl FnMut(Publication) -> Result<(), Error>,
    ) -> Result<Report, Error> {
        if !valid_label(checkup) {
            return Err(Error::InvalidInput);
        }
        let record = record.normalize()?;
        let mut bytes = serde_json::to_vec(&record).map_err(|_| Error::InvalidInput)?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err(Error::InvalidInput);
        }
        let dir = self.directory(true)?.ok_or(Error::Io)?;
        let name = format!("{checkup}.json");
        let lock_name = format!(".{checkup}.lock");
        leaf_identity(&dir, &name)?;
        let (_lock, lock_identity) = lock(&dir, &lock_name)?;
        let saved = read_record(&dir, &name)?;
        if let Some(old) = &saved {
            match record.instant()?.cmp(&old.record.instant()?) {
                std::cmp::Ordering::Less => return Err(Error::StaleRun),
                std::cmp::Ordering::Equal if record == old.record => {
                    return Ok(Report::Recorded {
                        record,
                        record_sha256: old.hash.clone(),
                        changed: false,
                    });
                }
                std::cmp::Ordering::Equal => return Err(Error::StaleRun),
                std::cmp::Ordering::Greater => {}
            }
        }
        let (mut temp, mut file) = Temporary::create(&dir)?;
        file.write_all(&bytes).map_err(|_| Error::Io)?;
        file.sync_all().map_err(|_| Error::Io)?;
        checkpoint(Publication::BeforeRename)?;
        let current_dir = self.directory(false)?.ok_or(Error::UnsafeTarget)?;
        if Identity::from(fs::fstat(&dir).map_err(target_error)?)
            != Identity::from(fs::fstat(&current_dir).map_err(target_error)?)
            || leaf_identity(&dir, &name)? != saved.map(|old| old.identity)
            || leaf_identity(&dir, &lock_name)? != Some(lock_identity)
            || leaf_identity(&dir, &temp.name)? != Some(temp.identity)
        {
            return Err(Error::UnsafeTarget);
        }
        fs::renameat(&dir, temp.name.as_str(), &dir, name.as_str()).map_err(target_error)?;
        temp.published = true;
        checkpoint(Publication::AfterRename)?;
        Ok(Report::Recorded {
            record,
            record_sha256: hash(&bytes),
            changed: true,
        })
    }
}

#[cfg(test)]
mod tests;
