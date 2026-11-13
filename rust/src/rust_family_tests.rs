//! Test-invocation-owned corpus data. No worker, filesystem reader or source execution.

use crate::host_graph::Datum;
use crate::model::Manifest;
use crate::native_facts::RequiredTarget;
use crate::snapshot::{Entry, IgnoredEntry, Snapshot};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const CORPUS: &str =
    include_str!("../../docs/plans/rust-literal-adapter-corpus-proposal-20261105.md");
const CORPUS_SHA: &str = "b500bf9c8ade0e5cbe7dc70e26c2ef019e5d230da04576af198fc018bf2dd527";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn records() -> impl Iterator<Item = Value> {
    assert_eq!(
        sha(CORPUS.as_bytes()),
        CORPUS_SHA,
        "corpus setup: frozen data changed"
    );
    CORPUS
        .split("```json\n")
        .skip(1)
        .map(|part| {
            serde_json::from_str(part.split("\n```").next().unwrap())
                .expect("corpus setup: invalid frozen JSON")
        })
}

#[derive(Clone, Copy)]
enum BodyExpansion {
    LiteralValues,
    PreserveReferences,
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().expect("corpus setup: expected string")
}

fn substitute_index(value: &Value, index: u64) -> Value {
    match value {
        Value::String(value) => Value::String(value.replace("{i:06d}", &format!("{index:06}"))),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| substitute_index(item, index))
                .collect(),
        ),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), substitute_index(value, index)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn expand(value: &Value, body: Option<&str>, expansion: BodyExpansion) -> Value {
    match value {
        Value::String(value)
            if value == "$BODY" && matches!(expansion, BodyExpansion::LiteralValues) =>
        {
            Value::String(body.expect("corpus setup: absent body binding").into())
        }
        Value::Array(items) => {
            let mut result = Vec::new();
            for item in items {
                if let Some(repeat) = item.get("$repeat") {
                    assert_eq!(
                        text(repeat, "index"),
                        "i",
                        "corpus setup: unknown repeat variable"
                    );
                    let interval = repeat["inclusive"].as_array().unwrap();
                    let start = interval[0].as_u64().unwrap();
                    let end = interval[1].as_u64().unwrap();
                    assert!(start <= end && end <= 100_000, "corpus setup: repeat bound");
                    for index in start..=end {
                        result.push(expand(&substitute_index(&repeat["value"], index), body, expansion));
                    }
                } else {
                    result.push(expand(item, body, expansion));
                }
            }
            Value::Array(result)
        }
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), expand(value, body, expansion)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn bytes(value: &Value, body: Option<&str>, manifest: &Value, id: &str) -> Vec<u8> {
    let result = if let Some(value) = value.get("bytes_utf8") {
        value.as_str().unwrap().as_bytes().to_vec()
    } else if let Some(value) = value.get("bytes_hex") {
        let value = value.as_str().unwrap();
        assert_eq!(value.len() % 2, 0, "corpus setup: hex width");
        (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
            .collect()
    } else if let Some(runs) = value.get("bytes_rle") {
        let mut result = Vec::new();
        for run in runs.as_array().unwrap() {
            let encoded = run[0].as_str().unwrap();
            let count = run[1].as_u64().unwrap();
            let chunk: Vec<_> = (0..encoded.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&encoded[index..index + 2], 16).unwrap())
                .collect();
            assert!(count <= 2_097_153, "corpus setup: RLE bound");
            for _ in 0..count {
                result.extend_from_slice(&chunk);
            }
        }
        result
    } else if let Some(parts) = value.get("bytes_concat") {
        let mut result = Vec::new();
        for part in parts.as_array().unwrap() {
            if let Some(value) = part.get("utf8") {
                result.extend_from_slice(value.as_str().unwrap().as_bytes());
            } else {
                assert!(text(part, "binding") == "$BODY", "corpus setup {id}: unknown binding");
                result.extend_from_slice(body.unwrap().as_bytes());
            }
        }
        result
    } else {
        assert_eq!(
            text(value, "bytes_recipe"),
            "canonical-json-of-expanded-manifest-plus-LF",
            "corpus setup: unknown self entry encoding"
        );
        let mut result = serde_json::to_vec(manifest).unwrap();
        result.push(b'\n');
        result
    };
    if let Some(length) = value.get("expanded_bytes") {
        assert_eq!(
            result.len() as u64,
            length.as_u64().unwrap(),
            "corpus setup {id}: byte length"
        );
    }
    if let Some(expected) = value.get("sha256") {
        assert_eq!(
            sha(&result),
            expected.as_str().unwrap(),
            "corpus setup {id}: source hash"
        );
    }
    result
}

struct Case {
    id: String,
    snapshot: Snapshot,
    manifest: Manifest,
    expected: Value,
    witnesses: Vec<Value>,
    resource: Option<Value>,
    injected_producer: bool,
}

fn materialize(id: &str) -> Case {
    let record = records()
        .find(|record| record["id"] == id)
        .unwrap();
    materialize_record(&record)
}

fn materialize_record(record: &Value) -> Case {
    let id = text(record, "id");
    let resource = record.get("exact_resource");
    let body = resource
        .and_then(|resource| resource.get("bindings"))
        .and_then(|bindings| bindings.get("$BODY"))
        .map(|binding| {
            String::from_utf8(bytes(binding, None, &Value::Null, id))
                .unwrap_or_else(|_| panic!("corpus setup {id}: invalid body binding UTF-8"))
        });
    let source = resource.unwrap_or(&record["snapshot"]);
    let manifest_value = record
        .get("manifest")
        .or_else(|| source.get("manifest"))
        .or_else(|| source.get("manifest_template"))
        .expect("corpus setup: absent manifest");
    let manifest_value = expand(manifest_value, body.as_deref(), BodyExpansion::LiteralValues);
    let mut entries = BTreeMap::new();
    let expanded_entries = expand(&source["entries"], None, BodyExpansion::PreserveReferences);
    for value in expanded_entries.as_array().unwrap() {
        let path = text(value, "path");
        let entry = Entry {
            path: path.into(),
            mode: u32::from_str_radix(text(value, "mode"), 8).unwrap(),
            blob: text(value, "git_blob").into(),
            bytes: bytes(value, body.as_deref(), &manifest_value, id),
        };
        assert!(
            entries.insert(path.into(), entry).is_none(),
            "corpus setup: duplicate path"
        );
    }
    drop(expanded_entries);
    let described: Value = serde_json::from_slice(&entries["rust/inventory.json"].bytes)
        .unwrap_or_else(|_| panic!("corpus setup {id}: invalid self description"));
    assert!(described == manifest_value, "corpus setup {id}: self description differs");
    drop(described);
    let manifest: Manifest = serde_json::from_value(manifest_value)
        .unwrap_or_else(|_| panic!("corpus setup {id}: invalid manifest shape"));
    for file in &manifest.files {
        let entry = &entries[&file.path];
        if file.path != "rust/inventory.json" {
            assert_eq!(
                file.reviewed_git_blob.as_deref(),
                Some(entry.blob.as_str()),
                "corpus setup: stale file"
            );
        }
    }
    let ignored = source["ignored"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| IgnoredEntry {
            path: text(value, "path").into(),
            executable: value["executable"].as_bool().unwrap(),
            symlink: value["symlink"].as_bool().unwrap(),
        })
        .collect();
    assert!(
        source["untracked"].as_array().unwrap().is_empty(),
        "corpus setup: untracked recipe"
    );
    let witnesses = record
        .get("native_witnesses")
        .or_else(|| source.get("native_witnesses"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| source.get("native_witness").cloned().into_iter().collect());
    Case {
        id: id.into(),
        snapshot: Snapshot {
            entries,
            untracked: Vec::new(),
            ignored,
        },
        manifest,
        expected: record["expected"].clone(),
        witnesses: witnesses
            .iter()
            .map(|value| expand(value, body.as_deref(), BodyExpansion::LiteralValues))
            .collect(),
        resource: resource.cloned(),
        injected_producer: !record["test_only_injected_producer"].is_null(),
    }
}

fn receipt_witnesses(case: &Case, found: &crate::discovery::Discovery) -> Vec<String> {
    let mut missing = Vec::new();
    for witness in &case.witnesses {
        if let Some(id) = witness.get("call_id").and_then(Value::as_str) {
            let Some(boundary) = found.boundaries.get(id) else {
                missing.push(format!("missing native call {id}"));
                continue;
            };
            if let Some(receipt) = witness.get("receipt") {
                if serde_json::to_value(&boundary.receipts).unwrap()
                    != Value::Array(vec![receipt.clone()])
                {
                    missing.push(format!("wrong exact receipt {id}"));
                }
            }
            if let Some(body) = witness.get("decoded_body_utf8").and_then(Value::as_str) {
                if !boundary.bodies.iter().any(
                    |body_fact| matches!(&body_fact.value, Datum::Text(value, _) if value == body),
                ) {
                    missing.push(format!("wrong decoded body {id}"));
                }
            }
            if let Some(body_id) = witness.get("body_id").and_then(Value::as_str) {
                if !found.facts.contains_key(body_id) {
                    missing.push(format!("missing generated body {body_id}"));
                }
            }
            if let Some(output) = witness.get("literal_output").and_then(Value::as_str) {
                if !boundary.targets.iter().any(|target| {
                    matches!(target, RequiredTarget::Output(Datum::Text(value, _)) if value == output)
                }) {
                    missing.push(format!("wrong observed output {id}"));
                }
            }
            if witness.get("owner_fn_byte_range").is_some() {
                // The unchanged API has no Rust owner/module trace. Do not invent it.
                missing.push(format!("unqualified Rust function/module trace {id}"));
            }
        } else if witness.get("fully_covered_rust") == Some(&Value::Bool(true)) {
            let incomplete = found
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.path.as_deref() == Some("src/lib.rs"));
            let actual: Vec<_> = found
                .boundaries
                .keys()
                .filter(|id| id.starts_with("call:src/lib.rs:"))
                .collect();
            if incomplete || !actual.is_empty() || !found.programs.contains_key("src/lib.rs") {
                missing.push("unqualified fully covered inert Rust source".into());
            }
        } else if case.id == "C02" {
            let exact_body = text(witness, "body_utf8");
            let matching = found.boundaries.values().any(|boundary| {
                boundary.receipts.iter().any(|receipt| receipt.callee == "rust:std::fs/write")
                    && boundary.bodies.iter().any(|body| {
                        matches!(&body.value, Datum::Text(value, _) if value == exact_body)
                    })
                    && boundary.targets.iter().any(|target| {
                        matches!(target, RequiredTarget::Output(Datum::Input(_, names)) if names == &vec!["canary-output".to_owned()])
                    })
            });
            if !matching {
                missing.push("missing actual compiled symbolic Rust canary".into());
            }
        }
    }
    if case.injected_producer {
        missing.push(
            "unqualified: current orchestration has no test-only producer composition seam".into(),
        );
    }
    if matches!(case.id.as_str(), "N02c" | "N02d") {
        missing
            .push("unqualified: current discovery has no Rust writer/depth/decoded trace".into());
    }
    missing
}

fn run(id: &str) {
    let case = materialize(id);
    let found = crate::discovery::discover(&case.snapshot);
    let missing = receipt_witnesses(&case, &found);
    let program_count = found.programs.len();
    let imports = found.registry_edges.clone();
    let report =
        crate::validation::validate(&case.snapshot, "rust/inventory.json", &case.manifest, found);
    let mut counts = BTreeMap::<&str, usize>::new();
    for diagnostic in &report.diagnostics {
        *counts.entry(&diagnostic.code).or_default() += 1;
    }
    eprintln!(
        "case={id} clean={} diagnostic_counts={counts:?} missing_witnesses={missing:?}",
        report.diagnostics.is_empty()
    );
    if id.starts_with('P')
        && !missing.is_empty()
        && report
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "reviewed-source-registry-required")
    {
        panic!("semantic baseline: real discovery is registry-required and lacks frozen Rust writer evidence: {missing:?}");
    }
    assert!(missing.is_empty(), "unqualified case {id}: {missing:?}");
    assert_eq!(
        report.diagnostics.is_empty(),
        case.expected["decision"] == "accept",
        "wrong decision {id}"
    );
    for expected in case.expected["required_diagnostic_witnesses"]
        .as_array()
        .unwrap()
    {
        let code = text(expected, "code");
        let path = expected["path"].as_str();
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == code && diagnostic.path.as_deref() == path),
            "wrong refusal {id}: missing {code} at {path:?}"
        );
    }
    if let Some(forbidden) = case
        .expected
        .get("forbidden_diagnostic_codes")
        .and_then(Value::as_array)
    {
        for code in forbidden {
            assert!(
                !counts.contains_key(code.as_str().unwrap()),
                "forbidden diagnostic {id}"
            );
        }
    }
    if let Some(prefixes) = case
        .expected
        .get("forbidden_diagnostic_prefixes")
        .and_then(Value::as_array)
    {
        for prefix in prefixes {
            assert!(
                !counts
                    .keys()
                    .any(|code| code.starts_with(prefix.as_str().unwrap())),
                "forbidden diagnostic prefix {id}"
            );
        }
    }
    if let Some(edges) = case
        .expected
        .get("exact_program_import_edges")
        .and_then(Value::as_array)
    {
        for edge in edges {
            let expected = (
                format!("program:{}", edge[0].as_str().unwrap()),
                format!("program:{}", edge[1].as_str().unwrap()),
                "imports".to_owned(),
            );
            assert!(
                imports.contains(&expected),
                "missing physical module/include edge {id}"
            );
        }
    }
    if id == "N02b" {
        assert_eq!(program_count, 100_001, "resource witness source count");
    }
}

fn resource_materialization_is_exact(case: &Case, resource: &Value) {
    let id = &case.id;
    match id.as_str() {
        "N02a" => {
            assert_eq!(case.snapshot.entries["src/lib.rs"].bytes.len(), 2_097_153);
            assert_eq!(resource["required_witness"]["source_bytes"].as_u64(), Some(2_097_153));
        }
        "N02b" => {
            assert_eq!(case.snapshot.entries.len(), 100_003);
            assert_eq!(case.manifest.components.len(), 100_001);
            assert_eq!(case.snapshot.entries.keys().filter(|path| path.ends_with(".rs")).count(), 100_001);
            assert_eq!(resource["required_witness"]["initial_source_count"].as_u64(), Some(100_001));
        }
        "N02c" => {
            assert_eq!(case.witnesses.len(), 1);
            assert_eq!(resource["required_witness"]["refused_parent_body_depth"].as_u64(), Some(16));
        }
        "N02d" => {
            assert_eq!(case.witnesses.len(), 17);
            let body_bytes = case.witnesses[0]["body_bytes"].as_u64().unwrap();
            let before = body_bytes * 16;
            let witness = &resource["required_witness"];
            assert_eq!(witness["decoded_bytes_before"].as_u64(), Some(before));
            assert_eq!(witness["next_body_bytes"].as_u64(), Some(body_bytes));
            assert_eq!(witness["would_be_decoded_bytes"].as_u64(), Some(before + body_bytes));
            assert_eq!(witness["limit"].as_u64(), Some(33_554_432));
            assert!(before <= 33_554_432 && before + body_bytes > 33_554_432);
        }
        _ => panic!("corpus setup {id}: unexpected resource record"),
    }
    for witness in &case.witnesses {
        let receipt = &witness["receipt"];
        let path = text(&receipt["site"], "path");
        let entry = &case.snapshot.entries[path];
        let source = &entry.bytes;
        let start = receipt["site"]["start"].as_u64().unwrap() as usize;
        let end = receipt["site"]["end"].as_u64().unwrap() as usize;
        let call = source.get(start..end).expect("corpus setup: resource call range");
        assert!(call.starts_with(b"::std::fs::write("), "corpus setup {id}: resource call prefix");
        assert!(call.ends_with(b")"), "corpus setup {id}: resource call end");
        assert_eq!(sha(source), text(witness, "source_sha256"), "corpus setup {id}: resource source SHA");
        assert_eq!(source.len() as u64, witness["source_bytes"].as_u64().unwrap(), "corpus setup {id}: resource source length");
        assert!(entry.blob == text(witness, "source_git_blob"), "corpus setup {id}: resource blob identity");
        let body = receipt["arguments"][1]["value"][0].as_str().expect("corpus setup: resource body text");
        assert_eq!(body.len() as u64, witness["body_bytes"].as_u64().unwrap(), "corpus setup {id}: resource body length");
        let call_id = text(witness, "call_id");
        let component = case.manifest.components.iter().find(|component| component.id == call_id)
            .unwrap_or_else(|| panic!("corpus setup {id}: resource call component absent"));
        let actual = serde_json::to_value(&component.call_receipts)
            .unwrap_or_else(|_| panic!("corpus setup {id}: resource receipt serialization"));
        assert!(actual == Value::Array(vec![receipt.clone()]), "corpus setup {id}: resource receipt mismatch");
    }
}

#[test]
fn corpus_materialization_is_exact() {
    let mut counts = [0_usize; 4];
    let mut resources = 0;
    for row in records() {
        let id = text(&row, "id");
        counts[0] += 1;
        let group = match id.as_bytes()[0] {
            b'P' => 1,
            b'N' => 2,
            b'C' => 3,
            _ => panic!("corpus setup: unknown case prefix"),
        };
        counts[group] += 1;
        let case = materialize_record(&row);
        if let Some(resource) = &case.resource {
            resources += 1;
            resource_materialization_is_exact(&case, resource);
        }
    }
    assert_eq!(counts, [58, 6, 50, 2]);
    assert_eq!(resources, 4);
}

macro_rules! frozen_case {
    ($name:ident, $id:literal) => {
        #[test]
        fn $name() {
            run($id);
        }
    };
}
frozen_case!(p01, "P01");
frozen_case!(p02, "P02");
frozen_case!(p03, "P03");
frozen_case!(p04, "P04");
frozen_case!(p05, "P05");
frozen_case!(p06, "P06");
frozen_case!(n01a, "N01a");
frozen_case!(n01b, "N01b");
frozen_case!(n02a, "N02a");
frozen_case!(n02b, "N02b");
frozen_case!(n02c, "N02c");
frozen_case!(n02d, "N02d");
frozen_case!(n03a, "N03a");
frozen_case!(n03b, "N03b");
frozen_case!(n04a, "N04a");
frozen_case!(n04b, "N04b");
frozen_case!(n04c, "N04c");
frozen_case!(n04d, "N04d");
frozen_case!(n04e, "N04e");
frozen_case!(n04f, "N04f");
frozen_case!(n05a, "N05a");
frozen_case!(n06a, "N06a");
frozen_case!(n07a, "N07a");
frozen_case!(n07b, "N07b");
frozen_case!(n08a, "N08a");
frozen_case!(n08b, "N08b");
frozen_case!(n08c, "N08c");
frozen_case!(n09a, "N09a");
frozen_case!(n09b, "N09b");
frozen_case!(n09c, "N09c");
frozen_case!(n10a, "N10a");
frozen_case!(n10b, "N10b");
frozen_case!(n11a, "N11a");
frozen_case!(n11b, "N11b");
frozen_case!(n12a, "N12a");
frozen_case!(n12b, "N12b");
frozen_case!(n12c, "N12c");
frozen_case!(n13a, "N13a");
frozen_case!(n13b, "N13b");
frozen_case!(n14a, "N14a");
frozen_case!(n14b, "N14b");
frozen_case!(n14c, "N14c");
frozen_case!(n14d, "N14d");
frozen_case!(n15a, "N15a");
frozen_case!(n15b, "N15b");
frozen_case!(n16a, "N16a");
frozen_case!(n16b, "N16b");
frozen_case!(n17a, "N17a");
frozen_case!(n17b, "N17b");
frozen_case!(n17c, "N17c");
frozen_case!(n17d, "N17d");
frozen_case!(n17e, "N17e");
frozen_case!(n17f, "N17f");
frozen_case!(n18a, "N18a");
frozen_case!(n18b, "N18b");
frozen_case!(n18c, "N18c");
frozen_case!(c01, "C01");
frozen_case!(c02, "C02");

#[path = "rust_legacy_baseline_tests.rs"]
mod rust_legacy_baseline_tests;

#[cfg(test)]
#[path = "rust_observer_tests.rs"]
mod rust_observer_tests;

#[cfg(test)]
#[path = "rust_span_probe.rs"]
mod rust_span_probe;
