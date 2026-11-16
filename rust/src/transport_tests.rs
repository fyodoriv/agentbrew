use super::{
    final_status, mark_failure, parent_error, FirstFailure, ParentStage, ReadOperation,
    ReapFailure, SignalFailure, TransportContext, WorkerFailure,
};
use crate::model::Diagnostic;
use rustix::io::Errno;
use serde_json::json;
use std::ffi::OsStr;
use std::os::unix::process::ExitStatusExt;
use std::process::ExitStatus;

const REASONS: &[(i32, WorkerFailure)] = &[
    (4, WorkerFailure::SignalSetup),
    (5, WorkerFailure::Request),
    (6, WorkerFailure::StartupCancelled),
    (7, WorkerFailure::ChildSocket),
    (8, WorkerFailure::ChildSpawn),
    (9, WorkerFailure::ChildPid),
    (10, WorkerFailure::ChildStdout),
    (11, WorkerFailure::IoSetup),
    (12, WorkerFailure::WaitBeforeCleanup),
    (13, WorkerFailure::TermUnreserved),
    (14, WorkerFailure::TermWait),
    (15, WorkerFailure::TermKillPermission),
    (16, WorkerFailure::TermKillOther),
    (17, WorkerFailure::CleanupDeadline),
    (18, WorkerFailure::KillUnreserved),
    (19, WorkerFailure::KillWait),
    (20, WorkerFailure::KillKillPermission),
    (21, WorkerFailure::KillKillOther),
    (22, WorkerFailure::WaitAfterKill),
    (23, WorkerFailure::ReapWait),
    (24, WorkerFailure::ReapNotTerminal),
    (25, WorkerFailure::ReapChildWait),
    (26, WorkerFailure::LeafNonzero),
    (27, WorkerFailure::LeafSignal),
    (28, WorkerFailure::Stopped),
    (29, WorkerFailure::InputIncomplete),
    (30, WorkerFailure::InputWrite),
    (31, WorkerFailure::OutputRead),
    (32, WorkerFailure::OutputWrite),
];

const PARENT_STAGES: &[(ParentStage, &str, &str)] = &[
    (ParentStage::InputLimit, "input-limit", "git-limit"),
    (ParentStage::RootClone, "root-clone", "git-command"),
    (ParentStage::RequestSocket, "request-socket", "git-command"),
    (ParentStage::RequestMode, "request-mode", "git-command"),
    (ParentStage::WorkerSpawn, "worker-spawn", "git-command"),
    (ParentStage::WorkerStdout, "worker-stdout", "git-command"),
    (ParentStage::OutputMode, "output-mode", "git-command"),
    (ParentStage::Deadline, "deadline", "git-timeout"),
    (ParentStage::RequestWrite, "request-write", "git-command"),
    (ParentStage::OutputRead, "output-read", "git-command"),
    (ParentStage::WorkerWait, "worker-wait", "git-command"),
    (ParentStage::OutputLimit, "output-limit", "git-limit"),
    (ParentStage::WorkerLimit, "worker-limit", "git-limit"),
    (
        ParentStage::RecordedFailure,
        "recorded-failure",
        "git-command",
    ),
    (ParentStage::WorkerNonzero, "worker-nonzero", "git-command"),
    (
        ParentStage::IncompleteSend,
        "incomplete-send",
        "git-command",
    ),
];

fn exit(code: i32) -> ExitStatus {
    ExitStatus::from_raw(code << 8)
}

fn signal(number: i32) -> ExitStatus {
    ExitStatus::from_raw(number)
}

#[test]
fn transport_diagnostic_worker_reason_table_roundtrips() {
    for code in 0..=255 {
        let expected = REASONS
            .iter()
            .find(|entry| entry.0 == code)
            .map(|entry| entry.1);
        assert_eq!(
            WorkerFailure::from_code(code),
            expected,
            "worker exit {code}"
        );
        let context = TransportContext::new(ParentStage::WorkerNonzero, Some(exit(code)));
        assert_eq!(context.worker_exit, Some(code));
        assert_eq!(context.worker_signal, None);
        assert_eq!(
            context.worker_reason, expected,
            "decoded worker exit {code}"
        );
    }
    for &(code, reason) in REASONS {
        assert_eq!(reason.code(), code);
        assert_eq!(serde_json::to_value(reason).unwrap(), json!(code));
    }
    let operations = [
        (ReadOperation::RootPrefix, "root-prefix"),
        (ReadOperation::Index, "index"),
        (ReadOperation::Untracked, "untracked"),
        (ReadOperation::AllUntracked, "all-untracked"),
        (ReadOperation::ObjectBatch, "objects"),
    ];
    for (operation, name) in operations {
        assert_eq!(operation.name(), name);
        assert_eq!(
            ReadOperation::parse(Some(OsStr::new(name))),
            Some(operation)
        );
        assert_eq!(serde_json::to_value(operation).unwrap(), json!(name));
    }
    for name in ["", "Objects", "root-prefix extra", "unknown"] {
        assert_eq!(ReadOperation::parse(Some(OsStr::new(name))), None);
    }
    assert_eq!(ReadOperation::parse(None), None);
}

#[test]
fn transport_diagnostic_unqualified_startup_stays_two() {
    assert_eq!(WorkerFailure::from_code(2), None);
    let diagnostic = parent_error(ParentStage::WorkerNonzero, Some(exit(2)));
    assert_eq!(diagnostic.code, "git-command");
    let context = diagnostic.transport.unwrap();
    assert_eq!(context.worker_exit, Some(2));
    assert_eq!(context.worker_signal, None);
    assert_eq!(context.worker_reason, None);
    assert_eq!(final_status(&Ok(exit(0)), true, false, None), 2);
}

#[test]
fn transport_diagnostic_unknown_exit_stays_unknown_and_failed() {
    for code in [1].into_iter().chain(33..=255) {
        let status = exit(code);
        assert!(!status.success());
        let diagnostic = parent_error(ParentStage::WorkerNonzero, Some(status));
        assert_eq!(diagnostic.code, "git-command");
        let context = diagnostic.transport.unwrap();
        assert_eq!(context.worker_exit, Some(code));
        assert_eq!(context.worker_reason, None);
        assert_eq!(context.worker_signal, None);
    }
    for code in [i32::MIN, -1, 256, 65_536, i32::MAX] {
        assert_eq!(WorkerFailure::from_code(code), None);
    }
    let missing = parent_error(ParentStage::WorkerNonzero, None);
    assert_eq!(missing.code, "git-command");
    assert_eq!(missing.transport.unwrap().worker_reason, None);
}

#[test]
fn transport_diagnostic_signal_exit_does_not_decode_a_reason() {
    for number in [2, 9, 15] {
        let status = signal(number);
        assert!(!status.success());
        let context = TransportContext::new(ParentStage::WorkerNonzero, Some(status));
        assert_eq!(context.worker_signal, Some(number));
        assert_eq!(context.worker_exit, None);
        assert_eq!(context.worker_reason, None);
        assert_eq!(
            parent_error(ParentStage::WorkerNonzero, Some(status)).code,
            "git-command"
        );
        assert_eq!(final_status(&Ok(status), false, false, None), 27);
    }
}

#[test]
fn transport_diagnostic_parent_stage_table_covers_existing_errors() {
    for &(stage, serialized, code) in PARENT_STAGES {
        let diagnostic = parent_error(stage, None);
        assert_eq!(diagnostic.code, code);
        assert_eq!(diagnostic.path, None);
        let context = diagnostic.transport.unwrap();
        assert_eq!(context.stage, stage);
        assert_eq!(context.operation, None);
        assert_eq!(context.worker_exit, None);
        assert_eq!(context.worker_signal, None);
        assert_eq!(context.worker_reason, None);
        assert_eq!(serde_json::to_value(stage).unwrap(), json!(serialized));
    }
}

#[test]
fn transport_diagnostic_term_wait_is_not_kill_permission() {
    let permission = Errno::PERM.raw_os_error();
    let wait = SignalFailure::from_wait_error(permission);
    let kill = SignalFailure::from_kill_error(permission);
    assert_eq!(wait, SignalFailure::Wait);
    assert_eq!(kill, SignalFailure::KillPermission);
    assert_eq!(wait.reason(false), WorkerFailure::TermWait);
    assert_eq!(kill.reason(false), WorkerFailure::TermKillPermission);
    assert_eq!(wait.reason(false).code(), 14);
    assert_eq!(kill.reason(false).code(), 15);
    assert_eq!(SignalFailure::Unreserved.reason(false).code(), 13);
    for errno in [-1, 0, Errno::IO.raw_os_error()] {
        assert_eq!(
            SignalFailure::from_wait_error(errno).reason(false).code(),
            14
        );
        assert_eq!(
            SignalFailure::from_kill_error(errno).reason(false).code(),
            16
        );
    }
}

#[test]
fn transport_diagnostic_kill_wait_is_not_kill_permission() {
    let permission = Errno::PERM.raw_os_error();
    assert_eq!(
        SignalFailure::from_wait_error(permission)
            .reason(true)
            .code(),
        19
    );
    assert_eq!(
        SignalFailure::from_kill_error(permission)
            .reason(true)
            .code(),
        20
    );
    assert_eq!(SignalFailure::Unreserved.reason(true).code(), 18);
    for errno in [-1, 0, Errno::IO.raw_os_error()] {
        assert_eq!(SignalFailure::from_wait_error(errno), SignalFailure::Wait);
        assert_eq!(
            SignalFailure::from_kill_error(errno),
            SignalFailure::KillOther
        );
        assert_eq!(
            SignalFailure::from_wait_error(errno).reason(true).code(),
            19
        );
        assert_eq!(
            SignalFailure::from_kill_error(errno).reason(true).code(),
            21
        );
    }
}

#[test]
fn transport_diagnostic_reap_error_is_not_leaf_failure() {
    for (failure, reason, code) in [
        (ReapFailure::Wait, WorkerFailure::ReapWait, 23),
        (ReapFailure::NotTerminal, WorkerFailure::ReapNotTerminal, 24),
        (ReapFailure::ChildWait, WorkerFailure::ReapChildWait, 25),
    ] {
        assert_eq!(failure.reason(), reason);
        for failed in [false, true] {
            assert_eq!(
                final_status(&Err(failure), failed, false, Some(FirstFailure::Stopped)),
                code
            );
        }
    }
    assert_eq!(final_status(&Ok(exit(7)), false, false, None), 26);
    assert_eq!(final_status(&Ok(signal(15)), false, false, None), 27);
}

#[test]
fn transport_diagnostic_success_and_limit_precedence_is_unchanged() {
    assert_eq!(final_status(&Ok(exit(0)), false, false, None), 0);
    assert_eq!(
        final_status(&Ok(exit(0)), false, true, Some(FirstFailure::InputWrite)),
        0
    );
    let outcomes = [
        (Ok(exit(0)), 0, 3),
        (Ok(exit(7)), 3, 3),
        (Ok(signal(9)), 3, 3),
        (Err(ReapFailure::Wait), 3, 3),
    ];
    for (outcome, not_failed, failed) in outcomes {
        assert_eq!(
            final_status(&outcome, false, true, Some(FirstFailure::OutputWrite)),
            not_failed
        );
        assert_eq!(
            final_status(&outcome, true, true, Some(FirstFailure::OutputWrite)),
            failed
        );
    }
}

#[test]
fn transport_diagnostic_first_failure_tag_is_not_overwritten() {
    let failures = [
        (FirstFailure::Stopped, 28),
        (FirstFailure::InputIncomplete, 29),
        (FirstFailure::InputWrite, 30),
        (FirstFailure::OutputRead, 31),
        (FirstFailure::OutputWrite, 32),
    ];
    for (initial, expected) in failures {
        for (later, _) in failures {
            let mut failed = false;
            let mut first = None;
            mark_failure(&mut failed, &mut first, initial);
            mark_failure(&mut failed, &mut first, later);
            assert!(failed);
            assert_eq!(first, Some(initial));
            assert_eq!(final_status(&Ok(exit(0)), failed, false, first), expected);
        }
    }
    let mut failed = true;
    let mut unknown = None;
    mark_failure(&mut failed, &mut unknown, FirstFailure::OutputWrite);
    assert_eq!(unknown, None);
    assert_eq!(final_status(&Ok(exit(0)), failed, false, unknown), 2);
}

#[test]
fn transport_diagnostic_absent_context_is_not_invented() {
    let diagnostic = Diagnostic::new("unresolved-execution", Some("scripts/fixture.sh"));
    assert_eq!(
        serde_json::to_value(diagnostic).unwrap(),
        json!({
            "code": "unresolved-execution", "path": "scripts/fixture.sh"
        })
    );
    let context = TransportContext::new(ParentStage::WorkerWait, None);
    assert_eq!(context.operation, None);
    assert_eq!(context.worker_exit, None);
    assert_eq!(context.worker_signal, None);
    assert_eq!(context.worker_reason, None);
}

#[test]
fn transport_diagnostic_serialization_has_only_closed_fields() {
    let marker = "SYNTHETIC_PRIVATE_DIAGNOSTIC_MARKER";
    assert_eq!(ReadOperation::parse(Some(OsStr::new(marker))), None);
    let mut diagnostic = parent_error(ParentStage::WorkerNonzero, Some(exit(15)));
    diagnostic.transport.as_mut().unwrap().operation = Some(ReadOperation::ObjectBatch);
    let value = serde_json::to_value(&diagnostic).unwrap();
    assert_eq!(
        value,
        json!({
            "code": "git-command", "path": null,
            "transport": {
                "operation": "objects", "stage": "worker-nonzero",
                "worker_exit": 15, "worker_signal": null, "worker_reason": 15
            }
        })
    );
    assert_eq!(value.as_object().unwrap().len(), 3);
    assert_eq!(value["transport"].as_object().unwrap().len(), 5);
    assert!(!serde_json::to_string(&value).unwrap().contains(marker));
    for &(stage, _, _) in PARENT_STAGES {
        let serialized = serde_json::to_value(TransportContext::new(stage, None)).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 5);
        assert!(serialized["operation"].is_null());
        assert!(serialized["worker_exit"].is_null());
        assert!(serialized["worker_signal"].is_null());
        assert!(serialized["worker_reason"].is_null());
    }
}

#[test]
fn transport_diagnostic_outer_codes_remain_unchanged() {
    for &(stage, _, expected) in PARENT_STAGES {
        for code in 0..=255 {
            let diagnostic = parent_error(stage, Some(exit(code)));
            assert_eq!(diagnostic.code, expected);
            assert_eq!(diagnostic.path, None);
            assert_eq!(
                diagnostic.transport.as_ref().unwrap().worker_exit,
                Some(code)
            );
            if stage != ParentStage::WorkerNonzero {
                assert_eq!(diagnostic.transport.as_ref().unwrap().worker_reason, None);
            }
        }
    }
    assert_eq!(
        serde_json::to_value(Diagnostic::new("git-command", None)).unwrap(),
        json!({
            "code": "git-command", "path": null
        })
    );
}

#[test]
fn transport_diagnostic_root_clone_and_incomplete_frame_are_not_worker_failures() {
    let root = parent_error(ParentStage::RootClone, None);
    assert_eq!(root.code, "git-command");
    let root_context = root.transport.unwrap();
    assert_eq!(root_context.stage, ParentStage::RootClone);
    assert_eq!(root_context.worker_exit, None);
    assert_eq!(root_context.worker_reason, None);
    for status in [exit(0), exit(5)] {
        let incomplete = parent_error(ParentStage::IncompleteSend, Some(status));
        assert_eq!(incomplete.code, "git-command");
        let context = incomplete.transport.unwrap();
        assert_eq!(context.stage, ParentStage::IncompleteSend);
        assert_eq!(context.worker_exit, status.code());
        assert_eq!(context.worker_reason, None);
    }
}

#[test]
fn transport_diagnostic_parent_timeout_and_limit_precedence_is_unchanged() {
    for status in [
        None,
        Some(exit(0)),
        Some(exit(3)),
        Some(exit(15)),
        Some(signal(15)),
    ] {
        let timeout = parent_error(ParentStage::Deadline, status);
        assert_eq!(timeout.code, "git-timeout");
        assert_eq!(timeout.transport.unwrap().worker_reason, None);
        for stage in [
            ParentStage::InputLimit,
            ParentStage::OutputLimit,
            ParentStage::WorkerLimit,
        ] {
            let limited = parent_error(stage, status);
            assert_eq!(limited.code, "git-limit");
            assert_eq!(limited.transport.unwrap().worker_reason, None);
        }
    }
    let failure = parent_error(ParentStage::RequestWrite, Some(exit(3)));
    assert_eq!(failure.code, "git-command");
    assert_eq!(failure.transport.unwrap().worker_reason, None);
}
