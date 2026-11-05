#![cfg(unix)]
#![forbid(unsafe_code)]

use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
const PARSER_PATH: &str = "hooks/lib/pr-command-target.py";
const PARSER_BLOB: &str = "b27c7c158c08ac255496dffd6427bf8763fba3e3";
const PARSER_SOURCE: &[u8] = include_bytes!("../fixtures/pr-command-target.source");

struct Fixture {
    scratch: PathBuf,
    root: PathBuf,
    home: PathBuf,
    manifest: Value,
}

impl Fixture {
    fn new() -> Self {
        let scratch = std::env::temp_dir().join(format!(
            "reviewed-source-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&scratch).unwrap();
        let root = scratch.join("repo");
        let home = scratch.join("home");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&home).unwrap();
        let fixture = Self {
            scratch,
            root,
            home,
            manifest: json!({
                "schema_version":1,"owner":"agentbrew",
                "reviewed_revision":"0000000000000000000000000000000000000000",
                "slices":["rust-source-inventory","rust-hooks-and-generated-helpers"],
                "files":[{"path":"rust/inventory.json","reviewed_git_blob":null,
                    "disposition":"inventory-description","reason":"Exact manifest self-description",
                    "components":[]}],
                "components":[],"edges":[]
            }),
        };
        fixture.git(&["init", "--quiet", "--template="]);
        fixture
    }

    fn git(&self, args: &[&str]) -> String {
        let mut command = Command::new("git");
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(name);
            }
        }
        let output = command
            .args([
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "synthetic fixture Git setup failed"
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn program(&mut self, path: &str, source: &[u8], language: &str) {
        let target = self.root.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, source).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        let id = format!("program:{path}");
        self.manifest["files"].as_array_mut().unwrap().push(json!({
            "path":path,"reviewed_git_blob":null,"disposition":"reviewed-source",
            "reason":"Exact source subject inspected by the checker, never executed",
            "components":[id]
        }));
        self.manifest["components"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id":id,"source":{"path":path,"anchor":"","start_line":1,
                    "end_line":std::str::from_utf8(source).unwrap().lines().count(),
                    "language":language,"form":"program"},
                "owner":"agentbrew","caller_boundary":"Static inventory subject only",
                "migration_slice":"rust-hooks-and-generated-helpers","disposition":"eligible",
                "exception_reason":null,"generated_targets":[],"resolution":null,
                "contracts":[],"call_receipts":[]
            }));
    }

    fn seal(&mut self) {
        self.git(&["add", "--all"]);
        let paths: Vec<String> = self.manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|file| file["path"].as_str())
            .filter(|path| *path != "rust/inventory.json")
            .map(str::to_owned)
            .collect();
        for path in paths {
            let blob = self.git(&["rev-parse", &format!(":{path}")]);
            if path == PARSER_PATH && fs::read(self.root.join(&path)).unwrap() == PARSER_SOURCE {
                assert_eq!(blob, PARSER_BLOB, "actual public source oracle changed");
            }
            let file = self.manifest["files"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|file| file["path"] == path)
                .unwrap();
            file["reviewed_git_blob"] = blob.into();
        }
        fs::create_dir_all(self.root.join("rust")).unwrap();
        fs::write(
            self.root.join("rust/inventory.json"),
            serde_json::to_vec_pretty(&self.manifest).unwrap(),
        )
        .unwrap();
        self.git(&["add", "--all"]);
    }

    fn codes(&self) -> Vec<String> {
        let output = Command::new(env!("CARGO_BIN_EXE_migration-check"))
            .args([
                "inventory",
                "--check",
                "--json",
                "--manifest",
                "rust/inventory.json",
                "--root",
            ])
            .arg(&self.root)
            .output()
            .unwrap();
        assert!(
            matches!(output.status.code(), Some(0 | 1 | 2)),
            "checker failed outside the diagnostic contract"
        );
        let report: Value = serde_json::from_slice(&output.stdout).expect("checker JSON report");
        if let Some(diagnostics) = report["diagnostics"].as_array() {
            diagnostics
                .iter()
                .map(|item| item["code"].as_str().unwrap().to_owned())
                .collect()
        } else {
            vec![report["error"]["code"]
                .as_str()
                .expect("terminal diagnostic code")
                .to_owned()]
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.scratch).unwrap();
    }
}

#[test]
fn supported_native_positive_proves_reader_and_driver_are_available() {
    let mut fixture = Fixture::new();
    fixture.program(
        "scripts/native.sh",
        b"#!/bin/sh\ntouch REGISTRY_SOURCE_NOT_EXECUTED\n",
        "sh",
    );
    fixture.seal();
    assert_eq!(fixture.codes(), Vec::<String>::new());
    assert!(!fixture.root.join("REGISTRY_SOURCE_NOT_EXECUTED").exists());
}

#[test]
fn actual_reviewed_parser_requires_its_compiled_source_record() {
    let mut fixture = Fixture::new();
    fixture.program(PARSER_PATH, PARSER_SOURCE, "python");
    fixture.seal();
    assert_eq!(
        fixture.codes(),
        Vec::<String>::new(),
        "complete actual source needs a reviewed-source discovery record"
    );
}

#[test]
fn actual_source_data_regions_match_an_independent_literal_oracle() {
    use migration_check::reviewed_sources::{self, DataKind};
    use migration_check::snapshot::{CargoArtifact, HeldRoot};
    let mut fixture = Fixture::new();
    fixture.program(PARSER_PATH, PARSER_SOURCE, "python");
    fixture.seal();
    let artifact = CargoArtifact::from_cargo_build(env!("CARGO_BIN_EXE_migration-check")).unwrap();
    let snapshot = HeldRoot::open_with_cargo_artifact(&fixture.root, &artifact)
        .unwrap()
        .snapshot()
        .unwrap();
    let evidence = reviewed_sources::inspect(&snapshot).unwrap();
    assert_eq!(evidence.len(), 1);
    let record = &evidence[0];
    assert_eq!(record.path, PARSER_PATH);
    assert_eq!(record.git_blob, PARSER_BLOB);
    let source = std::str::from_utf8(PARSER_SOURCE).unwrap();
    let expected = [
        ("tokenize-command", "shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)", "shlex.shlex", "python:shlex/shlex", DataKind::ParseData, "parameter:command-text", "data:command-words"),
        ("read-transcript", "open(sys.argv[1], encoding=\"utf-8\")", "open", "python:builtins/open", DataKind::DataFileRead, "argv:1:data-path", "data:transcript-lines"),
        ("parse-row", "json.loads(line)", "json.loads", "python:json/loads", DataKind::ParseData, "data:transcript-line", "data:parsed-record"),
        ("emit-target", "print(json.dumps({\"activity\": activity, \"unavailable\": unavailable, **(latest or {})}))", "print", "python:builtins/print", DataKind::DataOutput, "data:target-record", "stdout:json"),
    ];
    assert_eq!(
        record.data_regions.len(),
        expected.len(),
        "fixed actual-source oracle, independent of registry data"
    );
    for (actual, (id, expression, spelling, identity, kind, input, output)) in
        record.data_regions.iter().zip(expected)
    {
        assert_eq!(
            source.match_indices(expression).count(),
            1,
            "actual source site must be unambiguous"
        );
        let start = source.find(expression).unwrap() as u32;
        assert_eq!(actual.id, id);
        assert_eq!(
            (actual.source.start, actual.source.end),
            (start, start + expression.len() as u32)
        );
        assert_eq!(
            &source[actual.source.start as usize..actual.source.end as usize],
            expression
        );
        assert_eq!(
            &source[actual.callee.start as usize..actual.callee.end as usize],
            spelling
        );
        assert_eq!(actual.spelling, spelling);
        assert_eq!(actual.identity, identity);
        assert_eq!(actual.kind, kind);
        assert_eq!(actual.inputs, [input]);
        assert_eq!(actual.outputs, [output]);
    }
    let entry = "if __name__ == \"__main__\":\n    main()\n";
    assert_eq!(
        &source[record.entry.start as usize..record.entry.end as usize],
        entry
    );
}

#[test]
fn another_path_cannot_borrow_a_compiled_record_for_the_same_bytes() {
    let mut fixture = Fixture::new();
    fixture.program("hooks/lib/unreviewed-copy.py", PARSER_SOURCE, "python");
    fixture.seal();
    assert!(fixture
        .codes()
        .iter()
        .any(|code| code == "reviewed-source-registry-required"));
}

#[test]
fn changed_source_cannot_reuse_the_compiled_receipt() {
    let mut fixture = Fixture::new();
    let mut changed = PARSER_SOURCE.to_vec();
    changed.extend_from_slice(b"# changed source receipt\n");
    fixture.program(PARSER_PATH, &changed, "python");
    fixture.seal();
    assert!(fixture
        .codes()
        .iter()
        .any(|code| code == "stale-reviewed-source"));
}

#[test]
fn manifest_cannot_supply_or_select_a_source_registry() {
    let mut fixture = Fixture::new();
    fixture.program(PARSER_PATH, PARSER_SOURCE, "python");
    fixture.manifest["reviewed_sources"] = json!([{"path":PARSER_PATH,"complete":true}]);
    fixture.seal();
    assert!(fixture
        .codes()
        .iter()
        .any(|code| code == "invalid-manifest"));
}

#[test]
fn parsed_command_text_cannot_be_declared_an_executable_body() {
    let mut fixture = Fixture::new();
    fixture.program(PARSER_PATH, PARSER_SOURCE, "python");
    let mut invented = fixture.manifest["components"][0].clone();
    invented["id"] = "invented:command-text".into();
    invented["source"]["form"] = "embedded-program".into();
    fixture.manifest["components"]
        .as_array_mut()
        .unwrap()
        .push(invented);
    fixture.manifest["files"][1]["components"]
        .as_array_mut()
        .unwrap()
        .push("invented:command-text".into());
    fixture.seal();
    assert!(fixture
        .codes()
        .iter()
        .any(|code| code == "reviewed-source-manifest-binding"));
}

#[test]
fn actual_rust_canary_body_caller_and_output_have_independent_source_evidence() {
    use migration_check::host_graph::Datum;
    use migration_check::native_facts::RequiredTarget;
    use migration_check::snapshot::{CargoArtifact, HeldRoot};
    const PATH: &str = "rust/tests/snapshot.rs";
    const BLOB: &str = "5c6794f8e0751e3e3d1045972def717bbd1be8d3";
    const SOURCE: &[u8] = include_bytes!("../fixtures/snapshot-rust.source");
    const BODY: &str = "#!/bin/sh\nprintf 'called\\n' >> \"$MIGRATION_FIXTURE_MARKER\"\nexit 1\n";
    let mut fixture = Fixture::new();
    fixture.program(PATH, SOURCE, "rust");
    fixture.manifest["components"][0]["disposition"] = "native".into();
    fixture.manifest["components"][0]["migration_slice"] = "rust-source-inventory".into();
    fixture.seal();
    assert_eq!(fixture.git(&["rev-parse", &format!(":{PATH}")]), BLOB);
    let artifact = CargoArtifact::from_cargo_build(env!("CARGO_BIN_EXE_migration-check")).unwrap();
    let snapshot = HeldRoot::open_with_cargo_artifact(&fixture.root, &artifact)
        .unwrap()
        .snapshot()
        .unwrap();
    let observed = migration_check::discovery::discover(&snapshot);
    assert!(
        !observed
            .diagnostics
            .iter()
            .any(|item| item.code.starts_with("reviewed-producer-")),
        "actual producer evidence must satisfy its source bindings: {:?}",
        observed.diagnostics
    );

    let source = std::str::from_utf8(SOURCE).unwrap();
    let start = source.find("fs::write(\n        &program,").unwrap();
    let end = start + source[start..].find("\n    )").unwrap() + "\n    )".len();
    let call = format!("call:{PATH}:{start}:{end}");
    let body_id = format!("body:{call}:0");
    let fact = observed
        .facts
        .get(&body_id)
        .expect("actual Rust canary generated body cannot be omitted");
    assert_eq!(fact.path, PATH);
    assert_eq!(fact.form, "generated-program");
    assert_eq!(fact.language, "sh");
    let boundary = observed
        .boundaries
        .get(&call)
        .expect("actual Rust writer call");
    let producer = observed
        .reviewed_producers
        .iter()
        .find(|item| item.event.site.start as usize == start)
        .unwrap();
    assert_eq!(
        producer.event.owner,
        Some(source.find("fn canary_program(").unwrap() as u32),
        "actual caller function scope is fixed independently of registry data"
    );
    assert_eq!(producer.environment_inputs, ["MIGRATION_FIXTURE_MARKER"]);
    assert_eq!(producer.executable_mode, 0o700);

    assert_eq!(boundary.receipts.len(), 1);
    assert_eq!(boundary.receipts[0].callee, "rust:std::fs/write");
    let body = boundary
        .bodies
        .iter()
        .find(|body| body.language == "sh")
        .unwrap();
    assert!(matches!(&body.value, Datum::Text(value, _) if value == BODY));
    let origin = source.find("let program = directory.join(name);").unwrap() as u32;
    assert!(
        boundary.targets.iter().any(|target| matches!(target,
            RequiredTarget::Output(Datum::Input(site, names))
                if site.path==PATH && site.start==origin && names==&["canary-output".to_owned()]
        )),
        "actual output retains its reviewed variable/caller provenance"
    );
    assert!(observed
        .required_targets
        .iter()
        .any(|(from, to, kind)| from == &format!("program:{PATH}")
            && to == &call
            && kind == "invokes"));
    assert!(
        observed
            .diagnostics
            .iter()
            .any(|item| item.code == "reviewed-source-registry-required"),
        "one producer record must not approve the rest of the Rust program"
    );
}

#[test]
fn actual_rust_inner_attribute_is_owned_source_not_an_unknown_shebang() {
    let source = std::str::from_utf8(include_bytes!("../fixtures/snapshot-rust.source")).unwrap();
    assert!(source.starts_with("#![cfg(unix)]"));
    assert_eq!(
        migration_check::source_kind::language("rust/tests/snapshot.rs", source),
        Some("rust")
    );
    assert_eq!(
        migration_check::source_kind::language(
            "tools/unknown.rs",
            "#!/usr/bin/unknown-language\nbody\n"
        ),
        None
    );
}
