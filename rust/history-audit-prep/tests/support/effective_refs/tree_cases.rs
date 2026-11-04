use super::{
    MAX_EDGES, MAX_PATH, Refusal, Seed, inspect, oid, parse_frames, records, refs, seed, walk,
};
use gix_hash::ObjectId;
use gix_object::tree::EntryKind;

fn fixture() -> Vec<Seed<'static>> {
    parse_frames(include_str!("../../data/nonempty-trees.zframes"))
}

fn id(seeds: &[Seed<'_>], label: &str) -> ObjectId {
    oid(seed(seeds, label).hex_id.as_bytes())
}

const TYPED: [&str; 6] = [
    "typed-before",
    "typed-after",
    "typed-root",
    "raw-subtree",
    "file",
    "symlink",
];

#[test]
fn a29_raw_alias_paths_and_modes_are_exact_per_commit() {
    let seeds = fixture();
    let (result, counts) = inspect(&seeds, "typed-after", &TYPED);
    let report = result.expect("closed local tree");
    assert_eq!(counts.attempted, 6);
    assert_eq!(counts.verified, 6);
    assert_eq!(counts.edges, 9);
    assert_eq!(report.paths.iter().flatten().count(), 14);
    let external = oid(b"9191919191919191919191919191919191919191");
    assert!(
        !report
            .nodes
            .iter()
            .flatten()
            .any(|node| node.id == external)
    );
    let expected: &[(&[u8], EntryKind, ObjectId)] = &[
        (b"a-\xff", EntryKind::Tree, id(&seeds, "raw-subtree")),
        (b"a-\xff/line\n\t-\xfe", EntryKind::Blob, id(&seeds, "file")),
        (b"b", EntryKind::Tree, id(&seeds, "raw-subtree")),
        (b"b/line\n\t-\xfe", EntryKind::Blob, id(&seeds, "file")),
        (b"executable", EntryKind::BlobExecutable, id(&seeds, "file")),
        (b"link", EntryKind::Link, id(&seeds, "symlink")),
        (b"module", EntryKind::Commit, external),
    ];
    for commit in [id(&seeds, "typed-before"), id(&seeds, "typed-after")] {
        for &(path, mode, target) in expected {
            assert!(report.paths.iter().flatten().any(|row| {
                row.commit == commit
                    && row.mode == mode
                    && row.target == target
                    && &row.bytes[..row.len] == path
            }));
        }
    }
}

#[test]
fn a30_accepts_exact_component_and_assembled_path_limits() {
    let seeds = fixture();
    let (result, _) = inspect(
        &seeds,
        "exact-commit",
        &["exact-commit", "exact-tree", "exact-leaf", "file"],
    );
    let report = result.expect("exact path bounds");
    let mut expected = [b'd'; MAX_PATH];
    expected[64] = b'/';
    expected[65..].fill(b'f');
    assert!(
        report
            .paths
            .iter()
            .flatten()
            .any(|row| row.len == MAX_PATH && row.bytes == expected)
    );
    assert!(
        report
            .paths
            .iter()
            .flatten()
            .any(|row| row.len == 64 && row.bytes[..64] == [b'd'; 64])
    );
}

#[test]
fn a31_refuses_oversized_component_path_and_tree() {
    let seeds = fixture();
    for (root, input, expected) in [
        (
            "too-long-name-commit",
            &["too-long-name-commit", "too-long-name-tree", "file"][..],
            Refusal::PathBytes,
        ),
        (
            "too-long-path-commit",
            &[
                "too-long-path-commit",
                "too-long-path-tree",
                "too-long-path-leaf",
                "file",
            ][..],
            Refusal::PathBytes,
        ),
        (
            "too-large-tree-commit",
            &["too-large-tree-commit", "too-large-tree-tree"][..],
            Refusal::Integrity,
        ),
    ] {
        assert_eq!(inspect(&seeds, root, input).0, Err(expected));
    }
}

#[test]
fn a32_missing_local_tree_objects_withhold_all_paths() {
    let seeds = fixture();
    for omitted in ["raw-subtree", "file", "symlink"] {
        let input: Vec<_> = TYPED
            .into_iter()
            .filter(|label| *label != omitted)
            .collect();
        let (result, counts) = inspect(&seeds, "typed-after", &input);
        assert_eq!(result, Err(Refusal::Missing));
        assert!(counts.verified >= 3);
        assert_eq!(counts.attempted, counts.verified + 1);
    }
}

#[test]
fn a33_invalid_modes_names_order_and_gitlinks_refuse() {
    let seeds = fixture();
    for label in [
        "mode",
        "padded-mode",
        "traversal",
        "dot",
        "dotdot",
        "reserved",
        "empty-name",
        "duplicate",
        "unsorted",
        "null-gitlink",
    ] {
        let root = format!("{label}-commit");
        let tree = format!("{label}-tree");
        assert_eq!(
            inspect(&seeds, &root, &[&root, &tree, "file", "empty"]).0,
            Err(Refusal::TreeEntry)
        );
    }
}

#[test]
fn a34_bad_kind_truncated_entry_and_wrong_hash_withhold_report() {
    let seeds = fixture();
    assert_eq!(
        inspect(
            &seeds,
            "wrong-kind-commit",
            &["wrong-kind-commit", "wrong-kind-tree", "empty"]
        )
        .0,
        Err(Refusal::Kind),
    );
    let (result, counts) = inspect(
        &seeds,
        "truncated-commit",
        &["truncated-commit", "truncated-tree", "file"],
    );
    assert_eq!(result, Err(Refusal::Encoding));
    assert_eq!(counts.verified, 2);
    let mut mismatched = records(&seeds, &["wrong-kind-commit", "truncated-tree", "file"]);
    mismatched[1].id = id(&seeds, "wrong-kind-tree");
    assert_eq!(
        walk(
            refs(&seeds, "wrong-kind-commit").as_bytes(),
            &[],
            &mismatched,
            &mut Default::default()
        ),
        Err(Refusal::Integrity)
    );
}

#[test]
fn a35_alias_path_occurrences_are_bounded_separately() {
    let seeds = fixture();
    let (result, counts) = inspect(
        &seeds,
        "path-rows-commit",
        &[
            "path-rows-commit",
            "path-rows-tree",
            "crowded-subtree",
            "file",
        ],
    );
    assert_eq!(result, Err(Refusal::PathRows));
    assert_eq!(counts.verified, 4);
    assert_eq!(counts.edges, 12);
}

#[test]
fn a36_tree_edges_count_before_blob_deduplication() {
    let seeds = fixture();
    let (result, counts) = inspect(
        &seeds,
        "tree-edges-commit",
        &["tree-edges-commit", "tree-edges-tree", "file"],
    );
    assert_eq!(result, Err(Refusal::EdgeCap));
    assert_eq!(counts.edges, MAX_EDGES);
    assert_eq!(counts.verified, 2);
}
