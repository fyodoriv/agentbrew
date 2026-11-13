use crate::{
    host_graph::{self, Datum, Site},
    model::Diagnostic,
    native_facts::{self, Boundaries, Boundary, RequiredTarget},
    native_validation,
    observations::{self, CallReceipt},
    shell_ast, shell_calls,
    snapshot::Snapshot,
    source_kind, syntax,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

const SOURCE_BYTES: usize = 2 * 1024 * 1024;
const DECODED_BYTES: usize = 32 * 1024 * 1024;
const SOURCE_COUNT: usize = 100_000;
const BODY_DEPTH: usize = 16;

#[derive(Clone, Debug)]
pub struct Fact {
    pub id: String,
    pub path: String,
    pub language: String,
    pub form: String,
    pub start: usize,
    pub end: usize,
    pub parent: Option<String>,
}

#[derive(Default)]
pub struct Discovery {
    pub upstream: crate::upstream_ownership::Evidence,
    pub facts: BTreeMap<String, Fact>,
    pub diagnostics: Vec<Diagnostic>,
    pub boundaries: BTreeMap<String, Boundary>,
    pub programs: BTreeMap<String, String>,
    pub required_targets: Vec<(String, String, String)>,
    pub registry_edges: Vec<(String, String, String)>,
    pub package_entries: Vec<crate::package_entries::Entry>,
    pub package_programs: BTreeMap<String, String>,
    pub reviewed_sources: Vec<crate::reviewed_sources::ProgramEvidence>,
    pub reviewed_producers: Vec<crate::reviewed_producers::Evidence>,
}

#[cfg(test)]
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct HostObservation {
    pub site: Site,
    pub operation: crate::host_graph::Operation,
    pub api: String,
    pub uncertain: bool,
}

#[cfg(test)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RustSyntaxObservation {
    pub path: String,
    pub module: String,
    pub owner: std::ops::Range<usize>,
    pub call: std::ops::Range<usize>,
    pub output: std::ops::Range<usize>,
    pub body: std::ops::Range<usize>,
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct DiscoveryObserver {
    records: BTreeSet<HostObservation>,
    text_bytes: usize,
    passes: usize,
    overflow: bool,
    complete: bool,
    rust_records: Vec<RustSyntaxObservation>,
    rust_path_bytes: usize,
    rust_module_bytes: usize,
    rust_invalid: bool,
}

#[cfg(test)]
impl DiscoveryObserver {
    pub(crate) fn begin_pass(&mut self) {
        self.records.clear();
        self.text_bytes = 0;
        self.overflow = false;
        self.complete = false;
        self.passes = self.passes.saturating_add(1);
    }

    pub(crate) fn record(&mut self, record: HostObservation) {
        if self.overflow || self.records.contains(&record) {
            return;
        }
        let size = record
            .site
            .path
            .len()
            .checked_add(record.site.body.as_ref().map_or(0, String::len))
            .and_then(|n| n.checked_add(record.api.len()))
            .and_then(|n| self.text_bytes.checked_add(n));
        if self.records.len() == 256 || size.is_none_or(|n| n > 65_536) {
            self.overflow = true;
            return;
        }
        self.text_bytes = size.expect("checked above");
        self.records.insert(record);
    }

    pub(crate) fn records(&self) -> Option<&BTreeSet<HostObservation>> {
        (self.complete && !self.overflow).then_some(&self.records)
    }

    pub(crate) fn overflowed(&self) -> bool {
        self.overflow
    }

    pub(crate) fn passes(&self) -> usize {
        self.passes
    }

    pub(crate) fn finish(&mut self) {
        self.complete = true;
    }

    pub(crate) fn observe_rust(&mut self, path: &str, source: &str, generated: bool) {
        if self.rust_invalid {
            return;
        }
        if generated {
            self.rust_invalid = true;
            self.rust_records.clear();
            return;
        }
        let Ok(sites) = crate::rust_family_tests::rust_syntax_slice::parse(source.as_bytes())
        else {
            self.rust_invalid = true;
            self.rust_records.clear();
            return;
        };
        for site in sites {
            let Some(bytes) = self.rust_path_bytes.checked_add(path.len()) else {
                self.rust_invalid = true;
                self.rust_records.clear();
                return;
            };
            let module_bytes = self.rust_module_bytes.checked_add(site.module.len());
            if self.rust_records.len() == 256
                || bytes > 65_536
                || module_bytes.is_none_or(|n| n > 65_536)
            {
                self.rust_invalid = true;
                self.rust_records.clear();
                return;
            }
            self.rust_path_bytes = bytes;
            self.rust_module_bytes = module_bytes.expect("checked above");
            self.rust_records.push(RustSyntaxObservation {
                path: path.into(),
                module: site.module,
                owner: site.owner,
                call: site.call,
                output: site.output.0,
                body: site.body.0,
            });
        }
    }

    pub(crate) fn rust_partial_records(&self) -> Option<&[RustSyntaxObservation]> {
        (self.complete && !self.rust_invalid).then_some(self.rust_records.as_slice())
    }
}

#[derive(Clone)]
struct Source {
    path: String,
    language: String,
    text: Arc<str>,
    physical_start: usize,
    physical_end: usize,
    body: Option<String>,
    depth: usize,
}

fn issue(result: &mut Discovery, code: &str, path: &str) {
    result.diagnostics.push(Diagnostic::new(code, Some(path)));
}

fn physical_lines(source: &Source, site: &Site) -> (usize, usize) {
    if source.body.is_some() {
        return (source.physical_start, source.physical_end);
    }
    let start = site.start as usize;
    let end = site.end as usize;
    let line = |end: usize| {
        source.text.as_bytes()[..end.min(source.text.len())]
            .iter()
            .filter(|byte| **byte == b'\n')
            .count()
            + 1
    };
    (line(start), line(end.saturating_sub(1).max(start)))
}

fn project_site(origins: &BTreeMap<String, Source>, site: &mut Site) {
    if site.body.is_some() {
        return;
    }
    if let Some(source) = origins.get(&site.path) {
        site.path = source.path.clone();
        site.body = source.body.clone();
    }
}

fn project_value(origins: &BTreeMap<String, Source>, value: &mut Datum) {
    match value {
        Datum::Text(_, site)
        | Datum::Boolean(_, site)
        | Datum::Number(_, site)
        | Datum::Null(site)
        | Datum::Unknown(site)
        | Datum::Input(site, _) => project_site(origins, site),
        Datum::Parts(values, site) => {
            project_site(origins, site);
            for value in values {
                project_value(origins, value);
            }
        }
        Datum::List(values) | Datum::Alternatives(values) => {
            for value in values {
                project_value(origins, value);
            }
        }
        Datum::Object(values) => {
            for value in values.values_mut() {
                project_value(origins, value);
            }
        }
        _ => {}
    }
}

fn project_receipt(origins: &BTreeMap<String, Source>, receipt: &mut CallReceipt) {
    project_site(origins, &mut receipt.site);
    for value in &mut receipt.arguments {
        project_value(origins, value);
    }
}

fn static_text(value: &Datum, budget: &mut usize, depth: usize) -> Option<String> {
    if depth > 32 {
        return None;
    }
    match value {
        Datum::Text(text, _) if text.len() <= *budget => {
            *budget -= text.len();
            Some(text.clone())
        }
        Datum::Parts(parts, _) => {
            let mut text = String::new();
            for part in parts {
                text.push_str(&static_text(part, budget, depth + 1)?);
            }
            Some(text)
        }
        _ => None,
    }
}

pub(crate) fn owned_path(path: &str, parent: Option<&str>) -> Option<String> {
    if path.starts_with('/') || path.contains(['\\', ':']) || path.chars().any(char::is_control) {
        return None;
    }
    let mut parts: Vec<_> = parent
        .map(|parent| parent.split('/').collect())
        .unwrap_or_default();
    if parent.is_some() {
        parts.pop();
    }
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn indexed_target(snapshot: &Snapshot, path: &str) -> Option<String> {
    let mut current = owned_path(path, None)?;
    let mut visited = BTreeSet::new();
    loop {
        if !visited.insert(current.clone()) {
            return None;
        }
        let entry = snapshot.entries.get(&current)?;
        if entry.mode != 0o120000 {
            return Some(current);
        }
        current = owned_path(std::str::from_utf8(&entry.bytes).ok()?, Some(&current))?;
    }
}

fn root_source(snapshot: &Snapshot, path: &str, language: &str) -> Option<Source> {
    let entry = snapshot.entries.get(path)?;
    let text = std::str::from_utf8(&entry.bytes).ok()?;
    Some(Source {
        path: path.into(),
        language: language.into(),
        text: Arc::from(text),
        physical_start: 1,
        physical_end: text.lines().count().max(1),
        body: None,
        depth: 0,
    })
}

fn program(source: &Source) -> Fact {
    Fact {
        id: source
            .body
            .clone()
            .unwrap_or_else(|| format!("program:{}", source.path)),
        path: source.path.clone(),
        language: source.language.clone(),
        form: if source.body.is_some() {
            "embedded-program"
        } else {
            "program"
        }
        .into(),
        start: 1,
        end: source.physical_end,
        parent: None,
    }
}

pub fn language(path: &str, text: &str) -> Option<&'static str> {
    source_kind::language(path, text)
}

fn package_sources(
    snapshot: &Snapshot,
    roots: &mut BTreeMap<String, Source>,
    result: &mut Discovery,
) {
    let Some(entry) = snapshot.entries.get("package.json") else {
        return;
    };
    if entry.mode == 0o120000 {
        issue(result, "unresolved-source-registry", "package.json");
        return;
    }
    let Ok(package) = serde_json::from_slice::<serde_json::Value>(&entry.bytes) else {
        issue(result, "invalid-source-registry", "package.json");
        return;
    };
    let Some(scripts) = package.get("scripts") else {
        return;
    };
    let Some(scripts) = scripts.as_object() else {
        issue(result, "invalid-source-registry", "package.json");
        return;
    };
    for (name, value) in scripts {
        let Some(text) = value.as_str() else {
            issue(result, "invalid-source-registry", "package.json");
            continue;
        };
        if name.chars().any(char::is_control) {
            issue(result, "invalid-source-registry", "package.json");
            continue;
        }
        let escaped = name.replace('~', "~0").replace('/', "~1");
        let id = format!("package-script:package.json#/scripts/{escaped}");
        roots.insert(
            id.clone(),
            Source {
                path: "package.json".into(),
                language: "sh".into(),
                text: Arc::from(text),
                physical_start: 1,
                physical_end: std::str::from_utf8(&entry.bytes)
                    .map(|text| text.lines().count().max(1))
                    .unwrap_or(1),
                body: Some(id),
                depth: 0,
            },
        );
    }
}

fn package_entries(
    snapshot: &Snapshot,
    roots: &mut BTreeMap<String, Source>,
    result: &mut Discovery,
) {
    let Some(entry) = snapshot.entries.get("package.json") else {
        return;
    };
    if entry.mode == 0o120000 {
        return;
    }
    let entries = match crate::package_entries::inspect(&entry.bytes) {
        Ok(entries) => entries,
        Err(error) => {
            result.diagnostics.push(error);
            return;
        }
    };
    let end = std::str::from_utf8(&entry.bytes)
        .map(|text| text.lines().count().max(1))
        .unwrap_or(1);
    for entry in entries {
        result.facts.insert(
            entry.id.clone(),
            Fact {
                id: entry.id.clone(),
                path: "package.json".into(),
                language: "json".into(),
                form: "registry".into(),
                start: 1,
                end,
                parent: None,
            },
        );
        if let Some(target) = indexed_target(snapshot, &entry.target) {
            let mut promoted = BTreeMap::new();
            promote(snapshot, result, &mut promoted, &target, None);
            result
                .package_programs
                .insert(entry.id.clone(), format!("program:{target}"));
            roots.extend(promoted);
        } else if snapshot.entries.contains_key(&entry.target) {
            issue(result, "unresolved-package-bin", "package.json");
        }
        result.package_entries.push(entry);
    }
}

fn metadata_sources(
    snapshot: &Snapshot,
    roots: &mut BTreeMap<String, Source>,
    result: &mut Discovery,
) {
    for (path, entry) in &snapshot.entries {
        let workflow = path.starts_with(".github/workflows/")
            && (path.ends_with(".yml") || path.ends_with(".yaml"));
        if !workflow && path != "hooks/manifest.yaml" {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&entry.bytes) else {
            issue(result, "invalid-source-registry", path);
            continue;
        };
        let evidence = if workflow {
            crate::yaml_sources::workflow(path, text)
        } else {
            crate::yaml_sources::hook_manifest(path, text)
        };
        result.diagnostics.extend(evidence.diagnostics);
        for script in evidence.scripts {
            roots.insert(
                script.id.clone(),
                Source {
                    path: path.clone(),
                    language: script.language,
                    text: Arc::from(script.text),
                    physical_start: 1,
                    physical_end: text.lines().count().max(1),
                    body: Some(script.id),
                    depth: 0,
                },
            );
        }
        for (id, target) in evidence.targets {
            result.facts.insert(
                id.clone(),
                Fact {
                    id: id.clone(),
                    path: path.clone(),
                    language: "yaml".into(),
                    form: "registry".into(),
                    start: 1,
                    end: text.lines().count().max(1),
                    parent: None,
                },
            );
            let mut promoted = BTreeMap::new();
            promote(snapshot, result, &mut promoted, &target, None);
            if let Some(target) = indexed_target(snapshot, &target) {
                result
                    .required_targets
                    .push((id, format!("program:{target}"), "invokes".into()));
            }
            roots.extend(promoted);
        }
    }
}

fn registry_sources(
    snapshot: &Snapshot,
    roots: &mut BTreeMap<String, Source>,
    result: &mut Discovery,
) -> BTreeSet<Site> {
    let mut modules = BTreeMap::new();
    for path in ["src/sync/helper-scripts.ts", "tsup.config.ts"] {
        if let Some(source) = roots.get(path) {
            if source.text.len() <= SOURCE_BYTES {
                if let Ok(host) = syntax::parse_host(path, &source.text, true) {
                    modules.insert(path.into(), host);
                }
            }
        }
    }
    let indexed = snapshot.entries.keys().cloned().collect();
    let mut trusted_calls = BTreeSet::new();
    let mut promoted = BTreeMap::new();
    for (source, edge_kind) in [
        ("src/sync/helper-scripts.ts", "copies"),
        ("tsup.config.ts", "bundles"),
    ] {
        if !snapshot.entries.contains_key(source) {
            continue;
        }
        let evidence = if edge_kind == "copies" {
            crate::source_registries::helper_map(&modules, &indexed, source)
        } else {
            crate::source_registries::bundler_entries(&modules, &indexed, source)
        };
        result.diagnostics.extend(evidence.diagnostics);
        trusted_calls.extend(evidence.constructor_sites);
        for row in evidence.sources {
            let fallback = if edge_kind == "copies" {
                source_kind::language(&row.name, "")
            } else {
                None
            };
            promote(snapshot, result, &mut promoted, &row.path, fallback);
            if let Some(target) = indexed_target(snapshot, &row.path) {
                result.registry_edges.push((
                    format!("program:{source}"),
                    format!("program:{target}"),
                    edge_kind.into(),
                ));
            }
        }
    }
    roots.extend(promoted);
    trusted_calls
}

fn initial_roots_exceed_limit(result: &mut Discovery, count: usize, limit: usize) -> bool {
    if count <= limit {
        return false;
    }
    result
        .diagnostics
        .push(Diagnostic::new("source-worklist-limit", None));
    true
}

fn record_initial_roots(result: &mut Discovery, roots: &BTreeMap<String, Source>) {
    for source in roots.values() {
        let fact = program(source);
        if source.body.is_none() {
            result.programs.insert(source.path.clone(), fact.id.clone());
        }
        result.facts.insert(fact.id.clone(), fact);
    }
}

pub fn discover(snapshot: &Snapshot) -> Discovery {
    discover_with_initial_limit(snapshot, SOURCE_COUNT)
}

fn discover_with_initial_limit(snapshot: &Snapshot, initial_limit: usize) -> Discovery {
    #[cfg(test)]
    {
        discover_inner(snapshot, initial_limit, None)
    }
    #[cfg(not(test))]
    {
        discover_inner(snapshot, initial_limit)
    }
}

#[cfg(test)]
pub(crate) fn discover_observed(
    snapshot: &Snapshot,
    observer: &mut DiscoveryObserver,
) -> Discovery {
    *observer = DiscoveryObserver::default();
    discover_inner(snapshot, SOURCE_COUNT, Some(observer))
}

fn discover_inner(
    snapshot: &Snapshot,
    initial_limit: usize,
    #[cfg(test)] mut observer: Option<&mut DiscoveryObserver>,
) -> Discovery {
    let mut result = Discovery::default();
    match crate::upstream_ownership::inspect(snapshot) {
        Ok(evidence) => {
            for fact in &evidence.facts {
                result.facts.insert(fact.id.clone(), fact.clone());
            }
            result.registry_edges.extend(evidence.edges.clone());
            result.upstream = evidence;
        }
        Err(error) => result.diagnostics.push(error),
    }
    match crate::reviewed_sources::inspect(snapshot) {
        Ok(evidence) => result.reviewed_sources = evidence,
        Err(error) => result.diagnostics.push(error),
    }
    match crate::reviewed_producers::inspect(snapshot) {
        Ok(evidence) => result.reviewed_producers = evidence,
        Err(error) => result.diagnostics.push(error),
    }
    let mut roots = BTreeMap::new();
    let mut unknown_executables = BTreeSet::new();
    #[cfg(test)]
    let mut invalid_rust_entry = false;
    for (path, entry) in &snapshot.entries {
        if entry.mode == 0o120000 {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&entry.bytes) else {
            #[cfg(test)]
            if observer.is_some() && path.ends_with(".rs") {
                invalid_rust_entry = true;
            }
            if entry.mode == 0o100755 {
                issue(&mut result, "unsupported-executable", path);
            }
            continue;
        };
        if let Some(language) = language(path, text) {
            roots.insert(
                path.clone(),
                root_source(snapshot, path, language).expect("same indexed UTF-8 source"),
            );
        } else if entry.mode == 0o100755 {
            unknown_executables.insert(path.clone());
        }
    }
    package_sources(snapshot, &mut roots, &mut result);
    package_entries(snapshot, &mut roots, &mut result);
    metadata_sources(snapshot, &mut roots, &mut result);
    let registry_calls = registry_sources(snapshot, &mut roots, &mut result);
    let initial_over_limit = roots.len() > initial_limit;
    // A new caller-promoted file restarts source closure. This prevents stale
    // unresolved module facts or changed body ordinals from surviving a round.
    for _ in 0..=snapshot.entries.len() {
        #[cfg(test)]
        let mut round_observer = DiscoveryObserver::default();
        #[cfg(test)]
        {
            round_observer.rust_invalid = invalid_rust_entry;
        }
        let mut round = Discovery {
            upstream: result.upstream.clone(),
            facts: result.facts.clone(),
            required_targets: result.required_targets.clone(),
            registry_edges: result.registry_edges.clone(),
            package_entries: result.package_entries.clone(),
            package_programs: result.package_programs.clone(),
            reviewed_sources: result.reviewed_sources.clone(),
            reviewed_producers: result.reviewed_producers.clone(),
            ..Discovery::default()
        };
        record_initial_roots(&mut round, &roots);
        if initial_over_limit && initial_roots_exceed_limit(&mut round, roots.len(), initial_limit)
        {
            result.diagnostics.extend(round.diagnostics);
            round.diagnostics = result.diagnostics;
            return round;
        }
        let mut sources = roots.clone();
        let mut queue: VecDeque<_> = roots.keys().cloned().collect();
        let mut parsed = BTreeSet::new();
        let mut modules = BTreeMap::new();
        let mut decoded = 0;
        let mut promoted = BTreeMap::new();
        while !queue.is_empty() {
            let mut shell_results = Vec::new();
            while let Some(key) = queue.pop_front() {
                if !parsed.insert(key.clone()) {
                    continue;
                }
                let source = sources[&key].clone();
                if source.text.len() > SOURCE_BYTES {
                    #[cfg(test)]
                    if observer.is_some() && source.language == "rust" {
                        round_observer.rust_invalid = true;
                        round_observer.rust_records.clear();
                    }
                    issue(&mut round, "parser-source-limit", &source.path);
                    continue;
                }
                match source.language.as_str() {
                    "typescript" | "javascript" => match syntax::parse_host(
                        &key,
                        &source.text,
                        source.language == "typescript",
                    ) {
                        Ok(host) => {
                            modules.insert(key, host);
                        }
                        Err(mut error) => {
                            error.path = Some(source.path.clone());
                            round.diagnostics.push(error);
                        }
                    },
                    "sh" | "bash" => match shell_ast::parse_shell(&key, &source.text) {
                        Ok(shell) => {
                            for target in shell_calls::owned_targets(&shell) {
                                if target.starts_with("./")
                                    || snapshot.entries.contains_key(&target)
                                {
                                    promote(snapshot, &mut round, &mut promoted, &target, None);
                                }
                            }
                            shell_results.push((
                                source.clone(),
                                native_facts::from_host(shell_calls::events(&key, &shell)),
                            ));
                        }
                        Err(mut error) => {
                            error.path = Some(source.path.clone());
                            round.diagnostics.push(error);
                        }
                    },
                    _ => {
                        #[cfg(test)]
                        if observer.is_some() && source.language == "rust" {
                            round_observer.observe_rust(
                                &source.path,
                                &source.text,
                                source.body.is_some(),
                            );
                        }
                        let reviewed = source.body.is_none()
                            && round.reviewed_sources.iter().any(|record| {
                                record.path == source.path && record.language == source.language
                            });
                        if !reviewed {
                            issue(
                                &mut round,
                                "reviewed-source-registry-required",
                                &source.path,
                            );
                        }
                    }
                }
            }
            let mut graph = host_graph::analyze_with_registry_calls(&modules, &registry_calls);
            #[cfg(test)]
            if observer.is_some() {
                round_observer.begin_pass();
                for event in &graph.events {
                    if round_observer.overflowed() {
                        break;
                    }
                    let mut site = event.site.clone();
                    project_site(&sources, &mut site);
                    round_observer.record(HostObservation {
                        site,
                        operation: event.operation.clone(),
                        api: event.api.clone(),
                        uncertain: event.arguments.iter().any(observations::has_unknown),
                    });
                }
            }
            for producer in &round.reviewed_producers {
                if modules.contains_key(&producer.event.site.path) {
                    graph.diagnostics.push(Diagnostic::new(
                        "reviewed-native-contradiction",
                        Some(&producer.event.site.path),
                    ));
                } else {
                    graph.events.insert(producer.event.clone());
                }
            }
            let host = native_facts::from_host(graph);
            let mut by_source: BTreeMap<String, Boundaries> = BTreeMap::new();
            for (id, boundary) in host.boundaries {
                by_source
                    .entry(boundary.site.path.clone())
                    .or_default()
                    .boundaries
                    .insert(id, boundary);
            }
            for error in host.diagnostics {
                let path = error
                    .path
                    .as_ref()
                    .and_then(|path| sources.get(path))
                    .map(|source| source.path.clone());
                round.diagnostics.push(Diagnostic {
                    code: error.code,
                    path,
                    #[cfg(unix)]
                    transport: error.transport,
                });
            }
            for (key, boundaries) in by_source {
                shell_results.push((sources[&key].clone(), boundaries));
            }
            for (source, boundaries) in shell_results {
                absorb(
                    snapshot,
                    &source,
                    boundaries,
                    &mut round,
                    &mut sources,
                    &mut queue,
                    &mut promoted,
                    &mut decoded,
                );
            }
            if sources.len() > SOURCE_COUNT {
                round
                    .diagnostics
                    .push(Diagnostic::new("source-worklist-limit", None));
                break;
            }
        }
        let new: Vec<_> = promoted
            .into_iter()
            .filter(|(path, _)| !roots.contains_key(path))
            .collect();
        if new.is_empty() {
            #[cfg(test)]
            if let Some(target) = observer.as_deref_mut() {
                round_observer.finish();
                *target = round_observer;
            }
            for (path, entry) in &snapshot.entries {
                if entry.mode == 0o120000 {
                    if let Some(id) = indexed_target(snapshot, path)
                        .and_then(|target| round.programs.get(&target).cloned())
                    {
                        round.programs.insert(path.clone(), id);
                    }
                }
            }
            for path in unknown_executables {
                if !round.programs.contains_key(&path) {
                    issue(&mut round, "unsupported-executable", &path);
                }
            }
            result.diagnostics.extend(round.diagnostics);
            round.diagnostics = result.diagnostics;
            return round;
        }
        for (path, source) in new {
            roots.insert(path, source);
        }
    }
    issue(&mut result, "source-worklist-limit", "");
    result
}

fn promote(
    snapshot: &Snapshot,
    result: &mut Discovery,
    promoted: &mut BTreeMap<String, Source>,
    path: &str,
    language: Option<&str>,
) {
    let Some(target) = indexed_target(snapshot, path) else {
        let normalized = owned_path(path, None);
        if let Some(path) = normalized.as_deref() {
            if snapshot.ignored.iter().any(|entry| entry.path == path) {
                issue(result, "ignored-execution-target", path);
                issue(result, "untracked-file", path);
            } else if snapshot.untracked.iter().any(|entry| entry == path) {
                issue(result, "untracked-file", path);
            }
        }
        issue(result, "unresolved-execution", path);
        return;
    };
    let entry = &snapshot.entries[&target];
    let Ok(text) = std::str::from_utf8(&entry.bytes) else {
        issue(result, "unsupported-executable", &target);
        return;
    };
    let Some(language) = source_kind::language(&target, text).or(language) else {
        issue(result, "unsupported-executable", &target);
        return;
    };
    if let Some(source) = root_source(snapshot, &target, language) {
        promoted.insert(target, source);
    }
}

fn absorb(
    snapshot: &Snapshot,
    source: &Source,
    boundaries: Boundaries,
    result: &mut Discovery,
    sources: &mut BTreeMap<String, Source>,
    queue: &mut VecDeque<String>,
    promoted: &mut BTreeMap<String, Source>,
    decoded: &mut usize,
) {
    for mut error in boundaries.diagnostics {
        error.path = Some(source.path.clone());
        result.diagnostics.push(error);
    }
    for (_, mut boundary) in boundaries.boundaries {
        let (start, end) = physical_lines(source, &boundary.site);
        project_site(sources, &mut boundary.site);
        for receipt in &mut boundary.receipts {
            project_receipt(sources, receipt);
        }
        boundary.bodies = boundary
            .bodies
            .into_iter()
            .map(|mut body| {
                project_value(sources, &mut body.value);
                body
            })
            .collect();
        boundary.targets = boundary
            .targets
            .into_iter()
            .map(|mut target| {
                if let RequiredTarget::Output(value) = &mut target {
                    project_value(sources, value);
                }
                target
            })
            .collect();
        result.facts.insert(
            boundary.id.clone(),
            Fact {
                id: boundary.id.clone(),
                path: source.path.clone(),
                language: source.language.clone(),
                form: "call-site".into(),
                start,
                end,
                parent: source
                    .body
                    .clone()
                    .or_else(|| Some(format!("program:{}", source.path))),
            },
        );
        result.required_targets.push((
            source
                .body
                .clone()
                .unwrap_or_else(|| format!("program:{}", source.path)),
            boundary.id.clone(),
            "invokes".into(),
        ));
        let interpreter = boundary.receipts.iter().find_map(|receipt| {
            receipt
                .arguments
                .first()
                .and_then(observations::literal)
                .and_then(native_facts::interpreter)
        });
        for target in &boundary.targets {
            if let RequiredTarget::Owned(path) = target {
                promote(snapshot, result, promoted, path, interpreter);
            }
        }
        for (ordinal, body) in boundary.bodies.iter().enumerate() {
            let id = native_validation::body_id(&boundary, ordinal);
            result.facts.insert(
                id.clone(),
                Fact {
                    id: id.clone(),
                    path: source.path.clone(),
                    language: body.language.clone(),
                    form: body.form.clone(),
                    start,
                    end,
                    parent: Some(boundary.id.clone()),
                },
            );
            let mut budget = SOURCE_BYTES;
            let Some(text) = static_text(&body.value, &mut budget, 0) else {
                issue(result, "reviewed-body-registry-required", &source.path);
                continue;
            };
            if source.depth >= BODY_DEPTH || *decoded + text.len() > DECODED_BYTES {
                issue(result, "source-worklist-limit", &source.path);
                continue;
            }
            if !sources.contains_key(&id) {
                *decoded += text.len();
                sources.insert(
                    id.clone(),
                    Source {
                        path: source.path.clone(),
                        language: body.language.clone(),
                        text: Arc::from(text),
                        physical_start: start,
                        physical_end: end,
                        body: Some(id.clone()),
                        depth: source.depth + 1,
                    },
                );
                queue.push_back(id);
            }
        }
        result.boundaries.insert(boundary.id.clone(), boundary);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(files: &[(&str, &str)]) -> Snapshot {
        Snapshot {
            entries: files
                .iter()
                .map(|(path, text)| {
                    (
                        (*path).into(),
                        crate::snapshot::Entry {
                            path: (*path).into(),
                            mode: 0o100644,
                            blob: "0000000000000000000000000000000000000000".into(),
                            bytes: text.as_bytes().to_vec(),
                        },
                    )
                })
                .collect(),
            untracked: Vec::new(),
            ignored: Vec::new(),
        }
    }

    fn report(snapshot: &Snapshot, discovery: Discovery) -> serde_json::Value {
        let manifest: crate::model::Manifest = serde_json::from_value(serde_json::json!({
            "schema_version": 1,
            "owner": "fixture",
            "reviewed_revision": "0000000000000000000000000000000000000000",
            "slices": ["rust-fixture"],
            "files": [], "components": [], "edges": []
        }))
        .unwrap();
        serde_json::to_value(crate::validation::validate(
            snapshot,
            "rust/inventory.json",
            &manifest,
            discovery,
        ))
        .unwrap()
    }

    #[test]
    fn initial_limit_preserves_empty_below_and_exact_reports() {
        for files in [
            vec![],
            vec![("one.rs", "// one\n")],
            vec![("one.rs", "// one\n"), ("two.rs", "// two\n")],
        ] {
            let input = snapshot(&files);
            assert_eq!(
                report(&input, discover_with_initial_limit(&input, 2)),
                report(&input, discover(&input))
            );
        }
    }

    #[test]
    fn initial_limit_refuses_one_over_with_root_facts() {
        let input = snapshot(&[
            ("one.rs", "// one\n"),
            ("two.rs", "// two\n"),
            ("three.rs", "// three\n"),
        ]);
        let found = discover_with_initial_limit(&input, 2);
        let old = discover(&input);
        assert_eq!(found.programs, old.programs);
        for (id, fact) in &found.facts {
            let expected = &old.facts[id];
            assert_eq!(
                (
                    &fact.path,
                    &fact.language,
                    &fact.form,
                    fact.start,
                    fact.end,
                    &fact.parent
                ),
                (
                    &expected.path,
                    &expected.language,
                    &expected.form,
                    expected.start,
                    expected.end,
                    &expected.parent
                )
            );
        }
        assert_eq!(found.facts.len(), 3);
        assert!(found.boundaries.is_empty());
        assert!(found
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
        let checked = report(&input, found);
        assert_eq!(checked["classified_components"], 0);
        assert!(checked["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["code"] == "source-worklist-limit"));
    }

    #[test]
    fn initial_limit_skips_observable_closure_parsing() {
        let input = snapshot(&[
            ("script.sh", "#!/bin/sh\npython3 -c 'print(1)'\n"),
            ("one.rs", "// one\n"),
            ("two.rs", "// two\n"),
        ]);
        let admitted = discover(&input);
        assert!(!admitted.boundaries.is_empty());
        let limited = discover_with_initial_limit(&input, 2);
        assert_eq!(limited.programs, admitted.programs);
        assert_eq!(limited.programs.len(), 3);
        assert!(limited.boundaries.is_empty());
        assert!(limited
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
    }

    #[test]
    fn initial_limit_preserves_prior_synthetic_evidence() {
        let mut found = Discovery::default();
        let prior = Fact {
            id: "upstream:fixture".into(),
            path: "upstream/fixture".into(),
            language: "rust".into(),
            form: "program".into(),
            start: 1,
            end: 1,
            parent: None,
        };
        found.facts.insert(prior.id.clone(), prior.clone());
        found.upstream.facts.push(prior);
        found
            .registry_edges
            .push(("from".into(), "to".into(), "imports".into()));
        found.package_entries.push(crate::package_entries::Entry {
            id: "package:fixture".into(),
            target: "tool".into(),
        });
        found
            .diagnostics
            .push(Diagnostic::new("prior-diagnostic", None));
        assert!(initial_roots_exceed_limit(&mut found, 3, 2));
        assert!(found.facts.contains_key("upstream:fixture"));
        assert_eq!(found.upstream.facts.len(), 1);
        assert_eq!(found.registry_edges.len(), 1);
        assert_eq!(found.package_entries.len(), 1);
        assert_eq!(
            found
                .diagnostics
                .iter()
                .map(|d| d.code.as_str())
                .collect::<Vec<_>>(),
            ["prior-diagnostic", "source-worklist-limit"]
        );
    }

    #[test]
    fn initial_limit_root_recording_preserves_collision_precedence() {
        let source = |path: &str, body: Option<&str>| Source {
            path: path.into(),
            language: "sh".into(),
            text: Arc::from(":"),
            physical_start: 1,
            physical_end: 1,
            body: body.map(str::to_owned),
            depth: 0,
        };
        let roots = BTreeMap::from([
            ("a".into(), source("a", None)),
            ("b".into(), source("b", Some("shared"))),
            ("c".into(), source("c", Some("shared"))),
        ]);
        let mut found = Discovery::default();
        found.facts.insert(
            "program:a".into(),
            Fact {
                id: "program:a".into(),
                path: "prior".into(),
                language: "rust".into(),
                form: "program".into(),
                start: 1,
                end: 1,
                parent: None,
            },
        );
        record_initial_roots(&mut found, &roots);
        assert_eq!(
            found.programs.get("a").map(String::as_str),
            Some("program:a")
        );
        assert_eq!(found.facts["program:a"].path, "a");
        assert_eq!(found.facts["shared"].path, "c");
        assert_eq!(found.facts["shared"].form, "embedded-program");
    }

    #[test]
    fn initial_limit_keeps_existing_diagnostic() {
        let mut input = snapshot(&[
            ("one.rs", "// one\n"),
            ("two.rs", "// two\n"),
            ("three.rs", "// three\n"),
            ("invalid", "x"),
        ]);
        let invalid = input.entries.get_mut("invalid").unwrap();
        invalid.mode = 0o100755;
        invalid.bytes = vec![0xff];
        let found = discover_with_initial_limit(&input, 2);
        assert!(found
            .diagnostics
            .iter()
            .any(|d| d.code == "unsupported-executable"));
        assert!(found
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
    }

    #[test]
    fn initial_limit_counts_package_script_roots() {
        let input = snapshot(&[
            ("one.rs", "// one\n"),
            ("two.rs", "// two\n"),
            ("package.json", r#"{"scripts":{"check":":"}}"#),
        ]);
        let found = discover_with_initial_limit(&input, 2);
        assert!(found
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
        assert_eq!(found.programs.len(), 2);
        assert!(found
            .facts
            .contains_key("package-script:package.json#/scripts/check"));
    }

    #[test]
    fn initial_limit_counts_registry_promoted_root() {
        let registry = "export const HELPER_SCRIPT_SOURCES={'guard.sh':'hooks/helpers.rules'};\n";
        let input = snapshot(&[
            ("src/sync/helper-scripts.ts", registry),
            ("hooks/helpers.rules", "exit 0\n"),
        ]);
        let found = discover_with_initial_limit(&input, 1);
        assert!(found
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
        let without_row = snapshot(&[
            (
                "src/sync/helper-scripts.ts",
                "export const HELPER_SCRIPT_SOURCES={};\n",
            ),
            ("hooks/helpers.rules", "exit 0\n"),
        ]);
        let admitted = discover_with_initial_limit(&without_row, 1);
        assert!(!admitted
            .diagnostics
            .iter()
            .any(|d| d.code == "source-worklist-limit"));
        assert_eq!(
            report(&without_row, admitted),
            report(&without_row, discover(&without_row))
        );
    }

    #[test]
    fn initial_limit_does_not_count_non_source_data() {
        let input = snapshot(&[
            ("one.rs", "// one\n"),
            ("two.rs", "// two\n"),
            ("notes.data", "text\n"),
        ]);
        assert_eq!(
            report(&input, discover_with_initial_limit(&input, 2)),
            report(&input, discover(&input))
        );
    }

    #[test]
    fn initial_limit_does_not_recheck_later_promoted_roots() {
        let input = snapshot(&[
            (
                "scripts/start.sh",
                "#!/bin/bash\nsource hooks/helpers.rules\n",
            ),
            ("hooks/helpers.rules", "python3 -c 'print(1)'\n"),
        ]);
        let limited = discover_with_initial_limit(&input, 1);
        assert!(limited.programs.contains_key("hooks/helpers.rules"));
        assert_eq!(report(&input, limited), report(&input, discover(&input)));
    }

    #[test]
    fn promoted_source_is_scanned_for_its_inline_python_child() {
        let result = discover(&snapshot(&[
            (
                "scripts/start.sh",
                "#!/bin/bash\nsource hooks/helpers.rules\n",
            ),
            ("hooks/helpers.rules", "python3 -c 'print(1)'\n"),
        ]));
        assert_eq!(
            result
                .programs
                .get("hooks/helpers.rules")
                .map(String::as_str),
            Some("program:hooks/helpers.rules")
        );
        assert!(result
            .facts
            .values()
            .any(|fact| fact.path == "hooks/helpers.rules"
                && fact.language == "python"
                && fact.form == "embedded-program"));
    }

    #[test]
    fn nested_generated_calls_keep_their_body_identity_and_physical_source() {
        let source="import {writeFileSync} from 'node:fs';\nwriteFileSync('tool', `#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';\nspawnSync('node',['-e','console.log(1)']);\n`);\n";
        let result = discover(&snapshot(&[("src/create.ts", source)]));
        let nested: Vec<_> = result
            .boundaries
            .values()
            .filter(|boundary| boundary.site.body.is_some())
            .collect();
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].site.path, "src/create.ts");
        assert!(nested[0]
            .site
            .body
            .as_ref()
            .unwrap()
            .starts_with("body:call:src/create.ts:"));
        assert!(result
            .facts
            .values()
            .any(|fact| fact.form == "embedded-program" && fact.language == "javascript"));
    }

    #[test]
    fn known_interpreter_with_missing_target_remains_unresolved() {
        let result = discover(&snapshot(&[(
            "scripts/start.sh",
            "#!/bin/bash\nnode missing.opaque\n",
        )]));
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }

    #[test]
    fn package_script_promotes_a_nonexecutable_extensionless_source() {
        let result = discover(&snapshot(&[
            (
                "package.json",
                r#"{"scripts":{"check":"bash tools/check"}}"#,
            ),
            ("tools/check", "exit 0\n"),
        ]));
        assert!(result
            .facts
            .contains_key("package-script:package.json#/scripts/check"));
        assert_eq!(
            result.programs.get("tools/check").map(String::as_str),
            Some("program:tools/check")
        );
        assert!(result
            .boundaries
            .values()
            .any(|boundary| boundary.site.path == "package.json"
                && boundary.site.body.as_deref()
                    == Some("package-script:package.json#/scripts/check")));
    }
}
