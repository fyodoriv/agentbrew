#![cfg(unix)]
#![forbid(unsafe_code)]

#[path = "support/lifecycle_validity.rs"]
mod validity;

use rustix::process::{kill_process, Pid, Signal};
use std::fs;
use std::os::unix::process::ExitStatusExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use validity::{Observation, Resources};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    path: PathBuf,
    child: Option<Child>,
}

impl Fixture {
    fn new(case: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "migration-lifecycle-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let child = Command::new(env!("CARGO_BIN_EXE_lifecycle-fixture"))
            .arg(case)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        Self {
            path,
            child: Some(child),
        }
    }

    fn ready(&mut self, live_leader: bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !self.path.join("leader-ready").exists()
            || !self.path.join("descendant-ready").exists()
        {
            assert!(
                self.child.as_mut().unwrap().try_wait().unwrap().is_none(),
                "fixture owner exited before readiness"
            );
            assert!(
                Instant::now() < deadline,
                "fixture readiness unavailable; inconclusive"
            );
            thread::sleep(Duration::from_millis(5));
        }
        let pid: i32 = fs::read_to_string(self.path.join("descendant-pid"))
            .unwrap()
            .parse()
            .unwrap();
        assert!(
            rustix::process::test_kill_process(Pid::from_raw(pid).unwrap()).is_ok(),
            "ready descendant not alive"
        );
        if live_leader {
            assert!(
                rustix::process::test_kill_process(self.pid("leader-pid")).is_ok(),
                "ready leader not alive"
            );
        }
    }

    fn pid(&self, name: &str) -> Pid {
        let pid = fs::read_to_string(self.path.join(name))
            .unwrap()
            .parse()
            .unwrap();
        Pid::from_raw(pid).expect("fixture pid")
    }

    fn owned_gone(&self, deadline: Instant) -> bool {
        loop {
            if Instant::now() >= deadline {
                return false;
            }
            let gone = ["leader-pid", "descendant-pid"].iter().all(|name| {
                matches!(
                    rustix::process::test_kill_process(self.pid(name)),
                    Err(rustix::io::Errno::SRCH)
                )
            });
            if gone {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn completed(&mut self, deadline: Instant) -> Option<std::process::ExitStatus> {
        loop {
            if Instant::now() >= deadline {
                return None;
            }
            if let Some(status) = self.child.as_mut().unwrap().try_wait().unwrap() {
                return Some(status);
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn release(&self) {
        fs::write(self.path.join("release"), b"release").unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.release();
        let deadline = Instant::now() + Duration::from_secs(37);
        if self.path.join("descendant-ready").exists() {
            assert!(self.owned_gone(deadline), "bounded fixture cleanup failed");
        }
        assert!(
            self.completed(deadline).is_some(),
            "bounded fixture owner cleanup failed"
        );
        let _ = self.child.as_mut().unwrap().wait();
        fs::remove_dir_all(&self.path).unwrap();
    }
}

#[test]
fn transport_diagnostic_closed_invalid_request_roundtrip() {
    let mut fixture = Fixture::new("owner-invalid-request");
    let status = fixture
        .completed(Instant::now() + Duration::from_secs(3))
        .expect("closed invalid request finishes");
    assert!(
        status.success(),
        "closed fixture did not verify the parent error"
    );
    assert_eq!(
        fs::read_to_string(fixture.path.join("owner-result")).unwrap(),
        "invalid-request"
    );
    assert_eq!(
        fs::read_to_string(fixture.path.join("owner-observation")).unwrap(),
        "error:git-command"
    );
    assert_eq!(
        fs::read_to_string(fixture.path.join("worker-status")).unwrap(),
        "5"
    );
    assert_eq!(
        fs::read_to_string(fixture.path.join("worker-observation")).unwrap(),
        "Request -1\n"
    );
    let context: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.path.join("transport-observation")).unwrap())
            .unwrap();
    assert_eq!(context["stage"], "worker-nonzero");
    assert_eq!(context["worker_exit"], 5);
    assert_eq!(context["worker_reason"], 5);
    assert!(context["worker_signal"].is_null());
    assert!(!fixture.path.join("leaf-status").exists());
}

#[test]
fn existing_owner_finishes_success_refusal_and_overflow() {
    for (case, result) in [
        ("owner-success", "ok"),
        ("owner-refused", "refused"),
        ("owner-overflow", "overflow"),
    ] {
        let mut fixture = Fixture::new(case);
        let status = fixture
            .completed(Instant::now() + Duration::from_secs(3))
            .expect("ordinary fixture completion");
        assert!(status.success(), "case={case}, owner_status={status:?}, owner_observation={:?}, worker_status={:?}, leaf_status={:?}, worker_observation={:?}",
            fs::read_to_string(fixture.path.join("owner-observation")),
            fs::read_to_string(fixture.path.join("worker-status")),
            fs::read_to_string(fixture.path.join("leaf-status")),
            fs::read_to_string(fixture.path.join("worker-observation")));
        assert_eq!(
            fs::read_to_string(fixture.path.join("owner-result")).unwrap(),
            result
        );
    }
}

#[test]
fn descendant_held_pipe_fits_total_thirty_second_deadline() {
    let observation = Observation::start().expect("inconclusive: timing admission");
    let started = Instant::now();
    let mut fixture = Fixture::new("owner-held");
    fixture.ready(false);
    fs::write(fixture.path.join("allow-leader-exit"), b"release").unwrap();
    let status_at_deadline = fixture.completed(started + Duration::from_secs(30));
    let owned_gone_in_budget = fixture.owned_gone(started + Duration::from_secs(30));
    let completed_in_budget =
        status_at_deadline.is_some_and(|status| status.success()) && owned_gone_in_budget;
    // Record the result before bounded cooperative fixture cleanup.
    let observed = started.elapsed();
    fixture.release();
    assert!(
        fixture
            .completed(started + Duration::from_secs(37))
            .is_some(),
        "finite fixture fallback"
    );
    let samples = observation.finish().expect("inconclusive: timing sample");
    eprintln!("held-pipe: completed_in_budget={completed_in_budget}, owned_gone_in_budget={owned_gone_in_budget}, owner_status={status_at_deadline:?}, owner_observation={:?}, worker_status={:?}, leaf_status={:?}, worker_observation={:?}, observed_ms={}, validated_resource_samples={samples}",
        fs::read_to_string(fixture.path.join("owner-observation")),
        fs::read_to_string(fixture.path.join("worker-status")),
        fs::read_to_string(fixture.path.join("leaf-status")),
        fs::read_to_string(fixture.path.join("worker-observation")), observed.as_millis());
    assert!(
        completed_in_budget,
        "held-pipe expected successful owner completion and owned PID absence within 30000ms: observed {}ms",
        observed.as_millis()
    );
}

#[test]
fn parent_signals_close_descendant_within_two_seconds() {
    let mut violations = Vec::new();
    for signal in [Signal::INT, Signal::TERM] {
        let observation = Observation::start().expect("inconclusive: timing admission");
        let mut fixture = Fixture::new("owner-live");
        fixture.ready(true);
        let started = Instant::now();
        let pid = Pid::from_raw(fixture.child.as_ref().unwrap().id() as i32).unwrap();
        kill_process(pid, signal).unwrap();
        let parent = fixture.completed(started + Duration::from_secs(2));
        let descendant_closed = fixture.owned_gone(started + Duration::from_secs(2));
        let observed = started.elapsed();
        fixture.release();
        assert!(
            fixture.owned_gone(Instant::now() + Duration::from_secs(3)),
            "cooperative fixture cleanup"
        );
        let samples = observation.finish().expect("inconclusive: timing sample");
        let parent = parent.expect("parent did not exit within cancellation bound");
        assert_eq!(parent.code(), None);
        assert_eq!(parent.signal(), Some(signal.as_raw()));
        eprintln!("parent-cancel: signal={}, descendant_closed={descendant_closed}, observed_ms={}, validated_resource_samples={samples}", signal.as_raw(), observed.as_millis());
        if !descendant_closed {
            violations.push(signal.as_raw());
        }
    }
    assert!(
        violations.is_empty(),
        "owned descendant remained after 2000ms cancellation: signals {violations:?}"
    );
}

#[test]
fn registered_invalid_timing_samples_are_inconclusive() {
    let valid = || Resources {
        cpu: 20.0,
        cores: vec![10.0, 20.0],
        total: 1000,
        available: 500,
        refresh_gap: Duration::from_millis(250),
    };
    assert_eq!(validity::resource_validity(&valid()), Ok(()));
    let mut invalid = valid();
    invalid.cores.clear();
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.cpu = f32::NAN;
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.cores[0] = f32::INFINITY;
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.cores[0] = 101.0;
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.total = 0;
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.available = 1001;
    assert!(validity::resource_validity(&invalid).is_err());
    let mut invalid = valid();
    invalid.refresh_gap = Duration::from_millis(249);
    assert!(validity::resource_validity(&invalid).is_err());
    let mut saturated = valid();
    saturated.cpu = 81.0;
    assert_eq!(
        validity::resource_validity(&saturated),
        Err("saturated-resource-sample")
    );
    let mut saturated = valid();
    saturated.available = 149;
    assert_eq!(
        validity::resource_validity(&saturated),
        Err("saturated-resource-sample")
    );
    assert_eq!(
        validity::clock_validity(
            Duration::from_millis(201),
            Duration::from_secs(1),
            Duration::from_secs(1)
        ),
        Err("paused-timing-sample")
    );
    assert_eq!(
        validity::clock_validity(
            Duration::from_millis(20),
            Duration::from_secs(1),
            Duration::from_millis(1201)
        ),
        Err("paused-timing-sample")
    );
    assert_eq!(
        validity::clock_validity(
            Duration::from_millis(20),
            Duration::from_secs(1),
            Duration::from_secs(1)
        ),
        Ok(())
    );
}
