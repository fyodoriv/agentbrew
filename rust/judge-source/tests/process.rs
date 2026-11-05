#![cfg(unix)]

use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use std::process::Command;

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn process_returns_only_qualified_bytes() {
    let fixture = Fixture(
        std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("agentbrew-judge-process-{}", std::process::id())),
    );
    let owner = fixture.0.join("owner");
    fs::create_dir_all(&owner).unwrap();
    fs::write(owner.join("clarity.md"), b"clarity\n").unwrap();
    fs::write(fixture.0.join("outside.md"), b"outside\n").unwrap();
    symlink(fixture.0.join("outside.md"), owner.join("link.md")).unwrap();

    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_judge-source"))
            .arg(&owner)
            .args(args)
            .output()
            .unwrap()
    };

    let allowed = run(&["clarity.md"]);
    assert_eq!(allowed.status.code(), Some(0));
    assert_eq!(allowed.stdout, b"clarity\n");
    assert!(allowed.stderr.is_empty());

    for args in [&["link.md"][..], &["clarity.md", "extra"][..]] {
        let refused = run(args);
        assert_eq!(refused.status.code(), Some(2));
        assert!(refused.stdout.is_empty());
        assert_eq!(refused.stderr, b"Judge source unavailable.\n");
    }
}
