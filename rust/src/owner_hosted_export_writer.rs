//! Bounded structural export. It does not authenticate or retain a run.

#[path = "owner_hosted_export_reader.rs"]
mod reader;
#[cfg(all(test, not(owner_hosted_experiment)))]
#[path = "owner_hosted_receipt.rs"]
mod receipt;
#[cfg(owner_hosted_experiment)]
use super::owner_hosted_receipt as receipt;

use self::receipt::{Event, Evidence};

fn code(event: Event) -> u8 {
    match event {
        Event::Spawned => 1,
        Event::Drop => 2,
        Event::Finalized => 3,
        Event::TermAttempt => 4,
        Event::KillAttempt => 5,
        Event::Refused => 6,
        Event::Observation(Evidence::Reaped) => 7,
        Event::Observation(Evidence::OwnershipUnknown) => 8,
        Event::Observation(Evidence::SetupFailure) => 9,
        Event::Observation(Evidence::WorkFailure) => 10,
        Event::Observation(Evidence::Context) => 11,
        Event::Observation(Evidence::Terminal) => 12,
        Event::Observation(Evidence::Stop) => 13,
        Event::Observation(Evidence::Intent) => 14,
    }
}

pub(crate) fn encode(events: &[Option<Event>], closed: bool, output: &mut [u8]) -> Option<usize> {
    const HEADER: usize = 7;
    const MAX_EVENTS: usize = 256;
    if events.len() > MAX_EVENTS || output.len() < HEADER + events.len() {
        return None;
    }
    let mut frame = [0u8; HEADER + MAX_EVENTS];
    frame[..4].copy_from_slice(b"ABR1");
    frame[4] = u8::from(closed);
    frame[5..7].copy_from_slice(&(events.len() as u16).to_le_bytes());
    for (index, event) in events.iter().enumerate() {
        frame[HEADER + index] = code((*event)?);
    }
    let length = HEADER + events.len();
    if closed && reader::classify(&frame[..length]) != reader::Classification::ClosedRefusal {
        return None;
    }
    output[..length].copy_from_slice(&frame[..length]);
    Some(length)
}

pub(crate) fn encode_receipt<const N: usize>(
    receipt: &mut receipt::Receipt<N>,
    output: &mut [u8],
) -> Option<usize> {
    let closed = receipt.closed_refusal_diagnostic();
    encode(receipt.events(), closed, output)
}

#[cfg(test)]
mod tests {
    use super::{encode, encode_receipt, reader, receipt::Receipt, Event, Evidence};

    fn closed() -> [Option<Event>; 6] {
        [
            Some(Event::Spawned),
            Some(Event::TermAttempt),
            Some(Event::Refused),
            Some(Event::Drop),
            Some(Event::Observation(Evidence::Reaped)),
            Some(Event::Finalized),
        ]
    }

    #[test]
    fn exact_fit_round_trips() {
        let mut out = [0; 13];
        let n = encode(&closed(), true, &mut out).unwrap();
        assert_eq!(n, out.len());
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::ClosedRefusal
        );
    }

    #[test]
    fn short_buffer_is_untouched() {
        let mut out = [0xa5; 12];
        assert_eq!(encode(&closed(), true, &mut out), None);
        assert_eq!(out, [0xa5; 12]);
    }

    #[test]
    fn empty_is_inconclusive() {
        let mut out = [0; 7];
        let n = encode(&[], false, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
    }

    #[test]
    fn missing_event_never_writes() {
        let mut out = [0xa5; 16];
        assert_eq!(encode(&[None], false, &mut out), None);
        assert_eq!(out, [0xa5; 16]);
    }

    #[test]
    fn unknown_is_inconclusive() {
        let mut out = [0; 16];
        let n = encode(
            &[Some(Event::Observation(Evidence::OwnershipUnknown))],
            false,
            &mut out,
        )
        .unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
    }

    #[test]
    fn invalid_closed_sequence_never_writes() {
        let mut out = [0xa5; 16];
        assert_eq!(encode(&[Some(Event::Finalized)], true, &mut out), None);
        assert_eq!(out, [0xa5; 16]);
    }

    #[test]
    fn valid_events_can_be_explicitly_inconclusive() {
        let mut out = [0; 13];
        let n = encode(&closed(), false, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
    }

    #[test]
    fn capacity_is_bounded_and_preserves_tail_canary() {
        let mut events = [Some(Event::Observation(Evidence::Context)); 256];
        events[0] = Some(Event::Spawned);
        events[251..].copy_from_slice(&closed()[1..]);
        let mut out = [0xa5; 264];
        let n = encode(&events, true, &mut out).unwrap();
        assert_eq!(n, 263);
        assert_eq!(out[263], 0xa5);
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::ClosedRefusal
        );
        assert_eq!(encode(&[Some(Event::Drop); 257], false, &mut out), None);
    }

    #[test]
    fn every_closed_category_has_a_fixed_code_without_canary() {
        let events = [
            Event::Spawned,
            Event::Drop,
            Event::Finalized,
            Event::TermAttempt,
            Event::KillAttempt,
            Event::Refused,
            Event::Observation(Evidence::Reaped),
            Event::Observation(Evidence::OwnershipUnknown),
            Event::Observation(Evidence::SetupFailure),
            Event::Observation(Evidence::WorkFailure),
            Event::Observation(Evidence::Context),
            Event::Observation(Evidence::Terminal),
            Event::Observation(Evidence::Stop),
            Event::Observation(Evidence::Intent),
        ]
        .map(Some);
        let mut output = [0xa5; 32];
        let n = encode(&events, false, &mut output).unwrap();
        assert_eq!(
            &output[7..n],
            &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
        );
        assert!(!output[..n].contains(&0xa5));
        assert_eq!(
            reader::classify(&output[..n]),
            reader::Classification::Inconclusive
        );
    }

    fn finalized_receipt() -> Receipt<16> {
        let mut r = Receipt::<16>::new();
        assert!(r.claim());
        assert!(r.record(Event::Spawned));
        assert!(r.begin(Event::TermAttempt));
        assert!(r.refused());
        assert!(r.record(Event::Drop));
        assert!(r.record(Event::Observation(Evidence::Reaped)));
        assert!(r.finalize_after_return());
        r
    }

    #[test]
    fn actual_closed_receipt_round_trips() {
        let mut receipt = finalized_receipt();
        let mut out = [0; 32];
        let n = encode_receipt(&mut receipt, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::ClosedRefusal
        );
    }

    #[test]
    fn actual_invalid_receipt_exports_only_inconclusive() {
        let mut receipt = finalized_receipt();
        receipt.invalidate();
        let mut out = [0; 32];
        let n = encode_receipt(&mut receipt, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
    }

    #[test]
    fn actual_pending_receipt_exports_only_inconclusive() {
        let mut receipt = Receipt::<16>::new();
        assert!(receipt.claim());
        assert!(receipt.record(Event::Spawned));
        assert!(receipt.begin(Event::TermAttempt));
        let mut out = [0; 32];
        let n = encode_receipt(&mut receipt, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
        assert!(!receipt.refused());
    }

    #[test]
    fn short_export_still_invalidates_pending_receipt() {
        let mut receipt = Receipt::<16>::new();
        assert!(receipt.claim());
        assert!(receipt.record(Event::Spawned));
        assert!(receipt.begin(Event::TermAttempt));
        let mut out = [0xa5; 2];
        assert_eq!(encode_receipt(&mut receipt, &mut out), None);
        assert_eq!(out, [0xa5; 2]);
        assert!(!receipt.refused());
    }

    #[test]
    fn actual_overflow_receipt_exports_only_inconclusive() {
        let mut receipt = Receipt::<1>::new();
        assert!(receipt.claim());
        assert!(receipt.record(Event::Spawned));
        assert!(!receipt.record(Event::Drop));
        let mut out = [0; 16];
        let n = encode_receipt(&mut receipt, &mut out).unwrap();
        assert_eq!(
            reader::classify(&out[..n]),
            reader::Classification::Inconclusive
        );
    }
}
