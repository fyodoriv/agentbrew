#![forbid(unsafe_code)]

use checkup_run::{Error, Record, Report, ResultKind, Store, MAX_BYTES};
use std::env;
use std::ffi::OsString;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

struct Request {
    checkup: String,
    record: Option<Record>,
    json: bool,
}

fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Request, Error> {
    let mut args = args.into_iter();
    let mut bytes = 0usize;
    let mut next = || {
        args.next()
            .map(|arg| {
                bytes = bytes
                    .checked_add(arg.len() + 1)
                    .ok_or(Error::InvalidInput)?;
                if bytes > MAX_BYTES {
                    return Err(Error::InvalidInput);
                }
                arg.into_string().map_err(|_| Error::InvalidInput)
            })
            .transpose()
    };
    let verb = next()?.ok_or(Error::InvalidInput)?;
    let checkup = next()?.ok_or(Error::InvalidInput)?;
    let recording = match verb.as_str() {
        "show" => false,
        "record" => true,
        _ => return Err(Error::InvalidInput),
    };
    let mut json = false;
    let mut finished_at = None;
    let mut result = None;
    let mut commits = Vec::new();
    while let Some(flag) = next()? {
        match flag.as_str() {
            "--json" if !json => json = true,
            "--finished-at" if recording && finished_at.is_none() => {
                finished_at = Some(next()?.ok_or(Error::InvalidInput)?);
            }
            "--result" if recording && result.is_none() => {
                result = Some(ResultKind::parse(&next()?.ok_or(Error::InvalidInput)?)?);
            }
            "--commit" if recording => {
                let value = next()?.ok_or(Error::InvalidInput)?;
                let (repo, sha) = value.split_once('=').ok_or(Error::InvalidInput)?;
                commits.push((repo.to_owned(), sha.to_owned()));
            }
            _ => return Err(Error::InvalidInput),
        }
    }
    let record = if recording {
        Some(Record::new(
            finished_at.ok_or(Error::InvalidInput)?,
            result.ok_or(Error::InvalidInput)?,
            commits,
        )?)
    } else {
        None
    };
    Ok(Request {
        checkup,
        record,
        json,
    })
}

fn run(request: Request) -> Result<Report, Error> {
    let root = match env::var_os("XDG_STATE_HOME").filter(|value| !value.is_empty()) {
        Some(root) => PathBuf::from(root),
        None => PathBuf::from(
            env::var_os("HOME")
                .filter(|v| !v.is_empty())
                .ok_or(Error::UnsafeTarget)?,
        )
        .join(".local/state"),
    };
    let store = Store::new(root)?;
    match request.record {
        Some(record) => store.record(&request.checkup, record),
        None => store.show(&request.checkup),
    }
}

fn write_report(report: Report, json: bool) -> Result<(), Error> {
    let mut out = io::stdout().lock();
    if json {
        serde_json::to_writer(&mut out, &report).map_err(|_| Error::Io)?;
        out.write_all(b"\n").map_err(|_| Error::Io)
    } else {
        out.write_all(report.human().as_bytes())
            .map_err(|_| Error::Io)
    }
}

fn main() -> ExitCode {
    let json_requested = env::args_os().skip(1).any(|arg| arg == "--json");
    let outcome = parse(env::args_os().skip(1)).and_then(|request| {
        let json = request.json;
        write_report(run(request)?, json)
    });
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let mut err = io::stderr().lock();
            if json_requested {
                let _ = writeln!(
                    err,
                    "{{\"status\":\"error\",\"code\":\"{}\"}}",
                    error.code()
                );
            } else {
                let _ = writeln!(err, "Checkup record: {}", error.code());
            }
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStringExt;

    #[test]
    fn invalid_argument_bytes_and_flags_are_refused() {
        let invalid = OsString::from_vec(vec![0xff]);
        for args in [
            vec!["show".into(), invalid],
            vec![
                "show".into(),
                "fixture".into(),
                "--json".into(),
                "--json".into(),
            ],
            vec!["show".into(), "fixture".into(), "--extra".into()],
            vec!["show".into(), "a".repeat(MAX_BYTES).into()],
            vec!["record".into(), "fixture".into(), "--finished-at".into()],
        ] {
            assert!(matches!(parse(args), Err(Error::InvalidInput)));
        }
    }
}
