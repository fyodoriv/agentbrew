//! Default-deny dispatch for a separately compiled hosted experiment.
//! It cannot admit a syscall or prove process ownership.

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Refused;

pub(crate) fn dispatch<T, F: FnOnce() -> T>(_syscall: F) -> Result<T, Refused> {
    Err(Refused)
}

#[cfg(test)]
mod tests {
    use super::{dispatch, Refused};
    use std::cell::Cell;

    #[test]
    fn term_kill_and_drop_retries_never_call_the_syscall() {
        let calls = Cell::new(0);
        for _case in ["term", "kill", "drop-term", "drop-kill"] {
            let result = dispatch(|| calls.set(calls.get() + 1));
            assert_eq!(result, Err(Refused));
        }
        assert_eq!(calls.get(), 0);
    }
}
