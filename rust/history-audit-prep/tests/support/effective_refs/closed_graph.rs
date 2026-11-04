use super::{LooseRef, UNAVAILABLE, loose_value, oid, packed_rows, resolve};
use crate::{Audit, HASH, OUTPUT_BYTES, loose_record};
use gix_hash::ObjectId;
use gix_object::{
    CommitRefIter, Kind, TagRef, TreeRefIter,
    commit::ref_iter::Token,
    tree::{EntryKind, EntryRef},
};
use std::cmp::Ordering;

const MAX_OBJECTS: usize = 8;
const MAX_RECORDS: usize = MAX_OBJECTS + 1;
const MAX_EDGES: usize = 16;
const MAX_COMPONENT: usize = 64;
const MAX_PATH: usize = 96;
const MAX_PATH_ROWS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PathRow {
    commit: ObjectId,
    mode: gix_object::tree::EntryKind,
    target: ObjectId,
    bytes: [u8; MAX_PATH],
    len: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Node {
    id: ObjectId,
    kind: Kind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Edge {
    from: ObjectId,
    to: Node,
}

#[derive(Debug, PartialEq, Eq)]
struct Report {
    nodes: [Option<Node>; MAX_OBJECTS],
    edges: [Option<Edge>; MAX_EDGES],
    paths: [Option<PathRow>; MAX_PATH_ROWS],
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Counts {
    attempted: usize,
    verified: usize,
    edges: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refusal {
    Refs,
    InventoryCap,
    Missing,
    ObjectCap,
    EdgeCap,
    Kind,
    Integrity,
    Encoding,
    PathBytes,
    PathRows,
    TreeEntry,
}

#[derive(Clone, Copy)]
struct Record<'a> {
    id: ObjectId,
    compressed: &'a [u8],
}

#[derive(Clone, Copy)]
struct Pending {
    id: ObjectId,
    expected: Option<Kind>,
}

#[derive(Clone, Copy)]
struct TreeEntry {
    mode: EntryKind,
    bytes: [u8; MAX_COMPONENT],
    len: usize,
}

impl TreeEntry {
    fn name(&self) -> &[u8] {
        &self.bytes[..self.len]
    }
}

struct Walker {
    pending: [Option<Pending>; MAX_OBJECTS],
    tree_entries: [Option<TreeEntry>; MAX_EDGES],
    report: Report,
}

impl Walker {
    fn enqueue(&mut self, id: ObjectId, expected: Option<Kind>) -> Result<(), Refusal> {
        for (pending, verified) in self.pending.iter_mut().zip(&self.report.nodes) {
            match pending {
                Some(existing) if existing.id == id => {
                    if let Some(kind) = expected {
                        let prior_kind = verified.map(|node| node.kind).or(existing.expected);
                        // An unresolved ref root still requires a commit or tag.
                        if prior_kind.map_or(!matches!(kind, Kind::Commit | Kind::Tag), |prior| {
                            prior != kind
                        }) {
                            return Err(Refusal::Kind);
                        }
                        existing.expected = expected;
                    }
                    return Ok(());
                }
                Some(_) => {}
                None => {
                    *pending = Some(Pending { id, expected });
                    return Ok(());
                }
            }
        }
        Err(Refusal::ObjectCap)
    }

    fn edge(
        &mut self,
        from: ObjectId,
        to: Node,
        entry: Option<TreeEntry>,
        counts: &mut Counts,
    ) -> Result<(), Refusal> {
        if counts.edges == MAX_EDGES {
            return Err(Refusal::EdgeCap);
        }
        if !entry.is_some_and(|entry| entry.mode == EntryKind::Commit) {
            self.enqueue(to.id, Some(to.kind))?;
        }
        self.report.edges[counts.edges] = Some(Edge { from, to });
        self.tree_entries[counts.edges] = entry;
        counts.edges += 1;
        Ok(())
    }

    fn commit_edges(
        &mut self,
        from: ObjectId,
        body: &[u8],
        counts: &mut Counts,
    ) -> Result<(), Refusal> {
        for token in CommitRefIter::from_bytes(body, HASH) {
            let (id, kind) = match token.map_err(|_| Refusal::Encoding)? {
                Token::Tree { id } => (id, Kind::Tree),
                Token::Parent { id } => (id, Kind::Commit),
                Token::Author { .. } | Token::Committer { .. } | Token::Encoding(_) => continue,
                Token::Message(_) => return Ok(()),
                Token::ExtraHeader(_) => return Err(Refusal::Encoding),
            };
            self.edge(from, Node { id, kind }, None, counts)?;
        }
        // The iterator can stop at EOF before yielding the required message separator.
        Err(Refusal::Encoding)
    }

    fn tree_edges(
        &mut self,
        from: ObjectId,
        body: &[u8],
        counts: &mut Counts,
    ) -> Result<(), Refusal> {
        let mut remaining = body;
        let mut previous: Option<EntryRef<'_>> = None;
        for entry in TreeRefIter::from_bytes(body, HASH) {
            let entry = entry.map_err(|_| Refusal::Encoding)?;
            let mode_end = remaining
                .iter()
                .take(7)
                .position(|byte| *byte == b' ')
                .ok_or(Refusal::TreeEntry)?;
            // The typed parser normalizes some octal spellings. Admit exact modes only.
            let (mode, kind) = match &remaining[..mode_end] {
                b"100644" => (EntryKind::Blob, Kind::Blob),
                b"100755" => (EntryKind::BlobExecutable, Kind::Blob),
                b"120000" => (EntryKind::Link, Kind::Blob),
                b"40000" => (EntryKind::Tree, Kind::Tree),
                b"160000" if !entry.oid.is_null() => (EntryKind::Commit, Kind::Commit),
                _ => return Err(Refusal::TreeEntry),
            };
            let name: &[u8] = entry.filename.as_ref();
            if name.len() > MAX_COMPONENT {
                return Err(Refusal::PathBytes);
            }
            if name.is_empty()
                || name.contains(&b'/')
                || matches!(name, b"." | b"..")
                || name.eq_ignore_ascii_case(b".git")
                || entry.mode.kind() != mode
                || previous.is_some_and(|prior| prior.cmp(&entry) != Ordering::Less)
                || self
                    .report
                    .edges
                    .iter()
                    .zip(&self.tree_entries)
                    .any(|(edge, item)| {
                        edge.is_some_and(|edge| edge.from == from)
                            && item.is_some_and(|item| item.name() == name)
                    })
            {
                return Err(Refusal::TreeEntry);
            }
            let mut bytes = [0; MAX_COMPONENT];
            bytes[..name.len()].copy_from_slice(name);
            self.edge(
                from,
                Node {
                    id: entry.oid.to_owned(),
                    kind,
                },
                Some(TreeEntry {
                    mode,
                    bytes,
                    len: name.len(),
                }),
                counts,
            )?;
            let consumed = mode_end + 1 + name.len() + 1 + HASH.len_in_bytes();
            remaining = remaining.get(consumed..).ok_or(Refusal::Encoding)?;
            previous = Some(entry);
        }
        if remaining.is_empty() {
            Ok(())
        } else {
            Err(Refusal::Encoding)
        }
    }

    fn collect_paths(&self) -> Result<[Option<PathRow>; MAX_PATH_ROWS], Refusal> {
        let mut rows = [None; MAX_PATH_ROWS];
        for (edge, entry) in self.report.edges.iter().zip(&self.tree_entries) {
            if let Some(edge) = edge.filter(|edge| edge.to.kind == Kind::Tree && entry.is_none()) {
                self.expand_paths(edge.from, edge.to.id, b"", &mut rows)?;
            }
        }
        Ok(rows)
    }

    fn expand_paths(
        &self,
        commit: ObjectId,
        tree: ObjectId,
        prefix: &[u8],
        rows: &mut [Option<PathRow>; MAX_PATH_ROWS],
    ) -> Result<(), Refusal> {
        for (edge, entry) in self.report.edges.iter().zip(&self.tree_entries) {
            let (Some(edge), Some(entry)) = (edge, entry) else {
                continue;
            };
            if edge.from != tree {
                continue;
            }
            let separator = usize::from(!prefix.is_empty());
            let offset = prefix.len() + separator;
            let len = offset + entry.len;
            if len > MAX_PATH {
                return Err(Refusal::PathBytes);
            }
            let slot = rows
                .iter_mut()
                .find(|slot| slot.is_none())
                .ok_or(Refusal::PathRows)?;
            let mut bytes = [0; MAX_PATH];
            bytes[..prefix.len()].copy_from_slice(prefix);
            if separator != 0 {
                bytes[prefix.len()] = b'/';
            }
            bytes[offset..len].copy_from_slice(entry.name());
            *slot = Some(PathRow {
                commit,
                mode: entry.mode,
                target: edge.to.id,
                bytes,
                len,
            });
            if entry.mode == EntryKind::Tree {
                self.expand_paths(commit, edge.to.id, &bytes[..len], rows)?;
            }
        }
        Ok(())
    }
}

fn walk(
    packed: &[u8],
    loose: &[LooseRef<'_>],
    records: &[Record<'_>],
    counts: &mut Counts,
) -> Result<Report, Refusal> {
    *counts = Counts::default();
    if records.len() > MAX_RECORDS {
        return Err(Refusal::InventoryCap);
    }
    let roots = resolve(packed, loose).map_err(|_| Refusal::Refs)?;
    let mut walker = Walker {
        pending: [None; MAX_OBJECTS],
        tree_entries: [None; MAX_EDGES],
        report: Report {
            nodes: [None; MAX_OBJECTS],
            edges: [None; MAX_EDGES],
            paths: [None; MAX_PATH_ROWS],
        },
    };
    for root in roots.into_iter().flatten() {
        walker.enqueue(root.target, None)?;
    }

    let mut output = [0; OUTPUT_BYTES];
    for slot in 0..MAX_OBJECTS {
        let Some(Pending { id, expected }) = walker.pending[slot] else {
            break;
        };
        counts.attempted += 1;
        let record = records
            .iter()
            .find(|record| record.id == id)
            .ok_or(Refusal::Missing)?;
        let (kind, body) = loose_record(record.compressed, &id, &mut output, &mut Audit::default())
            .map_err(|_| Refusal::Integrity)?;
        if expected.map_or(!matches!(kind, Kind::Commit | Kind::Tag), |wanted| {
            wanted != kind
        }) {
            return Err(Refusal::Kind);
        }
        walker.report.nodes[slot] = Some(Node { id, kind });
        counts.verified += 1;

        match kind {
            Kind::Commit => walker.commit_edges(id, body, counts)?,
            Kind::Tag => {
                let tag = TagRef::from_bytes(body, HASH).map_err(|_| Refusal::Encoding)?;
                if !matches!(tag.target_kind, Kind::Commit | Kind::Tag) {
                    return Err(Refusal::Kind);
                }
                walker.edge(
                    id,
                    Node {
                        id: tag.target(),
                        kind: tag.target_kind,
                    },
                    None,
                    counts,
                )?;
            }
            Kind::Tree => walker.tree_edges(id, body, counts)?,
            Kind::Blob => {}
        }
    }
    walker.report.paths = walker.collect_paths()?;
    Ok(walker.report)
}

struct Seed<'a> {
    label: &'a str,
    hex_id: &'a str,
    compressed: Vec<u8>,
}

fn seeds() -> Vec<Seed<'static>> {
    parse_frames(include_str!("../../data/closed-graph.zframes"))
}

fn parse_frames(frames: &'static str) -> Vec<Seed<'static>> {
    frames
        .lines()
        .map(|line| {
            let mut fields = line.split(' ');
            let label = fields.next().unwrap();
            let hex_id = fields.next().unwrap();
            let hex = fields.next().unwrap();
            assert!(fields.next().is_none() && hex.len() % 2 == 0);
            let compressed = (0..hex.len())
                .step_by(2)
                .map(|offset| u8::from_str_radix(&hex[offset..offset + 2], 16).unwrap())
                .collect();
            Seed {
                label,
                hex_id,
                compressed,
            }
        })
        .collect()
}

fn seed<'a>(seeds: &'a [Seed<'_>], label: &str) -> &'a Seed<'a> {
    seeds.iter().find(|item| item.label == label).unwrap()
}

fn records<'a>(seeds: &'a [Seed<'_>], labels: &[&str]) -> Vec<Record<'a>> {
    labels
        .iter()
        .map(|label| {
            let item = seed(seeds, label);
            Record {
                id: oid(item.hex_id.as_bytes()),
                compressed: &item.compressed,
            }
        })
        .collect()
}

fn refs(seeds: &[Seed<'_>], label: &str) -> String {
    packed_rows(&[("refs/fixture/start", seed(seeds, label).hex_id.as_bytes())])
}

fn inspect(seeds: &[Seed<'_>], root: &str, labels: &[&str]) -> (Result<Report, Refusal>, Counts) {
    let mut counts = Counts::default();
    let result = walk(
        refs(seeds, root).as_bytes(),
        &[],
        &records(seeds, labels),
        &mut counts,
    );
    (result, counts)
}

#[test]
fn a21_closed_merge_tag_and_tree_graph() {
    let seeds = seeds();
    let packed = packed_rows(&[
        ("refs/tags/release", seed(&seeds, "outer").hex_id.as_bytes()),
        ("refs/heads/main", UNAVAILABLE),
        (
            "refs/fixture/right",
            seed(&seeds, "right").hex_id.as_bytes(),
        ),
    ]);
    let loose = [LooseRef {
        name: b"refs/heads/main",
        value: &loose_value(seed(&seeds, "merge").hex_id.as_bytes()),
    }];
    let input = records(
        &seeds,
        &["root", "left", "right", "merge", "inner", "outer", "tree"],
    );
    let mut counts = Counts::default();
    let report = walk(packed.as_bytes(), &loose, &input, &mut counts).expect("closed graph");
    let node = |label, kind| Node {
        id: oid(seed(&seeds, label).hex_id.as_bytes()),
        kind,
    };
    let tree = node("tree", Kind::Tree);
    let root = node("root", Kind::Commit);
    let left = node("left", Kind::Commit);
    let right = node("right", Kind::Commit);
    let merge = node("merge", Kind::Commit);
    let inner = node("inner", Kind::Tag);
    let outer = node("outer", Kind::Tag);
    let expected_nodes = [tree, root, left, right, merge, inner, outer];
    let expected_edges = [
        (root, tree),
        (left, tree),
        (right, tree),
        (merge, tree),
        (left, root),
        (right, root),
        (merge, left),
        (merge, right),
        (inner, merge),
        (outer, inner),
    ];
    assert_eq!(report.nodes.iter().flatten().count(), expected_nodes.len());
    assert!(
        expected_nodes
            .iter()
            .all(|node| report.nodes.contains(&Some(*node)))
    );
    assert_eq!(report.edges.iter().flatten().count(), expected_edges.len());
    assert!(
        expected_edges
            .iter()
            .all(|(from, to)| report.edges.contains(&Some(Edge {
                from: from.id,
                to: *to
            })))
    );
    assert_eq!(
        counts,
        Counts {
            attempted: 7,
            verified: 7,
            edges: 10
        }
    );
}

#[test]
fn a22_missing_parent_tag_or_tree_withholds_report() {
    let seeds = seeds();
    for (root, labels) in [
        ("merge", &["merge", "left", "root", "tree"][..]),
        ("outer", &["outer"][..]),
        ("root", &["root"][..]),
    ] {
        let (result, counts) = inspect(&seeds, root, labels);
        assert_eq!(result, Err(Refusal::Missing));
        assert!(counts.verified >= 1);
        assert_eq!(counts.attempted, counts.verified + 1);
    }
}

#[test]
fn a23_ninth_required_object_is_never_read() {
    let seeds = seeds();
    let input = [
        "chain0", "chain1", "chain2", "chain3", "chain4", "chain5", "chain6", "chain7", "tree",
    ];
    let (result, counts) = inspect(&seeds, "chain7", &input);
    assert_eq!(result, Err(Refusal::ObjectCap));
    assert_eq!(counts.attempted, 8);
}

#[test]
fn a24_each_structural_edge_counts_even_for_shared_objects() {
    let seeds = seeds();
    let input = [
        "dense0",
        "dense1",
        "dense2",
        "dense3",
        "dense4",
        "dense5",
        "too-many-edges",
        "tree",
    ];
    let (result, counts) = inspect(&seeds, "too-many-edges", &input);
    assert_eq!(result, Err(Refusal::EdgeCap));
    assert_eq!(counts.edges, 16);
}

#[test]
fn a25_kind_expectations_survive_shared_target_deduplication() {
    let seeds = seeds();
    let packed = packed_rows(&[
        ("refs/heads/right", seed(&seeds, "right").hex_id.as_bytes()),
        (
            "refs/tags/wrong",
            seed(&seeds, "wrong-kind").hex_id.as_bytes(),
        ),
    ]);
    let input = records(&seeds, &["right", "wrong-kind", "root", "tree"]);
    let mut counts = Counts::default();
    assert_eq!(
        walk(packed.as_bytes(), &[], &input, &mut counts),
        Err(Refusal::Kind)
    );
    assert_eq!(counts.verified, 2);
}

#[test]
fn a26_bad_identity_and_malformed_objects_refuse() {
    let seeds = seeds();
    let mut bad_id = records(&seeds, &["left"]);
    bad_id[0].id = oid(seed(&seeds, "root").hex_id.as_bytes());
    let mut counts = Counts::default();
    assert_eq!(
        walk(refs(&seeds, "root").as_bytes(), &[], &bad_id, &mut counts),
        Err(Refusal::Integrity)
    );
    for label in ["truncated", "invalid-parent", "bad-tag"] {
        assert_eq!(inspect(&seeds, label, &[label]).0, Err(Refusal::Encoding));
    }
}

#[test]
fn a27_missing_local_tree_entry_refuses_instead_of_dropping_it() {
    let seeds = seeds();
    let (result, counts) = inspect(
        &seeds,
        "nonempty-commit",
        &["nonempty-commit", "nonempty-tree"],
    );
    assert_eq!(result, Err(Refusal::Missing));
    assert_eq!(counts.attempted, 3);
}

#[test]
fn a28_exact_graph_caps_accept_complete_input() {
    let seeds = seeds();
    let input = [
        "dense0", "dense1", "dense2", "dense3", "dense4", "dense5", "dense6", "tree",
    ];
    let (result, counts) = inspect(&seeds, "dense6", &input);
    let report = result.expect("exact-cap graph");
    assert_eq!(report.nodes.iter().flatten().count(), MAX_OBJECTS);
    assert_eq!(report.edges.iter().flatten().count(), MAX_EDGES);
    assert_eq!(
        counts,
        Counts {
            attempted: MAX_OBJECTS,
            verified: MAX_OBJECTS,
            edges: MAX_EDGES
        }
    );
}

#[path = "tree_cases.rs"]
mod tree_cases;

#[path = "added_lines.rs"]
mod added_lines;
