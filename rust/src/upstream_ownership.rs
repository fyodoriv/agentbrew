use crate::{
    discovery::Fact,
    model::{Component, Diagnostic},
    snapshot::Snapshot,
    upstream_consumers::{self, Consumer},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const COMPILED: &str = include_str!("../reviewed-upstream.json");
const ROOT: &str = "rust/vendor/libproc-0.14.11";
const OWNER: &str = "upstream:libproc@0.14.11";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Ownership {
    Upstream,
    MixedCode,
    OwnedCode,
    OwnedData,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileRecord {
    path: String,
    sha256: String,
    original_sha256: Option<String>,
    mode: u32,
    ownership: Ownership,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema_version: u32,
    package: String,
    version: String,
    root: String,
    archive_sha256: String,
    license_sha256: String,
    files: Vec<FileRecord>,
    consumers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default)]
pub struct Evidence {
    pub files: BTreeMap<String, Ownership>,
    pub consumer: Option<Consumer>,
    pub facts: Vec<Fact>,
    pub edges: Vec<(String, String, String)>,
}
fn error(code: &str, path: &str) -> Diagnostic {
    Diagnostic::new(code, Some(path))
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn hexadecimal(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn inspect(snapshot: &Snapshot) -> Result<Evidence, Diagnostic> {
    if !snapshot
        .entries
        .keys()
        .any(|path| path.starts_with(&format!("{ROOT}/")))
    {
        if upstream_consumers::declares_local_package(snapshot)? {
            return Err(error("upstream-consumer-mismatch", "rust/Cargo.toml"));
        }
        return Ok(Evidence::default());
    }
    let mismatch = || error("upstream-provenance-mismatch", ROOT);
    if COMPILED.len() > 1024 * 1024 {
        return Err(mismatch());
    }
    let record: Record = serde_json::from_str(COMPILED).map_err(|_| mismatch())?;
    if record.schema_version != 1
        || record.package != "libproc"
        || record.version != "0.14.11"
        || record.root != ROOT
        || record.archive_sha256
            != "a54ad7278b8bc5301d5ffd2a94251c004feb971feba96c971ea4063645990757"
        || record.license_sha256
            != "96476b7db2b7185d597311f4cb25091dfbfe75ad8197562e4bff72d797bb331c"
        || record.files.is_empty()
        || record.files.len() > 1000
    {
        return Err(mismatch());
    }
    if let Some(entry) = snapshot.entries.get("rust/reviewed-upstream.json") {
        if entry.mode != 0o100644 || entry.bytes != COMPILED.as_bytes() {
            return Err(mismatch());
        }
    }
    let mut evidence = Evidence::default();
    let mut paths = BTreeSet::new();
    for file in &record.files {
        if !crate::validation::relative_path(&file.path)
            || !hexadecimal(&file.sha256)
            || file
                .original_sha256
                .as_ref()
                .is_some_and(|sha| !hexadecimal(sha))
            || file.mode != 0o100644
            || !paths.insert(file.path.as_str())
        {
            return Err(mismatch());
        }
        if file.ownership == Ownership::Upstream
            && file.original_sha256.as_ref() != Some(&file.sha256)
            && file.path != "examples/procinfo.rs"
        {
            return Err(mismatch());
        }
        let path = format!("{ROOT}/{}", file.path);
        let entry = snapshot.entries.get(&path).ok_or_else(mismatch)?;
        if entry.mode != file.mode
            || entry.bytes.len() > 2 * 1024 * 1024
            || digest(&entry.bytes) != file.sha256
        {
            return Err(error("upstream-provenance-mismatch", &path));
        }
        evidence.files.insert(path, file.ownership.clone());
    }
    if [
        "UPSTREAM.json",
        "PATCH.json",
        "PATCH.diff",
        "PATCH.md",
        "LICENSE",
    ]
    .iter()
    .any(|path| !paths.contains(path))
        || record
            .consumers
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>()
            != BTreeSet::from([
                "rust/Cargo.toml",
                "rust/Cargo.lock",
                "rust/src/lib.rs",
                "rust/src/darwin_group.rs",
            ])
    {
        return Err(mismatch());
    }
    if snapshot
        .entries
        .keys()
        .filter_map(|path| path.strip_prefix(&format!("{ROOT}/")))
        .any(|path| !paths.contains(path))
    {
        return Err(mismatch());
    }
    let provenance_path = format!("{ROOT}/UPSTREAM.json");
    let provenance: serde_json::Value =
        serde_json::from_slice(&snapshot.entries[&provenance_path].bytes)
            .map_err(|_| mismatch())?;
    if provenance["archive_sha256"].as_str() != Some(record.archive_sha256.as_str())
        || digest(&snapshot.entries[&format!("{ROOT}/LICENSE")].bytes) != record.license_sha256
    {
        return Err(mismatch());
    }
    for (path, expected) in &record.consumers {
        let entry = snapshot
            .entries
            .get(path)
            .ok_or_else(|| error("upstream-consumer-mismatch", path))?;
        if !hexadecimal(expected)
            || entry.mode != 0o100644
            || entry.bytes.len() > 2 * 1024 * 1024
            || digest(&entry.bytes) != *expected
        {
            return Err(error("upstream-consumer-mismatch", path));
        }
    }
    let consumer = upstream_consumers::inspect(snapshot)?;
    let id = "cargo-dependency:rust/Cargo.toml#libproc";
    let lines = std::str::from_utf8(&snapshot.entries["rust/Cargo.toml"].bytes)
        .map_err(|_| mismatch())?
        .lines()
        .count()
        .max(1);
    evidence.facts.push(Fact {
        id: id.into(),
        path: "rust/Cargo.toml".into(),
        language: "toml".into(),
        form: "registry".into(),
        start: 1,
        end: lines,
        parent: None,
    });
    evidence.edges.push((
        id.into(),
        format!("program:{}", consumer.library),
        "imports".into(),
    ));
    evidence.edges.push((
        id.into(),
        format!("program:{}", consumer.build_script),
        "invokes".into(),
    ));
    evidence.edges.push((
        "program:rust/src/darwin_group.rs".into(),
        format!("program:{ROOT}/src/processes.rs"),
        "invokes".into(),
    ));
    evidence.edges.push((
        "program:rust/src/darwin_group.rs".into(),
        format!("program:{}", consumer.owned_source),
        "imports".into(),
    ));
    evidence.consumer = Some(consumer);
    Ok(evidence)
}

pub fn policy(evidence: &Evidence, component: &Component) -> Option<Diagnostic> {
    let path = &component.source.path;
    let kind = evidence.files.get(path);
    if component.disposition == "upstream" {
        let qualified = kind == Some(&Ownership::Upstream)
            && component.owner == OWNER
            && component.source.form == "program"
            && component.migration_slice.is_none()
            && component.exception_reason.is_none()
            && component.generated_targets.is_empty()
            && component.resolution.is_none()
            && component.contracts.is_empty()
            && component.call_receipts.is_empty()
            && !component.caller_boundary.trim().is_empty()
            && !component.caller_boundary.chars().any(char::is_control);
        return (!qualified).then(|| error("unqualified-upstream-component", path));
    }
    if component.source.form == "program" {
        match kind {
            Some(Ownership::Upstream) => return Some(error("upstream-owner-required", path)),
            Some(Ownership::MixedCode) => return Some(error("mixed-upstream-ownership", path)),
            _ => {}
        }
    }
    None
}
