//! Fixed-capacity experiment receipt for one supervisor invocation.
//! It stores no process IDs, errno integers, heap data, or external I/O.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Evidence {
    SetupFailure,
    WorkFailure,
    Context,
    Terminal,
    Stop,
    Reaped,
    Intent,
    OwnershipUnknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    Observation(Evidence),
    Spawned,
    TermAttempt,
    KillAttempt,
    Refused,
    Drop,
    Finalized,
}

pub(crate) struct Receipt<const N: usize> {
    events: [Option<Event>; N],
    used: usize,
    pending: bool,
    invalid: bool,
    claimed: bool,
}

impl<const N: usize> Receipt<N> {
    pub(crate) fn new() -> Self {
        Self {
            events: [None; N],
            used: 0,
            pending: false,
            invalid: false,
            claimed: false,
        }
    }

    pub(crate) fn claim(&mut self) -> bool {
        if self.claimed || self.invalid || self.pending || self.used != 0 {
            self.invalid = true;
            return false;
        }
        self.claimed = true;
        true
    }

    pub(crate) fn record(&mut self, event: Event) -> bool {
        if self.invalid
            || self.pending
            || self.used == N
            || !matches!(event, Event::Observation(_) | Event::Spawned | Event::Drop)
        {
            self.invalid = true;
            return false;
        }
        self.events[self.used] = Some(event);
        self.used += 1;
        if event == Event::Observation(Evidence::OwnershipUnknown) {
            self.invalid = true;
        }
        true
    }

    pub(crate) fn begin(&mut self, attempt: Event) -> bool {
        if self.invalid
            || self.pending
            || !matches!(attempt, Event::TermAttempt | Event::KillAttempt)
            || N.saturating_sub(self.used) < 2
        {
            self.invalid = true;
            return false;
        }
        self.events[self.used] = Some(attempt);
        self.used += 1;
        self.pending = true;
        true
    }

    pub(crate) fn refused(&mut self) -> bool {
        if self.invalid || !self.pending || self.used == N {
            self.invalid = true;
            return false;
        }
        self.events[self.used] = Some(Event::Refused);
        self.used += 1;
        self.pending = false;
        true
    }

    pub(crate) fn invalidate(&mut self) {
        self.invalid = true;
    }

    pub(crate) fn finalize_after_return(&mut self) -> bool {
        if !self.claimed || self.invalid || self.pending || self.used == N {
            self.invalid = true;
            return false;
        }
        self.events[self.used] = Some(Event::Finalized);
        self.used += 1;
        true
    }

    pub(crate) fn internally_consistent(&mut self) -> bool {
        if self.pending {
            self.invalid = true;
        }
        !self.invalid
    }

    pub(crate) fn events(&self) -> &[Option<Event>] {
        &self.events[..self.used]
    }

    // A closed refusal diagnostic is not proof of process ownership or cleanup.
    pub(crate) fn closed_refusal_diagnostic(&mut self) -> bool {
        if !self.claimed || !self.internally_consistent() {
            return false;
        }
        let mut spawned = false;
        let mut dropped = false;
        let mut reaped = false;
        let mut finalized = false;
        let mut pending = false;
        let mut refused = false;
        for event in self.events[..self.used].iter().flatten() {
            if finalized {
                return false;
            }
            match event {
                Event::Spawned if !spawned => spawned = true,
                Event::Drop if spawned && !dropped && !pending => dropped = true,
                Event::Observation(Evidence::Reaped) if spawned && !reaped && !pending => {
                    reaped = true
                }
                Event::TermAttempt | Event::KillAttempt if spawned && !pending && !reaped => {
                    pending = true
                }
                Event::Refused if pending => {
                    pending = false;
                    refused = true;
                }
                Event::Finalized if spawned && dropped && reaped && refused && !pending => {
                    finalized = true;
                }
                Event::Observation(Evidence::OwnershipUnknown) => return false,
                Event::Observation(Evidence::Reaped) => return false,
                Event::Observation(_) if !pending => {}
                _ => return false,
            }
        }
        finalized
    }
}

#[cfg(test)]
mod tests {
    use super::{Event, Evidence, Receipt};
    use std::cell::Cell;

    #[test]
    fn exact_capacity_is_valid() {
        let mut r = Receipt::<2>::new();
        assert!(r.begin(Event::TermAttempt));
        assert!(r.refused());
        assert!(r.internally_consistent());
    }

    #[test]
    fn overflow_is_sticky() {
        let mut r = Receipt::<1>::new();
        assert!(!r.begin(Event::TermAttempt));
        assert!(!r.record(Event::Observation(Evidence::Context)));
        assert!(!r.internally_consistent());
    }

    #[test]
    fn invalidation_refuses_fake_syscall() {
        let mut r = Receipt::<1>::new();
        let calls = Cell::new(0);
        if r.begin(Event::KillAttempt) {
            calls.set(calls.get() + 1);
        }
        assert_eq!(calls.get(), 0);
        assert!(!r.internally_consistent());
    }

    #[test]
    fn missing_result_is_inconclusive() {
        let mut r = Receipt::<2>::new();
        assert!(r.begin(Event::TermAttempt));
        assert!(!r.internally_consistent());
        assert!(!r.refused());
    }

    #[test]
    fn illegal_transition_is_rejected() {
        let mut r = Receipt::<4>::new();
        assert!(!r.refused());
        assert!(!r.begin(Event::TermAttempt));
    }

    #[test]
    fn direct_transactional_record_is_rejected() {
        for event in [
            Event::Refused,
            Event::TermAttempt,
            Event::KillAttempt,
            Event::Finalized,
        ] {
            let mut r = Receipt::<4>::new();
            assert!(!r.record(event));
            assert!(!r.internally_consistent());
        }
    }

    #[test]
    fn invalid_receipt_refuses_cleanup_retries() {
        let mut r = Receipt::<3>::new();
        assert!(r.begin(Event::TermAttempt));
        assert!(!r.record(Event::Drop));
        assert!(!r.begin(Event::KillAttempt));
        assert!(!r.internally_consistent());
    }

    #[test]
    fn unexpected_admission_is_inconclusive() {
        let mut r = Receipt::<4>::new();
        assert!(r.begin(Event::TermAttempt));
        r.invalidate();
        assert!(!r.refused());
        assert!(!r.internally_consistent());
    }

    #[test]
    fn ordinary_observation_then_refusal_is_closed() {
        let mut r = Receipt::<3>::new();
        assert!(r.record(Event::Observation(Evidence::Context)));
        assert!(r.begin(Event::KillAttempt));
        assert!(r.refused());
        assert!(r.internally_consistent());
    }

    #[test]
    fn closed_evidence_categories_are_retained() {
        let mut r = Receipt::<4>::new();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Observation(Evidence::Terminal)));
        assert!(r.record(Event::Observation(Evidence::Stop)));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.internally_consistent());
    }

    #[test]
    fn unknown_ownership_blocks_later_attempts() {
        let mut r = Receipt::<4>::new();
        assert!(r.record(Event::Observation(Evidence::OwnershipUnknown)));
        assert!(!r.begin(Event::TermAttempt));
        assert!(!r.internally_consistent());
    }

    #[test]
    fn unproved_reap_after_drop_stays_inconclusive() {
        let mut r = Receipt::<4>::new();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::OwnershipUnknown)));
        assert!(!r.begin(Event::KillAttempt));
        assert!(!r.internally_consistent());
    }

    fn refusal(r: &mut Receipt<16>) {
        assert!(r.begin(Event::TermAttempt));
        assert!(r.refused());
    }

    fn claimed() -> Receipt<16> {
        let mut receipt = Receipt::<16>::new();
        assert!(receipt.claim());
        receipt
    }

    #[test]
    fn closed_refusal_after_drop_reap_is_diagnostic_only() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Observation(Evidence::Stop)));
        assert!(r.record(Event::Observation(Evidence::Terminal)));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(r.closed_refusal_diagnostic());
    }

    #[test]
    fn reap_before_drop_is_allowed() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        refusal(&mut r);
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.record(Event::Drop));
        assert!(r.finalize_after_return());
        assert!(r.closed_refusal_diagnostic());
    }

    #[test]
    fn drop_retry_without_main_attempt_is_allowed() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Drop));
        refusal(&mut r);
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(r.closed_refusal_diagnostic());
    }

    #[test]
    fn missing_final_or_reap_is_inconclusive() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(!r.closed_refusal_diagnostic());
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn no_refusal_is_inconclusive() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn early_or_duplicate_finalization_is_inconclusive() {
        let mut r = claimed();
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
        let mut duplicate = claimed();
        assert!(duplicate.record(Event::Spawned));
        refusal(&mut duplicate);
        assert!(duplicate.record(Event::Drop));
        assert!(duplicate.record(Event::Observation(Evidence::Reaped)));
        assert!(duplicate.finalize_after_return());
        assert!(duplicate.finalize_after_return());
        assert!(!duplicate.closed_refusal_diagnostic());
    }

    #[test]
    fn unknown_ownership_cannot_close_diagnostic() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::OwnershipUnknown)));
        assert!(!r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn duplicate_reap_cannot_close_diagnostic() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn receipt_can_be_claimed_only_once() {
        let mut r = claimed();
        assert!(!r.claim());
        assert!(!r.internally_consistent());
    }

    #[test]
    fn attempt_after_reap_cannot_close_diagnostic() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn pending_attempt_cannot_close_diagnostic() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        assert!(r.begin(Event::TermAttempt));
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn empty_or_unclaimed_receipt_is_inconclusive() {
        let mut empty = Receipt::<16>::new();
        assert!(!empty.closed_refusal_diagnostic());
        let mut claimed_empty = claimed();
        assert!(!claimed_empty.closed_refusal_diagnostic());
    }

    #[test]
    fn finalization_overflow_is_sticky() {
        let mut r = Receipt::<1>::new();
        assert!(r.claim());
        assert!(r.record(Event::Spawned));
        assert!(!r.finalize_after_return());
        assert!(!r.internally_consistent());
    }

    #[test]
    fn drop_before_spawn_is_inconclusive() {
        let mut r = claimed();
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Spawned));
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn reap_before_spawn_is_inconclusive() {
        let mut r = claimed();
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.record(Event::Spawned));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(!r.closed_refusal_diagnostic());
    }

    #[test]
    fn event_after_finalization_is_inconclusive() {
        let mut r = claimed();
        assert!(r.record(Event::Spawned));
        refusal(&mut r);
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        assert!(r.record(Event::Observation(Evidence::Context)));
        assert!(!r.closed_refusal_diagnostic());
    }
}
