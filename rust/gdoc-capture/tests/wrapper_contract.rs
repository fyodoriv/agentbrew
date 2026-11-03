use gdoc_capture::{output::HeldOutput, wire, Command, Output};
use rustix::fs::{self, Mode, OFlags};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[test]
fn w01a_exact_open() {
    let wire = wire::project(
        Command::Open {
            owner: "run-a",
            lease_secs: 300,
        },
        wire::URL,
    )
    .unwrap();
    assert_eq!(
        wire.argv,
        [
            "open",
            "--owner",
            "run-a",
            "--reason",
            "docs-capture",
            "--lease",
            "300",
            "https://example.com/synthetic-doc"
        ]
    );
    assert!(wire.stdin.is_none());
}

#[test]
fn w01b_exact_page_and_close() {
    let position = wire::project(
        Command::Position {
            owner: "run-a",
            target: "T_1",
            page: 5,
        },
        wire::URL,
    )
    .unwrap();
    let observe = wire::project(
        Command::Observe {
            owner: "run-a",
            target: "T_1",
        },
        wire::URL,
    )
    .unwrap();
    for call in [&position, &observe] {
        assert_eq!(call.argv, ["eval", "--owner", "run-a", "T_1", "-"]);
        assert!(call.stdin.as_ref().is_some_and(|s| s.len() < 4096));
    }
    assert_eq!(position.stdin.as_deref(), Some("fixture.position(5)"));
    assert_eq!(observe.stdin.as_deref(), Some("fixture.observe()"));
    let shot = wire::project(
        Command::Shot {
            owner: "run-a",
            target: "T_1",
        },
        wire::URL,
    )
    .unwrap();
    assert_eq!(shot.argv, ["shot", "--owner", "run-a", "T_1"]);
    assert!(shot.stdin.is_none());
    let close = wire::project(
        Command::CloseVerified {
            owner: "run-a",
            target: "T_1",
        },
        wire::URL,
    )
    .unwrap();
    assert_eq!(close.argv, ["close-verified", "--owner", "run-a", "T_1"]);
    assert!(close.stdin.is_none());
}

#[test]
fn w02a_refuse_unrelated_owner() {
    assert!(!wire::reviewed_owner(b"agent-tab help: close-verified\n"));
    let path = std::env::var_os("GDOC_QUALIFIED_OWNER").expect("disposable pinned owner fixture");
    let mut bytes = std::fs::read(path).unwrap();
    assert!(wire::reviewed_owner(&bytes));
    bytes.push(0);
    assert!(!wire::reviewed_owner(&bytes));
}

#[test]
fn w02b_refuse_invalid_authority() {
    assert!(wire::project(
        Command::Open {
            owner: "run-a",
            lease_secs: 300
        },
        "https://example.com/other"
    )
    .is_err());
    assert!(wire::project(
        Command::Open {
            owner: "--reason",
            lease_secs: 300
        },
        wire::URL
    )
    .is_err());
    assert!(wire::project(
        Command::Shot {
            owner: "run-a",
            target: "../T_1"
        },
        wire::URL
    )
    .is_err());
}

#[test]
fn w03_exact_terminal_output() {
    assert_eq!(wire::open_id(b"T_1\n").unwrap(), "T_1");
    assert!(wire::verified_close(b"agent-tab: closed T_1\n", "T_1").is_ok());
    assert!(wire::open_id(b"T_1\nextra\n").is_err());
    assert!(wire::open_id(&vec![b'A'; 65_537]).is_err());
    assert!(wire::verified_close(b"agent-tab: closed T_2\n", "T_1").is_err());
}

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        use std::os::unix::fs::DirBuilderExt;
        let path = std::env::temp_dir().join(format!(
            "gdoc-wrapper-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        Self(path)
    }
    fn output(&self) -> HeldOutput {
        HeldOutput::new(
            fs::open(
                &self.0,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW,
                Mode::empty(),
            )
            .unwrap(),
        )
        .unwrap()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn put(path: &Path, contents: &[u8]) {
    std::fs::write(path, contents).unwrap();
}

fn fill(out: &mut HeldOutput) {
    for page in 1..=10 {
        out.save(page, &[page]).unwrap();
    }
}

#[test]
fn w08_complete_publication() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    out.remember("run-a", "T_1").unwrap();
    fill(&mut out);
    let run = scratch.0.join("run-a");
    assert_eq!(
        std::fs::metadata(&run).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(run.join("page-01.png"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(!run.join("manifest.json").exists());
    assert!(out.publish(10).is_err());
    assert!(!run.join("manifest.json").exists());
    out.clear_recovery().unwrap();
    out.publish(10).unwrap();
    assert_eq!(
        std::fs::read(run.join("manifest.json")).unwrap(),
        b"{\"pages\":10}\n"
    );
    assert_eq!(std::fs::read(run.join("page-10.png")).unwrap(), [10]);
    assert!(!run.join("recovery.json").exists());
}

#[test]
fn w08b_held_directory_survives_name_replacement() {
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    let original = scratch.0.join("original");
    let replacement = scratch.0.join("run-a");
    std::fs::rename(&replacement, &original).unwrap();
    std::fs::create_dir(&replacement).unwrap();
    out.remember("run-a", "T_1").unwrap();
    assert!(original.join("recovery.json").is_file());
    assert!(!replacement.join("recovery.json").exists());
}

#[test]
fn w09_no_foreign_replacement() {
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    out.remember("run-a", "T_1").unwrap();
    fill(&mut out);
    out.clear_recovery().unwrap();
    let sentinel = scratch.0.join("foreign");
    put(&sentinel, b"original");
    let manifest = scratch.0.join("run-a/manifest.json");
    std::os::unix::fs::symlink(&sentinel, &manifest).unwrap();
    assert!(out.publish(10).is_err());
    assert!(std::fs::symlink_metadata(&manifest)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(std::fs::read(sentinel).unwrap(), b"original");
}

#[test]
fn w10_no_escape_symlink_or_oversize_image() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    let shots = scratch.0.join("run-a/agent-tab-T_1-fixture");
    std::fs::create_dir(&shots).unwrap();
    std::fs::set_permissions(&shots, std::fs::Permissions::from_mode(0o700)).unwrap();
    let img = shots.join("screenshot.png");
    put(&img, b"image");
    std::fs::set_permissions(&img, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        out.read_image("agent-tab-T_1-fixture", "screenshot.png")
            .unwrap(),
        b"image"
    );
    assert!(out.read_image("../run-a", "screenshot.png").is_err());
    std::os::unix::fs::symlink(&img, shots.join("link.png")).unwrap();
    assert!(out.read_image("agent-tab-T_1-fixture", "link.png").is_err());
    std::fs::OpenOptions::new()
        .write(true)
        .open(&img)
        .unwrap()
        .set_len(8 * 1024 * 1024 + 1)
        .unwrap();
    assert!(out
        .read_image("agent-tab-T_1-fixture", "screenshot.png")
        .is_err());
}

#[test]
fn w11_recovery_failure_preserves_existing_receipt() {
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    let recovery = scratch.0.join("run-a/recovery.json");
    put(&recovery, b"foreign receipt");
    assert!(out.remember("run-a", "T_1").is_err());
    assert_eq!(std::fs::read(recovery).unwrap(), b"foreign receipt");
    assert!(!scratch.0.join("run-a/manifest.json").exists());
}

#[test]
fn w10b_refuses_symlink_at_canonical_screenshot_name() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let scratch = Scratch::new();
    let mut out = scratch.output();
    out.prepare("run-a").unwrap();
    let shot_name = "agent-tab-T_1-fixture";
    let shots = scratch.0.join("run-a").join(shot_name);
    std::fs::create_dir(&shots).unwrap();
    std::fs::set_permissions(&shots, std::fs::Permissions::from_mode(0o700)).unwrap();
    let screenshot = shots.join("screenshot.png");
    let sentinel = scratch.0.join("foreign-screenshot.png");
    put(&screenshot, b"known image");
    put(&sentinel, b"foreign image");
    for file in [&screenshot, &sentinel] {
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    assert_eq!(
        out.read_image(shot_name, "screenshot.png").unwrap(),
        b"known image"
    );
    std::fs::remove_file(&screenshot).unwrap();
    symlink(&sentinel, &screenshot).unwrap();
    assert!(
        out.read_image(shot_name, "screenshot.png").is_err(),
        "canonical symlink opened"
    );
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"foreign image");
    assert!(std::fs::symlink_metadata(&screenshot)
        .unwrap()
        .file_type()
        .is_symlink());
}
