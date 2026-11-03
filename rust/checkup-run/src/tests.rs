use super::*;
use std::fs::{self as disk, OpenOptions};
use std::os::unix::fs::{symlink, DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const A: &str = "2026-01-01T00:00:00Z";
const B: &str = "2026-01-01T00:00:01Z";

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let base = std::env::temp_dir().canonicalize().unwrap();
        for _ in 0..128 {
            let path = base.join(format!(
                "checkup-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match disk::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => return Self(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("scratch setup failed: {error}"),
            }
        }
        panic!("scratch namespace exhausted");
    }

    fn store(&self) -> Store {
        Store::new(self.0.join("state")).unwrap()
    }

    fn record_path(&self) -> PathBuf {
        self.0.join("state/checkups/fixture.json")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = disk::remove_dir_all(&self.0);
    }
}

fn record(time: &str, result: ResultKind, sha: &str) -> Record {
    Record::new(time.into(), result, vec![("repo".into(), sha.into())]).unwrap()
}

fn green(time: &str) -> Record {
    record(time, ResultKind::Green, "abcdef0")
}

fn write_private(path: &Path, bytes: &[u8]) {
    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .unwrap()
        .write_all(bytes)
        .unwrap();
}

fn shown(store: &Store, name: &str) -> Record {
    match store.show(name).unwrap() {
        Report::Present { record, .. } => record,
        other => panic!("expected present: {other:?}"),
    }
}

#[test]
fn first_show_is_read_only() {
    let root = Scratch::new();
    let show = root.store().show("fixture").unwrap();
    assert_eq!(
        serde_json::to_value(&show).unwrap(),
        serde_json::json!({"status":"missing","record":null,"record_sha256":null})
    );
    assert_eq!(show.human(), "First run: no previous checkup record\n");
    assert!(!root.0.join("state").exists());
    disk::create_dir(root.0.join("state")).unwrap();
    assert!(matches!(
        root.store().show("fixture"),
        Ok(Report::Missing { .. })
    ));
    assert!(disk::read_dir(root.0.join("state"))
        .unwrap()
        .next()
        .is_none());
}

#[test]
fn two_completed_runs_preserve_previous_context() {
    let root = Scratch::new();
    let store = root.store();
    let first = record("2026-01-01T01:00:00+01:00", ResultKind::Green, "ABCDEF0");
    let second = record(B, ResultKind::Green, "abcdef1");
    assert!(matches!(
        store.record("fixture", first),
        Ok(Report::Recorded { changed: true, .. })
    ));
    assert_eq!(shown(&store, "fixture"), green(A));
    assert!(matches!(store.show("another"), Ok(Report::Missing { .. })));
    store.record("another", green(A)).unwrap();
    store.record("fixture", second.clone()).unwrap();
    assert_eq!(shown(&store, "fixture"), second);
    assert_eq!(shown(&store, "another"), green(A));
    let actual = disk::read(root.record_path()).unwrap();
    assert_eq!(
        serde_json::to_value(store.show("fixture").unwrap()).unwrap(),
        serde_json::json!({"status":"present","record":second,"record_sha256":hash(&actual)})
    );
    assert_eq!(
        store.show("fixture").unwrap().human(),
        "Previous completed checkup: 2026-01-01T00:00:01Z green\n  repo: abcdef1\n"
    );
}

#[test]
fn closed_results_roundtrip() {
    let root = Scratch::new();
    let store = root.store();
    for label in ["green", "degraded", "blocked"] {
        let value = record(A, ResultKind::parse(label).unwrap(), "abcdef0");
        store.record(label, value.clone()).unwrap();
        assert_eq!(shown(&store, label), value);
        assert_eq!(serde_json::to_value(value).unwrap()["result"], label);
    }
    assert_eq!(ResultKind::parse("healthy"), Err(Error::InvalidInput));
}

struct OwnedChild(Option<Child>);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[test]
fn interrupted_before_publish_preserves_previous() {
    let root = Scratch::new();
    let store = root.store();
    store.record("fixture", green(A)).unwrap();
    let before = disk::read(root.record_path()).unwrap();
    let child = Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "tests::interruptible_writer"])
        .env_clear()
        .env("CHECKUP_TEST_CHILD_ROOT", &root.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut guard = OwnedChild(Some(child));
    let ready = root.0.join("ready");
    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready.exists() {
        assert!(
            Instant::now() < deadline,
            "writer failed to reach the ready barrier"
        );
        assert!(
            guard.0.as_mut().unwrap().try_wait().unwrap().is_none(),
            "writer exited before the barrier"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(disk::read(root.record_path()).unwrap(), before);
    assert_eq!(store.record("fixture", green(B)).unwrap_err(), Error::Busy);
    let mut child = guard.0.take().unwrap();
    child.kill().unwrap();
    assert!(!child.wait().unwrap().success());
    assert_eq!(disk::read(root.record_path()).unwrap(), before);
    store.record("fixture", green(B)).unwrap();
    assert_eq!(shown(&store, "fixture"), green(B));
}

#[test]
#[ignore = "spawned by the interruption control"]
fn interruptible_writer() {
    let Some(root) = std::env::var_os("CHECKUP_TEST_CHILD_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let store = Store::new(root.join("state")).unwrap();
    let result = store.publish("fixture", green(B), |phase| {
        if phase == Publication::BeforeRename {
            disk::write(root.join("ready"), b"ready").unwrap();
            let mut release = String::new();
            std::io::stdin().read_line(&mut release).unwrap();
            return Err(Error::Io);
        }
        Ok(())
    });
    assert_eq!(result.unwrap_err(), Error::Io);
}

#[test]
fn invalid_inputs_preserve_previous() {
    let root = Scratch::new();
    let store = root.store();
    store.record("fixture", green(A)).unwrap();
    let old = disk::read(root.record_path()).unwrap();
    for label in ["", "../outside", "a/b", &"a".repeat(65)] {
        assert_eq!(
            store.record(label, green(B)).unwrap_err(),
            Error::InvalidInput
        );
    }
    for sha in ["abc", "zzzzzzz", &"a".repeat(65)] {
        assert_eq!(
            Record::new(
                B.into(),
                ResultKind::Green,
                vec![("repo".into(), sha.into())]
            ),
            Err(Error::InvalidInput)
        );
    }
    assert_eq!(
        Record::new(
            B.into(),
            ResultKind::Green,
            vec![("repo".into(), "abcdef0".into()); 2]
        ),
        Err(Error::InvalidInput)
    );
    let excess = (0..257)
        .map(|i| (format!("repo{i}"), "abcdef0".into()))
        .collect();
    assert_eq!(
        Record::new(B.into(), ResultKind::Green, excess),
        Err(Error::InvalidInput)
    );
    assert_eq!(
        Record::new("invalid time".into(), ResultKind::Blocked, vec![]),
        Err(Error::InvalidInput)
    );
    assert_eq!(disk::read(root.record_path()).unwrap(), old);
}

#[test]
fn unsafe_targets_preserve_foreign_bytes() {
    let root = Scratch::new();
    let foreign = root.0.join("foreign");
    disk::create_dir(&foreign).unwrap();
    let unrelated = foreign.join("unrelated");
    write_private(&unrelated, b"foreign bytes");
    symlink(&foreign, root.0.join("state")).unwrap();
    assert_eq!(
        root.store().show("fixture").unwrap_err(),
        Error::UnsafeTarget
    );
    assert_eq!(
        root.store().record("fixture", green(A)).unwrap_err(),
        Error::UnsafeTarget
    );
    disk::remove_file(root.0.join("state")).unwrap();
    disk::create_dir(root.0.join("state")).unwrap();
    let checkups = root.0.join("state/checkups");
    symlink(&foreign, &checkups).unwrap();
    assert_eq!(
        root.store().record("fixture", green(A)).unwrap_err(),
        Error::UnsafeTarget
    );
    disk::remove_file(&checkups).unwrap();
    disk::create_dir(&checkups).unwrap();
    let path = root.record_path();
    let reject = || {
        assert_eq!(
            root.store().show("fixture").unwrap_err(),
            Error::UnsafeTarget
        );
        assert_eq!(
            root.store().record("fixture", green(A)).unwrap_err(),
            Error::UnsafeTarget
        );
        assert!(!checkups.join(".fixture.lock").exists());
        assert_eq!(disk::read(&unrelated).unwrap(), b"foreign bytes");
    };
    symlink(&unrelated, &path).unwrap();
    reject();
    disk::remove_file(&path).unwrap();
    let dir = fs::open(&checkups, DIRECTORY, Mode::empty()).unwrap();
    assert!(Command::new("/usr/bin/mkfifo")
        .args(["-m", "600"])
        .arg(&path)
        .status()
        .unwrap()
        .success());
    reject();
    disk::remove_file(&path).unwrap();
    disk::create_dir(&path).unwrap();
    reject();
    disk::remove_dir(&path).unwrap();
    disk::hard_link(&unrelated, &path).unwrap();
    reject();
    disk::remove_file(&path).unwrap();
    write_private(&path, b"owned sample");
    disk::set_permissions(&path, disk::Permissions::from_mode(0o640)).unwrap();
    reject();
    disk::set_permissions(&path, disk::Permissions::from_mode(0o600)).unwrap();
    let stat = fs::statat(&dir, "fixture.json", AtFlags::SYMLINK_NOFOLLOW).unwrap();
    assert_eq!(private_file(&stat, stat.st_uid), Ok(()));
    assert_eq!(
        private_file(&stat, stat.st_uid ^ 1),
        Err(Error::UnsafeTarget)
    );
    disk::set_permissions(&checkups, disk::Permissions::from_mode(0o770)).unwrap();
    reject();
}

#[test]
fn concurrent_writer_is_busy() {
    let root = Scratch::new();
    let store = root.store();
    let dir = store.directory(true).unwrap().unwrap();
    let (held, identity) = lock(&dir, ".fixture.lock").unwrap();
    assert_eq!(store.record("fixture", green(A)).unwrap_err(), Error::Busy);
    assert!(!root.record_path().exists());
    drop(held);
    store.record("fixture", green(A)).unwrap();
    assert_eq!(leaf_identity(&dir, ".fixture.lock"), Ok(Some(identity)));
}

#[test]
fn atomic_commit_has_complete_acknowledgement_boundary() {
    let root = Scratch::new();
    let store = root.store();
    store.record("fixture", green(A)).unwrap();
    let old = disk::read(root.record_path()).unwrap();
    assert_eq!(
        store
            .publish("fixture", green(B), |_| Err(Error::Io))
            .unwrap_err(),
        Error::Io
    );
    assert_eq!(disk::read(root.record_path()).unwrap(), old);
    assert_eq!(
        store
            .publish("fixture", green(B), |phase| {
                if phase == Publication::AfterRename {
                    Err(Error::Io)
                } else {
                    Ok(())
                }
            })
            .unwrap_err(),
        Error::Io
    );
    assert_eq!(shown(&store, "fixture"), green(B));
    let new = disk::read(root.record_path()).unwrap();
    let dir = store.directory(false).unwrap().unwrap();
    let identity = leaf_identity(&dir, "fixture.json").unwrap();
    assert_eq!(
        store.record("fixture", green(A)).unwrap_err(),
        Error::StaleRun
    );
    assert_eq!(
        store
            .record("fixture", record(B, ResultKind::Green, "abcdef1"))
            .unwrap_err(),
        Error::StaleRun
    );
    match store.record("fixture", green(B)).unwrap() {
        Report::Recorded {
            changed: false,
            record_sha256,
            ..
        } => assert_eq!(record_sha256, hash(&new)),
        other => panic!("expected idempotent result: {other:?}"),
    }
    assert_eq!(leaf_identity(&dir, "fixture.json").unwrap(), identity);
    assert_eq!(disk::read(root.record_path()).unwrap(), new);
}

#[test]
fn malformed_existing_record_is_not_first_run() {
    let root = Scratch::new();
    let store = root.store();
    store.record("fixture", green(A)).unwrap();
    let invalid = [
        vec![0xff],
        vec![b' '; MAX_BYTES + 1],
        b"not json".to_vec(),
        br#"{"finished_at":"2026-01-01T00:00:00Z","result":"green","commits":{"repo":"abcdef0","repo":"abcdef1"}}"#.to_vec(),
        br#"{"finished_at":"2026-01-01T00:00:00Z","result":"green","result":"blocked","commits":{}}"#.to_vec(),
        br#"{"finished_at":"2026-01-01T00:00:00Z","result":"green","commits":{"repo":"abcdef0"},"other":true}"#.to_vec(),
    ];
    for bytes in invalid {
        write_private(&root.record_path(), &bytes);
        assert_eq!(store.show("fixture").unwrap_err(), Error::InvalidState);
        assert_eq!(
            store.record("fixture", green(B)).unwrap_err(),
            Error::InvalidState
        );
        assert_eq!(disk::read(root.record_path()).unwrap(), bytes);
    }
}

#[test]
fn missing_or_invalid_commit_capture_is_blocked() {
    let root = Scratch::new();
    for kind in [ResultKind::Green, ResultKind::Degraded] {
        assert_eq!(
            Record::new(A.into(), kind, vec![]),
            Err(Error::InvalidInput)
        );
        assert_eq!(
            Record::new(A.into(), kind, vec![("repo".into(), "timeout".into())]),
            Err(Error::InvalidInput)
        );
    }
    assert!(!root.0.join("state").exists());
    let blocked = Record::new(A.into(), ResultKind::Blocked, vec![]).unwrap();
    root.store().record("fixture", blocked.clone()).unwrap();
    assert_eq!(shown(&root.store(), "fixture"), blocked);
}
