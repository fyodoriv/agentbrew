#![forbid(unsafe_code)]

mod model {
    pub use migration_check::model::Diagnostic;
}
mod transport {
    pub use migration_check::transport::*;
}
#[path = "../../src/child_owner.rs"]
mod child_owner;
#[path = "../../src/worker_owner.rs"]
mod worker_owner;

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

fn main() {
    let raw: Vec<_> = std::env::args_os().skip(1).collect();
    if raw.first().is_some_and(|arg| arg == "worker") {
        if raw.len() != 6 {
            std::process::exit(2);
        }
        let Some(case) = raw[1].to_str() else {
            std::process::exit(2);
        };
        if !matches!(
            case,
            "leader-exit" | "leader-live" | "success" | "refused" | "overflow" | "invalid-request"
        ) {
            std::process::exit(2);
        }
        let path = std::path::PathBuf::from(&raw[2]);
        let Some(startup) = worker_owner::Startup::parse(&raw[3..]) else {
            std::process::exit(2);
        };
        if !path.is_absolute() || !fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) {
            std::process::exit(2);
        }
        fs::write(path.join("worker-pid"), std::process::id().to_string()).unwrap();
        let policy = if matches!(case, "refused" | "invalid-request") {
            worker_owner::InputPolicy::Objects
        } else {
            worker_owner::InputPolicy::Empty
        };
        let status = worker_owner::supervise(
            command(case, &path),
            startup,
            128,
            policy,
            Some(fs::File::create(path.join("worker-observation")).unwrap()),
        );
        fs::write(path.join("worker-status"), status.to_string()).unwrap();
        std::process::exit(status);
    }
    let mut args = std::env::args_os().skip(1);
    let case = args.next().and_then(|s| s.into_string().ok());
    let path = args.next().map(std::path::PathBuf::from);
    let Some(path) = path else {
        std::process::exit(2)
    };
    if args.next().is_some()
        || !path.is_absolute()
        || !fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir())
    {
        std::process::exit(2);
    }
    let status = match case.as_deref() {
        Some("owner-held") => owner(&path, "leader-exit", Vec::new(), 128),
        Some("owner-live") => owner(&path, "leader-live", Vec::new(), 128),
        Some("owner-success") => owner(&path, "success", Vec::new(), 128),
        Some("owner-refused") => owner(
            &path,
            "refused",
            format!("{}\n", "0".repeat(40)).repeat(3000).into_bytes(),
            128,
        ),
        Some("owner-overflow") => owner(&path, "overflow", Vec::new(), 128),
        Some("owner-invalid-request") => owner(&path, "invalid-request", b"invalid".to_vec(), 128),
        Some("leader-exit") => leader(&path, false),
        Some("leader-live") => leader(&path, true),
        Some("descendant") => descendant(&path),
        Some("success") => {
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input).unwrap();
            std::io::stdout().write_all(b"fixture-ok").unwrap();
            0
        }
        Some("refused") => 1,
        Some("overflow") => {
            std::io::stdout().write_all(&[0; 1024]).unwrap();
            0
        }
        _ => 2,
    };
    if matches!(
        case.as_deref(),
        Some("leader-exit" | "leader-live" | "success" | "refused" | "overflow")
    ) {
        fs::write(path.join("leaf-status"), status.to_string()).unwrap();
    }
    std::process::exit(status);
}

fn command(case: &str, path: &Path) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.arg(case).arg(path).stderr(Stdio::null());
    command
}

fn owner(path: &Path, case: &str, input: Vec<u8>, limit: usize) -> i32 {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["worker", case])
        .arg(path)
        .stderr(Stdio::null());
    let result = child_owner::run_child(command, input, limit);
    let observation = match &result {
        Ok(bytes) => format!("ok:{}", bytes.len()),
        Err(error) => format!("error:{}", error.code),
    };
    fs::write(path.join("owner-observation"), observation).unwrap();
    if case == "invalid-request" {
        if let Err(error) = &result {
            fs::write(
                path.join("transport-observation"),
                serde_json::to_vec(&error.transport).unwrap(),
            )
            .unwrap();
        }
    }
    let value = match result {
        Ok(bytes) if case == "success" && bytes == b"fixture-ok" => "ok",
        Ok(bytes) if matches!(case, "leader-exit" | "leader-live") && bytes.is_empty() => "ok",
        Err(error) if case == "refused" && error.code == "git-command" => "refused",
        Err(error) if case == "overflow" && error.code == "git-limit" => "overflow",
        Err(error)
            if case == "invalid-request"
                && error.code == "git-command"
                && error.transport.as_ref().is_some_and(|context| {
                    context.stage == transport::ParentStage::WorkerNonzero
                        && context.worker_exit == Some(5)
                        && context.worker_signal.is_none()
                        && context.worker_reason == Some(transport::WorkerFailure::Request)
                }) =>
        {
            "invalid-request"
        }
        _ => return 3,
    };
    fs::write(path.join("owner-result"), value).unwrap();
    0
}

fn leader(path: &Path, live: bool) -> i32 {
    // EOF proves the shared supervisor delivered and closed the leaf request.
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
    assert!(input.is_empty());
    fs::write(path.join("leader-pid"), std::process::id().to_string()).unwrap();
    let mut child = command("descendant", path)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while !path.join("descendant-ready").exists() {
        assert!(Instant::now() < deadline, "fixture descendant readiness");
        thread::sleep(Duration::from_millis(5));
    }
    fs::write(path.join("leader-ready"), b"ready").unwrap();
    if live {
        child.wait().unwrap();
    } else {
        let deadline = Instant::now() + Duration::from_secs(35);
        while !path.join("allow-leader-exit").exists()
            && !path.join("release").exists()
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
    }
    0
}

fn descendant(path: &Path) -> i32 {
    fs::write(path.join("descendant-pid"), std::process::id().to_string()).unwrap();
    // This process owns the inherited output descriptor until the fixed fallback.
    let _output = std::io::stdout().lock();
    fs::write(path.join("descendant-ready"), b"ready").unwrap();
    let deadline = Instant::now() + Duration::from_secs(35);
    while Instant::now() < deadline && !path.join("release").exists() {
        thread::sleep(Duration::from_millis(5));
    }
    fs::write(path.join("descendant-done"), b"done").unwrap();
    0
}
