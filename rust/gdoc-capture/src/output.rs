use crate::{valid_id, Output, Stop};
use rustix::fd::OwnedFd;
use rustix::fs::{self, AtFlags, FileType, Mode, OFlags, RenameFlags, Stat};
use rustix::process::geteuid;
use std::io::{Read, Write};

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const PRIVATE_FILE: Mode = Mode::RUSR.union(Mode::WUSR);
const PRIVATE_DIR: Mode = PRIVATE_FILE.union(Mode::XUSR);
const OPEN_DIR: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);

fn checked_dir(dir: &OwnedFd) -> Result<(), Stop> {
    let stat = fs::fstat(dir).map_err(|_| Stop::Operation)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::Directory
        || stat.st_uid != geteuid().as_raw()
        || stat.st_mode & 0o7777 != 0o700
    {
        return Err(Stop::Operation);
    }
    Ok(())
}

fn checked_file(stat: &Stat) -> bool {
    FileType::from_raw_mode(stat.st_mode) == FileType::RegularFile
        && stat.st_uid == geteuid().as_raw()
        && stat.st_mode & 0o7777 == 0o600
        && stat.st_nlink == 1
}

fn create(dir: &OwnedFd, name: &str, bytes: &[u8]) -> Result<Stat, Stop> {
    let fd = fs::openat(
        dir,
        name,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        PRIVATE_FILE,
    )
    .map_err(|_| Stop::Operation)?;
    let stat = fs::fstat(&fd).map_err(|_| Stop::Operation)?;
    if !checked_file(&stat) {
        return Err(Stop::Operation);
    }
    let mut file = std::fs::File::from(fd);
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| Stop::Operation)?;
    Ok(stat)
}

pub struct HeldOutput {
    parent: OwnedFd,
    run: Option<(String, OwnedFd)>,
    recovery: Option<Stat>,
    saved: u8,
    closed: bool,
}

impl HeldOutput {
    pub fn new(parent: OwnedFd) -> Result<Self, Stop> {
        checked_dir(&parent)?;
        Ok(Self {
            parent,
            run: None,
            recovery: None,
            saved: 0,
            closed: false,
        })
    }

    fn run_fd(&self) -> Result<&OwnedFd, Stop> {
        self.run.as_ref().map(|(_, fd)| fd).ok_or(Stop::Operation)
    }

    pub fn read_image(&self, dir: &str, file: &str) -> Result<Vec<u8>, Stop> {
        if !dir.starts_with("agent-tab-") || !valid_id(dir) || file != "screenshot.png" {
            return Err(Stop::Operation);
        }
        let shots = fs::openat(self.run_fd()?, dir, OPEN_DIR, Mode::empty())
            .map_err(|_| Stop::Operation)?;
        checked_dir(&shots)?;
        let fd = fs::openat(
            &shots,
            file,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Stop::Operation)?;
        let stat = fs::fstat(&fd).map_err(|_| Stop::Operation)?;
        if !checked_file(&stat) || stat.st_size <= 0 || stat.st_size as u64 > MAX_IMAGE_BYTES as u64
        {
            return Err(Stop::InvalidPng);
        }
        let mut bytes = Vec::new();
        std::fs::File::from(fd)
            .take((MAX_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| Stop::Operation)?;
        if bytes.len() != stat.st_size as usize || bytes.len() > MAX_IMAGE_BYTES {
            return Err(Stop::InvalidPng);
        }
        Ok(bytes)
    }
}

impl Output for HeldOutput {
    fn prepare(&mut self, run: &str) -> Result<(), Stop> {
        if self.run.is_some() || !valid_id(run) {
            return Err(Stop::Operation);
        }
        fs::mkdirat(&self.parent, run, PRIVATE_DIR).map_err(|_| Stop::Operation)?;
        let dir =
            fs::openat(&self.parent, run, OPEN_DIR, Mode::empty()).map_err(|_| Stop::Operation)?;
        checked_dir(&dir)?;
        self.run = Some((run.into(), dir));
        Ok(())
    }

    fn remember(&mut self, owner: &str, target: &str) -> Result<(), Stop> {
        let (run, dir) = self.run.as_ref().ok_or(Stop::Operation)?;
        if run != owner || !valid_id(target) || self.recovery.is_some() || self.closed {
            return Err(Stop::Operation);
        }
        let receipt = format!("{{\"owner\":\"{owner}\",\"target\":\"{target}\"}}\n");
        self.recovery = Some(create(dir, "recovery.json", receipt.as_bytes())?);
        Ok(())
    }

    fn save(&mut self, page: u8, image: &[u8]) -> Result<(), Stop> {
        if self.recovery.is_none()
            || self.closed
            || !(1..=10).contains(&page)
            || page != self.saved + 1
            || image.is_empty()
            || image.len() > MAX_IMAGE_BYTES
        {
            return Err(Stop::Operation);
        }
        create(self.run_fd()?, &format!("page-{page:02}.png"), image)?;
        self.saved = page;
        Ok(())
    }

    fn clear_recovery(&mut self) -> Result<(), Stop> {
        let dir = self.run_fd()?;
        let expected = self.recovery.as_ref().ok_or(Stop::Operation)?;
        let actual = fs::statat(dir, "recovery.json", AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| Stop::Operation)?;
        if !checked_file(&actual)
            || (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino)
        {
            return Err(Stop::Operation);
        }
        fs::unlinkat(dir, "recovery.json", AtFlags::empty()).map_err(|_| Stop::Operation)?;
        self.recovery = None;
        self.closed = true;
        Ok(())
    }

    fn publish(&mut self, pages: u8) -> Result<(), Stop> {
        if !self.closed || pages != 10 || self.saved != pages {
            return Err(Stop::Operation);
        }
        let dir = self.run_fd()?;
        create(dir, ".manifest.pending", b"{\"pages\":10}\n")?;
        fs::renameat_with(
            dir,
            ".manifest.pending",
            dir,
            "manifest.json",
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| Stop::Operation)
    }
}
