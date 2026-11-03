use crate::{valid_id, Command, Stop};
use sha2::{Digest, Sha256};

pub const URL: &str = "https://example.com/synthetic-doc";
const MAX_STREAM: usize = 64 * 1024;
const MAX_OWNER_BYTES: usize = 128 * 1024;

pub struct Wire {
    pub argv: Vec<String>,
    pub stdin: Option<String>,
}

fn token(id: &str) -> bool {
    valid_id(id) && !id.starts_with('-')
}

/// Compare only bytes obtained from the held reviewed executable.
pub fn reviewed_owner(bytes: &[u8]) -> bool {
    !bytes.is_empty()
        && bytes.len() <= MAX_OWNER_BYTES
        && format!("{:x}", Sha256::digest(bytes))
            == "4c48789ba1fcdaabb6b9684436522f8b53e269da456afb86ecb09e9b049ce54a"
}

pub fn project(command: Command<'_>, url: &str) -> Result<Wire, Stop> {
    if url != URL {
        return Err(Stop::Operation);
    }
    let (operation, owner, target, stdin) = match command {
        Command::Open {
            owner,
            lease_secs: 300,
        } if token(owner) => {
            return Ok(Wire {
                argv: [
                    "open",
                    "--owner",
                    owner,
                    "--reason",
                    "docs-capture",
                    "--lease",
                    "300",
                    URL,
                ]
                .into_iter()
                .map(str::to_owned)
                .collect(),
                stdin: None,
            });
        }
        Command::Position {
            owner,
            target,
            page,
        } if (1..=10).contains(&page) => (
            "eval",
            owner,
            target,
            Some(format!("fixture.position({page})")),
        ),
        Command::Observe { owner, target } => {
            ("eval", owner, target, Some("fixture.observe()".into()))
        }
        Command::Shot { owner, target } => ("shot", owner, target, None),
        Command::CloseVerified { owner, target } => ("close-verified", owner, target, None),
        _ => return Err(Stop::Operation),
    };
    if !token(owner) || !token(target) {
        return Err(Stop::Operation);
    }
    let mut argv: Vec<_> = [operation, "--owner", owner, target]
        .into_iter()
        .map(str::to_owned)
        .collect();
    if stdin.is_some() {
        argv.push("-".into());
    }
    Ok(Wire { argv, stdin })
}

pub fn open_id(stdout: &[u8]) -> Result<&str, Stop> {
    if stdout.len() > MAX_STREAM {
        return Err(Stop::OpenUnknown);
    }
    let id = std::str::from_utf8(stdout)
        .ok()
        .and_then(|line| line.strip_suffix('\n'))
        .filter(|id| token(id))
        .ok_or(Stop::OpenUnknown)?;
    Ok(id)
}

/// Interpret stdout only after the shared owner proves exit zero and termination.
pub fn verified_close(stdout: &[u8], target: &str) -> Result<(), Stop> {
    if !token(target) || stdout != format!("agent-tab: closed {target}\n").as_bytes() {
        return Err(Stop::CloseUnknown);
    }
    Ok(())
}
