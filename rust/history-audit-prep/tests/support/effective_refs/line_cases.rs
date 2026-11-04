use super::{AddedLine, EvidenceRefusal, Refusal, evidence};
use crate::effective_refs::closed_graph::{Seed, oid, parse_frames, records, refs, seed};
use gix_hash::ObjectId;

fn fixture() -> Vec<Seed<'static>> {
    parse_frames(include_str!("../../data/added-lines.zframes"))
}

fn id(seeds: &[Seed<'_>], label: &str) -> ObjectId {
    oid(seed(seeds, label).hex_id.as_bytes())
}

fn inspect(
    seeds: &[Seed<'_>],
    root: &str,
    labels: &[&str],
) -> Result<Vec<AddedLine>, EvidenceRefusal> {
    evidence(refs(seeds, root).as_bytes(), &records(seeds, labels))
        .map(|rows| rows.into_iter().flatten().collect())
}

fn for_commit(rows: &[AddedLine], commit: ObjectId) -> Vec<&AddedLine> {
    rows.iter()
        .filter(|row| row.file.commit == commit)
        .collect()
}

fn line(row: &AddedLine) -> &[u8] {
    &row.bytes[..row.len]
}

fn path(row: &AddedLine) -> &[u8] {
    &row.file.bytes[..row.file.len]
}

#[test]
fn a37_root_compares_to_empty_preserving_raw_bytes() {
    let seeds = fixture();
    let rows = inspect(&seeds, "raw-commit", &["raw-commit", "raw-tree", "raw"]).unwrap();
    assert_eq!(rows.len(), 2);
    for (idx, bytes) in [b"one\xff\r\n".as_slice(), b"last\t\xfe"]
        .into_iter()
        .enumerate()
    {
        assert_eq!(rows[idx].parent, None);
        assert_eq!(rows[idx].number, idx + 1);
        assert_eq!(path(&rows[idx]), b"raw-\xff\n");
        assert_eq!(line(&rows[idx]), bytes);
    }
}

#[test]
fn a38_insertion_and_additional_duplicate_are_exact() {
    let seeds = fixture();
    let rows = inspect(
        &seeds,
        "new-commit",
        &[
            "new-commit",
            "new-tree",
            "new",
            "old-commit",
            "old-tree",
            "old",
        ],
    )
    .unwrap();
    let changes = for_commit(&rows, id(&seeds, "new-commit"));
    assert_eq!(changes.len(), 2);
    assert!(
        changes
            .iter()
            .all(|row| row.parent == Some(id(&seeds, "old-commit")) && path(row) == b"file")
    );
    assert_eq!(line(changes[0]), b"repeat\n");
    assert!([2, 3].contains(&changes[0].number));
    assert_eq!(
        (changes[1].number, line(changes[1])),
        (4, b"inserted\n".as_slice())
    );
}

#[test]
fn a39_deletion_unchanged_and_mode_only_add_nothing() {
    let seeds = fixture();
    let rows = inspect(
        &seeds,
        "same-new-commit",
        &[
            "same-old-commit",
            "same-old-tree",
            "same-new-commit",
            "same-new-tree",
            "normal",
        ],
    )
    .unwrap();
    assert!(for_commit(&rows, id(&seeds, "same-new-commit")).is_empty());
    assert_eq!(for_commit(&rows, id(&seeds, "same-old-commit")).len(), 3);
}

#[test]
fn a40_merge_checks_each_parent_separately() {
    let seeds = fixture();
    for root in ["merge", "merge-reversed"] {
        let rows = inspect(
            &seeds,
            root,
            &[root, "left", "right", "old-tree", "new-tree", "old", "new"],
        )
        .unwrap();
        let changes = for_commit(&rows, id(&seeds, root));
        assert_eq!(changes.len(), 2, "{root}");
        assert!(
            changes
                .iter()
                .all(|row| row.parent == Some(id(&seeds, "right")))
        );
        assert_eq!(line(changes[0]), b"repeat\n");
        assert_eq!(line(changes[1]), b"inserted\n");
    }
}

#[test]
fn a41_changed_nul_body_withholds_earlier_text_evidence() {
    let seeds = fixture();
    for (root, labels) in [
        (
            "binary-commit",
            &["binary-commit", "binary-tree", "normal", "binary"][..],
        ),
        (
            "binary-replaced",
            &[
                "binary-replaced",
                "binary-replaced-tree",
                "normal",
                "binary-alone-commit",
                "binary-alone-tree",
                "binary",
            ][..],
        ),
    ] {
        assert_eq!(inspect(&seeds, root, labels), Err(EvidenceRefusal::Binary));
    }
}

#[test]
fn a42_comparison_and_evidence_caps_fail_closed() {
    let seeds = fixture();
    for (label, expected) in [
        ("big-blob", EvidenceRefusal::BlobBytes),
        ("long-line", EvidenceRefusal::LineBytes),
        ("many-lines", EvidenceRefusal::Lines),
    ] {
        let root = format!("{label}-commit");
        let tree = format!("{label}-tree");
        assert_eq!(
            inspect(&seeds, &root, &[&root, &tree, label]),
            Err(expected)
        );
    }
    assert_eq!(
        inspect(
            &seeds,
            "compare-commit",
            &[
                "compare-commit",
                "compare-tree",
                "parent-0",
                "parent-1",
                "parent-2",
                "parent-3",
                "empty",
                "normal"
            ]
        ),
        Err(EvidenceRefusal::Comparisons)
    );
    assert_eq!(
        inspect(
            &seeds,
            "report-commit",
            &["report-commit", "report-tree", "report-blob"]
        ),
        Err(EvidenceRefusal::EvidenceRows)
    );
}

#[test]
fn a43_raw_path_and_type_replacements_do_not_pair() {
    let seeds = fixture();
    let rows = inspect(
        &seeds,
        "paths-after",
        &[
            "paths-after",
            "paths-after-tree",
            "paths-before",
            "paths-before-tree",
            "normal",
            "target",
        ],
    )
    .unwrap();
    let changes = for_commit(&rows, id(&seeds, "paths-after"));
    assert_eq!(changes.len(), 2);
    assert_eq!(
        (path(changes[0]), line(changes[0])),
        (b"new-name".as_slice(), b"unchanged\n".as_slice())
    );
    assert_eq!(
        (path(changes[1]), line(changes[1])),
        (b"switch".as_slice(), b"../../never-follow\n".as_slice())
    );
}

#[test]
fn a44_bad_source_graph_never_yields_line_evidence() {
    let seeds = fixture();
    assert_eq!(
        inspect(&seeds, "raw-commit", &["raw-commit", "raw-tree"]),
        Err(EvidenceRefusal::Graph(Refusal::Missing))
    );
    let mut bad = records(&seeds, &["raw-commit", "raw-tree", "normal"]);
    bad[2].id = id(&seeds, "raw");
    assert_eq!(
        evidence(refs(&seeds, "raw-commit").as_bytes(), &bad),
        Err(EvidenceRefusal::Graph(Refusal::Integrity))
    );
}
