use crate::transport::{
    final_status, mark_failure, FirstFailure, ReapFailure, SignalFailure, WorkerFailure,
};
use nix::sys::signal::{pthread_sigmask, SigSet, SigmaskHow, Signal as NixSignal};
use rustix::fd::AsFd;
use rustix::fs::{fcntl_getfl, fcntl_setfl, OFlags};
use rustix::io::{read, write, Errno};
use rustix::process::{
    getpid, getppid, kill_process_group, waitid, Pid, Signal, WaitId, WaitIdOptions,
};
use rustix::time::{clock_gettime, ClockId};
use std::ffi::OsString;
use std::fs::File;
use std::io::Write;
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const SECOND: u128 = 1_000_000_000;
const TOTAL: u128 = 30 * SECOND;
const CLEANUP: u128 = 2 * SECOND;
pub(crate) const INPUT_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
pub(crate) struct Deadline(u128);

impl Deadline {
    pub(crate) fn now() -> Self {
        let time = clock_gettime(ClockId::Monotonic);
        Self(time.tv_sec as u128 * SECOND + time.tv_nsec as u128)
    }

    pub(crate) fn elapsed(self) -> bool {
        Self::now().0 >= self.0
    }
    fn work_done(self) -> bool {
        Self::now().0 >= self.0.saturating_sub(CLEANUP)
    }
    fn cleanup(self) -> Self {
        Self(self.0.min(Self::now().0 + CLEANUP))
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Startup {
    parent: Pid,
    pub(crate) deadline: Deadline,
}

impl Startup {
    pub(crate) fn capture() -> Self {
        Self {
            parent: getpid(),
            deadline: Deadline(Deadline::now().0 + TOTAL),
        }
    }

    pub(crate) fn args(self) -> [String; 3] {
        [
            self.parent.as_raw_nonzero().get().to_string(),
            (self.deadline.0 / SECOND).to_string(),
            (self.deadline.0 % SECOND).to_string(),
        ]
    }

    pub(crate) fn parse(args: &[OsString]) -> Option<Self> {
        if args.len() != 3 {
            return None;
        }
        let parent: i32 = args[0].to_str()?.parse().ok()?;
        let seconds: u64 = args[1].to_str()?.parse().ok()?;
        let nanos: u32 = args[2].to_str()?.parse().ok()?;
        if parent <= 1 || nanos >= 1_000_000_000 {
            return None;
        }
        let startup = Self {
            parent: Pid::from_raw(parent)?,
            deadline: Deadline(seconds as u128 * SECOND + nanos as u128),
        };
        let now = Deadline::now().0;
        if startup.deadline.0 <= now
            || startup.deadline.0 - now > TOTAL
            || !startup.parent_present()
        {
            return None;
        }
        Some(startup)
    }

    fn parent_present(self) -> bool {
        getppid() == Some(self.parent)
    }
}

pub(crate) fn nonblocking(fd: &impl AsFd) -> Result<(), ()> {
    let flags = fcntl_getfl(fd).map_err(|_| ())?;
    fcntl_setfl(fd, flags | OFlags::NONBLOCK).map_err(|_| ())
}

pub(crate) enum InputPolicy {
    Empty,
    Objects,
}

#[derive(Debug)]
enum Observation {
    SignalSetup,
    Request,
    StartupCancelled,
    IoSetup,
    ControlRead,
    SignalFlag,
    ParentPresent,
    WorkDeadline,
    InputIncomplete,
    InputWrite,
    OutputRead,
    OutputWrite,
    OutputLimit,
    TerminalCode,
    TerminalSignal,
    WaitError,
    SignalAttempt,
    SignalError,
    ReapCode,
    ReapSignal,
    ReapError,
    Failed,
}

fn observe(receipt: &mut Option<File>, reason: Observation, value: i64) {
    if let Some(receipt) = receipt {
        let _ = writeln!(receipt, "{reason:?} {value}");
    }
}

fn worker_signals() -> Result<Arc<AtomicUsize>, ()> {
    // These registrations belong to one fresh worker process and die with it.
    let cancelled = Arc::new(AtomicUsize::new(0));
    for signal in [
        signal_hook::consts::SIGINT,
        signal_hook::consts::SIGTERM,
        signal_hook::consts::SIGPIPE,
    ] {
        signal_hook::flag::register_usize(signal, Arc::clone(&cancelled), signal as usize)
            .map_err(|_| ())?;
    }
    // A fresh sigaction replaces inherited SIG_IGN/SA_NOCLDWAIT before spawning.
    signal_hook::flag::register_usize(
        signal_hook::consts::SIGCHLD,
        Arc::new(AtomicUsize::new(0)),
        1,
    )
    .map_err(|_| ())?;
    let mut unblock = SigSet::empty();
    unblock.add(NixSignal::SIGINT);
    unblock.add(NixSignal::SIGTERM);
    pthread_sigmask(SigmaskHow::SIG_UNBLOCK, Some(&unblock), None).map_err(|_| ())?;
    let actual = SigSet::thread_get_mask().map_err(|_| ())?;
    if actual.contains(NixSignal::SIGINT) || actual.contains(NixSignal::SIGTERM) {
        return Err(());
    }
    Ok(cancelled)
}

fn cancelled(startup: Startup, flags: &AtomicUsize) -> bool {
    flags.load(Ordering::Acquire) != 0 || !startup.parent_present()
}

fn request(startup: Startup, flags: &AtomicUsize, policy: InputPolicy) -> Result<Vec<u8>, ()> {
    let stdin = std::io::stdin();
    nonblocking(&stdin)?;
    let mut bytes = Vec::new();
    let mut expected = None;
    let mut buffer = [0; 65536];
    loop {
        if startup.deadline.work_done() || cancelled(startup, flags) {
            return Err(());
        }
        match read(&stdin, &mut buffer[..]) {
            Ok(0) => return Err(()),
            Ok(count) => {
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.len() >= 4 && expected.is_none() {
                    let size = u32::from_be_bytes(bytes[..4].try_into().map_err(|_| ())?) as usize;
                    if size > INPUT_LIMIT {
                        return Err(());
                    }
                    expected = Some(size + 4);
                }
                if let Some(size) = expected {
                    if bytes.len() > size {
                        return Err(());
                    }
                    if bytes.len() == size {
                        break;
                    }
                }
            }
            Err(Errno::AGAIN | Errno::INTR) => thread::sleep(Duration::from_millis(1)),
            Err(_) => return Err(()),
        }
    }
    bytes.drain(..4);
    match policy {
        InputPolicy::Empty if !bytes.is_empty() => Err(()),
        InputPolicy::Objects
            if !bytes.is_empty()
                && (!bytes.ends_with(b"\n")
                    || bytes[..bytes.len() - 1].split(|b| *b == b'\n').any(|id| {
                        !matches!(id.len(), 40 | 64) || !id.iter().all(u8::is_ascii_hexdigit)
                    })) =>
        {
            Err(())
        }
        _ => Ok(bytes),
    }
}

struct Leader {
    child: Child,
    pid: Pid,
    reserved: bool,
    deadline: Deadline,
    cleanup: Option<Deadline>,
    last_error: i32,
}

impl Leader {
    fn status(&mut self) -> Result<Option<rustix::process::WaitIdStatus>, ()> {
        match waitid(
            WaitId::Pid(self.pid),
            WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
        ) {
            Ok(status) => Ok(status),
            Err(Errno::INTR) => Ok(None),
            Err(error) => {
                self.last_error = error.raw_os_error();
                self.reserved = false;
                Err(())
            }
        }
    }

    fn signal(&mut self, signal: Signal) -> Result<(), SignalFailure> {
        if !self.reserved {
            return Err(SignalFailure::Unreserved);
        }
        self.status()
            .map_err(|_| SignalFailure::from_wait_error(self.last_error))?;
        match kill_process_group(self.pid, signal) {
            Ok(()) | Err(Errno::SRCH) => Ok(()),
            Err(error) => {
                self.last_error = error.raw_os_error();
                Err(SignalFailure::from_kill_error(error.raw_os_error()))
            }
        }
    }

    fn reap(&mut self) -> Result<std::process::ExitStatus, ReapFailure> {
        if self.status().map_err(|_| ReapFailure::Wait)?.is_none() {
            return Err(ReapFailure::NotTerminal);
        }
        let status = self.child.wait().map_err(|error| {
            self.last_error = error.raw_os_error().unwrap_or(-1);
            ReapFailure::ChildWait
        })?;
        self.reserved = false;
        Ok(status)
    }
}

impl Drop for Leader {
    fn drop(&mut self) {
        if !self.reserved {
            return;
        }
        let end = self.cleanup.unwrap_or_else(|| self.deadline.cleanup());
        let _ = self.signal(Signal::TERM);
        let _ = self.signal(Signal::KILL);
        while self.reserved && !end.elapsed() {
            match self.status() {
                Ok(Some(_)) => {
                    let _ = self.reap();
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(1)),
                Err(_) => break,
            }
        }
    }
}

// Only a fresh fixed-operation worker may call this owner. Its host is unchanged.
pub(crate) fn supervise(
    mut command: Command,
    startup: Startup,
    limit: usize,
    policy: InputPolicy,
    mut receipt: Option<File>,
) -> i32 {
    let Ok(flags) = worker_signals() else {
        observe(&mut receipt, Observation::SignalSetup, -1);
        return WorkerFailure::SignalSetup.code();
    };
    let Ok(input) = request(startup, &flags, policy) else {
        observe(&mut receipt, Observation::Request, -1);
        return WorkerFailure::Request.code();
    };
    if cancelled(startup, &flags) || startup.deadline.work_done() {
        observe(&mut receipt, Observation::StartupCancelled, -1);
        return WorkerFailure::StartupCancelled.code();
    }
    let Ok((child_input, child_request)) = UnixStream::pair() else {
        return WorkerFailure::ChildSocket.code();
    };
    let child_request: OwnedFd = child_request.into();
    command
        .stdin(Stdio::from(child_request))
        .stdout(Stdio::piped())
        .process_group(0);
    let Ok(child) = command.spawn() else {
        return WorkerFailure::ChildSpawn.code();
    };
    drop(command);
    let Some(pid) = Pid::from_raw(child.id() as i32) else {
        return WorkerFailure::ChildPid.code();
    };
    let mut leader = Leader {
        child,
        pid,
        reserved: true,
        deadline: startup.deadline,
        cleanup: None,
        last_error: 0,
    };
    let Some(child_output) = leader.child.stdout.take() else {
        return WorkerFailure::ChildStdout.code();
    };
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    if nonblocking(&child_input).is_err()
        || nonblocking(&child_output).is_err()
        || nonblocking(&stdout).is_err()
    {
        observe(&mut receipt, Observation::IoSetup, -1);
        return WorkerFailure::IoSetup.code();
    }
    let mut child_input = Some(child_input);
    let mut input_offset = 0;
    let mut output = Vec::new();
    let mut offset = 0;
    let mut total = 0usize;
    let mut eof = false;
    let mut failed = false;
    let mut first_failure = None;
    let mut limit_failed = false;
    let mut cleanup: Option<Deadline> = None;
    let mut kill_at = 0;
    let mut killed = false;
    let mut reported_terminal = false;
    let mut reported_stop = false;
    let mut buffer = [0; 65536];
    loop {
        let now = Deadline::now();
        let mut control = [0; 1];
        let (control_failed, control_result) = match read(&stdin, &mut control[..]) {
            Err(Errno::AGAIN | Errno::INTR) => (false, 2),
            Ok(count) => (true, count as i64),
            Err(error) => (true, -(error.raw_os_error() as i64)),
        };
        let stopped = cancelled(startup, &flags) || startup.deadline.work_done() || control_failed;
        if stopped {
            mark_failure(&mut failed, &mut first_failure, FirstFailure::Stopped);
        }
        let terminal = match leader.status() {
            Ok(status) => {
                if let Some(status) = &status {
                    if !reported_terminal {
                        observe(
                            &mut receipt,
                            Observation::TerminalCode,
                            status.exit_status().unwrap_or(-1) as i64,
                        );
                        observe(
                            &mut receipt,
                            Observation::TerminalSignal,
                            status.terminating_signal().unwrap_or(-1) as i64,
                        );
                        reported_terminal = true;
                    }
                }
                status.is_some()
            }
            Err(_) => {
                observe(
                    &mut receipt,
                    Observation::WaitError,
                    leader.last_error as i64,
                );
                return WorkerFailure::WaitBeforeCleanup.code();
            }
        };
        if terminal && input_offset != input.len() {
            observe(
                &mut receipt,
                Observation::InputIncomplete,
                (input.len() - input_offset) as i64,
            );
        }
        if terminal && input_offset != input.len() {
            mark_failure(
                &mut failed,
                &mut first_failure,
                FirstFailure::InputIncomplete,
            );
        }
        if (cleanup.is_none() && (stopped || failed || terminal)) || (stopped && !reported_stop) {
            observe(&mut receipt, Observation::ControlRead, control_result);
            observe(
                &mut receipt,
                Observation::SignalFlag,
                flags.load(Ordering::Acquire) as i64,
            );
            observe(
                &mut receipt,
                Observation::ParentPresent,
                i64::from(startup.parent_present()),
            );
            observe(
                &mut receipt,
                Observation::WorkDeadline,
                i64::from(startup.deadline.work_done()),
            );
            reported_stop |= stopped;
        }
        if cleanup.is_none() && (stopped || failed || terminal) {
            cleanup = Some(startup.deadline.cleanup());
            leader.cleanup = cleanup;
            kill_at = now.0 + 20_000_000;
            observe(
                &mut receipt,
                Observation::SignalAttempt,
                Signal::TERM.as_raw() as i64,
            );
            if let Err(reason) = leader.signal(Signal::TERM) {
                observe(
                    &mut receipt,
                    Observation::SignalError,
                    leader.last_error as i64,
                );
                return reason.reason(false).code();
            }
        }
        if let Some(end) = cleanup {
            if end.elapsed() {
                return WorkerFailure::CleanupDeadline.code();
            }
            if !killed && now.0 >= kill_at {
                observe(
                    &mut receipt,
                    Observation::SignalAttempt,
                    Signal::KILL.as_raw() as i64,
                );
                if let Err(reason) = leader.signal(Signal::KILL) {
                    observe(
                        &mut receipt,
                        Observation::SignalError,
                        leader.last_error as i64,
                    );
                    return reason.reason(true).code();
                }
                killed = true;
            }
        }
        if child_input.is_some() {
            if cleanup.is_some() || input_offset == input.len() {
                child_input.take();
            } else {
                match child_input.as_mut().unwrap().write(&input[input_offset..]) {
                    Ok(count) => input_offset += count,
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => {
                        observe(
                            &mut receipt,
                            Observation::InputWrite,
                            error.raw_os_error().unwrap_or(-1) as i64,
                        );
                        mark_failure(&mut failed, &mut first_failure, FirstFailure::InputWrite);
                    }
                }
            }
        }
        if !eof && offset == output.len() {
            match read(&child_output, &mut buffer[..]) {
                Ok(0) => eof = true,
                Ok(count) => {
                    total = total.saturating_add(count);
                    if total > limit {
                        failed = true;
                        limit_failed = true;
                        observe(&mut receipt, Observation::OutputLimit, total as i64);
                    }
                    output.clear();
                    output.extend_from_slice(&buffer[..count]);
                    offset = 0;
                }
                Err(Errno::AGAIN | Errno::INTR) => {}
                Err(error) => {
                    observe(
                        &mut receipt,
                        Observation::OutputRead,
                        error.raw_os_error() as i64,
                    );
                    mark_failure(&mut failed, &mut first_failure, FirstFailure::OutputRead);
                    eof = true;
                }
            }
        }
        if offset < output.len() {
            if failed {
                offset = output.len();
            } else {
                match write(&stdout, &output[offset..]) {
                    Ok(count) => offset += count,
                    Err(Errno::AGAIN | Errno::INTR) => {}
                    Err(error) => {
                        observe(
                            &mut receipt,
                            Observation::OutputWrite,
                            error.raw_os_error() as i64,
                        );
                        mark_failure(&mut failed, &mut first_failure, FirstFailure::OutputWrite);
                    }
                }
            }
        }
        if killed && eof && offset == output.len() {
            match leader.status() {
                Ok(Some(_)) => {
                    let reaped = leader.reap();
                    match &reaped {
                        Ok(status) => {
                            observe(
                                &mut receipt,
                                Observation::ReapCode,
                                status.code().unwrap_or(-1) as i64,
                            );
                            observe(
                                &mut receipt,
                                Observation::ReapSignal,
                                status.signal().unwrap_or(-1) as i64,
                            );
                        }
                        Err(_) => observe(
                            &mut receipt,
                            Observation::ReapError,
                            leader.last_error as i64,
                        ),
                    }
                    observe(&mut receipt, Observation::Failed, i64::from(failed));
                    return final_status(&reaped, failed, limit_failed, first_failure);
                }
                Ok(None) => {}
                Err(_) => {
                    observe(
                        &mut receipt,
                        Observation::WaitError,
                        leader.last_error as i64,
                    );
                    return WorkerFailure::WaitAfterKill.code();
                }
            }
        }
        thread::sleep(Duration::from_millis(1));
    }
}
