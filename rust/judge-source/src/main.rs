#![forbid(unsafe_code)]

use std::process::ExitCode;

#[cfg(unix)]
fn write_source() -> Option<()> {
    use judge_source::JudgeRoot;
    use std::io::{self, Write};
    use std::path::Path;

    let mut args = std::env::args_os().skip(1);
    let root = args.next()?;
    let declaration = args.next()?.into_string().ok()?;
    if args.next().is_some() {
        return None;
    }
    let root = JudgeRoot::open(Path::new(&root)).ok()?;
    let bytes = root.read(&declaration).ok()?;
    io::stdout().lock().write_all(&bytes).ok()
}

#[cfg(not(unix))]
fn write_source() -> Option<()> {
    None
}

fn main() -> ExitCode {
    if write_source().is_some() {
        return ExitCode::SUCCESS;
    }
    eprintln!("Judge source unavailable.");
    ExitCode::from(2)
}
