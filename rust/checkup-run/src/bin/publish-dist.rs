// Publish one qualified source build without moving the checkout or launcher.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn publish() -> Result<(), Box<dyn std::error::Error>> {
    use rustix::fd::OwnedFd;
    use rustix::fs::{self, AtFlags, FileType, FlockOperation, Mode, OFlags, RenameFlags};
    use rustix::io::Errno;
    use rustix::process::getuid;

    const DIR: OFlags = OFlags::RDONLY
        .union(OFlags::DIRECTORY)
        .union(OFlags::CLOEXEC)
        .union(OFlags::NOFOLLOW);

    fn owned_dir(fd: &OwnedFd, private: bool) -> Result<(), Box<dyn std::error::Error>> {
        let st = fs::fstat(fd)?;
        let forbidden = if private { 0o077 } else { 0o022 };
        if st.st_uid != getuid().as_raw() || st.st_mode & forbidden != 0 {
            return Err("unsafe directory".into());
        }
        Ok(())
    }

    fn identity(st: &fs::Stat) -> String {
        format!("{}:{}", st.st_dev, st.st_ino)
    }

    let args: Vec<String> = std::env::args().skip(1).collect();
    let [repo_path, stage_name, previous, head, repo_identity, stage_identity, candidate_identity] =
        args.as_slice()
    else {
        return Err("invalid publisher arguments".into());
    };
    if !std::path::Path::new(repo_path).is_absolute()
        || !stage_name
            .strip_prefix(".agentbrew-build.")
            .is_some_and(|name| {
                name.len() == 8 && name.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
    {
        return Err("invalid build path".into());
    }

    let repo = fs::open(repo_path.as_str(), DIR, Mode::empty())?;
    owned_dir(&repo, false)?;
    let repo_st = fs::fstat(&repo)?;
    if repo_identity != &identity(&repo_st) {
        return Err("checkout moved during build".into());
    }
    let stage = fs::openat(&repo, stage_name.as_str(), DIR, Mode::empty())?;
    owned_dir(&stage, true)?;
    if stage_identity != &identity(&fs::fstat(&stage)?) {
        return Err("build stage moved".into());
    }
    let candidate = fs::openat(&stage, "dist", DIR, Mode::empty())?;
    owned_dir(&candidate, false)?;
    if candidate_identity != &identity(&fs::fstat(&candidate)?) {
        return Err("staged build moved".into());
    }
    for name in [
        "cli.js",
        "build-info.json",
        "native/darwin-arm64/checkup-run",
        "native/darwin-arm64/judge-source",
    ] {
        let st = fs::statat(&candidate, name, AtFlags::SYMLINK_NOFOLLOW)?;
        if FileType::from_raw_mode(st.st_mode) != FileType::RegularFile
            || st.st_uid != getuid().as_raw()
            || st.st_nlink != 1
            || st.st_size == 0
            || st.st_mode & 0o022 != 0
        {
            return Err("unsafe candidate asset".into());
        }
    }

    let lock = fs::openat(
        &repo,
        ".agentbrew-build.lock",
        OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )?;
    let lock_stat = fs::fstat(&lock)?;
    if FileType::from_raw_mode(lock_stat.st_mode) != FileType::RegularFile
        || lock_stat.st_uid != getuid().as_raw()
        || lock_stat.st_nlink != 1
        || lock_stat.st_mode & 0o077 != 0
    {
        return Err("unsafe publication lock".into());
    }
    fs::flock(&lock, FlockOperation::NonBlockingLockExclusive)?;

    let git = std::process::Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(repo_path)
        .output()?;
    let current_head = if git.status.success() {
        std::str::from_utf8(&git.stdout)?.trim()
    } else {
        ""
    };
    if current_head != head {
        return Err("source moved during build".into());
    }
    if repo_identity
        != &identity(&fs::statat(
            fs::CWD,
            repo_path.as_str(),
            AtFlags::SYMLINK_NOFOLLOW,
        )?)
        || stage_identity
            != &identity(&fs::statat(
                &repo,
                stage_name.as_str(),
                AtFlags::SYMLINK_NOFOLLOW,
            )?)
        || candidate_identity != &identity(&fs::statat(&stage, "dist", AtFlags::SYMLINK_NOFOLLOW)?)
    {
        return Err("staged build moved".into());
    }
    let flags = match fs::statat(&repo, "dist", AtFlags::SYMLINK_NOFOLLOW) {
        Err(Errno::NOENT) if previous == "absent" => RenameFlags::NOREPLACE,
        Ok(st)
            if FileType::from_raw_mode(st.st_mode) == FileType::Directory
                && st.st_uid == getuid().as_raw()
                && st.st_mode & 0o022 == 0
                && previous == &identity(&st) =>
        {
            RenameFlags::EXCHANGE
        }
        _ => return Err("predecessor moved during build".into()),
    };
    fs::renameat_with(&stage, "dist", &repo, "dist", flags)?;
    Ok(())
}

fn main() {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if publish().is_ok() {
        return;
    }
    eprintln!("agentbrew: could not publish staged build");
    std::process::exit(1);
}
