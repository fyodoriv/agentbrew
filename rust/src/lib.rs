#![forbid(unsafe_code)]

#[cfg(target_os = "macos")]
mod darwin_group;
pub mod discovery;
pub mod host_graph;
pub mod model;
pub mod native_facts;
pub mod native_validation;
pub mod observations;
pub mod package_entries;
pub mod reviewed_producers;
pub mod reviewed_sources;
pub mod shell_ast;
pub mod shell_calls;
pub mod snapshot;
pub mod source_kind;
pub mod source_registries;
pub mod syntax;
#[cfg(unix)]
pub mod transport;
pub mod validation;
pub mod yaml_sources;

use std::path::Path;

use model::{CheckReport, Diagnostic};

pub fn check_repository(root: &Path, manifest_path: &str) -> Result<CheckReport, Diagnostic> {
    if !validation::relative_path(manifest_path) {
        return Err(Diagnostic::new("invalid-manifest-path", None));
    }
    let snapshot = snapshot::read(root)?;
    let entry = snapshot
        .entries
        .get(manifest_path)
        .ok_or_else(|| Diagnostic::new("missing-manifest", Some(manifest_path)))?;
    if entry.mode == 0o120000 {
        return Err(Diagnostic::new("invalid-manifest", Some(manifest_path)));
    }
    let manifest: model::Manifest = serde_json::from_slice(&entry.bytes)
        .map_err(|_| Diagnostic::new("invalid-manifest", Some(manifest_path)))?;
    let discovered = discovery::discover(&snapshot);
    Ok(validation::validate(
        &snapshot,
        manifest_path,
        &manifest,
        discovered,
    ))
}
