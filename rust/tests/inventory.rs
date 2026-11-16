#![cfg(unix)]
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn git_command(root: &std::path::Path) -> Command {
    let mut cmd = Command::new("git");
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            cmd.env_remove(key);
        }
    }
    cmd.args([
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
    ])
    .current_dir(root)
    .env("GIT_CONFIG_GLOBAL", "/dev/null")
    .env("GIT_CONFIG_NOSYSTEM", "1");
    cmd
}

struct Fixture {
    root: PathBuf,
    manifest: Value,
}
impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "migration-inventory-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let mut f = Self {
            root,
            manifest: json!({"schema_version":1,"owner":"fixture","reviewed_revision":"0000000000000000000000000000000000000000","slices":["rust-tests-and-evals"],"files":[],"components":[],"edges":[]}),
        };
        f.git(&["init", "-q", "--template="]);
        f.file("scripts/base.sh", "#!/bin/bash\nexit 0\n", true);
        f.program("scripts/base.sh", "bash", 2);
        f.manifest["files"].as_array_mut().unwrap().push(json!({"path":"rust/inventory.json","reviewed_git_blob":null,"disposition":"inventory-description","reason":"Self-description avoids circular receipt","components":[]}));
        f.seal();
        f
    }
    fn git(&self, args: &[&str]) -> String {
        let out = git_command(&self.root).args(args).output().unwrap();
        assert!(out.status.success(), "fixture Git failed");
        String::from_utf8(out.stdout).unwrap().trim().into()
    }
    fn file(&mut self, path: &str, text: &str, executable: bool) {
        let target = self.root.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, text).unwrap();
        fs::set_permissions(
            target,
            fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
        )
        .unwrap();
        if !self.manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["path"] == path)
        {
            self.manifest["files"].as_array_mut().unwrap().push(json!({"path":path,"reviewed_git_blob":null,"disposition":"reviewed-data","reason":"Explicit fixture data","components":[]}));
        }
    }
    fn component(
        &mut self,
        id: &str,
        path: &str,
        language: &str,
        form: &str,
        start: usize,
        end: usize,
        anchor: &str,
    ) {
        self.manifest["components"].as_array_mut().unwrap().push(json!({"id":id,"source":{"path":path,"anchor":anchor,"start_line":start,"end_line":end,"language":language,"form":form},"owner":"fixture","caller_boundary":"fixture entrypoint","migration_slice":"rust-tests-and-evals","disposition":"eligible","exception_reason":null,"generated_targets":[],"resolution":null,"contracts":[]}));
    }
    fn program(&mut self, path: &str, language: &str, end: usize) {
        self.component(
            &format!("program:{path}"),
            path,
            language,
            "program",
            1,
            end,
            "",
        );
    }
    fn seal(&mut self) {
        self.git(&["add", "--all"]);
        for file in self.manifest["files"].as_array_mut().unwrap() {
            let path = file["path"].as_str().unwrap();
            if path == "rust/inventory.json" {
                continue;
            }
            let out = git_command(&self.root)
                .args(["rev-parse", &format!(":{path}")])
                .output()
                .unwrap();
            if out.status.success() {
                file["reviewed_git_blob"] = String::from_utf8(out.stdout).unwrap().trim().into();
            }
        }
        let components = self.manifest["components"].as_array().unwrap().clone();
        for file in self.manifest["files"].as_array_mut().unwrap() {
            file["components"] = components
                .iter()
                .filter(|c| c["source"]["path"] == file["path"])
                .map(|c| c["id"].clone())
                .collect::<Vec<_>>()
                .into();
        }
        fs::create_dir_all(self.root.join("rust")).unwrap();
        fs::write(
            self.root.join("rust/inventory.json"),
            serde_json::to_vec_pretty(&self.manifest).unwrap(),
        )
        .unwrap();
        self.git(&["add", "--all"]);
    }
    fn report(&self) -> Value {
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
            .expect("trusted Cargo checker artifact starts");
        assert!(
            matches!(output.status.code(), Some(0 | 1 | 2)),
            "checker exited outside the diagnostic contract"
        );
        let report: Value =
            serde_json::from_slice(&output.stdout).expect("checker emits a JSON diagnostic report");
        if report["error"]["code"] == "git-command" {
            if let Some(context) = report["error"].get("transport") {
                eprintln!(
                    "transport-context {}",
                    json!({
                        "operation": context["operation"], "stage": context["stage"],
                        "worker_exit": context["worker_exit"], "worker_signal": context["worker_signal"],
                        "worker_reason": context["worker_reason"]
                    })
                );
            }
        } else if report["diagnostics"].is_array() {
            eprintln!("transport-read-complete");
        }
        report
    }
    fn codes(&self) -> Vec<String> {
        Self::report_codes(&self.report())
    }
    fn report_codes(report: &Value) -> Vec<String> {
        if let Some(diagnostics) = report["diagnostics"].as_array() {
            diagnostics
                .iter()
                .map(|diagnostic| {
                    diagnostic["code"]
                        .as_str()
                        .expect("diagnostic code")
                        .to_owned()
                })
                .collect()
        } else {
            vec![report["error"]["code"]
                .as_str()
                .expect("terminal diagnostic code")
                .to_owned()]
        }
    }
    fn accepts(&self) {
        assert_eq!(self.codes(), Vec::<String>::new());
    }
    fn rejects(&self, code: &str) {
        let codes = self.codes();
        assert!(
            codes.iter().any(|x| x == code),
            "expected {code}, got {:?}",
            codes
        );
    }
    fn rewrite_shell(&mut self, body: &str) {
        self.file("scripts/base.sh", body, true);
        self.manifest["components"][0]["source"]["end_line"] = body.lines().count().into();
        self.seal();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn reviewed_baseline_passes_without_executing_source() {
    let mut f = Fixture::new();
    f.rewrite_shell("#!/bin/bash\ntouch SHOULD_NOT_EXIST\n");
    let report = f.report();
    let codes = Fixture::report_codes(&report);
    if codes.iter().any(|code| code == "git-command") {
        let context = report["error"]
            .get("transport")
            .expect("missing bounded transport context in first checker report");
        let fields = context
            .as_object()
            .expect("transport context must be a bounded object");
        assert!(
            fields.len() == 5
                && fields.keys().all(|key| matches!(
                    key.as_str(),
                    "operation" | "stage" | "worker_exit" | "worker_signal" | "worker_reason"
                )),
            "transport context must contain only the fixed fields"
        );
        assert_eq!(context["operation"], "root-prefix");
        assert!(
            matches!(
                context["stage"].as_str(),
                Some(
                    "input-limit"
                        | "root-clone"
                        | "request-socket"
                        | "request-mode"
                        | "worker-spawn"
                        | "worker-stdout"
                        | "output-mode"
                        | "deadline"
                        | "request-write"
                        | "output-read"
                        | "worker-wait"
                        | "output-limit"
                        | "worker-limit"
                        | "recorded-failure"
                        | "worker-nonzero"
                        | "incomplete-send"
                )
            ),
            "transport context must name a fixed stage"
        );
        for (key, minimum, maximum) in [
            ("worker_exit", 0, 255),
            ("worker_signal", 1, 127),
            ("worker_reason", 4, 32),
        ] {
            let value = &context[key];
            assert!(
                value.is_null()
                    || value
                        .as_u64()
                        .is_some_and(|n| (minimum..=maximum).contains(&n)),
                "transport context must contain only bounded optional numbers"
            );
        }
    }
    assert_eq!(codes, Vec::<String>::new());
    assert!(!f.root.join("SHOULD_NOT_EXIST").exists());
}
#[test]
fn c01_extensionless_executable_requires_program() {
    let mut f = Fixture::new();
    f.file("tools/new", "#!/bin/bash\nexit 0\n", true);
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c02_inline_python_requires_nested_component() {
    let mut f = Fixture::new();
    f.rewrite_shell("#!/bin/bash\npython3 -c 'print(1)'\n");
    f.rejects("unclassified-component");
}
#[test]
fn c03_node_heredoc_omission_and_complete_positive() {
    let mut f = Fixture::new();
    f.manifest["components"][0]["disposition"] = "necessary-shell".into();
    f.manifest["components"][0]["migration_slice"] = Value::Null;
    f.manifest["components"][0]["exception_reason"] =
        "Caller requires a sourced shell context".into();
    f.manifest["allowances"] = json!([{ "component":"program:scripts/base.sh", "disposition":"necessary-shell", "reason":"This exact outer boundary models sourced shell integration" }]);
    f.rewrite_shell("#!/bin/bash\nnode <<'JS'\nconsole.log(1)\nJS\n");
    f.rejects("unclassified-component");
    let call = "call:scripts/base.sh:12:16";
    let body = "body:call:scripts/base.sh:12:16:0";
    let site = json!({"path":"scripts/base.sh","start":12,"end":16});
    let receipt = json!([{"site":site,"operation":"execute","callee":"shell/node","arguments":[
        {"kind":"text","value":["node",site]},
        {"kind":"list","value":[]},
        {"kind":"object","value":{"input":{"kind":"text","value":["console.log(1)\n",{"path":"scripts/base.sh","start":24,"end":39}]}}}
    ]}]);
    f.component(call, "scripts/base.sh", "bash", "call-site", 2, 2, "node");
    f.component(
        body,
        "scripts/base.sh",
        "javascript",
        "embedded-program",
        2,
        4,
        "node",
    );
    f.manifest["components"][1]["call_receipts"] = receipt.clone();
    f.manifest["components"][2]["call_receipts"] = receipt;
    f.manifest["edges"] = json!([
        {"id":"shell-call","from":"program:scripts/base.sh","to":call,"kind":"invokes"},
        {"id":"inline-node","from":call,"to":body,"kind":"invokes-inline"}
    ]);
    f.seal();
    f.accepts();
}
#[test]
fn c04_typescript_executable_writer_requires_generated_program() {
    let mut f = Fixture::new();
    f.file("src/generator.ts","writeFileSync('tools/guard', '#!/bin/bash\\nexit 0\\n');\nchmodSync('tools/guard', 0o755);\n",false);
    f.program("src/generator.ts", "typescript", 2);
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c05_variable_python_is_not_hidden_by_flags() {
    let mut f = Fixture::new();
    f.rewrite_shell("#!/bin/bash\npython_bin=python3\n\"$python_bin\" -I -c 'print(1)'\n");
    f.rejects("unclassified-component");
}
#[test]
fn c06_package_caller_reaches_nonexecutable_extensionless_source() {
    let mut f = Fixture::new();
    f.file("tools/check", "exit 0\n", false);
    f.file(
        "package.json",
        r#"{"scripts":{"check":"bash tools/check"}}"#,
        false,
    );
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c07_workflow_run_requires_program_region() {
    let mut f = Fixture::new();
    f.file(
        ".github/workflows/check.yml",
        "jobs:\n  check:\n    steps:\n      - run: |\n          node -e 'console.log(1)'\n",
        false,
    );
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c08_conditional_template_needs_output_contract() {
    let mut f = Fixture::new();
    let path = "templates/{% if HOOK %}guard{% endif %}.sh.jinja";
    f.file(path, "#!/bin/bash\nexit 0\n", true);
    f.program(path, "bash", 2);
    f.seal();
    f.rejects("missing-template-output");
}
#[test]
fn c09_test_fake_tool_requires_generated_program() {
    let mut f = Fixture::new();
    f.file(
        "tests/fake.ts",
        "writeFileSync('fake/tool', '#!/bin/sh\\nexit 0\\n');\n",
        false,
    );
    f.program("tests/fake.ts", "typescript", 1);
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c10_sourced_unusual_suffix_requires_program() {
    let mut f = Fixture::new();
    f.file("hooks/helpers.rules", "printf ready\n", false);
    f.rewrite_shell("#!/bin/bash\nsource hooks/helpers.rules\n");
    f.seal();
    f.rejects("unclassified-component");
}
#[test]
fn c11_controller_and_data_export_are_not_presentation() {
    for (path, lang, text) in [
        ("src/screenshot.ts", "typescript", "spawn('browser', []);\n"),
        (
            "scripts/export-goals.py",
            "python",
            "import json\nprint(json.dumps({}))\n",
        ),
    ] {
        let mut f = Fixture::new();
        f.file(path, text, false);
        f.program(path, lang, text.lines().count());
        let last = f.manifest["components"].as_array().unwrap().len() - 1;
        f.manifest["components"][last]["disposition"] = "ui".into();
        f.manifest["components"][last]["migration_slice"] = Value::Null;
        f.manifest["components"][last]["exception_reason"] = "All report work is UI".into();
        f.seal();
        f.rejects("invalid-ui-exception");
    }
}
#[test]
fn c12_frozen_residue_cannot_be_marked_migrated() {
    let mut f = Fixture::new();
    f.file("src/agents.ts", "const agent = 'augment';\n", false);
    f.program("src/agents.ts", "typescript", 1);
    f.component(
        "frozen:src/agents.ts:1",
        "src/agents.ts",
        "typescript",
        "frozen-boundary",
        1,
        1,
        "augment",
    );
    f.manifest["components"][2]["disposition"] = "migrated".into();
    f.seal();
    f.rejects("frozen-policy-mismatch");
}
#[test]
fn c13_generated_edge_is_required() {
    let mut f = Fixture::new();
    f.file(
        "src/generator.ts",
        "writeFileSync('tools/guard', '#!/bin/bash\\nexit 0\\n');\n",
        false,
    );
    f.program("src/generator.ts", "typescript", 1);
    let call = "call:src/generator.ts:0:53";
    let body = "body:call:src/generator.ts:0:53:0";
    let receipt = json!([{"site":{"path":"src/generator.ts","start":0,"end":53},"operation":"write","callee":"node:fs/writeFileSync","arguments":[
        {"kind":"text","value":["tools/guard",{"path":"src/generator.ts","start":14,"end":27}]},
        {"kind":"text","value":["#!/bin/bash\nexit 0\n",{"path":"src/generator.ts","start":29,"end":52}]}
    ]}]);
    f.component(
        call,
        "src/generator.ts",
        "typescript",
        "call-site",
        1,
        1,
        "writeFileSync",
    );
    f.component(
        body,
        "src/generator.ts",
        "bash",
        "generated-program",
        1,
        1,
        "writeFileSync",
    );
    f.manifest["components"][2]["call_receipts"] = receipt.clone();
    f.manifest["components"][3]["call_receipts"] = receipt;
    f.manifest["components"][2]["generated_targets"] = json!([{"id":"output:tools/guard","path":"tools/guard","condition":null,"consumer":"fixture"}]);
    f.manifest["edges"] = json!([
        {"id":"host-call","from":"program:src/generator.ts","to":call,"kind":"invokes"},
        {"id":"generated-body","from":call,"to":body,"kind":"renders"},
        {"id":"output-edge","from":call,"to":"output:tools/guard","kind":"writes-executable"}
    ]);
    f.seal();
    f.accepts();
    f.manifest["edges"] = json!([]);
    f.seal();
    f.rejects("missing-generated-edge");
}
#[test]
fn c14_unknown_language_and_dynamic_execution_fail_closed() {
    let mut f = Fixture::new();
    f.file("tools/odd", "#!/usr/bin/unknown-language\nhello\n", true);
    f.seal();
    f.rejects("unsupported-executable");
    let mut f = Fixture::new();
    f.rewrite_shell("#!/bin/bash\n\"$unknown_runner\" \"$payload\"\n");
    f.rejects("unresolved-execution");
}
#[test]
fn c15_renamed_component_and_external_symlink_are_rejected() {
    let mut f = Fixture::new();
    f.manifest["components"][0]["id"] = "program:renamed".into();
    f.seal();
    f.rejects("unclassified-component");
    let mut f = Fixture::new();
    fs::remove_file(f.root.join("scripts/base.sh")).unwrap();
    symlink("/outside/private-source", f.root.join("scripts/base.sh")).unwrap();
    f.seal();
    f.rejects("unsafe-symlink");
}
#[test]
fn c16_inert_examples_comments_data_and_upstream_refs_pass() {
    let mut f = Fixture::new();
    f.rewrite_shell("#!/bin/bash\n# python3 -c 'example'\nprintf '%s\\n' 'node -e example'\n");
    f.file("README.md", "```sh\nnode -e 'example'\n```\n", false);
    f.file(
        "fixtures/record.json",
        r#"{"command":"node -e example"}"#,
        false,
    );
    f.file(
        "package.json",
        r#"{"dependencies":{"upstream":"1.0.0"}}"#,
        false,
    );
    f.seal();
    f.accepts();
}
#[test]
fn new_untracked_source_cannot_escape_index_ledger() {
    let f = Fixture::new();
    fs::write(f.root.join("new.py"), "print(1)\n").unwrap();
    f.rejects("untracked-file");
}
#[test]
fn self_description_cannot_exempt_another_file() {
    let mut f = Fixture::new();
    f.manifest["files"][0]["disposition"] = "inventory-description".into();
    f.manifest["files"][0]["reviewed_git_blob"] = Value::Null;
    f.seal();
    f.rejects("invalid-self-description");
}

#[test]
fn strict_schema_and_duplicate_records_fail_closed() {
    let mut f = Fixture::new();
    f.manifest["unreviewed_option"] = true.into();
    f.seal();
    f.rejects("invalid-manifest");
    let mut f = Fixture::new();
    let duplicate = f.manifest["components"][0].clone();
    f.manifest["components"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    f.seal();
    f.rejects("duplicate-component");
}

#[test]
fn necessary_shell_requires_specific_allowance() {
    let mut f = Fixture::new();
    f.manifest["components"][0]["disposition"] = "necessary-shell".into();
    f.manifest["components"][0]["migration_slice"] = Value::Null;
    f.manifest["components"][0]["exception_reason"] = "Needs the caller shell context".into();
    f.seal();
    f.rejects("invalid-shell-exception");
    f.manifest["allowances"] = json!([{ "component":"program:scripts/base.sh", "disposition":"necessary-shell", "reason":"Fixture models a sourced shell-context boundary" }]);
    f.seal();
    f.accepts();
}

#[test]
fn missing_file_receipt_is_not_reviewed() {
    let mut f = Fixture::new();
    f.manifest["files"].as_array_mut().unwrap().remove(0);
    f.seal();
    f.rejects("unclassified-file");
}

#[test]
fn c01_ignored_executable_omission_is_not_a_build_exemption() {
    let mut f = Fixture::new();
    f.file(".gitignore", "hidden-source/\n", false);
    fs::create_dir(f.root.join("hidden-source")).unwrap();
    let target = f.root.join("hidden-source/guard");
    fs::write(&target, "#!/bin/bash\nexit 0\n").unwrap();
    fs::set_permissions(target, fs::Permissions::from_mode(0o755)).unwrap();
    f.seal();
    f.rejects("untracked-file");
}

#[test]
fn c01_ignored_nonexecutable_known_source_is_not_data() {
    let mut f = Fixture::new();
    f.file(".gitignore", "hidden-source/\n", false);
    fs::create_dir(f.root.join("hidden-source")).unwrap();
    fs::write(
        f.root.join("hidden-source/tool.py"),
        "print('owned code')\n",
    )
    .unwrap();
    f.seal();
    f.rejects("untracked-file");
}

#[test]
fn c01_ignored_unknown_path_needs_explicit_non_source_contract() {
    let mut f = Fixture::new();
    f.file(".gitignore", "cache.ignored\n", false);
    fs::write(f.root.join("cache.ignored"), "inert fixture cache\n").unwrap();
    f.seal();
    f.rejects("untracked-file");
    f.manifest["non_source_allowances"] = json!([{ "path":"cache.ignored", "kind":"non-source", "reason":"This fixture owns an inert generated cache and never executes it" }]);
    f.seal();
    f.accepts();
}

#[test]
fn c01_caller_reached_ignored_target_fails_despite_non_source_contract() {
    let mut f = Fixture::new();
    f.file(".gitignore", "helper.ignored\n", false);
    fs::write(f.root.join("helper.ignored"), "printf called\n").unwrap();
    f.manifest["non_source_allowances"] = json!([{ "path":"helper.ignored", "kind":"non-source", "reason":"A declaration must not erase an actual execution caller" }]);
    f.rewrite_shell("#!/bin/bash\nbash helper.ignored\n");
    f.rejects("ignored-execution-target");
}

#[test]
fn c01_private_configuration_contract_never_reads_payload() {
    let mut f = Fixture::new();
    f.file(".gitignore", ".env\n", false);
    let target = f.root.join(".env");
    fs::write(&target, "SAFE_PLACEHOLDER=fixture\n").unwrap();
    fs::set_permissions(target, fs::Permissions::from_mode(0o000)).unwrap();
    f.manifest["non_source_allowances"] = json!([{ "path":".env", "kind":"private-configuration", "reason":"Owner configuration is a non-source input; metadata only" }]);
    f.seal();
    f.accepts();
}

#[test]
fn c01_non_source_contract_cannot_hide_executable_or_link() {
    let mut f = Fixture::new();
    f.file(".gitignore", "cache.ignored\n", false);
    let target = f.root.join("cache.ignored");
    fs::write(&target, "#!/bin/bash\nexit 0\n").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
    f.manifest["non_source_allowances"] = json!([{ "path":"cache.ignored", "kind":"non-source", "reason":"This must not override executable metadata" }]);
    f.seal();
    f.rejects("untracked-file");
    fs::remove_file(target).unwrap();
    symlink("/outside/private-source", f.root.join("cache.ignored")).unwrap();
    f.seal();
    f.rejects("untracked-file");
}

#[test]
fn generated_executable_without_shebang_cannot_hide_behind_reviewed_calls() {
    let mut f = Fixture::new();
    let source = "writeFileSync('tool', 'exit 0\\n');\nchmodSync('tool', 0o755);\n";
    f.file("src/generator.ts", source, false);
    f.program("src/generator.ts", "typescript", 2);
    let write_end = source.find(';').unwrap();
    let mode_start = source.find("chmodSync").unwrap();
    let mode_end = source.rfind(';').unwrap();
    let site = |start, end| json!({"path":"src/generator.ts","start":start,"end":end});
    let text = |value: &str, start, end| json!({"kind":"text","value":[value,site(start,end)]});
    for (id, start, end, line, callee, arguments) in [
        (
            format!("call:src/generator.ts:0:{write_end}"),
            0,
            write_end,
            1,
            "node:fs/writeFileSync",
            json!([text("tool", 14, 20), text("exit 0\n", 22, 32)]),
        ),
        (
            format!("call:src/generator.ts:{mode_start}:{mode_end}"),
            mode_start,
            mode_end,
            2,
            "node:fs/chmodSync",
            json!([
                text("tool",mode_start+10,mode_start+16),
                {"kind":"number","value":["0o755",site(mode_start+18,mode_start+23)]}
            ]),
        ),
    ] {
        let index = f.manifest["components"].as_array().unwrap().len();
        f.component(
            &id,
            "src/generator.ts",
            "typescript",
            "call-site",
            line,
            line,
            callee.rsplit('/').next().unwrap(),
        );
        f.manifest["components"][index]["call_receipts"] = json!([{"site":site(start,end),"operation":if line==1 {"write"}else{"mode"},"callee":callee,"arguments":arguments}]);
        let output = format!("output:tool:{line}");
        f.manifest["components"][index]["generated_targets"] =
            json!([{"id":output,"path":"tool","condition":null,"consumer":"fixture executable"}]);
        f.manifest["edges"].as_array_mut().unwrap().extend([
            json!({"id":format!("caller:{line}"),"from":"program:src/generator.ts","to":id,"kind":"invokes"}),
            json!({"id":format!("output:{line}"),"from":id,"to":output,"kind":"writes-executable"})
        ]);
    }
    f.seal();
    f.rejects("reviewed-generated-body-required");
}

fn registry_omission(path: &str, source: &str, kind: &str, anchor: &str) {
    let mut f = Fixture::new();
    f.file(path, source, false);
    f.program(path, "typescript", 1);
    f.file("hooks/helpers.rules", "#!/bin/bash\nexit 0\n", false);
    f.program("hooks/helpers.rules", "bash", 2);
    // Program coverage must not replace the actual table-to-source edge.
    f.manifest["registries"] = json!([{"id":"fixture-table","source":path,"kind":kind,"anchor":anchor,"path_prefix":"hooks/","consumer":"fixture deployment"}]);
    f.seal();
    f.rejects("missing-registry-edge");
    f.manifest["edges"] = json!([{
        "id":"reviewed-row", "from":format!("program:{path}"),
        "to":"program:hooks/helpers.rules", "kind":if kind=="bundler" {"bundles"} else {"copies"}
    }]);
    f.seal();
    f.accepts();
    f.manifest["edges"][0]["kind"] = "imports".into();
    f.seal();
    f.rejects("missing-registry-edge");
}

#[test]
fn helper_registry_rows_cannot_be_omitted_from_a_reviewed_table() {
    registry_omission(
        "src/sync/helper-scripts.ts",
        "export const HELPER_SCRIPT_SOURCES={'guard.sh':'hooks/helpers.rules'};\n",
        "helper-source-map",
        "HELPER_SCRIPT_SOURCES",
    );
}

#[test]
fn bundler_registry_rows_cannot_be_omitted_from_a_reviewed_table() {
    registry_omission(
        "tsup.config.ts",
        "import {defineConfig} from 'tsup'; export default defineConfig({entry:['hooks/helpers.rules']});\n",
        "bundler", "entry:",
    );
}

fn invalid_helper_registry_target(target: &str) {
    let mut f = Fixture::new();
    let source = format!("export const HELPER_SCRIPT_SOURCES={{'guard.sh':'{target}'}};\n");
    f.file("src/sync/helper-scripts.ts", &source, false);
    f.program("src/sync/helper-scripts.ts", "typescript", 1);
    f.manifest["registries"] = json!([{"id":"fixture-table","source":"src/sync/helper-scripts.ts","kind":"helper-source-map","anchor":"HELPER_SCRIPT_SOURCES","path_prefix":"hooks/","consumer":"fixture deployment"}]);
    f.seal();
    f.rejects("unresolved-source-registry");
}

#[test]
fn helper_registry_rejects_an_escaping_target_despite_a_table_record() {
    invalid_helper_registry_target("../outside/guard.sh");
}

#[test]
fn helper_registry_rejects_a_missing_target_despite_a_table_record() {
    invalid_helper_registry_target("hooks/missing.sh");
}

#[test]
fn actual_bundler_banner_field_cannot_hide_an_owned_program() {
    let mut f = Fixture::new();
    f.file("tsup.config.ts", "import {defineConfig} from 'tsup'; export default defineConfig({entry:['src/main.ts'],banner:{js:'globalThis.fixtureMarker=true;'}});\n", false);
    f.program("tsup.config.ts", "typescript", 1);
    f.file("src/main.ts", "export {};\n", false);
    f.program("src/main.ts", "typescript", 1);
    f.manifest["registries"] = json!([{"id":"fixture-bundler","source":"tsup.config.ts","kind":"bundler","anchor":"entry:","path_prefix":"src/","consumer":"fixture bundler"}]);
    f.manifest["edges"] = json!([{"id":"entry-row","from":"program:tsup.config.ts","to":"program:src/main.ts","kind":"bundles"}]);
    f.seal();
    f.rejects("reviewed-bundler-producer-required");
}
