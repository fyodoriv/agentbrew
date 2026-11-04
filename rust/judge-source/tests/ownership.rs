#![cfg(unix)]

use judge_source::JudgeRoot;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().canonicalize().unwrap();
        let path = base.join(format!("agentbrew-judge-source-{}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn reads_only_bounded_markdown_from_the_held_root() {
    let fixture = Fixture::new();
    let owner = fixture.0.join("owner");
    let judges = owner.join("judges");
    fs::create_dir_all(&judges).unwrap();
    fs::write(judges.join("clarity.md"), b"clarity\n").unwrap();
    fs::create_dir(judges.join("directory.md")).unwrap();
    fs::write(fixture.0.join("outside.md"), b"outside\n").unwrap();
    fs::write(owner.join("local.txt"), b"local\n").unwrap();
    fs::write(judges.join("oversize.md"), vec![0; 128 * 1024 + 1]).unwrap();
    symlink(fixture.0.join("outside.md"), judges.join("external.md")).unwrap();
    symlink(owner.join("local.txt"), judges.join("internal.md")).unwrap();
    symlink(&fixture.0, owner.join("linked-directory")).unwrap();
    fs::hard_link(fixture.0.join("outside.md"), judges.join("hardlink.md")).unwrap();

    let root = JudgeRoot::open(&owner).unwrap();
    let held_judges = JudgeRoot::open(&judges).unwrap();
    assert_eq!(root.read("judges/clarity.md").unwrap(), b"clarity\n");
    for path in [
        "judges/missing.md",
        "judges/directory.md",
        "judges/external.md",
        "judges/internal.md",
        "linked-directory/outside.md",
        "judges/hardlink.md",
        "../outside.md",
        "local.txt",
        "judges/oversize.md",
    ] {
        assert!(root.read(path).is_err(), "{path} must be refused");
    }

    fs::rename(&judges, owner.join("held-judges")).unwrap();
    fs::create_dir(fixture.0.join("outside-judges")).unwrap();
    fs::write(fixture.0.join("outside-judges/clarity.md"), b"substitute\n").unwrap();
    symlink(fixture.0.join("outside-judges"), &judges).unwrap();
    assert!(root.read("judges/clarity.md").is_err());
    assert_eq!(held_judges.read("clarity.md").unwrap(), b"clarity\n");
    fs::remove_file(&judges).unwrap();
    fs::rename(owner.join("held-judges"), &judges).unwrap();

    fs::rename(&owner, fixture.0.join("held")).unwrap();
    fs::create_dir_all(fixture.0.join("replacement/judges")).unwrap();
    fs::write(fixture.0.join("replacement/judges/clarity.md"), b"substitute\n").unwrap();
    symlink(fixture.0.join("replacement"), &owner).unwrap();
    assert_eq!(root.read("judges/clarity.md").unwrap(), b"clarity\n");
    assert!(JudgeRoot::open(&owner).is_err());
}
