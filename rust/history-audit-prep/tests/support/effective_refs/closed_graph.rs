use super::{LooseRef, UNAVAILABLE, loose_value, oid, packed_rows, resolve};
use crate::{Audit, HASH, OUTPUT_BYTES, loose_record};
use gix_hash::ObjectId;
use gix_object::{CommitRefIter, Kind, TagRef, commit::ref_iter::Token};

const MAX_OBJECTS: usize = 8;
const MAX_RECORDS: usize = MAX_OBJECTS + 1;
const MAX_EDGES: usize = 16;

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
    NonemptyTree,
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

struct Walker {
    pending: [Option<Pending>; MAX_OBJECTS],
    report: Report,
}

impl Walker {
    fn enqueue(&mut self, id: ObjectId, expected: Option<Kind>) -> Result<(), Refusal> {
        for (pending, verified) in self.pending.iter_mut().zip(&self.report.nodes) {
            match pending {
                Some(existing) if existing.id == id => {
                    if let Some(kind) = expected {
                        let prior_kind = verified.map(|node| node.kind).or(existing.expected);
                        // A root may also be reached through an edge, but cannot become a tree.
                        if prior_kind.map_or(kind == Kind::Tree, |prior| prior != kind) {
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

    fn edge(&mut self, from: ObjectId, to: Node, counts: &mut Counts) -> Result<(), Refusal> {
        if counts.edges == MAX_EDGES {
            return Err(Refusal::EdgeCap);
        }
        self.enqueue(to.id, Some(to.kind))?;
        self.report.edges[counts.edges] = Some(Edge { from, to });
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
            self.edge(from, Node { id, kind }, counts)?;
        }
        // The iterator can stop at EOF before yielding the required message separator.
        Err(Refusal::Encoding)
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
        report: Report {
            nodes: [None; MAX_OBJECTS],
            edges: [None; MAX_EDGES],
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
                    counts,
                )?;
            }
            Kind::Tree if body.is_empty() => {}
            Kind::Tree => return Err(Refusal::NonemptyTree),
            Kind::Blob => return Err(Refusal::Kind),
        }
    }
    Ok(walker.report)
}

struct Seed<'a> {
    label: &'a str,
    hex_id: &'a str,
    compressed: Vec<u8>,
}

fn seeds() -> Vec<Seed<'static>> {
    include_str!("../../data/closed-graph.zframes")
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
fn a27_nonempty_tree_refuses_instead_of_dropping_entries() {
    let seeds = seeds();
    let (result, counts) = inspect(
        &seeds,
        "nonempty-commit",
        &["nonempty-commit", "nonempty-tree"],
    );
    assert_eq!(result, Err(Refusal::NonemptyTree));
    assert_eq!(counts.attempted, 2);
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
