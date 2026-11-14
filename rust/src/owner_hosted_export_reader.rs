//! Structural classification only. This does not authenticate a run.

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Classification {
    Inconclusive,
    ClosedRefusal,
}

pub(crate) fn classify(bytes: &[u8]) -> Classification {
    use self::Classification::{ClosedRefusal, Inconclusive};
    if bytes.len() < 7 || &bytes[..4] != b"ABR1" || bytes[4] != 1 {
        return Inconclusive;
    }
    let count = u16::from_le_bytes([bytes[5], bytes[6]]) as usize;
    if count > 256 || bytes.len() != 7 + count {
        return Inconclusive;
    }
    let mut spawned = false;
    let mut dropped = false;
    let mut reaped = false;
    let mut refused = false;
    let mut pending = false;
    let mut finalized = false;
    for event in &bytes[7..] {
        if finalized {
            return Inconclusive;
        }
        match *event {
            1 if !spawned => spawned = true,
            2 if spawned && !dropped && !pending => dropped = true,
            3 if spawned && dropped && reaped && refused && !pending => finalized = true,
            4 | 5 if spawned && !pending && !reaped => pending = true,
            6 if pending => {
                pending = false;
                refused = true;
            }
            7 if spawned && !reaped && !pending => reaped = true,
            9..=14 if !pending => {}
            _ => return Inconclusive,
        }
    }
    if finalized {
        ClosedRefusal
    } else {
        Inconclusive
    }
}

#[cfg(test)]
mod tests {
    use super::{classify, Classification};

    fn encoded(events: &[u8]) -> Vec<u8> {
        let mut bytes = b"ABR1\x01".to_vec();
        bytes.extend_from_slice(&(events.len() as u16).to_le_bytes());
        bytes.extend_from_slice(events);
        bytes
    }

    #[test]
    fn accepts_closed_refusal_sequence() {
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 7, 3])),
            Classification::ClosedRefusal
        );
    }

    #[test]
    fn accepts_reap_before_drop() {
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 7, 2, 3])),
            Classification::ClosedRefusal
        );
    }

    #[test]
    fn rejects_truncation_and_trailing_bytes() {
        let mut bytes = encoded(&[1, 4, 6, 2, 7, 3]);
        bytes.pop();
        assert_eq!(classify(&bytes), Classification::Inconclusive);
        bytes.extend_from_slice(&[3, 9]);
        assert_eq!(classify(&bytes), Classification::Inconclusive);
    }

    #[test]
    fn rejects_unknown_or_inconclusive_class() {
        let mut bytes = encoded(&[1, 4, 6, 2, 7, 3]);
        bytes[4] = 0;
        assert_eq!(classify(&bytes), Classification::Inconclusive);
        bytes[4] = 2;
        assert_eq!(classify(&bytes), Classification::Inconclusive);
    }

    #[test]
    fn rejects_unknown_event_and_pending_attempt() {
        assert_eq!(
            classify(&encoded(&[1, 4, 8, 2, 7, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 8, 7, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 2, 7, 3])),
            Classification::Inconclusive
        );
    }

    #[test]
    fn rejects_missing_or_duplicate_markers() {
        assert_eq!(classify(&encoded(&[])), Classification::Inconclusive);
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 7, 7, 3])),
            Classification::Inconclusive
        );
    }

    #[test]
    fn rejects_out_of_order_events() {
        assert_eq!(
            classify(&encoded(&[7, 1, 4, 6, 2, 7, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 3, 2, 7])),
            Classification::Inconclusive
        );
    }

    #[test]
    fn rejects_refusal_without_attempt() {
        assert_eq!(
            classify(&encoded(&[1, 6, 2, 7, 3])),
            Classification::Inconclusive
        );
    }

    #[test]
    fn accepts_capacity_and_rejects_one_more() {
        let mut events = vec![1];
        events.extend_from_slice(&[9; 250]);
        events.extend_from_slice(&[4, 6, 2, 7, 3]);
        assert_eq!(classify(&encoded(&events)), Classification::ClosedRefusal);
        events.insert(1, 9);
        assert_eq!(classify(&encoded(&events)), Classification::Inconclusive);
    }

    #[test]
    fn rejects_each_truncated_prefix_and_bad_magic() {
        let bytes = encoded(&[1, 4, 6, 2, 7, 3]);
        for end in 0..bytes.len() {
            assert_eq!(classify(&bytes[..end]), Classification::Inconclusive);
        }
        let mut bad = bytes;
        bad[0] = b'X';
        assert_eq!(classify(&bad), Classification::Inconclusive);
        bad[0] = b'A';
        bad[3] = b'2';
        assert_eq!(classify(&bad), Classification::Inconclusive);
    }

    #[test]
    fn rejects_count_mismatch_in_both_directions() {
        let mut bytes = encoded(&[1, 4, 6, 2, 7, 3]);
        bytes[5] -= 1;
        assert_eq!(classify(&bytes), Classification::Inconclusive);
        bytes[5] += 2;
        assert_eq!(classify(&bytes), Classification::Inconclusive);
    }

    #[test]
    fn rejects_duplicate_spawn_and_drop() {
        assert_eq!(
            classify(&encoded(&[1, 1, 4, 6, 2, 7, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 2, 7, 3])),
            Classification::Inconclusive
        );
    }

    #[test]
    fn rejects_attempt_after_reap_and_post_final_event() {
        assert_eq!(
            classify(&encoded(&[1, 7, 4, 6, 2, 3])),
            Classification::Inconclusive
        );
        assert_eq!(
            classify(&encoded(&[1, 4, 6, 2, 7, 3, 9])),
            Classification::Inconclusive
        );
    }
}
