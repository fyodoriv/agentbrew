use super::rust_legacy_baseline_tests::{canonical, discovery, input_metadata, report};
use crate::discovery::{discover, discover_observed, DiscoveryObserver, HostObservation};
use crate::host_graph::{Operation, Site};
use crate::snapshot::{Entry, Snapshot};
use serde_json::{json, Value};

const LEGACY_SHA: &str = "1f4d827984fcf4ab3ce5f57d3120e2fee4d05b2c1212730e0b17947edd0d29f3";
const INPUT_SHA: &str = "1c23a7c5de37c7d72898a8fc99be03ee874af3699cf2ec32459ba66c76b068fb";

fn bytes(value: Value) -> Vec<u8> {
    format!("{}\n", canonical(value)).into_bytes()
}

fn observed_call(observer: &DiscoveryObserver, witness: &Value) -> bool {
    let Some(records) = observer.records() else {
        return false;
    };
    let Some(range) = witness["call_byte_range"].as_array() else {
        return false;
    };
    let Some(path) = witness["physical_path"].as_str() else {
        return false;
    };
    let Some(api) = witness["receipt"]["callee"].as_str() else {
        return false;
    };
    records.iter().any(|record| {
        record.site.path == path
            && Some(record.site.start as u64) == range[0].as_u64()
            && Some(record.site.end as u64) == range[1].as_u64()
            && record.operation == Operation::Write
            && record.api == api
            && !record.uncertain
    })
}

fn snapshot(files: &[(&str, &str)]) -> Snapshot {
    Snapshot {
        entries: files
            .iter()
            .map(|(path, text)| {
                (
                    (*path).into(),
                    Entry {
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

fn assert_overflow_unchanged(input: &Snapshot, manifest: &crate::model::Manifest) {
    let plain = discover(input);
    let plain_discovery = discovery(&plain);
    let plain_report = crate::validation::validate(input, "rust/inventory.json", manifest, plain);
    let mut overflow = DiscoveryObserver::default();
    let observed = discover_observed(input, &mut overflow);
    assert!(overflow.overflowed());
    assert!(overflow.records().is_none());
    assert_eq!(discovery(&observed), plain_discovery);
    let observed_report =
        crate::validation::validate(input, "rust/inventory.json", manifest, observed);
    assert_eq!(report(&observed_report), report(&plain_report));
}

#[test]
fn observer_preserves_legacy() {
    let ids = ["C01", "P01", "N02a"];
    let mut disabled = Vec::new();
    let mut enabled = Vec::new();
    let mut metadata = Vec::new();
    for id in ids {
        let case = super::materialize(id);
        metadata.push(json!({"id":id,"snapshot":input_metadata(&case.snapshot)}));
        let absent = DiscoveryObserver::default();
        let plain = discover(&case.snapshot);
        assert!(absent.records().is_none());
        let plain_discovery = discovery(&plain);
        let plain_report = crate::validation::validate(
            &case.snapshot,
            "rust/inventory.json",
            &case.manifest,
            plain,
        );
        disabled.push(json!({"discovery":plain_discovery,"report":report(&plain_report)}));

        let mut observer = DiscoveryObserver::default();
        let traced = discover_observed(&case.snapshot, &mut observer);
        if id == "C01" {
            let witness = &case.witnesses[0];
            assert!(observed_call(&observer, witness));
            let mut wrong = witness.clone();
            wrong["physical_path"] = "wrong/path.ts".into();
            assert!(!observed_call(&observer, &wrong));
        } else {
            assert!(observer.records().unwrap().is_empty());
        }
        let traced_discovery = discovery(&traced);
        let traced_report = crate::validation::validate(
            &case.snapshot,
            "rust/inventory.json",
            &case.manifest,
            traced,
        );
        enabled.push(json!({"discovery":traced_discovery,"report":report(&traced_report)}));
    }
    let old = bytes(json!({"ids":ids,"records":disabled}));
    let traced = bytes(json!({"ids":ids,"records":enabled}));
    let inputs = bytes(json!({"ids":ids,"inputs":metadata}));
    assert_eq!(old.len(), 3328);
    assert_eq!(super::sha(&old), LEGACY_SHA);
    assert_eq!(traced, old);
    assert_eq!(inputs.len(), 2232);
    assert_eq!(super::sha(&inputs), INPUT_SHA);

    let mut empty = DiscoveryObserver::default();
    discover_observed(&snapshot(&[]), &mut empty);
    assert!(empty.records().unwrap().is_empty());

    let mut large_source = "import {writeFileSync} from 'node:fs';\n".to_owned();
    for n in 0..257 {
        large_source.push_str(&format!(
            "writeFileSync('tools/{n}', '#!/bin/sh\\n:\\n');\n"
        ));
    }
    let overflow_input = snapshot(&[("src/large.ts", &large_source)]);
    let manifest: crate::model::Manifest = serde_json::from_value(json!({
        "schema_version":1,"owner":"fixture",
        "reviewed_revision":"0000000000000000000000000000000000000000",
        "slices":["rust-fixture"],"files":[],"components":[],"edges":[]
    }))
    .unwrap();
    assert_overflow_unchanged(&overflow_input, &manifest);

    let long_path = format!("src/{}.ts", "a".repeat(65_536));
    let single_source =
        "import {writeFileSync} from 'node:fs'; writeFileSync('tool', '#!/bin/sh\\n:\\n');";
    assert_overflow_unchanged(&snapshot(&[(&long_path, single_source)]), &manifest);

    let old = HostObservation {
        site: Site {
            path: "old.ts".into(),
            start: 0,
            end: 1,
            body: None,
        },
        operation: Operation::Write,
        api: "fixture".into(),
        uncertain: false,
    };
    let new = HostObservation {
        site: Site {
            path: "new.ts".into(),
            start: 0,
            end: 1,
            body: None,
        },
        ..old.clone()
    };
    let mut passes = DiscoveryObserver::default();
    passes.begin_pass();
    passes.record(old.clone());
    passes.begin_pass();
    passes.record(new.clone());
    passes.finish();
    assert_eq!(passes.passes(), 2);
    assert!(!passes.records().unwrap().contains(&old));
    assert!(passes.records().unwrap().contains(&new));

    let generated = "import {writeFileSync} from 'node:fs';\nwriteFileSync('tool', `#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';\nspawnSync('node',['-e','console.log(1)']);\n`);\n";
    let mut generated_trace = DiscoveryObserver::default();
    discover_observed(
        &snapshot(&[("src/create.ts", generated)]),
        &mut generated_trace,
    );
    assert!(generated_trace.passes() >= 2);
    assert!(generated_trace
        .records()
        .unwrap()
        .iter()
        .any(|record| record.site.body.is_some()));

    let main = "import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {body} from './helper'; writeFileSync('tools/out', body); spawnSync('node', ['src/helper']);\n";
    let helper = "export const body = '#!/bin/sh\\n:\\n';\n";
    let mut before = DiscoveryObserver::default();
    discover_observed(&snapshot(&[("src/main.ts", main)]), &mut before);
    let before_writes: Vec<&HostObservation> = before
        .records()
        .unwrap()
        .iter()
        .filter(|r| r.api == "node:fs/writeFileSync")
        .collect();
    assert_eq!(before_writes.len(), 1);
    assert!(before_writes[0].uncertain);
    let mut after = DiscoveryObserver::default();
    let final_discovery = discover_observed(
        &snapshot(&[("src/main.ts", main), ("src/helper", helper)]),
        &mut after,
    );
    assert!(final_discovery.programs.contains_key("src/helper"));
    let after_writes: Vec<&HostObservation> = after
        .records()
        .unwrap()
        .iter()
        .filter(|r| r.api == "node:fs/writeFileSync")
        .collect();
    assert_eq!(after_writes.len(), 1);
    assert!(!after_writes[0].uncertain);
    assert_eq!(before_writes[0].site, after_writes[0].site);
}
