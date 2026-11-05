use super::{PathRow, Record, Refusal, Report, walk};
use crate::{Audit, OUTPUT_BYTES, loose_record};
use gix_hash::ObjectId;
use gix_object::{Kind, tree::EntryKind};
use imara_diff::{Algorithm, Diff, InternedInput, sources::byte_lines};

const MAX_ROWS: usize = 32;
const MAX_COMPARISONS: usize = 16;
const MAX_BLOB_BYTES: usize = 2048;
const MAX_LINES: usize = 16;
const MAX_LINE_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct AddedLine {
    pub(super) file: PathRow,
    pub(super) parent: Option<ObjectId>,
    number: usize,
    pub(super) bytes: [u8; MAX_LINE_BYTES],
    pub(super) len: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum EvidenceRefusal {
    Graph(Refusal),
    Binary,
    BlobBytes,
    LineBytes,
    Lines,
    Comparisons,
    EvidenceRows,
}

fn evidence(
    packed: &[u8],
    records: &[Record<'_>],
) -> Result<[Option<AddedLine>; MAX_ROWS], EvidenceRefusal> {
    let graph =
        walk(packed, &[], records, &mut Default::default()).map_err(EvidenceRefusal::Graph)?;
    evidence_from_graph(&graph, records)
}

pub(super) fn evidence_from_graph(
    graph: &Report,
    records: &[Record<'_>],
) -> Result<[Option<AddedLine>; MAX_ROWS], EvidenceRefusal> {
    let mut rows = [None; MAX_ROWS];
    let mut comparisons = 0;
    for file in graph.paths.iter().flatten().filter(|row| content(row.mode)) {
        let mut parents = graph
            .edges
            .iter()
            .flatten()
            .filter(|edge| edge.from == file.commit && edge.to.kind == Kind::Commit)
            .peekable();
        if parents.peek().is_none() {
            compare(file, None, graph, records, &mut comparisons, &mut rows)?;
        }
        for parent in parents {
            compare(
                file,
                Some(parent.to.id),
                graph,
                records,
                &mut comparisons,
                &mut rows,
            )?;
        }
    }
    Ok(rows)
}

fn content(mode: EntryKind) -> bool {
    matches!(
        mode,
        EntryKind::Blob | EntryKind::BlobExecutable | EntryKind::Link
    )
}

fn compare(
    file: &PathRow,
    parent: Option<ObjectId>,
    graph: &Report,
    records: &[Record<'_>],
    comparisons: &mut usize,
    rows: &mut [Option<AddedLine>; MAX_ROWS],
) -> Result<(), EvidenceRefusal> {
    if *comparisons == MAX_COMPARISONS {
        return Err(EvidenceRefusal::Comparisons);
    }
    *comparisons += 1;
    let previous = parent.and_then(|parent| {
        graph.paths.iter().flatten().find(|prior| {
            prior.commit == parent
                && content(prior.mode)
                && (prior.mode == EntryKind::Link) == (file.mode == EntryKind::Link)
                && prior.bytes[..prior.len] == file.bytes[..file.len]
        })
    });
    if previous.is_some_and(|prior| prior.target == file.target) {
        return Ok(());
    }

    let mut before_output = [0; OUTPUT_BYTES];
    let before = match previous {
        Some(prior) => read_blob(prior.target, records, &mut before_output)?,
        None => b"",
    };
    let mut after_output = [0; OUTPUT_BYTES];
    let after = read_blob(file.target, records, &mut after_output)?;
    check_body(before)?;
    check_body(after)?;

    let input = InternedInput::new(before, after);
    let diff = Diff::compute(Algorithm::MyersMinimal, &input);
    for (index, line) in byte_lines(after).enumerate() {
        if !diff.is_added(index as u32) {
            continue;
        }
        let slot = rows
            .iter_mut()
            .find(|row| row.is_none())
            .ok_or(EvidenceRefusal::EvidenceRows)?;
        let mut bytes = [0; MAX_LINE_BYTES];
        bytes[..line.len()].copy_from_slice(line);
        *slot = Some(AddedLine {
            file: *file,
            parent,
            number: index + 1,
            bytes,
            len: line.len(),
        });
    }
    Ok(())
}

fn read_blob<'a>(
    id: ObjectId,
    records: &[Record<'_>],
    output: &'a mut [u8; OUTPUT_BYTES],
) -> Result<&'a [u8], EvidenceRefusal> {
    let record = records
        .iter()
        .find(|record| record.id == id)
        .ok_or(EvidenceRefusal::Graph(Refusal::Missing))?;
    let (kind, body) = loose_record(record.compressed, &id, output, &mut Audit::default())
        .map_err(|_| EvidenceRefusal::Graph(Refusal::Integrity))?;
    if kind != Kind::Blob {
        return Err(EvidenceRefusal::Graph(Refusal::Kind));
    }
    Ok(body)
}

fn check_body(body: &[u8]) -> Result<(), EvidenceRefusal> {
    if body.len() > MAX_BLOB_BYTES {
        return Err(EvidenceRefusal::BlobBytes);
    }
    if body.contains(&0) {
        return Err(EvidenceRefusal::Binary);
    }
    for (index, line) in byte_lines(body).enumerate() {
        if index == MAX_LINES {
            return Err(EvidenceRefusal::Lines);
        }
        if line.len() > MAX_LINE_BYTES {
            return Err(EvidenceRefusal::LineBytes);
        }
    }
    Ok(())
}

#[path = "line_cases.rs"]
mod line_cases;
