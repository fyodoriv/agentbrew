#![forbid(unsafe_code)]
#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

use checkup_run::{Error, Record, Report, ResultKind, Store};
use std::fs;
use std::os::unix::fs::DirBuilderExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const CHECKUP: &str = "fixture";
const A: &str = "2026-01-01T00:00:00Z";
const B: &str = "2026-01-01T00:00:01Z";

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let parent = std::env::temp_dir().canonicalize().unwrap();
        for _ in 0..128 {
            let path = parent.join(format!(
                "checkup-read-guard-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => return Self(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("scratch setup failed: {error}"),
            }
        }
        panic!("scratch namespace exhausted");
    }

    fn store(&self) -> Store {
        Store::new(self.0.join("state")).unwrap()
    }

    fn seed(&self) -> String {
        let record = Record::new(
            A.into(),
            ResultKind::Green,
            vec![("repo".into(), "abcdef0".into())],
        )
        .unwrap();
        self.store().record(CHECKUP, record).unwrap();
        self.digest()
    }

    fn digest(&self) -> String {
        let Report::Present { record_sha256, .. } = self.store().show(CHECKUP).unwrap() else {
            panic!("expected recorded fixture");
        };
        record_sha256
    }

    fn write_b(&self) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_checkup-run"))
            .env_clear()
            .env("XDG_STATE_HOME", self.0.join("state"))
            .args([
                "record",
                CHECKUP,
                "--finished-at",
                B,
                "--result",
                "degraded",
                "--commit",
                "repo=def1234",
                "--json",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if child.try_wait().unwrap().is_some() {
                return child.wait_with_output().unwrap();
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("fixture writer exceeded its deadline");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn replacement_before_read_guard_refuses_operation() {
    let scratch = Scratch::new();
    let old_digest = scratch.seed();
    assert!(scratch.write_b().status.success());
    let new_digest = scratch.digest();
    assert_ne!(old_digest, new_digest);
    assert_eq!(
        scratch
            .store()
            .with_current(CHECKUP, &old_digest, |_| -> Result<(), Error> {
                panic!("stale record reached the operation")
            }),
        Err(Error::StaleRun),
    );
    assert_eq!(scratch.digest(), new_digest);
}

#[test]
fn direct_writer_is_busy_during_guard_and_succeeds_after_release() {
    let scratch = Scratch::new();
    let old_digest = scratch.seed();
    scratch
        .store()
        .with_current(CHECKUP, &old_digest, |_| {
            let output = scratch.write_b();
            assert_eq!(output.status.code(), Some(2));
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&output.stderr).unwrap(),
                serde_json::json!({"status":"error","code":"busy"}),
            );
            assert_eq!(scratch.digest(), old_digest);
            Ok(())
        })
        .unwrap();
    assert!(scratch.write_b().status.success());
    assert_ne!(scratch.digest(), old_digest);
}

#[test]
fn missing_record_does_not_create_state_or_run_operation() {
    let scratch = Scratch::new();
    assert_eq!(
        scratch
            .store()
            .with_current(CHECKUP, &"0".repeat(64), |_| -> Result<(), Error> {
                panic!("missing record reached the operation")
            }),
        Err(Error::StaleRun),
    );
    assert!(!scratch.0.join("state").exists());
}
