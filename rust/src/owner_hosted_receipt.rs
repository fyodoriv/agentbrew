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
}

pub(crate) struct Receipt<const N: usize> {
    events: [Option<Event>; N],
    used: usize,
    pending: bool,
    invalid: bool,
}

impl<const N: usize> Receipt<N> {
    pub(crate) fn new() -> Self {
        Self {
            events: [None; N],
            used: 0,
            pending: false,
            invalid: false,
        }
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

    pub(crate) fn internally_consistent(&mut self) -> bool {
        if self.pending {
            self.invalid = true;
        }
        !self.invalid
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
        for event in [Event::Refused, Event::TermAttempt, Event::KillAttempt] {
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
}
