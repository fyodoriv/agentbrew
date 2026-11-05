use serde::{Serialize, Serializer};
use std::ffi::OsStr;
use std::os::unix::process::ExitStatusExt;
use std::process::ExitStatus;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadOperation {
    RootPrefix,
    Index,
    Untracked,
    AllUntracked,
    #[serde(rename = "objects")]
    ObjectBatch,
}

impl ReadOperation {
    pub fn name(self) -> &'static str {
        match self {
            Self::RootPrefix => "root-prefix",
            Self::Index => "index",
            Self::Untracked => "untracked",
            Self::AllUntracked => "all-untracked",
            Self::ObjectBatch => "objects",
        }
    }

    pub fn parse(operation: Option<&OsStr>) -> Option<Self> {
        match operation?.to_str()? {
            "root-prefix" => Some(Self::RootPrefix),
            "index" => Some(Self::Index),
            "untracked" => Some(Self::Untracked),
            "all-untracked" => Some(Self::AllUntracked),
            "objects" => Some(Self::ObjectBatch),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ParentStage {
    InputLimit,
    RootClone,
    RequestSocket,
    RequestMode,
    WorkerSpawn,
    WorkerStdout,
    OutputMode,
    Deadline,
    RequestWrite,
    OutputRead,
    WorkerWait,
    OutputLimit,
    WorkerLimit,
    RecordedFailure,
    WorkerNonzero,
    IncompleteSend,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum WorkerFailure {
    SignalSetup = 4,
    Request = 5,
    StartupCancelled = 6,
    ChildSocket = 7,
    ChildSpawn = 8,
    ChildPid = 9,
    ChildStdout = 10,
    IoSetup = 11,
    WaitBeforeCleanup = 12,
    TermUnreserved = 13,
    TermWait = 14,
    TermKillPermission = 15,
    TermKillOther = 16,
    CleanupDeadline = 17,
    KillUnreserved = 18,
    KillWait = 19,
    KillKillPermission = 20,
    KillKillOther = 21,
    WaitAfterKill = 22,
    ReapWait = 23,
    ReapNotTerminal = 24,
    ReapChildWait = 25,
    LeafNonzero = 26,
    LeafSignal = 27,
    Stopped = 28,
    InputIncomplete = 29,
    InputWrite = 30,
    OutputRead = 31,
    OutputWrite = 32,
}

impl WorkerFailure {
    pub fn code(self) -> i32 {
        self as i32
    }

    pub fn from_code(code: i32) -> Option<Self> {
        Some(match code {
            4 => Self::SignalSetup,
            5 => Self::Request,
            6 => Self::StartupCancelled,
            7 => Self::ChildSocket,
            8 => Self::ChildSpawn,
            9 => Self::ChildPid,
            10 => Self::ChildStdout,
            11 => Self::IoSetup,
            12 => Self::WaitBeforeCleanup,
            13 => Self::TermUnreserved,
            14 => Self::TermWait,
            15 => Self::TermKillPermission,
            16 => Self::TermKillOther,
            17 => Self::CleanupDeadline,
            18 => Self::KillUnreserved,
            19 => Self::KillWait,
            20 => Self::KillKillPermission,
            21 => Self::KillKillOther,
            22 => Self::WaitAfterKill,
            23 => Self::ReapWait,
            24 => Self::ReapNotTerminal,
            25 => Self::ReapChildWait,
            26 => Self::LeafNonzero,
            27 => Self::LeafSignal,
            28 => Self::Stopped,
            29 => Self::InputIncomplete,
            30 => Self::InputWrite,
            31 => Self::OutputRead,
            32 => Self::OutputWrite,
            _ => return None,
        })
    }
}

impl Serialize for WorkerFailure {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignalFailure {
    Unreserved,
    Wait,
    KillPermission,
    KillOther,
}

impl SignalFailure {
    pub fn from_wait_error(_errno: i32) -> Self {
        Self::Wait
    }

    pub fn from_kill_error(errno: i32) -> Self {
        if errno == rustix::io::Errno::PERM.raw_os_error() {
            Self::KillPermission
        } else {
            Self::KillOther
        }
    }

    pub fn reason(self, kill: bool) -> WorkerFailure {
        match (kill, self) {
            (false, Self::Unreserved) => WorkerFailure::TermUnreserved,
            (false, Self::Wait) => WorkerFailure::TermWait,
            (false, Self::KillPermission) => WorkerFailure::TermKillPermission,
            (false, Self::KillOther) => WorkerFailure::TermKillOther,
            (true, Self::Unreserved) => WorkerFailure::KillUnreserved,
            (true, Self::Wait) => WorkerFailure::KillWait,
            (true, Self::KillPermission) => WorkerFailure::KillKillPermission,
            (true, Self::KillOther) => WorkerFailure::KillKillOther,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReapFailure {
    Wait,
    NotTerminal,
    ChildWait,
}

impl ReapFailure {
    pub fn reason(self) -> WorkerFailure {
        match self {
            Self::Wait => WorkerFailure::ReapWait,
            Self::NotTerminal => WorkerFailure::ReapNotTerminal,
            Self::ChildWait => WorkerFailure::ReapChildWait,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FirstFailure {
    Stopped,
    InputIncomplete,
    InputWrite,
    OutputRead,
    OutputWrite,
}

impl FirstFailure {
    pub fn reason(self) -> WorkerFailure {
        match self {
            Self::Stopped => WorkerFailure::Stopped,
            Self::InputIncomplete => WorkerFailure::InputIncomplete,
            Self::InputWrite => WorkerFailure::InputWrite,
            Self::OutputRead => WorkerFailure::OutputRead,
            Self::OutputWrite => WorkerFailure::OutputWrite,
        }
    }
}

// One supervisor invocation owns this tag. The first failed-flag site wins.
pub fn mark_failure(failed: &mut bool, first: &mut Option<FirstFailure>, reason: FirstFailure) {
    if !*failed {
        *first = Some(reason);
    }
    *failed = true;
}

pub fn final_status(
    reaped: &Result<ExitStatus, ReapFailure>,
    failed: bool,
    limit_failed: bool,
    first: Option<FirstFailure>,
) -> i32 {
    match reaped {
        Ok(status) if !failed && status.success() => 0,
        _ if limit_failed => 3,
        Err(reason) => reason.reason().code(),
        Ok(_) if failed => first.map(|reason| reason.reason().code()).unwrap_or(2),
        Ok(status) if status.code().is_some() => WorkerFailure::LeafNonzero.code(),
        Ok(status) if status.signal().is_some() => WorkerFailure::LeafSignal.code(),
        _ => 2,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct TransportContext {
    pub operation: Option<ReadOperation>,
    pub stage: ParentStage,
    pub worker_exit: Option<i32>,
    pub worker_signal: Option<i32>,
    pub worker_reason: Option<WorkerFailure>,
}

impl TransportContext {
    pub fn new(stage: ParentStage, status: Option<ExitStatus>) -> Self {
        let worker_exit = status.and_then(|status| status.code());
        Self {
            operation: None,
            stage,
            worker_exit,
            worker_signal: status.and_then(|status| status.signal()),
            worker_reason: if stage == ParentStage::WorkerNonzero {
                worker_exit.and_then(WorkerFailure::from_code)
            } else {
                None
            },
        }
    }
}

pub fn parent_error(stage: ParentStage, status: Option<ExitStatus>) -> crate::model::Diagnostic {
    let code = match stage {
        ParentStage::InputLimit | ParentStage::OutputLimit | ParentStage::WorkerLimit => {
            "git-limit"
        }
        ParentStage::Deadline => "git-timeout",
        _ => "git-command",
    };
    let mut diagnostic = crate::model::Diagnostic::new(code, None);
    diagnostic.transport = Some(TransportContext::new(stage, status));
    diagnostic
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
