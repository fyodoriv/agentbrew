use super::worker_owner::{nonblocking, Startup, INPUT_LIMIT};
use crate::{
    model::Diagnostic,
    transport::{parent_error, ParentStage},
};
use rustix::io::{read, Errno};
use std::io::Write;
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::thread;
use std::time::Duration;

// One metadata operation owns this supervisor and its cancellation endpoint.
struct Worker {
    child: Child,
    input: Option<UnixStream>,
    output: Option<ChildStdout>,
    startup: Startup,
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.input.take();
        self.output.take();
        while !self.startup.deadline.elapsed() {
            match self.child.try_wait() {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) => thread::sleep(Duration::from_millis(1)),
            }
        }
    }
}

pub(crate) fn run_child(
    mut command: Command,
    input: Vec<u8>,
    limit: usize,
) -> Result<Vec<u8>, Diagnostic> {
    let startup = Startup::capture();
    if input.len() > INPUT_LIMIT {
        return Err(parent_error(ParentStage::InputLimit, None));
    }
    let (request, child_request) =
        UnixStream::pair().map_err(|_| parent_error(ParentStage::RequestSocket, None))?;
    request
        .set_nonblocking(true)
        .map_err(|_| parent_error(ParentStage::RequestMode, None))?;
    let child_request: OwnedFd = child_request.into();
    command
        .args(startup.args())
        .stdin(Stdio::from(child_request))
        .stdout(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|_| parent_error(ParentStage::WorkerSpawn, None))?;
    drop(command);
    let mut worker = Worker {
        child,
        input: Some(request),
        output: None,
        startup,
    };
    worker.output = worker.child.stdout.take();
    let output = worker
        .output
        .as_ref()
        .ok_or_else(|| parent_error(ParentStage::WorkerStdout, None))?;
    nonblocking(output).map_err(|_| parent_error(ParentStage::OutputMode, None))?;
    let mut frame = Vec::with_capacity(input.len() + 4);
    frame.extend_from_slice(&(input.len() as u32).to_be_bytes());
    frame.extend_from_slice(&input);
    let mut sent = 0;
    let mut bytes = Vec::new();
    let mut failure = None;
    let mut status = None;
    let mut eof = false;
    let mut buffer = [0; 65536];
    loop {
        if startup.deadline.elapsed() {
            return Err(parent_error(ParentStage::Deadline, status));
        }
        if let Some(request) = worker.input.as_mut() {
            if sent < frame.len() {
                match request.write(&frame[sent..]) {
                    Ok(count) => sent += count,
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(_) => failure = Some(ParentStage::RequestWrite),
                }
            }
        }
        if !eof {
            match read(worker.output.as_ref().unwrap(), &mut buffer[..]) {
                Ok(0) => eof = true,
                Ok(count) => {
                    let keep = (limit.saturating_add(1) - bytes.len()).min(count);
                    bytes.extend_from_slice(&buffer[..keep]);
                    if bytes.len() > limit {
                        failure = Some(ParentStage::OutputLimit);
                    }
                }
                Err(Errno::AGAIN | Errno::INTR) => {}
                Err(_) => failure = Some(ParentStage::OutputRead),
            }
        }
        if failure.is_some() {
            worker.input.take();
        }
        if status.is_none() {
            status = worker
                .child
                .try_wait()
                .map_err(|_| parent_error(ParentStage::WorkerWait, None))?;
        }
        if let Some(status) = status {
            if status.code() == Some(3) {
                failure = Some(ParentStage::WorkerLimit);
            }
            if eof {
                if let Some(stage) = failure {
                    return Err(parent_error(stage, Some(status)));
                }
                if status.success() && sent == frame.len() {
                    return Ok(bytes);
                }
                return Err(parent_error(
                    if status.success() {
                        ParentStage::IncompleteSend
                    } else {
                        ParentStage::WorkerNonzero
                    },
                    Some(status),
                ));
            }
        }
        thread::sleep(Duration::from_millis(1));
    }
}
