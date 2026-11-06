use crate::host_graph::Site;
use crate::model::Diagnostic;
use crate::snapshot::Snapshot;
use serde::Deserialize;
use std::collections::BTreeSet;

const COMPILED: &str = include_str!("../reviewed-sources.json");
const REGISTRY_LIMIT: usize = 1024 * 1024;
const RECORD_LIMIT: usize = 1000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    schema_version: u32,
    sources: Vec<ProgramRecord>,
    #[serde(default)]
    producers: Vec<crate::reviewed_producers::Record>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Span {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl Span {
    pub(crate) fn text<'a>(&self, source: &'a str) -> Option<&'a str> {
        (self.start < self.end)
            .then(|| source.get(self.start..self.end))
            .flatten()
    }

    pub(crate) fn site(&self, path: &str) -> Option<Site> {
        Some(Site {
            path: path.into(),
            start: self.start.try_into().ok()?,
            end: self.end.try_into().ok()?,
            body: None,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    source: Span,
    expected_source: String,
    interpreter: String,
    arguments: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum DataKind {
    DataFileRead,
    ParseData,
    DataOutput,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DataRegion {
    id: String,
    source: Span,
    callee: Span,
    spelling: String,
    identity: String,
    kind: DataKind,
    inputs: Vec<String>,
    outputs: Vec<String>,
    consumer: String,
}

// This first variant admits reviewed data parsers only. Producer variants
// remain unsupported until their real-body oracles and decoders are delivered.
#[derive(Deserialize)]
enum ExecutableBoundary {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Unresolved {
    source: Span,
    reason: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramRecord {
    path: String,
    git_blob: String,
    owner: String,
    migration_slice: String,
    language: String,
    reason: String,
    scope: String,
    kind: String,
    complete: bool,
    program: Span,
    entry: Entry,
    data_regions: Vec<DataRegion>,
    executable_boundaries: Vec<ExecutableBoundary>,
    unresolved: Vec<Unresolved>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataEvidence {
    pub id: String,
    pub source: Site,
    pub callee: Site,
    pub spelling: String,
    pub identity: String,
    pub kind: DataKind,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub consumer: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProgramEvidence {
    pub path: String,
    pub git_blob: String,
    pub language: String,
    pub owner: String,
    pub migration_slice: String,
    pub program: Site,
    pub entry: Site,
    pub data_regions: Vec<DataEvidence>,
}

fn error(code: &str, path: Option<&str>) -> Diagnostic {
    Diagnostic::new(code, path)
}

fn nonempty(text: &str) -> bool {
    !text.trim().is_empty() && !text.chars().any(char::is_control)
}

fn validate(
    record: ProgramRecord,
    snapshot: &Snapshot,
) -> Result<Option<ProgramEvidence>, Diagnostic> {
    let path = &record.path;
    if !crate::validation::relative_path(path)
        || !nonempty(&record.owner)
        || !record.migration_slice.starts_with("rust-")
        || !matches!(record.git_blob.len(), 40 | 64)
        || !record.git_blob.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !nonempty(&record.reason)
        || record.language != "python"
        || record.scope != "program"
        || record.kind != "data-parser"
    {
        return Err(error("invalid-reviewed-source-record", Some(path)));
    }
    let Some(entry) = snapshot.entries.get(path) else {
        return Ok(None);
    };
    if entry.mode == 0o120000 {
        return Err(error("reviewed-source-type", Some(path)));
    }
    if record.git_blob != entry.blob {
        return Err(error("stale-reviewed-source", Some(path)));
    }
    let source = std::str::from_utf8(&entry.bytes)
        .map_err(|_| error("reviewed-source-encoding", Some(path)))?;
    if !record.complete || !record.executable_boundaries.is_empty() {
        return Err(error("incomplete-reviewed-source", Some(path)));
    }
    for unresolved in &record.unresolved {
        if unresolved.source.text(source).is_none() || !nonempty(&unresolved.reason) {
            return Err(error("invalid-reviewed-source-record", Some(path)));
        }
    }
    if !record.unresolved.is_empty() {
        return Err(error("incomplete-reviewed-source", Some(path)));
    }
    if record.program.start != 0
        || record.program.end != source.len()
        || record.entry.source.text(source) != Some(record.entry.expected_source.as_str())
        || record.entry.interpreter != "python3"
        || record.entry.arguments != ["owned-program", "data-path"]
        || record.data_regions.is_empty()
        || record.data_regions.len() > RECORD_LIMIT
    {
        return Err(error("reviewed-source-binding", Some(path)));
    }
    let mut ids = BTreeSet::new();
    let mut regions = Vec::new();
    for region in record.data_regions {
        if !nonempty(&region.id)
            || !ids.insert(region.id.clone())
            || region.source.text(source).is_none()
            || region.callee.text(source) != Some(region.spelling.as_str())
            || region.callee.start < region.source.start
            || region.callee.end > region.source.end
            || !region.identity.starts_with("python:")
            || !nonempty(&region.consumer)
            || region.inputs.is_empty()
            || region.outputs.is_empty()
            || region
                .inputs
                .iter()
                .chain(&region.outputs)
                .any(|id| !nonempty(id))
        {
            return Err(error("reviewed-source-binding", Some(path)));
        }
        regions.push(DataEvidence {
            id: region.id,
            source: region
                .source
                .site(path)
                .ok_or_else(|| error("reviewed-source-binding", Some(path)))?,
            callee: region
                .callee
                .site(path)
                .ok_or_else(|| error("reviewed-source-binding", Some(path)))?,
            spelling: region.spelling,
            identity: region.identity,
            kind: region.kind,
            inputs: region.inputs,
            outputs: region.outputs,
            consumer: region.consumer,
        });
    }
    Ok(Some(ProgramEvidence {
        path: record.path.clone(),
        git_blob: record.git_blob,
        language: record.language,
        owner: record.owner,
        migration_slice: record.migration_slice,
        program: record
            .program
            .site(path)
            .ok_or_else(|| error("reviewed-source-binding", Some(path)))?,
        entry: record
            .entry
            .source
            .site(path)
            .ok_or_else(|| error("reviewed-source-binding", Some(path)))?,
        data_regions: regions,
    }))
}

// One checker invocation owns this immutable view of the compiled registry.
// The source manifest and environment cannot select another registry.
fn compiled() -> Result<Registry, Diagnostic> {
    if COMPILED.len() > REGISTRY_LIMIT {
        return Err(error("reviewed-source-limit", None));
    }
    let registry: Registry = serde_json::from_str(COMPILED)
        .map_err(|_| error("invalid-reviewed-source-registry", None))?;
    if registry.schema_version != 1
        || registry
            .sources
            .len()
            .saturating_add(registry.producers.len())
            > RECORD_LIMIT
    {
        return Err(error("invalid-reviewed-source-registry", None));
    }
    Ok(registry)
}

pub(crate) fn producer_records() -> Result<Vec<crate::reviewed_producers::Record>, Diagnostic> {
    Ok(compiled()?.producers)
}

pub fn inspect(snapshot: &Snapshot) -> Result<Vec<ProgramEvidence>, Diagnostic> {
    let registry = compiled()?;
    let mut paths = BTreeSet::new();
    let mut result = Vec::new();
    for record in registry.sources {
        if !paths.insert(record.path.clone()) {
            return Err(error("invalid-reviewed-source-registry", None));
        }
        if let Some(evidence) = validate(record, snapshot)? {
            result.push(evidence)
        }
    }
    Ok(result)
}
