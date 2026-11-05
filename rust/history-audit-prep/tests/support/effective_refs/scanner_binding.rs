use super::{
    Record, Refusal,
    added_lines::{EvidenceRefusal, evidence_from_graph},
    resolve, walk,
};
use crate::effective_refs::LooseRef;
use crate::{Audit, HASH, OUTPUT_BYTES, loose_record};
use gix_hash::ObjectId;
use gix_object::{CommitRefIter, Kind, TagRef, commit::ref_iter::Token};

const FRAME_LIMIT: usize = 1024;
const RECORD_LIMIT: usize = 64;
const TOTAL_LIMIT: usize = 64 * 1024;
const PREFIX: &[u8] = b"synthetic scanner calibration\n";
const TAIL: &[u8] = b"SYNTHETICTAIL564";
const SUFFIX: &[u8] = b"\nSYNTHETICTAIL564\n";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum Surface {
    Author = 1,
    Committer,
    CommitMessage,
    TagMessage,
    Branch,
    TagRef,
    OtherRef,
    Path,
    Added,
}

#[derive(Debug, PartialEq, Eq)]
struct Frame {
    surface: Surface,
    commit: Option<ObjectId>,
    parent: Option<ObjectId>,
    bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
enum ProjectionRefusal {
    Graph(Refusal),
    Lines(EvidenceRefusal),
    Text,
    FrameLimit,
    RecordLimit,
    TotalLimit,
}

#[derive(Default)]
struct Frames {
    items: Vec<Frame>,
    total: usize,
}

impl Frames {
    fn push(
        &mut self,
        surface: Surface,
        payload: &[u8],
        commit: Option<ObjectId>,
        parent: Option<ObjectId>,
    ) -> Result<(), ProjectionRefusal> {
        let len = PREFIX.len() + payload.len() + SUFFIX.len();
        if len > FRAME_LIMIT {
            return Err(ProjectionRefusal::FrameLimit);
        }
        if self.items.len() == RECORD_LIMIT {
            return Err(ProjectionRefusal::RecordLimit);
        }
        if self.total + len > TOTAL_LIMIT {
            return Err(ProjectionRefusal::TotalLimit);
        }
        if payload.contains(&0)
            || std::str::from_utf8(payload).is_err()
            || payload.windows(TAIL.len()).any(|bytes| bytes == TAIL)
        {
            return Err(ProjectionRefusal::Text);
        }
        let mut bytes = Vec::with_capacity(len);
        bytes.extend_from_slice(PREFIX);
        bytes.extend_from_slice(payload);
        bytes.extend_from_slice(SUFFIX);
        self.items.push(Frame {
            surface,
            commit,
            parent,
            bytes,
        });
        self.total += len;
        Ok(())
    }
}

fn project(
    packed: &[u8],
    loose: &[LooseRef<'_>],
    records: &[Record<'_>],
) -> Result<Vec<Frame>, ProjectionRefusal> {
    let graph =
        walk(packed, loose, records, &mut Default::default()).map_err(ProjectionRefusal::Graph)?;
    let lines = evidence_from_graph(&graph, records).map_err(ProjectionRefusal::Lines)?;
    let refs = resolve(packed, loose).map_err(|_| ProjectionRefusal::Graph(Refusal::Refs))?;
    let mut frames = Frames::default();

    for record in refs.into_iter().flatten() {
        let surface = if record.name.starts_with(b"refs/heads/") {
            Surface::Branch
        } else if record.name.starts_with(b"refs/tags/") {
            Surface::TagRef
        } else {
            Surface::OtherRef
        };
        frames.push(surface, record.name, None, None)?;
    }
    let mut output = [0; OUTPUT_BYTES];
    for node in graph
        .nodes
        .iter()
        .flatten()
        .filter(|node| matches!(node.kind, Kind::Commit | Kind::Tag))
    {
        let record = records
            .iter()
            .find(|record| record.id == node.id)
            .ok_or(ProjectionRefusal::Graph(Refusal::Missing))?;
        let (kind, body) = loose_record(
            record.compressed,
            &node.id,
            &mut output,
            &mut Audit::default(),
        )
        .map_err(|_| ProjectionRefusal::Graph(Refusal::Integrity))?;
        if kind != node.kind {
            return Err(ProjectionRefusal::Graph(Refusal::Kind));
        }
        let decode_error = |_| ProjectionRefusal::Graph(Refusal::Encoding);
        if kind == Kind::Commit {
            for token in CommitRefIter::from_bytes(body, HASH) {
                let (surface, payload): (_, &[u8]) = match token.map_err(decode_error)? {
                    Token::Author { signature } => (Surface::Author, signature.email.as_ref()),
                    Token::Committer { signature } => {
                        (Surface::Committer, signature.email.as_ref())
                    }
                    Token::Message(message) => (Surface::CommitMessage, message.as_ref()),
                    _ => continue,
                };
                frames.push(surface, payload, Some(node.id), None)?;
            }
        } else {
            let tag = TagRef::from_bytes(body, HASH).map_err(decode_error)?;
            let payload: &[u8] = if tag.pgp_signature.is_some() {
                // Do not let a signature-like line hide the remaining raw annotation bytes.
                let separator = body
                    .windows(2)
                    .position(|bytes| bytes == b"\n\n")
                    .ok_or(ProjectionRefusal::Graph(Refusal::Encoding))?;
                &body[separator + 2..]
            } else {
                tag.message.as_ref()
            };
            frames.push(Surface::TagMessage, payload, None, None)?;
        }
    }
    for row in graph.paths.iter().flatten() {
        frames.push(Surface::Path, &row.bytes[..row.len], Some(row.commit), None)?;
    }
    for row in lines.into_iter().flatten() {
        frames.push(
            Surface::Added,
            &row.bytes[..row.len],
            Some(row.file.commit),
            row.parent,
        )?;
    }
    Ok(frames.items)
}

#[path = "scanner_cases.rs"]
mod scanner_cases;
