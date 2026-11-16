//! Bounded synthetic capture only. It neither reads a stream nor retains evidence.

#[path = "owner_hosted_export_reader.rs"]
mod reader;

const MAX_FRAME: usize = 7 + 256;

pub(crate) struct Capture {
    bytes: [u8; MAX_FRAME],
    len: usize,
    failed: bool,
}

impl Capture {
    pub(crate) fn new() -> Self {
        Self {
            bytes: [0; MAX_FRAME],
            len: 0,
            failed: false,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) {
        let Some(end) = self.len.checked_add(chunk.len()) else {
            self.failed = true;
            return;
        };
        if self.failed || end > MAX_FRAME {
            self.failed = true;
            return;
        }
        self.bytes[self.len..end].copy_from_slice(chunk);
        self.len = end;
    }

    pub(crate) fn fail(&mut self) {
        self.failed = true;
    }

    // EOF alone does not prove a clean producer exit or an owned endpoint.
    // This caller-supplied flag is synthetic until those facts are established.
    pub(crate) fn finish(self, clean_eof: bool) -> reader::Classification {
        if self.failed || !clean_eof {
            return reader::Classification::Inconclusive;
        }
        reader::classify(&self.bytes[..self.len])
    }
}

#[cfg(test)]
mod tests {
    use super::{reader::Classification, Capture, MAX_FRAME};

    const FRAME: &[u8] = b"ABR1\x01\x06\x00\x01\x04\x06\x02\x07\x03";

    fn capture(chunks: &[&[u8]], clean_eof: bool) -> Classification {
        let mut capture = Capture::new();
        for chunk in chunks {
            capture.push(chunk);
        }
        capture.finish(clean_eof)
    }

    #[test]
    fn accepts_one_frame_after_clean_eof() {
        assert_eq!(capture(&[FRAME], true), Classification::ClosedRefusal);
    }

    #[test]
    fn accepts_every_two_chunk_split() {
        for split in 0..=FRAME.len() {
            assert_eq!(
                capture(&[&FRAME[..split], &FRAME[split..]], true),
                Classification::ClosedRefusal
            );
        }
    }

    #[test]
    fn rejects_every_truncated_prefix() {
        for end in 0..FRAME.len() {
            assert_eq!(
                capture(&[&FRAME[..end]], true),
                Classification::Inconclusive
            );
        }
    }

    #[test]
    fn rejects_full_frame_without_clean_eof() {
        assert_eq!(capture(&[FRAME], false), Classification::Inconclusive);
    }

    #[test]
    fn rejects_delayed_extra_byte_and_duplicate_frame() {
        assert_eq!(capture(&[FRAME, b"x"], true), Classification::Inconclusive);
        assert_eq!(capture(&[FRAME, FRAME], true), Classification::Inconclusive);
    }

    #[test]
    fn rejects_oversized_input_and_keeps_failure_sticky() {
        let mut capture = Capture::new();
        capture.push(&[0; MAX_FRAME + 1]);
        capture.push(FRAME);
        assert_eq!(capture.finish(true), Classification::Inconclusive);
    }

    #[test]
    fn accepts_maximum_frame_and_rejects_one_more_byte() {
        let mut frame = Vec::from(&b"ABR1\x01\x00\x01\x01"[..]);
        frame.extend_from_slice(&[9; 250]);
        frame.extend_from_slice(&[4, 6, 2, 7, 3]);
        assert_eq!(frame.len(), MAX_FRAME);
        assert_eq!(capture(&[&frame], true), Classification::ClosedRefusal);
        assert_eq!(capture(&[&frame, b"x"], true), Classification::Inconclusive);
    }

    #[test]
    fn rejects_failure_before_a_complete_frame() {
        let mut capture = Capture::new();
        capture.fail();
        capture.push(FRAME);
        assert_eq!(capture.finish(true), Classification::Inconclusive);
    }

    #[test]
    fn rejects_read_failure_after_a_complete_frame() {
        let mut capture = Capture::new();
        capture.push(FRAME);
        capture.fail();
        assert_eq!(capture.finish(true), Classification::Inconclusive);
    }

    #[test]
    fn rejects_empty_and_bad_classification() {
        assert_eq!(capture(&[], true), Classification::Inconclusive);
        let mut bad = FRAME.to_vec();
        bad[4] = 0;
        assert_eq!(capture(&[&bad], true), Classification::Inconclusive);
    }
}
