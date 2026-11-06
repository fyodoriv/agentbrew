use migration_check::{
    discovery,
    model::{CheckReport, Manifest},
    snapshot::{Entry, Snapshot},
    validation,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

const PACKAGE: &str = "rust/vendor/libproc-0.14.11";
const OWNER: &str = "upstream:libproc@0.14.11";
const SUBJECT: &str = "rust/vendor/libproc-0.14.11/build.rs";
const BLOB: &str = "0000000000000000000000000000000000000000";

struct Fixture {
    snapshot: Snapshot,
    manifest: Value,
}
impl Fixture {
    fn new() -> Self {
        fn collect(root: &Path, path: &Path, entries: &mut BTreeMap<String, Entry>) {
            let meta = fs::symlink_metadata(path).unwrap();
            assert!(
                !meta.file_type().is_symlink(),
                "source fixture cannot follow links"
            );
            if meta.is_dir() {
                for row in fs::read_dir(path).unwrap() {
                    collect(root, &row.unwrap().path(), entries);
                }
            } else {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .replace('\\', "/");
                entries.insert(
                    name.clone(),
                    Entry {
                        path: name,
                        mode: 0o100644,
                        blob: BLOB.into(),
                        bytes: fs::read(path).unwrap(),
                    },
                );
            }
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let mut entries = BTreeMap::new();
        collect(root, &root.join(PACKAGE), &mut entries);
        for path in [
            "rust/Cargo.toml",
            "rust/Cargo.lock",
            "rust/src/lib.rs",
            "rust/src/darwin_group.rs",
        ] {
            entries.insert(
                path.into(),
                Entry {
                    path: path.into(),
                    mode: 0o100644,
                    blob: BLOB.into(),
                    bytes: fs::read(root.join(path)).unwrap(),
                },
            );
        }
        entries.insert(
            "rust/inventory.json".into(),
            Entry {
                path: "rust/inventory.json".into(),
                mode: 0o100644,
                blob: BLOB.into(),
                bytes: b"{}".to_vec(),
            },
        );
        let files:Vec<_>=entries.keys().map(|path|json!({"path":path,"reviewed_git_blob":if path=="rust/inventory.json"{Value::Null}else{json!(BLOB)},"disposition":if path=="rust/inventory.json"{"inventory-description"}else{"reviewed-source"},"reason":"synthetic source snapshot; code is never executed","components":if path==SUBJECT{vec![format!("program:{SUBJECT}")]}else{vec![]}})).collect();
        let lines = std::str::from_utf8(&entries[SUBJECT].bytes)
            .unwrap()
            .lines()
            .count();
        let manifest = json!({"schema_version":1,"owner":"agentbrew","reviewed_revision":BLOB,"slices":["rust-source-inventory"],"files":files,"components":[{"id":format!("program:{SUBJECT}"),"source":{"path":SUBJECT,"anchor":"","start_line":1,"end_line":lines,"language":"rust","form":"program"},"owner":OWNER,"caller_boundary":"Darwin Cargo dependency build script","migration_slice":null,"disposition":"upstream","exception_reason":null,"generated_targets":[],"resolution":null,"contracts":[]}],"edges":[]});
        Self {
            snapshot: Snapshot {
                entries,
                untracked: vec![],
                ignored: vec![],
            },
            manifest,
        }
    }
    fn check(&self) -> CheckReport {
        let manifest: Manifest = serde_json::from_value(self.manifest.clone()).unwrap();
        validation::validate(
            &self.snapshot,
            "rust/inventory.json",
            &manifest,
            discovery::discover(&self.snapshot),
        )
    }
    fn rejects(&self, code: &str) {
        assert!(
            self.check().diagnostics.iter().any(|d| d.code == code),
            "expected {code}; got {:?}",
            self.check().diagnostics
        );
    }
    fn rewrite(&mut self, path: &str, old: &str, new: &str) {
        let entry = self.snapshot.entries.get_mut(path).unwrap();
        let text = String::from_utf8(entry.bytes.clone()).unwrap();
        assert!(text.contains(old));
        entry.bytes = text.replace(old, new).into_bytes();
        // Ordinary source/file receipts stay consistent in this in-memory fixture.
        // The upstream policy must reject changed content independently.
    }
}

#[test]
fn valid_original_owner_does_not_clear_unknown_executable_family() {
    let f = Fixture::new();
    let report = f.check();
    let policy: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| {
            d.path.as_deref() == Some(SUBJECT)
                && matches!(
                    d.code.as_str(),
                    "invalid-component-owner"
                        | "invalid-component-disposition"
                        | "unqualified-upstream-component"
                )
        })
        .collect();
    assert!(
        policy.is_empty(),
        "qualified original source needs upstream ownership, not an owned port: {policy:?}"
    );
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.path.as_deref() == Some(SUBJECT)
                && d.code == "reviewed-source-registry-required"),
        "ownership must not clear unsupported Rust source"
    );
}

#[test]
fn forged_provenance_and_colluding_file_changes_reject() {
    let mut f = Fixture::new();
    let path = format!("{PACKAGE}/build.rs");
    f.snapshot
        .entries
        .get_mut(&path)
        .unwrap()
        .bytes
        .extend_from_slice(b"\n// changed\n");
    use sha2::{Digest, Sha256};
    let bytes = &f.snapshot.entries[&path].bytes;
    let forged_digest: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let metadata_path = format!("{PACKAGE}/UPSTREAM.json");
    let mut metadata: Value =
        serde_json::from_slice(&f.snapshot.entries[&metadata_path].bytes).unwrap();
    metadata["files"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|record| record["path"] == "build.rs")
        .unwrap()["sha256"] = json!(forged_digest);
    f.snapshot.entries.get_mut(&metadata_path).unwrap().bytes =
        serde_json::to_vec_pretty(&metadata).unwrap();
    f.rejects("upstream-provenance-mismatch");
}

#[test]
fn wrong_license_and_patch_bytes_reject() {
    for path in ["LICENSE", "PATCH.diff", "PATCH.json"] {
        let mut f = Fixture::new();
        f.snapshot
            .entries
            .get_mut(&format!("{PACKAGE}/{path}"))
            .unwrap()
            .bytes
            .extend_from_slice(b"\nchanged\n");
        f.rejects("upstream-provenance-mismatch");
    }
}

#[test]
fn missing_cargo_or_rust_consumer_is_not_supplied_by_manifest_edge() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/Cargo.toml",
        "libproc = { version = \"=0.14.11\", path = \"vendor/libproc-0.14.11\" }",
        "",
    );
    f.rejects("upstream-consumer-mismatch");
    let mut f = Fixture::new();
    f.rewrite(
        "rust/src/darwin_group.rs",
        "libproc::processes::bounded_group_pids(group as u32, 1)",
        "unrelated::placeholder(group as u32, 1)",
    );
    f.rejects("upstream-consumer-mismatch");
}

#[test]
fn changed_scope_and_comment_fake_do_not_supply_consumer() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/src/darwin_group.rs",
        "#[cfg(test)]",
        "#[cfg(not(test))]",
    );
    f.rejects("upstream-consumer-mismatch");
    let mut f = Fixture::new();
    f.rewrite("rust/src/darwin_group.rs","let result = libproc::processes::bounded_group_pids(group as u32, 1)","// libproc::processes::bounded_group_pids(group as u32, 1)\n        let result = unrelated::placeholder(group as u32, 1)");
    f.rejects("upstream-consumer-mismatch");
}

#[test]
fn owned_validation_module_and_mixed_program_cannot_be_hidden_as_upstream() {
    for path in [
        "src/libproc/sys/bounded_group.rs",
        "src/libproc/sys/macos.rs",
        "src/processes.rs",
    ] {
        let mut f = Fixture::new();
        let path = format!("{PACKAGE}/{path}");
        f.manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|file| file["path"] == SUBJECT)
            .unwrap()["components"] = json!([]);
        f.manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|file| file["path"] == path)
            .unwrap()["components"] = json!([format!("program:{path}")]);
        f.manifest["components"][0]["id"] = json!(format!("program:{path}"));
        f.manifest["components"][0]["source"]["path"] = json!(path);
        f.manifest["components"][0]["source"]["end_line"] = json!(1);
        f.rejects("unqualified-upstream-component");
    }
}

#[test]
fn valid_comment_only_example_retains_upstream_origin() {
    let mut f = Fixture::new();
    let path = format!("{PACKAGE}/examples/procinfo.rs");
    f.manifest["files"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["path"] == SUBJECT)
        .unwrap()["components"] = json!([]);
    f.manifest["files"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["path"] == path)
        .unwrap()["components"] = json!([format!("program:{path}")]);
    f.manifest["components"][0]["id"] = json!(format!("program:{path}"));
    f.manifest["components"][0]["source"]["path"] = json!(path);
    f.manifest["components"][0]["source"]["end_line"] =
        json!(std::str::from_utf8(&f.snapshot.entries[&path].bytes)
            .unwrap()
            .lines()
            .count());
    let report = f.check();
    assert!(!report
        .diagnostics
        .iter()
        .any(|d| d.path.as_deref() == Some(&path)
            && matches!(
                d.code.as_str(),
                "invalid-component-owner"
                    | "invalid-component-disposition"
                    | "unqualified-upstream-component"
            )));
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.path.as_deref() == Some(&path)
                && d.code == "reviewed-source-registry-required")
    );
}

#[test]
fn changed_mode_missing_file_and_unknown_extra_file_reject() {
    let mut f = Fixture::new();
    f.snapshot.entries.get_mut(SUBJECT).unwrap().mode = 0o100755;
    f.rejects("upstream-provenance-mismatch");
    let mut f = Fixture::new();
    f.snapshot.entries.remove(SUBJECT);
    f.rejects("upstream-provenance-mismatch");
    let mut f = Fixture::new();
    let path = format!("{PACKAGE}/extra.rs");
    f.snapshot.entries.insert(
        path.clone(),
        Entry {
            path,
            mode: 0o100644,
            blob: BLOB.into(),
            bytes: b"fn hidden() {}".to_vec(),
        },
    );
    f.rejects("upstream-provenance-mismatch");
}

#[test]
fn symlink_and_changed_comment_replacements_reject_without_following_targets() {
    let mut f = Fixture::new();
    let entry = f.snapshot.entries.get_mut(SUBJECT).unwrap();
    entry.mode = 0o120000;
    entry.bytes = b"/outside/secret".to_vec();
    f.rejects("upstream-provenance-mismatch");
    let mut f = Fixture::new();
    f.rewrite(
        &format!("{PACKAGE}/examples/procinfo.rs"),
        "//! Path: ~/workspace/libproc-rs/target/debug/procinfo",
        "fn owned_logic() {}",
    );
    f.rejects("upstream-provenance-mismatch");
}

#[test]
fn mixed_whole_program_and_original_source_cannot_be_claimed_as_owned_port() {
    for (path, code) in [
        (SUBJECT.to_string(), "upstream-owner-required"),
        (
            format!("{PACKAGE}/src/processes.rs"),
            "mixed-upstream-ownership",
        ),
    ] {
        let mut f = Fixture::new();
        let old = SUBJECT;
        f.manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|v| v["path"] == old)
            .unwrap()["components"] = json!([]);
        f.manifest["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|v| v["path"] == path)
            .unwrap()["components"] = json!([format!("program:{path}")]);
        f.manifest["components"][0]["id"] = json!(format!("program:{path}"));
        f.manifest["components"][0]["source"]["path"] = json!(path);
        f.manifest["components"][0]["owner"] = json!("agentbrew");
        f.manifest["components"][0]["disposition"] = json!("native");
        f.manifest["components"][0]["migration_slice"] = json!("rust-source-inventory");
        f.rejects(code);
    }
}

#[test]
fn actual_consumer_has_darwin_test_scope_and_separate_owned_include() {
    let f = Fixture::new();
    let evidence = migration_check::upstream_ownership::inspect(&f.snapshot).unwrap();
    let consumer = evidence.consumer.unwrap();
    assert_eq!(consumer.conditions, ["target_os=macos", "test"]);
    assert_eq!(consumer.call.path, "rust/src/darwin_group.rs");
    assert_eq!(consumer.dependency.path, "rust/Cargo.toml");
    assert_eq!(
        consumer.owned_source,
        format!("{PACKAGE}/src/libproc/sys/bounded_group.rs")
    );
    assert_eq!(consumer.build_script, format!("{PACKAGE}/build.rs"));
    assert_eq!(consumer.library, format!("{PACKAGE}/src/lib.rs"));
    use migration_check::upstream_ownership::Ownership;
    assert_eq!(
        evidence
            .files
            .values()
            .filter(|kind| **kind == Ownership::Upstream)
            .count(),
        33
    );
    assert_eq!(
        evidence
            .files
            .values()
            .filter(|kind| **kind == Ownership::MixedCode)
            .count(),
        3
    );
    assert_eq!(evidence.files[&consumer.owned_source], Ownership::OwnedCode);
}

#[test]
fn observed_consumer_parser_rejects_missing_calls_shadowing_and_wrong_scope() {
    let f = Fixture::new();
    assert!(migration_check::upstream_consumers::inspect(&f.snapshot).is_ok());
    for (old,new) in [
        ("libproc::processes::bounded_group_pids(group as u32, 1)","unrelated::placeholder(group as u32, 1)"),
        ("#[cfg(test)]","#[cfg(not(test))]"),
        ("mod tests {","mod tests { mod libproc {}"),
        ("mod tests {","mod tests { use another_crate as libproc;"),
        ("let result = libproc::processes::bounded_group_pids", "#[cfg(any())]\n        let result = libproc::processes::bounded_group_pids"),
        ("let result = libproc::processes::bounded_group_pids(group as u32, 1)","// libproc::processes::bounded_group_pids(group as u32, 1)\n        let result = unrelated::placeholder(group as u32, 1)"),
    ] {let mut f=Fixture::new();f.rewrite("rust/src/darwin_group.rs",old,new);assert!(migration_check::upstream_consumers::inspect(&f.snapshot).is_err(),"consumer parser must inspect syntax, not rely on provenance hashes");}
}

#[test]
fn parsed_cargo_binding_rejects_wrong_identity_path_and_condition() {
    for (old, new) in [
        (
            "path = \"vendor/libproc-0.14.11\"",
            "path = \"../outside/libproc\"",
        ),
        (
            "[target.'cfg(target_os = \"macos\")'.dependencies]",
            "[target.'cfg(target_os = \"linux\")'.dependencies]",
        ),
        ("version = \"=0.14.11\"", "version = \"=0.14.10\""),
    ] {
        let mut f = Fixture::new();
        f.rewrite("rust/Cargo.toml", old, new);
        assert!(migration_check::upstream_consumers::inspect(&f.snapshot).is_err());
    }
}

#[test]
fn manifest_or_runtime_registry_claim_cannot_grant_upstream_authority() {
    let mut f = Fixture::new();
    f.manifest["upstream_registry"] = json!("trust-my-vendor-map");
    assert!(serde_json::from_value::<Manifest>(f.manifest).is_err());
    let mut f = Fixture::new();
    let path = "rust/reviewed-upstream.json".to_string();
    f.snapshot.entries.insert(
        path.clone(),
        Entry {
            path,
            mode: 0o100644,
            blob: BLOB.into(),
            bytes: b"{\"schema_version\":1,\"admit_everything\":true}".to_vec(),
        },
    );
    f.rejects("upstream-provenance-mismatch");
}

#[test]
fn root_package_without_this_dependency_keeps_ordinary_inventory_rules() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/Cargo.toml",
        "libproc = { version = \"=0.14.11\", path = \"vendor/libproc-0.14.11\" }",
        "",
    );
    let mut snapshot = f.snapshot;
    snapshot
        .entries
        .retain(|path, _| !path.starts_with(&format!("{PACKAGE}/")));
    let evidence = migration_check::upstream_ownership::inspect(&snapshot).unwrap();
    assert!(evidence.files.is_empty());
    assert!(evidence.consumer.is_none());
}

#[test]
fn declared_local_dependency_without_any_package_entries_stays_unresolved() {
    let mut f = Fixture::new();
    f.snapshot
        .entries
        .retain(|path, _| !path.starts_with(&format!("{PACKAGE}/")));
    let code = migration_check::upstream_ownership::inspect(&f.snapshot)
        .err()
        .map(|error| error.code);
    assert_eq!(
        code.as_deref(),
        Some("upstream-consumer-mismatch"),
        "a declared package path cannot disappear as empty ownership evidence"
    );
}

#[test]
fn metadata_path_strings_do_not_invent_dependency_obligations() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/Cargo.toml",
        "libproc = { version = \"=0.14.11\", path = \"vendor/libproc-0.14.11\" }",
        "",
    );
    f.snapshot
        .entries
        .get_mut("rust/Cargo.toml")
        .unwrap()
        .bytes
        .extend_from_slice(b"\n[package.metadata.example]\npath = \"vendor/libproc-0.14.11\"\n");
    f.snapshot
        .entries
        .retain(|path, _| !path.starts_with(&format!("{PACKAGE}/")));
    assert!(migration_check::upstream_ownership::inspect(&f.snapshot)
        .unwrap()
        .files
        .is_empty());
}

#[test]
fn missing_package_keeps_obligation_across_actual_target_dependency_tables() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/Cargo.toml",
        "[target.'cfg(target_os = \"macos\")'.dependencies]",
        "[target.'cfg(target_os = \"linux\")'.build-dependencies]",
    );
    f.rewrite(
        "rust/Cargo.toml",
        "path = \"vendor/libproc-0.14.11\"",
        "path = \"./vendor/libproc-0.14.11\"",
    );
    f.snapshot
        .entries
        .retain(|path, _| !path.starts_with(&format!("{PACKAGE}/")));
    assert!(migration_check::upstream_ownership::inspect(&f.snapshot).is_err());
}

#[test]
fn escaping_path_with_same_suffix_is_not_the_indexed_package() {
    let mut f = Fixture::new();
    f.rewrite(
        "rust/Cargo.toml",
        "path = \"vendor/libproc-0.14.11\"",
        "path = \"../../rust/vendor/libproc-0.14.11\"",
    );
    assert!(
        !migration_check::upstream_consumers::declares_local_package(&f.snapshot).unwrap(),
        "path normalization must not discard a parent traversal beyond the repository root"
    );
}
