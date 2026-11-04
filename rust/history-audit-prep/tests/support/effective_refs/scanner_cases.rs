use super::{
    FRAME_LIMIT, Frame, Frames, PREFIX, ProjectionRefusal, RECORD_LIMIT, SUFFIX, Surface, TAIL,
    TOTAL_LIMIT, project,
};
use crate::effective_refs::{
    LooseRef, UNAVAILABLE,
    closed_graph::{
        Refusal, Seed, added_lines::EvidenceRefusal, parse_frames, records, refs, seed,
    },
    loose_value, oid, packed_rows,
};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

const MARKER: &[u8] = b"SYNTHETICMARKER564";

fn included(bytes: &[u8], needle: &[u8]) -> usize {
    bytes
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count()
}

fn fixture() -> Vec<Seed<'static>> {
    parse_frames(include_str!("../../data/scanner-binding.zframes"))
}

fn positive() -> Result<Vec<Frame>, ProjectionRefusal> {
    let seeds = fixture();
    let tip = seed(&seeds, "tip").hex_id.as_bytes();
    let tag = seed(&seeds, "annotated").hex_id.as_bytes();
    let packed = packed_rows(&[
        ("refs/custom/SYNTHETICMARKER564-custom", tip),
        ("refs/heads/SYNTHETICMARKER564-branch", UNAVAILABLE),
        ("refs/tags/SYNTHETICMARKER564-tag", tag),
    ]);
    let loose = [LooseRef {
        name: b"refs/heads/SYNTHETICMARKER564-branch",
        value: &loose_value(tip),
    }];
    project(
        packed.as_bytes(),
        &loose,
        &records(
            &seeds,
            &[
                "tip",
                "annotated",
                "old",
                "dirty-tree",
                "dirty-blob",
                "empty",
            ],
        ),
    )
}

fn clean() -> Result<Vec<Frame>, ProjectionRefusal> {
    let seeds = fixture();
    project(
        refs(&seeds, "clean").as_bytes(),
        &[],
        &records(&seeds, &["clean", "clean-tree", "clean-blob"]),
    )
}

#[test]
fn a45_nine_exact_marker_surfaces_from_a_closed_graph() {
    let rows = positive().unwrap();
    assert_eq!(rows.len(), 12);
    for (surface, payload) in [
        (
            Surface::Author,
            b"SYNTHETICMARKER564-author@example.com".as_slice(),
        ),
        (
            Surface::Committer,
            b"SYNTHETICMARKER564-committer@example.com",
        ),
        (Surface::CommitMessage, b"SYNTHETICMARKER564-commit\n"),
        (Surface::TagMessage, b"SYNTHETICMARKER564-tag-message\n"),
        (Surface::Branch, b"refs/heads/SYNTHETICMARKER564-branch"),
        (Surface::TagRef, b"refs/tags/SYNTHETICMARKER564-tag"),
        (Surface::OtherRef, b"refs/custom/SYNTHETICMARKER564-custom"),
        (Surface::Path, b"removed-SYNTHETICMARKER564-path"),
        (
            Surface::Added,
            b"SYNTHETICMARKER564-line # gitleaks:allow\n",
        ),
    ] {
        let candidates: Vec<_> = rows
            .iter()
            .filter(|row| row.surface == surface && included(&row.bytes, MARKER) != 0)
            .collect();
        assert_eq!(candidates.len(), 1);
        assert_eq!(included(&candidates[0].bytes, MARKER), 1);
        assert_eq!(
            &candidates[0].bytes[PREFIX.len()..candidates[0].bytes.len() - SUFFIX.len()],
            payload
        );
    }
}

#[test]
fn a46_parent_and_historical_scope_stay_bound() {
    let seeds = fixture();
    let old = oid(seed(&seeds, "old").hex_id.as_bytes());
    let positive = positive().unwrap();
    assert!(
        positive
            .iter()
            .any(|row| row.surface == Surface::Path && row.commit == Some(old))
    );
    assert!(positive.iter().any(|row| row.surface == Surface::Added
        && row.commit == Some(old)
        && row.parent.is_none()));
    let merge = parse_frames(include_str!("../../data/added-lines.zframes"));
    let rows = project(
        refs(&merge, "merge").as_bytes(),
        &[],
        &records(
            &merge,
            &[
                "merge", "left", "right", "old-tree", "new-tree", "old", "new",
            ],
        ),
    )
    .unwrap();
    let merge_id = oid(seed(&merge, "merge").hex_id.as_bytes());
    let right = oid(seed(&merge, "right").hex_id.as_bytes());
    let added: Vec<_> = rows
        .iter()
        .filter(|row| row.surface == Surface::Added && row.commit == Some(merge_id))
        .collect();
    assert_eq!(added.len(), 2);
    assert!(added.iter().all(|row| row.parent == Some(right)));
}

#[test]
fn a47_clean_frames_have_one_tail_each() {
    let rows = clean().unwrap();
    assert_eq!(rows.len(), 6);
    assert!(
        rows.iter()
            .all(|row| included(&row.bytes, MARKER) == 0 && included(&row.bytes, TAIL) == 1)
    );
}

#[test]
fn a48_bad_source_or_changed_binary_has_no_frames() {
    let seeds = fixture();
    assert_eq!(
        project(
            refs(&seeds, "clean").as_bytes(),
            &[],
            &records(&seeds, &["clean", "clean-tree"])
        ),
        Err(ProjectionRefusal::Graph(Refusal::Missing))
    );
    let binary = parse_frames(include_str!("../../data/added-lines.zframes"));
    assert_eq!(
        project(
            refs(&binary, "binary-commit").as_bytes(),
            &[],
            &records(
                &binary,
                &["binary-commit", "binary-tree", "normal", "binary"]
            )
        ),
        Err(ProjectionRefusal::Lines(EvidenceRefusal::Binary))
    );
}

#[test]
fn a49_invalid_text_and_reserved_tail_are_refused() {
    let mut frames = Frames::default();
    for invalid in [b"raw\xff".as_slice(), b"nul\0value", TAIL] {
        assert_eq!(
            frames.push(Surface::CommitMessage, invalid, None, None),
            Err(ProjectionRefusal::Text)
        );
    }
    assert!(frames.items.is_empty());
    let raw = parse_frames(include_str!("../../data/added-lines.zframes"));
    assert_eq!(
        project(
            refs(&raw, "raw-commit").as_bytes(),
            &[],
            &records(&raw, &["raw-commit", "raw-tree", "raw"])
        ),
        Err(ProjectionRefusal::Text)
    );
}

#[test]
fn a50_exact_frame_byte_limit() {
    let mut frames = Frames::default();
    let payload = [b'x'; FRAME_LIMIT - PREFIX.len() - SUFFIX.len() + 1];
    frames
        .push(
            Surface::CommitMessage,
            &payload[..payload.len() - 1],
            None,
            None,
        )
        .unwrap();
    assert_eq!(frames.items[0].bytes.len(), FRAME_LIMIT);
    assert_eq!(
        frames.push(Surface::CommitMessage, &payload, None, None),
        Err(ProjectionRefusal::FrameLimit)
    );
    assert_eq!(frames.items.len(), 1);
}

#[test]
fn a51_exact_frame_count_and_total_limit() {
    let mut frames = Frames::default();
    let payload = [b'x'; FRAME_LIMIT - PREFIX.len() - SUFFIX.len()];
    for _ in 0..RECORD_LIMIT {
        frames
            .push(Surface::CommitMessage, &payload, None, None)
            .unwrap();
    }
    assert_eq!(
        frames
            .items
            .iter()
            .map(|frame| frame.bytes.len())
            .sum::<usize>(),
        TOTAL_LIMIT
    );
    assert_eq!(
        frames.push(Surface::CommitMessage, &payload, None, None),
        Err(ProjectionRefusal::RecordLimit)
    );
}

#[test]
fn a52_sealed_synthetic_scanner_export() {
    let mut bytes = Vec::new();
    for (variant, frames, expected) in
        [(b'P', positive().unwrap(), 12), (b'C', clean().unwrap(), 6)]
    {
        assert_eq!(frames.len(), expected);
        for frame in frames {
            bytes.extend([variant, frame.surface as u8]);
            bytes.extend(u16::try_from(frame.bytes.len()).unwrap().to_be_bytes());
            bytes.extend(frame.bytes);
        }
    }
    if let Some(path) = std::env::var_os("HISTORY_SCANNER_BINDING_EXPORT") {
        let path = PathBuf::from(path);
        assert!(path.is_absolute());
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("scanner-binding.frames")
        );
        assert_eq!(
            path.parent().unwrap().canonicalize().unwrap(),
            std::env::temp_dir().canonicalize().unwrap()
        );
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .unwrap();
        file.write_all(&bytes).unwrap();
    }
}
