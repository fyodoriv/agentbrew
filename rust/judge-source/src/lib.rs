#![cfg(unix)]

use rustix::fs::{self, FileType, Mode, OFlags};
use rustix::io::Errno;
use std::fs::File;
use std::io::{self, Read};
use std::os::fd::OwnedFd;
use std::path::{Component, Path};

const MAX_SOURCE_BYTES: usize = 128 * 1024;
const DIRECTORY: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);
const SOURCE_FILE: OFlags = OFlags::RDONLY
    .union(OFlags::NOFOLLOW)
    .union(OFlags::NONBLOCK)
    .union(OFlags::CLOEXEC);

pub struct JudgeRoot(OwnedFd);

impl JudgeRoot {
    pub fn open(path: &Path) -> io::Result<Self> {
        let mut components = path.components();
        if components.next() != Some(Component::RootDir) {
            return Err(Errno::INVAL.into());
        }
        let mut directory = fs::open("/", DIRECTORY, Mode::empty())?;
        for component in components {
            let Component::Normal(name) = component else {
                return Err(Errno::INVAL.into());
            };
            directory = fs::openat(&directory, name, DIRECTORY, Mode::empty())?;
        }
        Ok(Self(directory))
    }

    pub fn read(&self, declaration: &str) -> io::Result<Vec<u8>> {
        let path = declaration.strip_prefix("./").unwrap_or(declaration);
        if !path.ends_with(".md")
            || path.bytes().any(|byte| byte.is_ascii_control() || matches!(byte, b'\\' | b':'))
            || path.split('/').any(|name| matches!(name, "" | "." | ".."))
        {
            return Err(Errno::INVAL.into());
        }

        let mut components = path.rsplit('/');
        let leaf = components.next().ok_or(Errno::INVAL)?;
        let mut directory = None;
        for name in components.rev() {
            let parent = directory.as_ref().unwrap_or(&self.0);
            directory = Some(fs::openat(parent, name, DIRECTORY, Mode::empty())?);
        }
        read_leaf(directory.as_ref().unwrap_or(&self.0), leaf)
    }
}

fn read_leaf(parent: &OwnedFd, name: &str) -> io::Result<Vec<u8>> {
    let fd = fs::openat(parent, name, SOURCE_FILE, Mode::empty())?;
    let stat = fs::fstat(&fd)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile || stat.st_nlink != 1 {
        return Err(Errno::INVAL.into());
    }
    if stat.st_size < 0 || stat.st_size as u64 > MAX_SOURCE_BYTES as u64 {
        return Err(Errno::FBIG.into());
    }
    let mut bytes = Vec::new();
    File::from(fd)
        .take((MAX_SOURCE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(Errno::FBIG.into());
    }
    Ok(bytes)
}
