use migration_check::{
    discovery,
    model::{CheckReport, Manifest},
    snapshot::{Entry, Snapshot},
    validation,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const BLOB: &str = "0000000000000000000000000000000000000000";
const MANIFEST: &str = "rust/inventory.json";
const BIN: &str = "package-bin:package.json#/bin/tool";

struct Fixture {
    snapshot: Snapshot,
    manifest: Value,
}
impl Fixture {
    fn new(package: &str) -> Self {
        let mut f = Self {
            snapshot: Snapshot {
                entries: BTreeMap::new(),
                untracked: vec![],
                ignored: vec![],
            },
            manifest: json!({"schema_version":1,"owner":"fixture","reviewed_revision":BLOB,"slices":["rust-tests-and-evals"],"files":[],"components":[],"edges":[]}),
        };
        f.file("package.json", package, 0o100644);
        f.file(MANIFEST, "{}", 0o100644);
        f.manifest["files"][1]["disposition"] = json!("inventory-description");
        f.manifest["files"][1]["reviewed_git_blob"] = Value::Null;
        f
    }
    fn file(&mut self, path: &str, text: &str, mode: u32) {
        self.snapshot.entries.insert(
            path.into(),
            Entry {
                path: path.into(),
                mode,
                blob: BLOB.into(),
                bytes: text.as_bytes().to_vec(),
            },
        );
        self.manifest["files"].as_array_mut().unwrap().push(json!({"path":path,"reviewed_git_blob":BLOB,"disposition":if mode == 0o120000 {"symlink"} else {"reviewed-source"},"reason":"synthetic reviewed source","components":[]}));
    }
    fn component(&mut self, id: &str, path: &str, language: &str, form: &str) {
        self.manifest["components"].as_array_mut().unwrap().push(json!({"id":id,"source":{"path":path,"anchor":"","start_line":1,"end_line":self.snapshot.entries[path].bytes.split(|b|*b==b'\n').count().saturating_sub(1).max(1),"language":language,"form":form},"owner":"fixture","caller_boundary":"synthetic package entry","migration_slice":"rust-tests-and-evals","disposition":"eligible","exception_reason":null,"generated_targets":[],"resolution":null,"contracts":[]}));
        let file = self.manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|f| f["path"] == path)
            .unwrap();
        file["components"].as_array_mut().unwrap().push(json!(id));
    }
    fn target(&mut self) {
        self.file("tools/tool", "#!/bin/bash\nexit 0\n", 0o100644);
        self.component("program:tools/tool", "tools/tool", "bash", "program");
    }
    fn alias(&mut self, id: &str, to: &str) {
        self.component(id, "package.json", "json", "registry");
        self.edge(id, to, "invokes");
    }
    fn edge(&mut self, from: &str, to: &str, kind: &str) {
        let id = format!("edge:{}", self.manifest["edges"].as_array().unwrap().len());
        self.manifest["edges"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id,"from":from,"to":to,"kind":kind}));
    }
    fn check(&self) -> CheckReport {
        let manifest: Manifest = serde_json::from_value(self.manifest.clone()).unwrap();
        validation::validate(
            &self.snapshot,
            MANIFEST,
            &manifest,
            discovery::discover(&self.snapshot),
        )
    }
    fn accepts(&self) {
        assert!(
            self.check().diagnostics.is_empty(),
            "{:?}",
            self.check().diagnostics
        );
    }
    fn rejects(&self, code: &str) {
        assert!(
            self.check().diagnostics.iter().any(|d| d.code == code),
            "expected {code}, got {:?}",
            self.check().diagnostics
        );
    }
}

#[test]
fn complete_entry_and_omitted_entry_have_distinct_decisions() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/tool"}}"#);
    f.target();
    f.rejects("unclassified-component");
    f.alias(BIN, "program:tools/tool");
    f.accepts();
    f.manifest["edges"] = json!([]);
    f.rejects("missing-caller-edge");
}

#[test]
fn aliases_sharing_a_target_remain_separate_obligations() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"./tools/tool","second":"tools/tool"}}"#);
    f.target();
    f.alias(BIN, "program:tools/tool");
    f.rejects("unclassified-component");
    f.alias("package-bin:package.json#/bin/second", "program:tools/tool");
    f.accepts();
}

#[test]
fn string_form_uses_unscoped_command_name() {
    for name in ["tool", "@scope/tool"] {
        let mut f = Fixture::new(&format!(r#"{{"name":"{name}","bin":"./tools/tool"}}"#));
        f.target();
        f.rejects("unclassified-component");
        f.alias(BIN, "program:tools/tool");
        f.accepts();
    }
}

#[test]
fn malformed_and_duplicate_tables_cannot_hide_entries() {
    for package in [
        r#"{"bin":{"tool":"tools/tool","tool":"other"}}"#,
        r#"{"bin":{"tool":"tools/tool"},"bin":{}}"#,
        r#"{"bin":null}"#,
        r#"{"bin":[]}"#,
        r#"{"bin":{"tool":false}}"#,
        r#"{"bin":{"../tool":"tools/tool"}}"#,
        r#"{"bin":"tools/tool"}"#,
        r#"{"name":"@scope/../tool","bin":"tools/tool"}"#,
    ] {
        Fixture::new(package).rejects("invalid-package-bin");
    }
}

#[test]
fn unsafe_paths_and_missing_targets_stay_unresolved() {
    for target in [
        "../tool",
        "tools/../tool",
        "/outside/tool",
        "tools\\tool",
        "tools//tool",
        "",
        "tools/\ntool",
    ] {
        let package = json!({"bin":{"tool":target}}).to_string();
        Fixture::new(&package).rejects("invalid-package-bin");
    }
    Fixture::new(r#"{"bin":{"tool":"tools/missing"}}"#).rejects("unresolved-package-bin");
}

#[test]
fn symlinks_resolve_only_inside_the_indexed_snapshot() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/link"}}"#);
    f.target();
    f.file("tools/link", "tool", 0o120000);
    f.alias(BIN, "program:tools/tool");
    f.accepts();
    for link in ["../../outside", "link"] {
        f.snapshot.entries.get_mut("tools/link").unwrap().bytes = link.as_bytes().to_vec();
        f.rejects("unresolved-package-bin");
    }
}

#[test]
fn nested_interpreter_body_is_not_erased_by_package_entry() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/tool"}}"#);
    f.target();
    f.alias(BIN, "program:tools/tool");
    f.snapshot.entries.get_mut("tools/tool").unwrap().bytes =
        b"#!/bin/bash\npython3 -c 'print(1)'\n".to_vec();
    f.rejects("unclassified-component");
}

#[test]
fn package_without_bin_creates_no_entry() {
    Fixture::new(r#"{"name":"tool","description":"bin tools/example is documentation"}"#).accepts();
}

#[test]
fn generated_entry_requires_unique_observed_producer_and_exact_entry_edge() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/guard"}}"#);
    f.file(
        "src/generator.ts",
        "writeFileSync('tools/guard', '#!/bin/bash\\nexit 0\\n');\n",
        0o100644,
    );
    f.component(
        "program:src/generator.ts",
        "src/generator.ts",
        "typescript",
        "program",
    );
    let call = "call:src/generator.ts:0:53";
    let body = "body:call:src/generator.ts:0:53:0";
    let receipt = json!([{"site":{"path":"src/generator.ts","start":0,"end":53},"operation":"write","callee":"node:fs/writeFileSync","arguments":[
        {"kind":"text","value":["tools/guard",{"path":"src/generator.ts","start":14,"end":27}]},
        {"kind":"text","value":["#!/bin/bash\nexit 0\n",{"path":"src/generator.ts","start":29,"end":52}]}
    ]}]);
    f.component(call, "src/generator.ts", "typescript", "call-site");
    f.component(body, "src/generator.ts", "bash", "generated-program");
    f.manifest["components"][1]["call_receipts"] = receipt.clone();
    f.manifest["components"][2]["call_receipts"] = receipt;
    f.manifest["components"][1]["generated_targets"] =
        json!([{"id":"output:guard","path":"tools/guard","condition":null,"consumer":"fixture"}]);
    f.edge("program:src/generator.ts", call, "invokes");
    f.edge(call, body, "renders");
    f.edge(call, "output:guard", "writes-executable");
    f.rejects("unclassified-component");
    f.alias(BIN, "output:guard");
    f.accepts();
    let complete = f.manifest.clone();
    f.manifest["edges"]
        .as_array_mut()
        .unwrap()
        .retain(|e| e["from"] != BIN);
    f.rejects("missing-caller-edge");
    f.manifest = complete.clone();
    f.manifest["edges"]
        .as_array_mut()
        .unwrap()
        .retain(|e| e["kind"] != "writes-executable");
    f.rejects("unresolved-package-bin");
    f.manifest = complete.clone();
    f.manifest["components"][1]["generated_targets"].as_array_mut().unwrap().push(json!({"id":"output:second","path":"tools/guard","condition":null,"consumer":"fixture"}));
    f.edge(call, "output:second", "writes-executable");
    f.rejects("unresolved-package-bin");
    f.manifest = complete;
    f.manifest["components"][1]["generated_targets"] = json!([]);
    f.manifest["components"][0]["generated_targets"] = json!([{"id":"output:guard","path":"tools/guard","condition":null,"consumer":"invented output on program"}]);
    f.rejects("unresolved-package-bin");
}

#[test]
fn actual_package_executable_rows_have_source_bound_identities() {
    let entries =
        migration_check::package_entries::inspect(include_bytes!("../../package.json")).unwrap();
    let actual: Vec<_> = entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry.target.as_str()))
        .collect();
    assert_eq!(
        actual,
        vec![
            ("package-bin:package.json#/bin/agentbrew", "dist/cli.js"),
            (
                "package-bin:package.json#/bin/storybook-screenshot",
                "dist/storybook-screenshot.js"
            ),
        ]
    );
}

#[test]
fn unknown_indexed_program_is_not_granted_a_language_by_bin() {
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/tool"}}"#);
    f.file("tools/tool", "opaque instruction format\n", 0o100644);
    f.rejects("unsupported-executable");
}

#[test]
fn symbolic_producer_receipt_cannot_prove_a_static_package_target() {
    use migration_check::{host_graph::Datum, native_facts::RequiredTarget};
    let mut f = Fixture::new(r#"{"bin":{"tool":"tools/guard"}}"#);
    f.file("src/create.ts","import {writeFileSync as emit} from 'node:fs'; export function create(path, body) { emit(path, body); }",0o100644);
    f.file(
        "src/main.ts",
        "import {create} from './create.js'; create('tools/actual', '#!/bin/sh\\nexit 0\\n');",
        0o100644,
    );
    let discovered = discovery::discover(&f.snapshot);
    let (producer, output) = discovered
        .boundaries
        .values()
        .find_map(|boundary| {
            boundary.targets.iter().find_map(|target| match target {
                RequiredTarget::Output(value @ Datum::Input(_, _)) => {
                    Some((boundary.id.clone(), value.clone()))
                }
                _ => None,
            })
        })
        .expect("actual exported wrapper retains its parameter-derived output");
    f.component(&producer, "src/create.ts", "typescript", "call-site");
    f.manifest["components"][0]["generated_targets"] = json!([{"id":"output:symbolic","path":"tools/guard","condition":null,"consumer":"static package entry","output_receipt":output}]);
    f.edge(&producer, "output:symbolic", "writes-executable");
    f.alias(BIN, "output:symbolic");
    let manifest: Manifest = serde_json::from_value(f.manifest).unwrap();
    let errors = migration_check::package_entries::validate(&manifest, &discovered);
    assert!(
        errors
            .iter()
            .any(|error| error.code == "unresolved-package-bin"),
        "a symbolic receipt does not establish the static package target: {errors:?}"
    );
}
