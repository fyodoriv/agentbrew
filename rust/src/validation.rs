use crate::{
    discovery::{Discovery, Fact},
    model::{CheckReport, Component, Diagnostic, Manifest},
    snapshot::Snapshot,
};
use std::collections::{BTreeMap, BTreeSet};

fn membership_index<'a>(
    components: impl Iterator<Item = (&'a str, &'a str)>,
) -> BTreeMap<&'a str, BTreeSet<&'a str>> {
    let mut index: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (path, id) in components {
        index.entry(path).or_default().insert(id);
    }
    index
}

fn membership_mismatch(
    index: &BTreeMap<&str, BTreeSet<&str>>,
    path: &str,
    listed: &[String],
) -> bool {
    let actual: BTreeSet<_> = listed.iter().map(String::as_str).collect();
    let matches = index
        .get(path)
        .map_or(actual.is_empty(), |expected| *expected == actual);
    !matches || actual.len() != listed.len()
}

#[cfg(test)]
mod membership_tests {
    use super::{membership_index, membership_mismatch};
    use std::cell::Cell;
    use std::collections::BTreeSet;

    fn legacy(components: &[(&str, &str)], path: &str, listed: &[String]) -> bool {
        let expected: BTreeSet<_> = components
            .iter()
            .filter(|(source, _)| *source == path)
            .map(|(_, id)| *id)
            .collect();
        let actual: BTreeSet<_> = listed.iter().map(String::as_str).collect();
        actual != expected || actual.len() != listed.len()
    }

    #[test]
    fn indexed_membership_matches_legacy_including_diagnostic_order() {
        let components = [
            ("a", "one"),
            ("a", "one"),
            ("a", "two"),
            ("b", "one"),
            ("", "empty-path"),
            ("../invalid", "invalid-path"),
        ];
        let cases: [(&str, &[&str]); 11] = [
            ("a", &["one", "two"]),
            ("a", &["one"]),
            ("a", &["one", "two", "two"]),
            ("b", &["one"]),
            ("b", &["two"]),
            ("missing", &[]),
            ("missing", &["one"]),
            ("", &["empty-path"]),
            ("../invalid", &["invalid-path"]),
            ("a", &["two"]),
            ("a", &["two"]),
        ];
        let index = membership_index(components.iter().copied());
        let mut old_errors = Vec::new();
        let mut new_errors = Vec::new();
        for (path, ids) in cases {
            let listed: Vec<String> = ids.iter().map(|id| (*id).to_owned()).collect();
            if legacy(&components, path, &listed) {
                old_errors.push(path);
            }
            if membership_mismatch(&index, path, &listed) {
                new_errors.push(path);
            }
        }
        assert_eq!(new_errors, old_errors);
        assert_eq!(old_errors, ["a", "a", "b", "missing", "a", "a"]);
    }

    #[test]
    fn fixed_corpus_replaces_repeated_component_visits() {
        let paths: Vec<_> = (0..2_000).map(|n| format!("source/{n}")).collect();
        let ids: Vec<_> = (0..2_000).map(|n| format!("id/{n}")).collect();
        let components: Vec<_> = paths
            .iter()
            .zip(&ids)
            .map(|(p, id)| (p.as_str(), id.as_str()))
            .collect();
        let old_visits = Cell::new(0usize);
        for path in &paths {
            let _: BTreeSet<_> = components
                .iter()
                .filter(|(source, _)| {
                    old_visits.set(old_visits.get() + 1);
                    *source == path.as_str()
                })
                .map(|(_, id)| *id)
                .collect();
        }
        let insertions = Cell::new(0usize);
        let index = membership_index(components.iter().map(|&(path, id)| {
            insertions.set(insertions.get() + 1);
            (path, id)
        }));
        let mut lookups = 0;
        for (path, id) in paths.iter().zip(&ids) {
            lookups += 1;
            assert!(!membership_mismatch(&index, path, std::slice::from_ref(id)));
        }
        assert_eq!(
            (old_visits.get(), insertions.get(), lookups),
            (4_000_000, 2_000, 2_000)
        );
    }
}

fn issue(errors: &mut Vec<Diagnostic>, code: &str, path: &str) {
    errors.push(Diagnostic::new(code, Some(path)));
}
fn nonempty(value: &str) -> bool {
    !value.trim().is_empty() && !value.chars().any(char::is_control)
}
pub fn relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', ':'])
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn normalized_link(path: &str, target: &str) -> Option<String> {
    if target.starts_with('/')
        || target.contains(['\\', ':'])
        || target.chars().any(char::is_control)
    {
        return None;
    }
    let mut parts: Vec<_> = path.split('/').collect();
    parts.pop();
    for part in target.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}
fn links(snapshot: &Snapshot, errors: &mut Vec<Diagnostic>) {
    for (path, entry) in &snapshot.entries {
        if entry.mode != 0o120000 {
            continue;
        }
        let mut current = path.clone();
        let mut seen = BTreeSet::new();
        loop {
            if !seen.insert(current.clone()) {
                issue(errors, "unsafe-symlink", path);
                break;
            }
            let Some(entry) = snapshot.entries.get(&current) else {
                issue(errors, "unsafe-symlink", path);
                break;
            };
            if entry.mode != 0o120000 {
                break;
            }
            let next = std::str::from_utf8(&entry.bytes)
                .ok()
                .and_then(|target| normalized_link(&current, target));
            match next {
                Some(next) => current = next,
                None => {
                    issue(errors, "unsafe-symlink", path);
                    break;
                }
            }
        }
    }
}
fn allowance(manifest: &Manifest, component: &Component, kind: &str) -> bool {
    manifest
        .allowances
        .iter()
        .filter(|a| a.component == component.id && a.disposition == kind && nonempty(&a.reason))
        .count()
        == 1
}
fn component_policy(manifest: &Manifest, component: &Component, errors: &mut Vec<Diagnostic>) {
    let path = &component.source.path;
    if component.owner != manifest.owner || !nonempty(&component.caller_boundary) {
        issue(errors, "invalid-component-owner", path);
    }
    match component.disposition.as_str() {
        "eligible" | "native" => {
            if !component
                .migration_slice
                .as_ref()
                .is_some_and(|s| manifest.slices.contains(s))
            {
                issue(errors, "missing-migration-slice", path);
            }
            if component.disposition == "native" && component.source.language != "rust" {
                issue(errors, "invalid-native-classification", path);
            }
        }
        "ui" => {
            let presentation = matches!(component.source.language.as_str(), "html" | "css")
                || (path == "src/ui/output.ts" && component.source.form == "program");
            if !presentation
                || !allowance(manifest, component, "ui")
                || !component
                    .exception_reason
                    .as_ref()
                    .is_some_and(|s| nonempty(s))
                || component.migration_slice.is_some()
            {
                issue(errors, "invalid-ui-exception", path);
            }
        }
        "necessary-shell" => {
            if !matches!(
                component.source.language.as_str(),
                "sh" | "bash" | "zsh" | "fish"
            ) || !allowance(manifest, component, "necessary-shell")
                || !component
                    .exception_reason
                    .as_ref()
                    .is_some_and(|s| nonempty(s))
                || component.migration_slice.is_some()
            {
                issue(errors, "invalid-shell-exception", path);
            }
        }
        "frozen-residue" => {
            if component.source.form != "frozen-boundary"
                || component.migration_slice.is_some()
                || !component
                    .exception_reason
                    .as_ref()
                    .is_some_and(|s| nonempty(s))
            {
                issue(errors, "frozen-policy-mismatch", path);
            }
        }
        _ => issue(
            errors,
            if component.source.form == "frozen-boundary" {
                "frozen-policy-mismatch"
            } else {
                "invalid-component-disposition"
            },
            path,
        ),
    }
    if component.source.form == "frozen-boundary" && component.disposition != "frozen-residue" {
        issue(errors, "frozen-policy-mismatch", path);
    }
}
fn matches_fact(component: &Component, fact: &Fact) -> bool {
    component.source.path == fact.path
        && component.source.form == fact.form
        && component.source.language == fact.language
        && component.source.start_line <= fact.start
        && component.source.end_line >= fact.end
}
fn ignored_allowed(manifest: &Manifest, path: &str) -> bool {
    let mut matches = 0;
    for allowance in &manifest.non_source_allowances {
        if !nonempty(&allowance.reason) {
            continue;
        }
        let matched = match allowance.kind.as_str() {
            "non-source" => {
                relative_path(&allowance.path)
                    && !allowance.path.contains(['*', '?'])
                    && allowance.path == path
            }
            "private-configuration" => {
                let name = path.rsplit('/').next().unwrap_or(path);
                match allowance.path.as_str() {
                    ".env" | ".envrc" => name == allowance.path,
                    ".env.*" => name.starts_with(".env."),
                    "*.pem" => name.ends_with(".pem"),
                    "*.key" => name.ends_with(".key"),
                    _ => false,
                }
            }
            _ => false,
        };
        if matched {
            matches += 1;
        }
    }
    matches == 1
}
pub fn validate(
    snapshot: &Snapshot,
    manifest_path: &str,
    manifest: &Manifest,
    discovered: Discovery,
) -> CheckReport {
    let mut errors = crate::package_entries::validate(manifest, &discovered);
    errors.extend(discovered.diagnostics);
    if manifest.schema_version != 1
        || !nonempty(&manifest.owner)
        || !matches!(manifest.reviewed_revision.len(), 40 | 64)
        || !manifest
            .reviewed_revision
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        issue(&mut errors, "invalid-manifest", manifest_path);
    }
    if manifest.slices.is_empty()
        || manifest
            .slices
            .iter()
            .any(|s| !s.starts_with("rust-") || !nonempty(s))
        || manifest.slices.iter().collect::<BTreeSet<_>>().len() != manifest.slices.len()
    {
        issue(&mut errors, "invalid-migration-slices", manifest_path);
    }
    let mut files = BTreeMap::new();
    let mut components = BTreeMap::new();
    let mut output_ids = BTreeSet::new();
    let mut all_ids = BTreeSet::new();
    for file in &manifest.files {
        if !relative_path(&file.path) || files.insert(file.path.clone(), file).is_some() {
            issue(&mut errors, "duplicate-or-invalid-file", manifest_path);
        }
        if !nonempty(&file.reason)
            || !matches!(
                file.disposition.as_str(),
                "reviewed-source" | "reviewed-data" | "symlink" | "inventory-description"
            )
        {
            issue(&mut errors, "invalid-file-disposition", &file.path);
        }
        if file.disposition == "inventory-description"
            && (file.path != manifest_path
                || file.reviewed_git_blob.is_some()
                || !file.components.is_empty())
        {
            issue(&mut errors, "invalid-self-description", &file.path);
        }
        if file.path == manifest_path && file.disposition != "inventory-description" {
            issue(&mut errors, "invalid-self-description", &file.path);
        }
        match snapshot.entries.get(&file.path) {
            None => issue(&mut errors, "missing-reviewed-file", &file.path),
            Some(entry) => {
                if file.path != manifest_path
                    && file.reviewed_git_blob.as_ref() != Some(&entry.blob)
                {
                    issue(&mut errors, "stale-file", &file.path);
                }
                if entry.mode == 0o120000 && file.disposition != "symlink" {
                    issue(&mut errors, "invalid-symlink-classification", &file.path);
                }
                if entry.mode != 0o120000 && file.disposition == "symlink" {
                    issue(&mut errors, "invalid-symlink-classification", &file.path);
                }
            }
        }
    }
    for path in snapshot.entries.keys() {
        if !files.contains_key(path) {
            issue(&mut errors, "unclassified-file", path);
        }
    }
    for path in &snapshot.untracked {
        issue(&mut errors, "untracked-file", path);
    }
    let mut allowance_ids = BTreeSet::new();
    for allowance in &manifest.non_source_allowances {
        let allowed_kind = match allowance.kind.as_str() {
            "non-source" => relative_path(&allowance.path) && !allowance.path.contains(['*', '?']),
            "private-configuration" => matches!(
                allowance.path.as_str(),
                ".env" | ".envrc" | ".env.*" | "*.pem" | "*.key"
            ),
            _ => false,
        };
        if !allowed_kind
            || !nonempty(&allowance.reason)
            || !allowance_ids.insert((&allowance.kind, &allowance.path))
        {
            issue(&mut errors, "invalid-non-source-allowance", manifest_path);
        }
    }
    for entry in &snapshot.ignored {
        let source_name = crate::discovery::language(&entry.path, "").is_some()
            || entry.path.rsplit('/').next() == Some("package.json");
        if entry.executable
            || entry.symlink
            || source_name
            || !ignored_allowed(manifest, &entry.path)
        {
            issue(&mut errors, "untracked-file", &entry.path);
        }
    }
    links(snapshot, &mut errors);
    for component in &manifest.components {
        let path = &component.source.path;
        if !nonempty(&component.id)
            || !all_ids.insert(component.id.clone())
            || components.insert(component.id.clone(), component).is_some()
        {
            issue(&mut errors, "duplicate-component", path);
        }
        if let Some(error) = crate::upstream_ownership::policy(&discovered.upstream, component) {
            errors.push(error);
        }
        if component.disposition != "upstream" {
            component_policy(manifest, component, &mut errors);
        }
        let region = &component.source;
        match snapshot
            .entries
            .get(path)
            .and_then(|entry| std::str::from_utf8(&entry.bytes).ok())
        {
            Some(text) => {
                let lines: Vec<_> = text.lines().collect();
                if region.start_line == 0
                    || region.end_line < region.start_line
                    || region.end_line > lines.len().max(1)
                {
                    issue(&mut errors, "invalid-source-region", path);
                } else if !region.anchor.is_empty()
                    && !lines[region.start_line - 1..region.end_line]
                        .join("\n")
                        .contains(&region.anchor)
                {
                    issue(&mut errors, "stale-source-anchor", path);
                }
            }
            None => issue(&mut errors, "missing-component-source", path),
        }
        for target in &component.generated_targets {
            if !target.id.starts_with("output:")
                || !relative_path(&target.path)
                || !nonempty(&target.consumer)
                || !all_ids.insert(target.id.clone())
            {
                issue(&mut errors, "invalid-generated-target", path);
            }
            output_ids.insert(target.id.clone());
        }
    }
    let membership = membership_index(
        manifest
            .components
            .iter()
            .map(|c| (c.source.path.as_str(), c.id.as_str())),
    );
    for file in &manifest.files {
        if membership_mismatch(&membership, &file.path, &file.components) {
            issue(&mut errors, "component-file-membership", &file.path);
        }
    }
    let mut edge_ids = BTreeSet::new();
    for edge in &manifest.edges {
        if !edge_ids.insert(&edge.id)
            || !nonempty(&edge.id)
            || !components.contains_key(&edge.from)
            || (!components.contains_key(&edge.to)
                && !output_ids.contains(&edge.to)
                && !manifest
                    .components
                    .iter()
                    .any(|c| c.contracts.contains(&edge.to)))
            || !matches!(
                edge.kind.as_str(),
                "imports"
                    | "invokes"
                    | "invokes-inline"
                    | "writes-executable"
                    | "copies"
                    | "bundles"
                    | "deploys"
                    | "renders"
                    | "retains-frozen"
            )
        {
            issue(&mut errors, "invalid-edge", manifest_path);
        }
    }
    let edge_exists = |from: &str, to: &str, kind: Option<&str>| {
        manifest
            .edges
            .iter()
            .any(|e| e.from == from && e.to == to && kind.is_none_or(|k| e.kind == k))
    };
    for fact in discovered.facts.values() {
        let reviewed = components
            .get(&fact.id)
            .filter(|component| matches_fact(component, fact));
        match reviewed {
            None => {
                issue(&mut errors, "unclassified-component", &fact.path);
                if fact.form == "dynamic-call" {
                    issue(&mut errors, "unresolved-execution", &fact.path);
                }
            }
            Some(component) => {
                if fact.form == "frozen-boundary" && component.disposition != "frozen-residue" {
                    issue(&mut errors, "frozen-policy-mismatch", &fact.path);
                }
                if fact.form == "embedded-program" {
                    if let Some(parent) = &fact.parent {
                        if !edge_exists(parent, &fact.id, Some("invokes-inline")) {
                            issue(&mut errors, "missing-caller-edge", &fact.path);
                        }
                    }
                }
            }
        }
    }
    for record in &discovered.reviewed_sources {
        let id = format!("program:{}", record.path);
        let program = components.get(&id);
        if manifest.owner != record.owner
            || !program.is_some_and(|component| {
                component.owner == record.owner
                    && component.source.language == record.language
                    && component.source.form == "program"
                    && component.disposition == "eligible"
                    && component.migration_slice.as_deref() == Some(record.migration_slice.as_str())
                    && component.generated_targets.is_empty()
                    && component.resolution.is_none()
                    && component.call_receipts.is_empty()
            })
            || manifest
                .components
                .iter()
                .any(|component| component.source.path == record.path && component.id != id)
        {
            issue(
                &mut errors,
                "reviewed-source-manifest-binding",
                &record.path,
            );
        }
    }
    for producer in &discovered.reviewed_producers {
        let event = &producer.event;
        let call = format!(
            "call:{}:{}:{}",
            event.site.path, event.site.start, event.site.end
        );
        let body = format!("body:{call}:0");
        if let Some(component) = components.get(&body) {
            if component.owner != producer.owner
                || component.migration_slice.as_deref() != Some(producer.migration_slice.as_str())
                || !producer
                    .environment_inputs
                    .iter()
                    .all(|name| component.contracts.contains(&format!("env:{name}")))
            {
                issue(
                    &mut errors,
                    "reviewed-producer-manifest-binding",
                    &event.site.path,
                );
            }
        }
    }
    for boundary in discovered.boundaries.values() {
        crate::native_validation::check_boundary(
            manifest,
            &discovered.programs,
            boundary,
            &mut errors,
        );
    }
    for component in &manifest.components {
        if component.source.form == "program"
            && (component.source.path.contains("{%")
                || component.source.path.ends_with(".jinja")
                || component.source.path.contains("/new-project/templates/"))
        {
            if component.generated_targets.is_empty()
                || component.generated_targets.iter().any(|target| {
                    !target.condition.as_ref().is_some_and(|s| nonempty(s))
                        || !edge_exists(&component.id, &target.id, Some("renders"))
                })
            {
                issue(
                    &mut errors,
                    "missing-template-output",
                    &component.source.path,
                );
            }
        }
    }
    for (from, to, kind) in &discovered.required_targets {
        if !edge_exists(from, to, Some(kind)) {
            let path = components
                .get(from)
                .map(|c| c.source.path.as_str())
                .unwrap_or(manifest_path);
            issue(&mut errors, "missing-caller-edge", path);
        }
        if !components.contains_key(to) && !output_ids.contains(to) {
            issue(&mut errors, "unresolved-execution", manifest_path);
        }
    }
    for (from, to, kind) in &discovered.registry_edges {
        if !edge_exists(from, to, Some(kind)) {
            issue(&mut errors, "missing-registry-edge", manifest_path);
        }
        if !components.contains_key(from)
            || (!components.contains_key(to) && !output_ids.contains(to))
        {
            issue(&mut errors, "missing-registry-target", manifest_path);
        }
    }
    // Registry records bind a reviewed existing source table, not a second list.
    let builtins = [
        (
            "src/sync/helper-scripts.ts",
            "helper-source-map",
            "HELPER_SCRIPT_SOURCES",
        ),
        ("hooks/manifest.yaml", "hook-manifest", "hooks:"),
        ("tsup.config.ts", "bundler", "entry:"),
    ];
    for (source, kind, anchor) in builtins {
        if snapshot.entries.contains_key(source)
            && !manifest
                .registries
                .iter()
                .any(|r| r.source == source && r.kind == kind && r.anchor == anchor)
        {
            issue(&mut errors, "missing-source-registry", source);
        }
    }
    let mut registry_ids = BTreeSet::new();
    for registry in &manifest.registries {
        if !registry_ids.insert(&registry.id)
            || !nonempty(&registry.id)
            || !nonempty(&registry.consumer)
            || !relative_path(&registry.source)
        {
            issue(&mut errors, "invalid-source-registry", manifest_path);
        }
        match snapshot
            .entries
            .get(&registry.source)
            .and_then(|e| std::str::from_utf8(&e.bytes).ok())
        {
            Some(text) if text.contains(&registry.anchor) => {}
            _ => issue(&mut errors, "stale-source-registry", &registry.source),
        }
    }
    errors.sort_by(|a, b| (&a.path, &a.code).cmp(&(&b.path, &b.code)));
    errors.dedup_by(|a, b| a.code == b.code && a.path == b.path);
    let classified = if errors.is_empty() {
        discovered.facts.len()
    } else {
        0
    };
    CheckReport {
        schema_version: 1,
        checked_files: snapshot.entries.len(),
        classified_components: classified,
        checked_edges: manifest.edges.len(),
        unresolved_frozen: manifest
            .components
            .iter()
            .filter(|c| c.disposition == "frozen-residue")
            .count(),
        diagnostics: errors,
    }
}
