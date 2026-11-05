// API preparation shares the exact safe validators without enabling native proof.
#[cfg(test)]
#[path = "../vendor/libproc-0.14.11/src/libproc/sys/bounded_group.rs"]
mod bounded_group;

#[cfg(test)]
mod tests {
    #[test]
    fn native_current_cargo_group_one_slot_is_only_a_full_buffer_abi_control() {
        let group = rustix::process::getpgrp().as_raw_pid();
        assert!(group > 0, "controlled Cargo execution group unavailable");
        let result = libproc::processes::bounded_group_pids(group as u32, 1)
            .expect("native bounded group ABI query must run successfully");
        assert_eq!(
            result.pids.len(),
            1,
            "one-slot native buffer was not filled"
        );
        assert!(
            !result.complete,
            "full native buffer cannot prove completeness"
        );
        assert!(
            result.pids.iter().all(|pid| *pid > 0),
            "invalid native PID identity"
        );
    }
}
