use super::rust_legacy_baseline_tests::{canonical, discovery, input_metadata, report};
use crate::discovery::{discover, discover_observed, DiscoveryObserver, RustSyntaxObservation};
use crate::snapshot::{Entry, Snapshot};
use serde_json::{json, Value};
use std::ops::Range;

fn eq_range(actual: &Range<usize>, value: &Value) -> bool {
    Some(actual.start as u64) == value[0].as_u64() && Some(actual.end as u64) == value[1].as_u64()
}
fn matches(record: &RustSyntaxObservation, witness: &Value) -> bool {
    Some(record.path.as_str()) == witness["physical_path"].as_str()
        && eq_range(&record.owner, &witness["owner_fn_byte_range"])
        && eq_range(&record.call, &witness["call_byte_range"])
        && eq_range(&record.output, &witness["output_literal_byte_range"])
        && eq_range(&record.body, &witness["body_literal_byte_range"])
}
fn encoded(value: Value) -> Vec<u8> {
    format!("{}\n", canonical(value)).into_bytes()
}
fn entry(path: &str, source: &str) -> Entry {
    Entry {
        path: path.into(),
        mode: 0o100644,
        blob: "0000000000000000000000000000000000000000".into(),
        bytes: source.as_bytes().to_vec(),
    }
}

fn copy_snapshot(value: &Snapshot) -> Snapshot {
    Snapshot {
        entries: value.entries.clone(),
        untracked: value.untracked.clone(),
        ignored: value.ignored.clone(),
    }
}

#[test]
fn observes_real_discovery_sources() {
    let mut trace = DiscoveryObserver::default();
    assert!(trace.rust_partial_records().is_none());
    for id in ["P01", "P02", "P03"] {
        let case = super::materialize(id);
        let plain = discover(&case.snapshot);
        let observed = discover_observed(&case.snapshot, &mut trace);
        assert_eq!(discovery(&plain), discovery(&observed));
        let records = trace.rust_partial_records().unwrap();
        assert_eq!(records.len(), case.witnesses.len());
        for (record, witness) in records.iter().zip(&case.witnesses) {
            assert!(matches(record, witness));
            let mut wrong = witness.clone();
            wrong["physical_path"] = json!("wrong.rs");
            assert!(!matches(record, &wrong));
            wrong = witness.clone();
            wrong["call_byte_range"][0] = json!(record.call.start + 1);
            assert!(!matches(record, &wrong));
        }
        assert_eq!(
            report(&crate::validation::validate(
                &case.snapshot,
                "rust/inventory.json",
                &case.manifest,
                plain
            )),
            report(&crate::validation::validate(
                &case.snapshot,
                "rust/inventory.json",
                &case.manifest,
                observed
            ))
        );
    }
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut metadata = Vec::new();
    for id in ["C01", "P01", "N02a"] {
        let case = super::materialize(id);
        metadata.push(json!({"id":id,"snapshot":input_metadata(&case.snapshot)}));
        let plain = discover(&case.snapshot);
        let plain_projection = discovery(&plain);
        let plain_report = crate::validation::validate(
            &case.snapshot,
            "rust/inventory.json",
            &case.manifest,
            plain,
        );
        let observed = discover_observed(&case.snapshot, &mut trace);
        if id == "N02a" {
            assert!(trace.rust_partial_records().is_none());
        }
        let observed_projection = discovery(&observed);
        let observed_report = crate::validation::validate(
            &case.snapshot,
            "rust/inventory.json",
            &case.manifest,
            observed,
        );
        before.push(json!({"discovery":plain_projection,"report":report(&plain_report)}));
        after.push(json!({"discovery":observed_projection,"report":report(&observed_report)}));
    }
    let ids = ["C01", "P01", "N02a"];
    let baseline = encoded(json!({"ids": ids, "records": before}));
    assert_eq!(baseline, encoded(json!({"ids": ids, "records": after})));
    assert_eq!(
        super::sha(&baseline),
        "1f4d827984fcf4ab3ce5f57d3120e2fee4d05b2c1212730e0b17947edd0d29f3"
    );
    assert_eq!(
        super::sha(&encoded(json!({"ids": ids, "inputs": metadata}))),
        "1c23a7c5de37c7d72898a8fc99be03ee874af3699cf2ec32459ba66c76b068fb"
    );

    let case = super::materialize("C01");
    discover_observed(&case.snapshot, &mut trace);
    let host = trace.records().unwrap().clone();
    let original = super::materialize("P01");
    let text = std::str::from_utf8(&original.snapshot.entries["src/lib.rs"].bytes).unwrap();
    trace.observe_rust("generated.rs", text, true);
    assert!(trace.rust_partial_records().is_none());
    assert_eq!(trace.records().unwrap(), &host);
    let mut unsupported = copy_snapshot(&original.snapshot);
    unsupported.entries.get_mut("src/lib.rs").unwrap().bytes = b"fn f() { unknown!(); }".to_vec();
    let unsupported_result = discover_observed(&unsupported, &mut trace);
    assert!(trace.rust_partial_records().unwrap().is_empty());
    assert!(unsupported_result.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "reviewed-source-registry-required"
            && diagnostic.path.as_deref() == Some("src/lib.rs")
    }));
    for bad in ["fn broken( {".to_string(), " ".repeat(2_097_153)] {
        let mut fixture = copy_snapshot(&original.snapshot);
        fixture.entries.get_mut("src/lib.rs").unwrap().bytes = bad.into_bytes();
        discover_observed(&fixture, &mut trace);
        assert!(trace.rust_partial_records().is_none());
    }
    let mut invalid = copy_snapshot(&original.snapshot);
    invalid.entries.get_mut("src/lib.rs").unwrap().bytes = vec![0xff];
    discover_observed(&invalid, &mut trace);
    assert!(trace.rust_partial_records().is_none());
    let mut overflow = DiscoveryObserver::default();
    overflow.finish();
    overflow.observe_rust(
        "src/lib.rs",
        &format!(
            "fn f() {{ {} }}",
            "::std::fs::write(\"a\", \"b\");".repeat(257)
        ),
        false,
    );
    assert!(overflow.rust_partial_records().is_none());
    let mut path_overflow = DiscoveryObserver::default();
    path_overflow.finish();
    path_overflow.observe_rust(&"x".repeat(65_537), text, false);
    assert!(path_overflow.rust_partial_records().is_none());

    let mut restart = copy_snapshot(&original.snapshot);
    let main = "import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {body} from './helper'; writeFileSync('tools/out', body); spawnSync('node', ['src/helper']);\n";
    let helper = "export const body = '#!/bin/sh\\n:\\n';\n";
    restart
        .entries
        .insert("src/main.ts".into(), entry("src/main.ts", main));
    restart
        .entries
        .insert("src/helper".into(), entry("src/helper", helper));
    let final_discovery = discover_observed(&restart, &mut trace);
    assert!(final_discovery.programs.contains_key("src/helper"));
    assert_eq!(trace.rust_partial_records().unwrap().len(), 1);
}
