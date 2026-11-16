use std::collections::BTreeMap;
use std::path::Path;

use crate::model::Diagnostic;

#[cfg(unix)]
#[path = "child_owner.rs"]
mod child_owner;
#[cfg(unix)]
#[path = "worker_owner.rs"]
mod worker_owner;

#[cfg(unix)]
pub use unix::{CargoArtifact, HeldRoot, READ_GIT_CONFIG, READ_GIT_ENV};

pub fn worker_entry() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next()?;
    if mode != "--internal-source-git-worker" {
        return mode
            .to_str()
            .filter(|mode| mode.starts_with("--internal-source-git-worker"))
            .map(|_| 2);
    }
    let version = args.next();
    let operation = args.next();
    let startup: Vec<_> = args.collect();
    if version.as_deref() != Some(std::ffi::OsStr::new("2")) {
        return Some(2);
    }
    #[cfg(unix)]
    {
        Some(unix::worker(operation.as_deref(), &startup))
    }
    #[cfg(not(unix))]
    {
        let _ = (operation, startup);
        Some(2)
    }
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub path: String,
    pub mode: u32,
    pub blob: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct Snapshot {
    pub entries: BTreeMap<String, Entry>,
    pub untracked: Vec<String>,
    pub ignored: Vec<IgnoredEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IgnoredEntry {
    pub path: String,
    pub executable: bool,
    pub symlink: bool,
}

pub fn read(root: &Path) -> Result<Snapshot, Diagnostic> {
    #[cfg(unix)]
    {
        unix::read(root)
    }
    #[cfg(not(unix))]
    {
        let _ = root;
        Err(Diagnostic::new("unsupported-platform", None))
    }
}

#[cfg(unix)]
mod unix {
    use super::{Diagnostic, Entry, IgnoredEntry, Snapshot};
    use crate::transport::{parent_error, ParentStage, ReadOperation};
    use rustix::fs::{
        fstat, open, openat, readlinkat_raw, statat, AtFlags, FileType, Mode, OFlags,
    };
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs::File;
    use std::io::Read;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    const METADATA_LIMIT: usize = 8 * 1024 * 1024;
    const FILE_LIMIT: usize = 16 * 1024 * 1024;
    const TOTAL_LIMIT: usize = 128 * 1024 * 1024;
    const LINK_LIMIT: usize = 16 * 1024;
    pub const READ_GIT_CONFIG: &[&str] = &[
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.excludesFile=/dev/null",
        "-c",
        "core.attributesFile=/dev/null",
        "-c",
        "credential.helper=",
        "-c",
        "credential.interactive=false",
        "-c",
        "protocol.allow=never",
    ];
    pub const READ_GIT_ENV: &[(&str, &str)] = &[
        ("LC_ALL", "C"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_SYSTEM", "/dev/null"),
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_NO_LAZY_FETCH", "1"),
        ("GIT_NO_REPLACE_OBJECTS", "1"),
        ("GIT_OPTIONAL_LOCKS", "0"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_ASKPASS", ""),
        ("GCM_INTERACTIVE", "never"),
    ];
    // Only these documented dependency/build roots are pruned. Tracked files remain inputs.
    const OUTPUT_EXCLUSIONS: [&str; 5] = [
        "--exclude=/node_modules/",
        "--exclude=/dist/",
        "--exclude=/coverage/",
        "--exclude=/rust/target/",
        "--exclude=/.metrics/",
    ];

    // Integration callers supply Cargo's compile-time binary artifact, never scanned source input.
    pub struct CargoArtifact {
        program: PathBuf,
    }

    impl CargoArtifact {
        pub fn from_cargo_build(artifact: &'static str) -> Result<Self, Diagnostic> {
            let program = Path::new(artifact)
                .canonicalize()
                .map_err(|_| error("worker-binary"))?;
            let metadata = program.metadata().map_err(|_| error("worker-binary"))?;
            if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
                return Err(error("worker-binary"));
            }
            Ok(Self { program })
        }
    }

    // One inventory invocation owns this directory capability and trusted measurement executable.
    pub struct HeldRoot {
        file: File,
        program: PathBuf,
    }

    impl HeldRoot {
        pub fn open(selected: &Path) -> Result<Self, Diagnostic> {
            Self::with_program(
                selected,
                std::env::current_exe().map_err(|_| error("worker-binary"))?,
            )
        }

        pub fn open_with_cargo_artifact(
            selected: &Path,
            artifact: &CargoArtifact,
        ) -> Result<Self, Diagnostic> {
            Self::with_program(selected, artifact.program.clone())
        }

        fn with_program(selected: &Path, program: PathBuf) -> Result<Self, Diagnostic> {
            let path = selected
                .canonicalize()
                .map_err(|_| error("repository-root"))?;
            let fd = open(
                &path,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| error("repository-root"))?;
            let file = File::from(fd);
            if statat(&file, ".git", AtFlags::SYMLINK_NOFOLLOW).is_err() {
                return Err(error("repository-root"));
            }
            Ok(Self { file, program })
        }

        pub fn read_index_metadata(&self) -> Result<Vec<u8>, Diagnostic> {
            git(self, ReadOperation::Index, Vec::new())
        }

        pub fn snapshot(&self) -> Result<Snapshot, Diagnostic> {
            read_held(self)
        }
    }

    fn git(
        root: &HeldRoot,
        operation: ReadOperation,
        input: Vec<u8>,
    ) -> Result<Vec<u8>, Diagnostic> {
        let (_, limit) = operation_args(operation);
        let mut command = Command::new(&root.program);
        command
            .args(["--internal-source-git-worker", "2", operation.name()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(root.file.try_clone().map_err(|_| {
                let mut diagnostic = parent_error(ParentStage::RootClone, None);
                diagnostic.transport.as_mut().unwrap().operation = Some(operation);
                diagnostic
            })?));
        super::child_owner::run_child(command, input, limit).map_err(|mut diagnostic| {
            if let Some(context) = diagnostic.transport.as_mut() {
                context.operation = Some(operation);
            }
            diagnostic
        })
    }

    fn operation_args(operation: ReadOperation) -> (Vec<&'static str>, usize) {
        let (mut args, limit) = match operation {
            ReadOperation::RootPrefix => (vec!["rev-parse", "--show-prefix"], METADATA_LIMIT),
            ReadOperation::Index => (
                vec!["ls-files", "--stage", "--full-name", "-z"],
                METADATA_LIMIT,
            ),
            ReadOperation::Untracked => (
                vec![
                    "ls-files",
                    "--others",
                    "--full-name",
                    "-z",
                    "--exclude-standard",
                ],
                METADATA_LIMIT,
            ),
            ReadOperation::AllUntracked => (
                vec!["ls-files", "--others", "--full-name", "-z"],
                METADATA_LIMIT,
            ),
            ReadOperation::ObjectBatch => (
                vec!["cat-file", "--batch"],
                TOTAL_LIMIT + 2 * METADATA_LIMIT,
            ),
        };
        if matches!(
            operation,
            ReadOperation::Untracked | ReadOperation::AllUntracked
        ) {
            args.extend(OUTPUT_EXCLUSIONS);
        }
        (args, limit)
    }

    fn error(code: &str) -> Diagnostic {
        Diagnostic::new(code, None)
    }

    fn at(code: &str, path: &str) -> Diagnostic {
        Diagnostic::new(code, Some(path))
    }

    fn readonly_git_command(operation: ReadOperation) -> Command {
        let (args, _) = operation_args(operation);
        let mut command = Command::new("git");
        command
            .args(READ_GIT_CONFIG)
            .args(args)
            .stderr(Stdio::null());
        // Keep the trusted wrapper's HOME/PATH/XDG/DOTFILES policy context.
        // Git redirects and environment-supplied config cannot select another input.
        for (name, _) in std::env::vars_os() {
            if name.as_bytes().starts_with(b"GIT_") {
                command.env_remove(name);
            }
        }
        command.envs(READ_GIT_ENV.iter().copied());
        command
    }

    pub(super) fn worker(
        operation: Option<&std::ffi::OsStr>,
        capabilities: &[std::ffi::OsString],
    ) -> i32 {
        let Some(operation) = ReadOperation::parse(operation) else {
            return 2;
        };
        let Some(startup) = super::worker_owner::Startup::parse(capabilities) else {
            return 2;
        };
        let directory = std::io::stderr();
        let Ok(metadata) = fstat(&directory) else {
            return 2;
        };
        if FileType::from_raw_mode(metadata.st_mode as _) != FileType::Directory {
            return 2;
        }
        if rustix::process::fchdir(&directory).is_err() {
            return 2;
        }
        let (_, limit) = operation_args(operation);
        let policy = if matches!(operation, ReadOperation::ObjectBatch) {
            super::worker_owner::InputPolicy::Objects
        } else {
            super::worker_owner::InputPolicy::Empty
        };
        super::worker_owner::supervise(
            readonly_git_command(operation),
            startup,
            limit,
            policy,
            None,
        )
    }

    fn safe_path(bytes: &[u8]) -> Result<String, Diagnostic> {
        let path = std::str::from_utf8(bytes).map_err(|_| error("invalid-path"))?;
        if path.is_empty()
            || path.chars().any(char::is_control)
            || path.contains('\\')
            || path.as_bytes().get(1) == Some(&b':')
            || path.split('/').any(|part| {
                part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git")
            })
        {
            return Err(error("invalid-path"));
        }
        Ok(path.to_owned())
    }

    fn records(bytes: &[u8]) -> Result<Vec<&[u8]>, Diagnostic> {
        if bytes.is_empty() {
            return Ok(Vec::new());
        }
        if bytes.last() != Some(&0) {
            return Err(error("git-format"));
        }
        Ok(bytes[..bytes.len() - 1].split(|byte| *byte == 0).collect())
    }

    fn index(bytes: &[u8]) -> Result<BTreeMap<String, Entry>, Diagnostic> {
        let mut entries = BTreeMap::new();
        for record in records(bytes)? {
            let tab = record
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or_else(|| error("git-format"))?;
            let path = safe_path(&record[tab + 1..])?;
            let header = std::str::from_utf8(&record[..tab]).map_err(|_| error("git-format"))?;
            let fields: Vec<_> = header.split(' ').collect();
            if fields.len() != 3 {
                return Err(error("git-format"));
            }
            if fields[2] != "0" {
                return Err(at("unmerged-index", &path));
            }
            let mode = u32::from_str_radix(fields[0], 8).map_err(|_| error("git-format"))?;
            if !matches!(mode, 0o100644 | 0o100755 | 0o120000) {
                return Err(at("unsupported-index-mode", &path));
            }
            let blob = fields[1];
            if !matches!(blob.len(), 40 | 64) || !blob.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(error("git-format"));
            }
            let entry = Entry {
                path: path.clone(),
                mode,
                blob: blob.to_owned(),
                bytes: Vec::new(),
            };
            if entries.insert(path, entry).is_some() {
                return Err(error("duplicate-index-path"));
            }
        }
        Ok(entries)
    }

    fn parse_paths(bytes: &[u8]) -> Result<Vec<String>, Diagnostic> {
        let mut paths = records(bytes)?
            .into_iter()
            .map(safe_path)
            .collect::<Result<Vec<_>, _>>()?;
        paths.sort();
        if paths.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(error("git-format"));
        }
        Ok(paths)
    }

    fn list_untracked(root: &HeldRoot, include_ignored: bool) -> Result<Vec<u8>, Diagnostic> {
        let operation = if include_ignored {
            ReadOperation::AllUntracked
        } else {
            ReadOperation::Untracked
        };
        git(root, operation, Vec::new())
    }

    fn parent_directory(root: &File, path: &str) -> Result<File, Diagnostic> {
        let parts: Vec<_> = path.split('/').collect();
        let mut parent = root
            .try_clone()
            .map_err(|_| at("working-tree-parent", path))?;
        for part in &parts[..parts.len() - 1] {
            let fd = openat(
                &parent,
                *part,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| at("working-tree-parent", path))?;
            parent = File::from(fd);
        }
        Ok(parent)
    }

    fn ignored_metadata(root: &File, paths: &[String]) -> Result<Vec<IgnoredEntry>, Diagnostic> {
        paths
            .iter()
            .map(|path| {
                let parent = parent_directory(root, path)?;
                let leaf = path
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| error("invalid-path"))?;
                let metadata = statat(&parent, leaf, AtFlags::SYMLINK_NOFOLLOW)
                    .map_err(|_| at("working-tree-type", path))?;
                let kind = FileType::from_raw_mode(metadata.st_mode as _);
                if !matches!(kind, FileType::RegularFile | FileType::Symlink) {
                    return Err(at("working-tree-type", path));
                }
                Ok(IgnoredEntry {
                    path: path.clone(),
                    executable: kind == FileType::RegularFile
                        && metadata.st_mode as u32 & 0o111 != 0,
                    symlink: kind == FileType::Symlink,
                })
            })
            .collect()
    }

    fn objects(
        root: &HeldRoot,
        entries: &BTreeMap<String, Entry>,
    ) -> Result<BTreeMap<String, Vec<u8>>, Diagnostic> {
        let ids: BTreeSet<_> = entries.values().map(|entry| entry.blob.as_str()).collect();
        if ids.is_empty() {
            return Ok(BTreeMap::new());
        }
        let input = ids
            .iter()
            .flat_map(|id| id.bytes().chain(std::iter::once(b'\n')))
            .collect();
        let output = git(root, ReadOperation::ObjectBatch, input)?;
        let mut offset = 0usize;
        let mut total = 0usize;
        let mut objects = BTreeMap::new();
        for id in ids {
            let remaining = output.get(offset..).ok_or_else(|| error("git-object"))?;
            let newline = remaining
                .iter()
                .position(|byte| *byte == b'\n')
                .ok_or_else(|| error("git-object"))?;
            let header =
                std::str::from_utf8(&remaining[..newline]).map_err(|_| error("git-object"))?;
            let fields: Vec<_> = header.split(' ').collect();
            if fields.len() != 3 || fields[0] != id || fields[1] != "blob" {
                return Err(error("git-object"));
            }
            let size = fields[2]
                .parse::<usize>()
                .map_err(|_| error("git-object"))?;
            total = total
                .checked_add(size)
                .ok_or_else(|| error("source-limit"))?;
            if size > FILE_LIMIT || total > TOTAL_LIMIT {
                return Err(error("source-limit"));
            }
            offset += newline + 1;
            let end = offset
                .checked_add(size)
                .ok_or_else(|| error("git-object"))?;
            let bytes = output.get(offset..end).ok_or_else(|| error("git-object"))?;
            if output.get(end) != Some(&b'\n') {
                return Err(error("git-object"));
            }
            objects.insert(id.to_owned(), bytes.to_vec());
            offset = end + 1;
        }
        if offset != output.len() {
            return Err(error("git-object"));
        }
        Ok(objects)
    }

    fn working(root: &File, entry: &Entry) -> Result<Vec<u8>, Diagnostic> {
        let path = entry.path.as_str();
        let parent = parent_directory(root, path)?;
        let leaf = path
            .rsplit('/')
            .next()
            .ok_or_else(|| error("invalid-path"))?;
        if entry.mode == 0o120000 {
            let mut bytes = vec![0u8; LINK_LIMIT + 1];
            let length = readlinkat_raw(&parent, leaf, bytes.as_mut_slice())
                .map_err(|_| at("working-tree-type", path))?;
            if length > LINK_LIMIT {
                return Err(at("source-limit", path));
            }
            bytes.truncate(length);
            return Ok(bytes);
        }
        let fd = openat(
            &parent,
            leaf,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| at("working-tree-type", path))?;
        let file = File::from(fd);
        let metadata = file.metadata().map_err(|_| at("working-tree-type", path))?;
        if !metadata.is_file() {
            return Err(at("working-tree-type", path));
        }
        if (metadata.mode() & 0o111 != 0) != (entry.mode == 0o100755) {
            return Err(at("unstaged-mode", path));
        }
        if metadata.len() > FILE_LIMIT as u64 {
            return Err(at("source-limit", path));
        }
        let mut bytes = Vec::new();
        file.take(FILE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| at("working-tree-read", path))?;
        if bytes.len() > FILE_LIMIT {
            return Err(at("source-limit", path));
        }
        Ok(bytes)
    }

    pub(super) fn read(selected: &Path) -> Result<Snapshot, Diagnostic> {
        let root = HeldRoot::open(selected)?;
        read_held(&root)
    }

    fn read_held(root: &HeldRoot) -> Result<Snapshot, Diagnostic> {
        if git(root, ReadOperation::RootPrefix, Vec::new())? != b"\n" {
            return Err(error("repository-root"));
        }
        let index_bytes = root.read_index_metadata()?;
        let new_bytes = list_untracked(root, false)?;
        let all_new_bytes = list_untracked(root, true)?;
        let mut entries = index(&index_bytes)?;
        let untracked = parse_paths(&new_bytes)?;
        let normal: BTreeSet<_> = untracked.iter().map(String::as_str).collect();
        let ignored_paths: Vec<_> = parse_paths(&all_new_bytes)?
            .into_iter()
            .filter(|path| !normal.contains(path.as_str()))
            .collect();
        let objects = objects(root, &entries)?;
        let root_file = &root.file;
        let ignored = ignored_metadata(root_file, &ignored_paths)?;
        let mut total = 0usize;
        for entry in entries.values_mut() {
            let expected = objects
                .get(&entry.blob)
                .ok_or_else(|| error("git-object"))?;
            total = total
                .checked_add(expected.len())
                .ok_or_else(|| error("source-limit"))?;
            if total > TOTAL_LIMIT {
                return Err(error("source-limit"));
            }
            let bytes = working(root_file, entry)?;
            if bytes != *expected {
                return Err(at("unstaged-content", &entry.path));
            }
            entry.bytes = bytes;
        }
        if root.read_index_metadata()? != index_bytes
            || list_untracked(root, false)? != new_bytes
            || list_untracked(root, true)? != all_new_bytes
            || ignored_metadata(root_file, &ignored_paths)? != ignored
        {
            return Err(error("index-changed"));
        }
        Ok(Snapshot {
            entries,
            untracked,
            ignored,
        })
    }
}
