use crate::{
    discovery::{Discovery, Fact},
    host_graph::{Event, Site},
    model::{CheckReport, Diagnostic},
    native_facts::{Body, Boundary, RequiredTarget},
    observations::CallReceipt,
    package_entries,
    reviewed_producers,
    reviewed_sources::{DataEvidence, DataKind, ProgramEvidence},
    snapshot::{Entry, IgnoredEntry, Snapshot},
    upstream_consumers::Consumer,
    upstream_ownership::{Evidence, Ownership},
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

fn serialized(value: &impl Serialize) -> Value {
    serde_json::to_value(value).expect("legacy projection serialization")
}

fn site(value: &Site) -> Value {
    let Site { path, start, end, body } = value;
    json!({ "path": path, "start": start, "end": end, "body": body })
}

fn fact(value: &Fact) -> Value {
    let Fact { id, path, language, form, start, end, parent } = value;
    json!({ "id": id, "path": path, "language": language, "form": form,
        "start": start, "end": end, "parent": parent })
}

fn diagnostic(value: &Diagnostic) -> Value {
    let Diagnostic {
        code,
        path,
        #[cfg(unix)]
        transport,
    } = value;
    #[cfg(unix)]
    let transport = serialized(transport);
    #[cfg(not(unix))]
    let transport = Value::Null;
    json!({ "code": code, "path": path, "transport": transport })
}

fn receipt(value: &CallReceipt) -> Value {
    let CallReceipt { site: source, operation, callee, arguments } = value;
    json!({ "site": site(source), "operation": serialized(operation),
        "callee": callee, "arguments": serialized(arguments) })
}

fn event(value: &Event) -> Value {
    let Event { site: source, operation, api, arguments, owner } = value;
    json!({ "site": site(source), "operation": serialized(operation), "api": api,
        "arguments": serialized(arguments), "owner": owner })
}

fn body(value: &Body) -> Value {
    let Body { form, language, value } = value;
    json!({ "form": form, "language": language, "value": serialized(value) })
}

fn target(value: &RequiredTarget) -> Value {
    match value {
        RequiredTarget::Owned(value) => json!({ "kind": "Owned", "value": value }),
        RequiredTarget::Inline(value) => json!({ "kind": "Inline", "value": value }),
        RequiredTarget::External(value) => json!({ "kind": "External", "value": value }),
        RequiredTarget::Input(value) => json!({ "kind": "Input", "value": value }),
        RequiredTarget::Output(value) => json!({ "kind": "Output", "value": serialized(value) }),
    }
}

fn boundary(value: &Boundary) -> Value {
    let Boundary { id, site: source, form, bodies, receipts, targets } = value;
    json!({ "id": id, "site": site(source), "form": form,
        "bodies": bodies.iter().map(body).collect::<Vec<_>>(),
        "receipts": receipts.iter().map(receipt).collect::<Vec<_>>(),
        "targets": targets.iter().map(target).collect::<Vec<_>>() })
}

fn data_kind(value: &DataKind) -> &'static str {
    match value {
        DataKind::DataFileRead => "DataFileRead",
        DataKind::ParseData => "ParseData",
        DataKind::DataOutput => "DataOutput",
    }
}

fn data_evidence(value: &DataEvidence) -> Value {
    let DataEvidence { id, source, callee, spelling, identity, kind, inputs, outputs, consumer } = value;
    json!({ "id": id, "source": site(source), "callee": site(callee),
        "spelling": spelling, "identity": identity, "kind": data_kind(kind),
        "inputs": inputs, "outputs": outputs, "consumer": consumer })
}

fn program_evidence(value: &ProgramEvidence) -> Value {
    let ProgramEvidence { path, git_blob, language, owner, migration_slice, program, entry, data_regions } = value;
    json!({ "path": path, "git_blob": git_blob, "language": language,
        "owner": owner, "migration_slice": migration_slice, "program": site(program),
        "entry": site(entry), "data_regions": data_regions.iter().map(data_evidence).collect::<Vec<_>>() })
}

fn producer_evidence(value: &reviewed_producers::Evidence) -> Value {
    let reviewed_producers::Evidence { event: source, owner, migration_slice, environment_inputs, executable_mode } = value;
    json!({ "event": event(source), "owner": owner, "migration_slice": migration_slice,
        "environment_inputs": environment_inputs, "executable_mode": executable_mode })
}

fn package_entry(value: &package_entries::Entry) -> Value {
    let package_entries::Entry { id, target } = value;
    json!({ "id": id, "target": target })
}

fn ownership(value: &Ownership) -> &'static str {
    match value {
        Ownership::Upstream => "Upstream",
        Ownership::MixedCode => "MixedCode",
        Ownership::OwnedCode => "OwnedCode",
        Ownership::OwnedData => "OwnedData",
    }
}

fn consumer(value: &Consumer) -> Value {
    let Consumer { dependency, call, owned_include, conditions, library, build_script, owned_source } = value;
    json!({ "dependency": site(dependency), "call": site(call), "owned_include": site(owned_include),
        "conditions": conditions, "library": library, "build_script": build_script,
        "owned_source": owned_source })
}

fn upstream(value: &Evidence) -> Value {
    let Evidence { files, consumer: source, facts, edges } = value;
    json!({ "files": files.iter().map(|(path, value)| (path.clone(), ownership(value))).collect::<BTreeMap<_, _>>(),
        "consumer": source.as_ref().map(consumer).unwrap_or(Value::Null),
        "facts": facts.iter().map(fact).collect::<Vec<_>>(), "edges": edges })
}

pub(super) fn discovery(value: &Discovery) -> Value {
    let Discovery {
        upstream: evidence,
        facts,
        diagnostics,
        boundaries,
        programs,
        required_targets,
        registry_edges,
        package_entries,
        package_programs,
        reviewed_sources,
        reviewed_producers,
    } = value;
    json!({ "upstream": upstream(evidence),
        "facts": facts.iter().map(|(id, value)| (id.clone(), fact(value))).collect::<BTreeMap<_, _>>(),
        "diagnostics": diagnostics.iter().map(diagnostic).collect::<Vec<_>>(),
        "boundaries": boundaries.iter().map(|(id, value)| (id.clone(), boundary(value))).collect::<BTreeMap<_, _>>(),
        "programs": programs, "required_targets": required_targets, "registry_edges": registry_edges,
        "package_entries": package_entries.iter().map(package_entry).collect::<Vec<_>>(),
        "package_programs": package_programs,
        "reviewed_sources": reviewed_sources.iter().map(program_evidence).collect::<Vec<_>>(),
        "reviewed_producers": reviewed_producers.iter().map(producer_evidence).collect::<Vec<_>>() })
}

pub(super) fn report(value: &CheckReport) -> Value {
    let CheckReport { schema_version, checked_files, classified_components, checked_edges, unresolved_frozen, diagnostics } = value;
    json!({ "schema_version": schema_version, "checked_files": checked_files,
        "classified_components": classified_components, "checked_edges": checked_edges,
        "unresolved_frozen": unresolved_frozen,
        "diagnostics": diagnostics.iter().map(diagnostic).collect::<Vec<_>>() })
}

pub(super) fn input_metadata(value: &Snapshot) -> Value {
    let Snapshot { entries, untracked, ignored } = value;
    let entries = entries.iter().map(|(key, value)| {
        let Entry { path, mode, blob, bytes } = value;
        (key.clone(), json!({ "path": path, "mode": mode, "blob": blob,
            "bytes": bytes.len(), "sha256": super::sha(bytes) }))
    }).collect::<BTreeMap<_, _>>();
    let ignored = ignored.iter().map(|value| {
        let IgnoredEntry { path, executable, symlink } = value;
        json!({ "path": path, "executable": executable, "symlink": symlink })
    }).collect::<Vec<_>>();
    json!({ "entries": entries, "untracked": untracked, "ignored": ignored,
        "manifest_sha256": super::sha(&value.entries["rust/inventory.json"].bytes) })
}

pub(super) fn canonical(value: Value) -> Value {
    match value {
        Value::Object(fields) => {
            let ordered: BTreeMap<_, _> = fields.into_iter().collect();
            let mut fields = Map::new();
            for (key, value) in ordered {
                fields.insert(key, canonical(value));
            }
            Value::Object(fields)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        value => value,
    }
}

#[test]
fn capture_legacy_fields() {
    let ids = ["C01", "P01", "N02a"];
    let mut records = Vec::new();
    let mut metadata = Vec::new();
    for id in ids {
        let case = super::materialize(id);
        assert_eq!(case.id, id, "baseline input selection");
        metadata.push(json!({ "id": id, "snapshot": input_metadata(&case.snapshot) }));
        let found = crate::discovery::discover(&case.snapshot);
        let discovered = discovery(&found);
        let checked = crate::validation::validate(&case.snapshot, "rust/inventory.json", &case.manifest, found);
        let record = json!({ "discovery": discovered, "report": report(&checked) });
        assert_eq!(record.as_object().unwrap().len(), 2, "baseline record shape");
        assert_eq!(record["discovery"].as_object().unwrap().len(), 11, "legacy Discovery fields");
        assert_eq!(record["report"].as_object().unwrap().len(), 6, "legacy report fields");
        records.push(record);
    }
    assert_eq!(records.len(), 3, "baseline record count");
    println!("LEGACY_BASELINE_INPUTS_JSON={}", canonical(json!({ "ids": ids, "inputs": metadata })));
    println!("LEGACY_BASELINE_JSON={}", canonical(json!({ "ids": ids, "records": records })));
}
