use super::rust_legacy_baseline_tests::{canonical, discovery, input_metadata, report};
use crate::discovery::{
    discover, discover_observed, discover_root_observed, discover_routed_observed,
    DiscoveryObserver, RustSyntaxObservation,
};
use crate::snapshot::{Entry, Snapshot};
use serde_json::{json, Value};
use std::ops::Range;

fn eq_range(actual: &Range<usize>, value: &Value) -> bool {
    Some(actual.start as u64) == value[0].as_u64() && Some(actual.end as u64) == value[1].as_u64()
}
fn matches(record: &RustSyntaxObservation, witness: &Value) -> bool {
    Some(record.path.as_str()) == witness["physical_path"].as_str()
        && Some(record.module.as_str()) == witness["logical_module"].as_str()
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

#[test]
fn observes_inline_modules() {
    let case = super::materialize("P05");
    let mut trace = DiscoveryObserver::default();
    let plain = discover(&case.snapshot);
    let observed = discover_observed(&case.snapshot, &mut trace);
    assert_eq!(discovery(&plain), discovery(&observed));
    let record = &trace.rust_partial_records().unwrap()[0];
    let witness = &case.witnesses[0];
    assert!(matches(record, witness));
    assert_eq!(
        Some(record.module.as_str()),
        witness["logical_module"].as_str()
    );
    let mut wrong = witness.clone();
    wrong["logical_module"] = json!("crate::wrong");
    assert!(!matches(record, &wrong));
    wrong = witness.clone();
    wrong["physical_path"] = json!("wrong.rs");
    assert!(!matches(record, &wrong));
    wrong = witness.clone();
    wrong["owner_fn_byte_range"][0] = json!(record.owner.start + 1);
    assert!(!matches(record, &wrong));

    let source = "mod a { mod nested { fn same() { ::std::fs::write(\"a\", \"b\"); } } } mod b { fn same() { ::std::fs::write(\"a\", \"b\"); } }";
    let sites = super::rust_syntax_slice::parse(source.as_bytes()).unwrap();
    assert_eq!(
        sites.iter().map(|s| s.module.as_str()).collect::<Vec<_>>(),
        ["crate::a::nested", "crate::b"]
    );
    let with_bom = format!("\u{feff}\r\n{source}");
    let bom_sites = super::rust_syntax_slice::parse(with_bom.as_bytes()).unwrap();
    assert_eq!(bom_sites[0].call.start, sites[0].call.start + 5);
    assert!(super::rust_syntax_slice::parse(b"mod a { fn broken(").is_err());
    for id in ["P01", "P02", "P03"] {
        let case = super::materialize(id);
        discover_observed(&case.snapshot, &mut trace);
        assert!(trace
            .rust_partial_records()
            .unwrap()
            .iter()
            .all(|r| r.module == "crate"));
    }
    let writer = "fn f() { ::std::fs::write(\"a\", \"b\"); }";
    let nested =
        |depth: usize| format!("{}{}{}", "mod a {".repeat(depth), writer, "}".repeat(depth));
    assert!(super::rust_syntax_slice::parse(nested(16).as_bytes()).is_ok());
    assert!(super::rust_syntax_slice::parse(nested(17).as_bytes()).is_err());
    let named = |len: usize| format!("mod {} {{ {writer} }}", "a".repeat(len));
    assert!(super::rust_syntax_slice::parse(named(256).as_bytes()).is_ok());
    assert!(super::rust_syntax_slice::parse(named(257).as_bytes()).is_err());
    let mut limit = DiscoveryObserver::default();
    limit.finish();
    for _ in 0..256 {
        limit.observe_rust("x", &named(249), false);
    }
    assert_eq!(limit.rust_partial_records().unwrap().len(), 256);
    let mut over = DiscoveryObserver::default();
    over.finish();
    for _ in 0..255 {
        over.observe_rust("x", &named(249), false);
    }
    over.observe_rust("x", &named(250), false);
    assert!(over.rust_partial_records().is_none());
    let unsupported = "#[cfg(any())] mod hidden { fn f() { ::std::fs::write(\"a\", \"b\"); } } mod external; include!(\"other.rs\");";
    assert!(super::rust_syntax_slice::parse(unsupported.as_bytes())
        .unwrap()
        .is_empty());
    trace = DiscoveryObserver::default();
    trace.finish();
    trace.observe_rust("test.rs", writer, true);
    assert!(trace.rust_partial_records().is_none());
    trace = DiscoveryObserver::default();
    trace.finish();
    trace.observe_rust(
        "test.rs",
        &format!(
            "fn f() {{ {} }}",
            "::std::fs::write(\"a\", \"b\");".repeat(257)
        ),
        false,
    );
    assert!(trace.rust_partial_records().is_none());
}

#[test]
fn witnesses_p04_routed_buffers() {
    let case = super::materialize("P04");
    for path in ["src/lib.rs", "src/emit.rs"] {
        assert!(case.snapshot.entries[path].bytes.len() <= 2_097_152);
    }
    let expected = copy_snapshot(&case.snapshot);
    let relation = super::rust_module_relation::relation(&expected).unwrap();
    assert_eq!(relation.len(), 1);
    assert!(super::rust_module_relation::matches(
        &relation[0],
        &case.witnesses[0]
    ));
    let mut observer = DiscoveryObserver::default();
    let ids = ["C01", "P01", "N02a"];
    let mut baseline = Vec::new();
    for id in ids {
        let control = super::materialize(id);
        let routed = discover_routed_observed(&control.snapshot, &expected, None, &mut observer);
        assert!(observer.routed_round().is_none());
        let projection = discovery(&routed);
        let validated = crate::validation::validate(
            &control.snapshot,
            "rust/inventory.json",
            &control.manifest,
            routed,
        );
        baseline.push(json!({"discovery": projection, "report": report(&validated)}));
    }
    assert_eq!(
        super::sha(&encoded(json!({"ids": ids, "records": baseline}))),
        "1f4d827984fcf4ab3ce5f57d3120e2fee4d05b2c1212730e0b17947edd0d29f3"
    );
    let plain = discover(&case.snapshot);
    let observed = discover_routed_observed(&case.snapshot, &expected, None, &mut observer);
    assert_eq!(discovery(&plain), discovery(&observed));
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
    assert_eq!(observer.routed_round(), Some(1));
    for path in ["src/lib.rs", "src/emit.rs"] {
        let mut wrong = copy_snapshot(&expected);
        wrong.entries.get_mut(path).unwrap().bytes.push(b' ');
        discover_routed_observed(&case.snapshot, &wrong, None, &mut observer);
        assert!(observer.routed_round().is_none());
    }
    for key in ["physical_path", "logical_module"] {
        let mut wrong = case.witnesses[0].clone();
        wrong[key] = json!("wrong");
        assert!(!super::rust_module_relation::matches(&relation[0], &wrong));
    }
    let mut wrong = case.witnesses[0].clone();
    wrong["call_byte_range"][0] = json!(relation[0].site.call.start + 1);
    assert!(!super::rust_module_relation::matches(&relation[0], &wrong));
    discover_routed_observed(&case.snapshot, &expected, None, &mut observer);
    assert!(observer.routed_round().is_some());
    discover_routed_observed(&case.snapshot, &expected, Some(0), &mut observer);
    assert!(observer.routed_round().is_none());
    let mut unsupported = copy_snapshot(&expected);
    unsupported.entries.get_mut("src/lib.rs").unwrap().bytes = b"mod emit; mod other;".to_vec();
    discover_routed_observed(&case.snapshot, &unsupported, None, &mut observer);
    assert!(observer.routed_round().is_none());
    // Helper-level controls do not claim a real generated-Rust route.
    crate::discovery::routed_helper_controls(&expected);

    let mut restart = copy_snapshot(&case.snapshot);
    let main = "import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {body} from './helper'; writeFileSync('tools/out', body); spawnSync('node', ['src/helper']);\n";
    let helper = "export const body = '#!/bin/sh\\n:\\n';\n";
    restart
        .entries
        .insert("src/main.ts".into(), entry("src/main.ts", main));
    restart
        .entries
        .insert("src/helper".into(), entry("src/helper", helper));
    let found = discover_routed_observed(&restart, &expected, None, &mut observer);
    assert!(found.programs.contains_key("src/helper"));
    assert!(observer.routed_round().is_some_and(|round| round > 1));
}

#[test]
fn shadows_root_namespace() {
    let mut observer = DiscoveryObserver::default();
    for id in [
        "P01", "P02", "P03", "P04", "N04a", "N04b", "N04c", "N04d", "N04e", "N04f",
    ] {
        let case = super::materialize(id);
        for path in ["src/lib.rs", "Cargo.toml"] {
            assert!(case.snapshot.entries[path].bytes.len() <= 2_097_152);
        }
        let expected = copy_snapshot(&case.snapshot);
        let plain = discover(&case.snapshot);
        let observed = discover_root_observed(&case.snapshot, &expected, None, &mut observer);
        assert_eq!(discovery(&plain), discovery(&observed));
        assert!(observed
            .diagnostics
            .iter()
            .any(|item| item.code == "reviewed-source-registry-required"));
        assert_eq!(
            observer.root_candidate(),
            ["P01", "P02", "P03"].contains(&id),
            "{id}"
        );
        if observer.root_candidate() {
            let records = observer.rust_partial_records().unwrap();
            assert_eq!(records.len(), case.witnesses.len());
            for (record, witness) in records.iter().zip(&case.witnesses) {
                assert!(matches(record, witness));
            }
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
    let original = super::materialize("P01");
    let expected = copy_snapshot(&original.snapshot);
    discover_root_observed(&original.snapshot, &expected, None, &mut observer);
    assert!(observer.root_candidate());
    for side in ["actual", "expected", "both"] {
        for kind in [
            "tracked",
            "untracked",
            "ignored",
            "unrelated-untracked",
            "unrelated-ignored",
        ] {
            let mut actual = copy_snapshot(&original.snapshot);
            let mut expected_case = copy_snapshot(&expected);
            let mutate = |snapshot: &mut Snapshot| match kind {
                "tracked" => {
                    snapshot
                        .entries
                        .insert("build.rs".into(), entry("build.rs", "fn main() {}"));
                }
                "untracked" => snapshot.untracked.push("build.rs".into()),
                "ignored" => snapshot.ignored.push(crate::snapshot::IgnoredEntry {
                    path: "build.rs".into(),
                    executable: false,
                    symlink: false,
                }),
                "unrelated-untracked" => snapshot.untracked.push("other".into()),
                _ => snapshot.ignored.push(crate::snapshot::IgnoredEntry {
                    path: "other".into(),
                    executable: false,
                    symlink: false,
                }),
            };
            if side != "expected" {
                mutate(&mut actual);
            }
            if side != "actual" {
                mutate(&mut expected_case);
            }
            let plain = discover(&actual);
            let observed = discover_root_observed(&actual, &expected_case, None, &mut observer);
            assert!(observer.root_routed_round().is_some(), "{side} {kind}");
            assert!(!observer.root_candidate(), "{side} {kind}");
            assert_eq!(discovery(&plain), discovery(&observed));
            assert_eq!(
                report(&crate::validation::validate(
                    &actual,
                    "rust/inventory.json",
                    &original.manifest,
                    plain
                )),
                report(&crate::validation::validate(
                    &actual,
                    "rust/inventory.json",
                    &original.manifest,
                    observed
                ))
            );
        }
    }
    for path in [".cargo/config", ".cargo/config.toml"] {
        for side in ["actual", "expected", "both"] {
            let mut actual = copy_snapshot(&original.snapshot);
            let mut expected_case = copy_snapshot(&expected);
            if side != "expected" {
                actual.entries.insert(path.into(), entry(path, "[build]\n"));
            }
            if side != "actual" {
                expected_case
                    .entries
                    .insert(path.into(), entry(path, "[build]\n"));
            }
            let plain = discover(&actual);
            let observed = discover_root_observed(&actual, &expected_case, None, &mut observer);
            assert!(observer.root_routed_round().is_some(), "{side} {path}");
            assert!(!observer.root_candidate(), "{side} {path}");
            assert_eq!(discovery(&plain), discovery(&observed));
            assert_eq!(
                report(&crate::validation::validate(
                    &actual,
                    "rust/inventory.json",
                    &original.manifest,
                    plain
                )),
                report(&crate::validation::validate(
                    &actual,
                    "rust/inventory.json",
                    &original.manifest,
                    observed
                ))
            );
        }
    }
    let mut swapped = copy_snapshot(&expected);
    swapped
        .entries
        .get_mut("Cargo.toml")
        .unwrap()
        .bytes
        .push(b' ');
    assert!(super::rust_namespace_screen::screen(
        &swapped.entries["Cargo.toml"].bytes,
        &swapped.entries["src/lib.rs"].bytes
    ));
    discover_root_observed(&original.snapshot, &swapped, None, &mut observer);
    assert!(!observer.root_candidate());
    let mut empty_root = copy_snapshot(&expected);
    empty_root.entries.get_mut("src/lib.rs").unwrap().bytes = b"fn empty() {}".to_vec();
    empty_root.entries.insert(
        "src/other.rs".into(),
        entry(
            "src/other.rs",
            "fn other() { ::std::fs::write(\"a\", \"b\"); }",
        ),
    );
    discover_root_observed(&empty_root, &empty_root, None, &mut observer);
    assert!(observer
        .rust_partial_records()
        .unwrap()
        .iter()
        .any(|record| record.path == "src/other.rs"));
    assert!(!observer.root_candidate());
    let mut changed = copy_snapshot(&expected);
    changed
        .entries
        .get_mut("src/lib.rs")
        .unwrap()
        .bytes
        .push(b' ');
    discover_root_observed(&original.snapshot, &changed, None, &mut observer);
    assert!(!observer.root_candidate());
    discover_root_observed(&original.snapshot, &expected, Some(0), &mut observer);
    assert!(!observer.root_candidate());
    let mut symlink = copy_snapshot(&expected);
    symlink.entries.get_mut("src/lib.rs").unwrap().mode = 0o120000;
    discover_root_observed(&symlink, &symlink, None, &mut observer);
    assert!(!observer.root_candidate());
    let mut bad = copy_snapshot(&expected);
    bad.entries.get_mut("src/lib.rs").unwrap().bytes = vec![0xff];
    discover_root_observed(&bad, &bad, None, &mut observer);
    assert!(!observer.root_candidate());
    bad.entries.get_mut("src/lib.rs").unwrap().bytes = vec![b' '; 2_097_153];
    discover_root_observed(&bad, &bad, None, &mut observer);
    assert!(!observer.root_candidate());
    // Helper-level duplicate/reset, not an actual stale-only restart.
    crate::discovery::root_reset_helper_control(&expected);

    let cargo = &expected.entries["Cargo.toml"].bytes;
    let source = &expected.entries["src/lib.rs"].bytes;
    let cargo_text = std::str::from_utf8(cargo).unwrap();
    let source_text = std::str::from_utf8(source).unwrap();
    // Screen-only mutations; they do not claim separate discovery routes.
    for (manifest, code) in [
        (
            cargo_text.replace("edition = \"2021\"", "edition = \"2018\""),
            source_text.to_owned(),
        ),
        (
            cargo_text.replace("src/lib.rs", "src/other.rs"),
            source_text.to_owned(),
        ),
        (
            format!("{cargo_text}\n[workspace]\n"),
            source_text.to_owned(),
        ),
        (
            format!("{cargo_text}\n[dependencies]\nstd = \"1\"\n"),
            source_text.to_owned(),
        ),
        (
            cargo_text.to_owned(),
            format!("mod std {{}}\n{source_text}"),
        ),
        (
            cargo_text.to_owned(),
            format!("extern crate core as std;\n{source_text}"),
        ),
        (
            cargo_text.to_owned(),
            format!("use core as std;\n{source_text}"),
        ),
        (
            cargo_text.to_owned(),
            format!("use core::*;\n{source_text}"),
        ),
        (
            cargo_text.to_owned(),
            format!("#[cfg(unix)]\n{source_text}"),
        ),
        (
            cargo_text.to_owned(),
            format!("macro_rules! x {{ () => {{}} }}\n{source_text}"),
        ),
    ] {
        assert!(!super::rust_namespace_screen::screen(
            manifest.as_bytes(),
            code.as_bytes()
        ));
    }
    let ids = ["C01", "P01", "N02a"];
    let mut baseline = Vec::new();
    for id in ids {
        let control = super::materialize(id);
        let routed = discover_root_observed(&control.snapshot, &expected, None, &mut observer);
        let projection = discovery(&routed);
        let validated = crate::validation::validate(
            &control.snapshot,
            "rust/inventory.json",
            &control.manifest,
            routed,
        );
        baseline.push(json!({"discovery": projection, "report": report(&validated)}));
    }
    assert_eq!(
        super::sha(&encoded(json!({"ids": ids, "records": baseline}))),
        "1f4d827984fcf4ab3ce5f57d3120e2fee4d05b2c1212730e0b17947edd0d29f3"
    );
}
