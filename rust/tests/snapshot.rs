#![cfg(unix)]

use migration_check::model::Diagnostic;
use migration_check::snapshot::{
    CargoArtifact, HeldRoot, IgnoredEntry, Snapshot, READ_GIT_CONFIG, READ_GIT_ENV,
};
use std::fs;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn input_command(mut command: Command, input: &[u8]) -> Output {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let write = child.stdin.take().unwrap().write_all(input);
    let output = child.wait_with_output().unwrap();
    assert!(write.is_ok(), "fixture input failed");
    output
}

fn fixture_input(fixture: &Fixture, args: &[&str], input: &[u8]) -> Output {
    let mut command = fixture.command();
    command.args(args);
    let output = input_command(command, input);
    assert!(output.status.success(), "fixture Git setup failed");
    output
}

fn canary_program(fixture: &Fixture, name: &str) -> (PathBuf, PathBuf) {
    let directory = fixture.scratch.join("canary-bin");
    fs::create_dir_all(&directory).unwrap();
    let program = directory.join(name);
    fs::write(
        &program,
        b"#!/bin/sh\nprintf 'called\\n' >> \"$MIGRATION_FIXTURE_MARKER\"\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o700)).unwrap();
    (directory, fixture.scratch.join("helper-marker"))
}

fn canary_path(directory: &Path) -> std::ffi::OsString {
    let mut paths: Vec<_> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    paths.push(directory.to_owned());
    std::env::join_paths(paths).unwrap()
}

fn marker_count(path: &Path) -> usize {
    match fs::read_to_string(path) {
        Ok(text) => text.lines().count(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(_) => panic!("fixture marker read failed"),
    }
}

fn clear_marker(path: &Path) {
    if path.exists() {
        fs::remove_file(path).unwrap();
    }
}

fn defensive_git(
    fixture: &Fixture,
    directory: &Path,
    marker: &Path,
    no_lazy: bool,
    no_fsmonitor: bool,
) -> Command {
    let mut command = Command::new("git");
    for config in READ_GIT_CONFIG.chunks_exact(2) {
        if no_fsmonitor || config[1] != "core.fsmonitor=false" {
            command.args(config);
        }
    }
    for (name, _) in std::env::vars_os() {
        if name.as_bytes().starts_with(b"GIT_") {
            command.env_remove(name);
        }
    }
    command
        .envs(
            READ_GIT_ENV
                .iter()
                .copied()
                .filter(|(name, _)| no_lazy || *name != "GIT_NO_LAZY_FETCH"),
        )
        .current_dir(&fixture.path)
        .env("PATH", canary_path(directory))
        .env("MIGRATION_FIXTURE_MARKER", marker);
    command
}

fn canary_worker(
    fixture: &Fixture,
    directory: &Path,
    marker: &Path,
    operation: &str,
    input: &[u8],
) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_migration-check"))
        .args(["--internal-source-git-worker", "2", operation])
        .args(startup_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(fs::File::open(&fixture.path).unwrap()))
        .env("PATH", canary_path(directory))
        .env("MIGRATION_FIXTURE_MARKER", marker)
        .spawn()
        .unwrap();
    let mut request = child.stdin.take().unwrap();
    let write = request
        .write_all(&(input.len() as u32).to_be_bytes())
        .and_then(|_| request.write_all(input));
    let output = child.wait_with_output().unwrap();
    drop(request);
    assert!(write.is_ok(), "fixture worker input failed");
    output
}

fn startup_args() -> [String; 3] {
    let now = rustix::time::clock_gettime(rustix::time::ClockId::Monotonic);
    [
        std::process::id().to_string(),
        (now.tv_sec + 30).to_string(),
        now.tv_nsec.to_string(),
    ]
}

fn held_root(path: &Path) -> Result<HeldRoot, Diagnostic> {
    let artifact = CargoArtifact::from_cargo_build(env!("CARGO_BIN_EXE_migration-check"))?;
    HeldRoot::open_with_cargo_artifact(path, &artifact)
}

fn read(path: &Path) -> Result<Snapshot, Diagnostic> {
    held_root(path)?.snapshot()
}

struct Fixture {
    path: PathBuf,
    home: PathBuf,
    scratch: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let scratch =
            std::env::temp_dir().join(format!("migration-snapshot-{}-{nonce}", std::process::id()));
        fs::create_dir(&scratch).unwrap();
        let path = scratch.join("repo");
        let home = scratch.join("home");
        fs::create_dir(&path).unwrap();
        fs::create_dir(&home).unwrap();
        let fixture = Self {
            path,
            home,
            scratch,
        };
        fixture.git(&["init", "--quiet", "--template="]);
        fixture
    }

    fn command(&self) -> Command {
        let mut command = Command::new("git");
        command
            .args([
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .current_dir(&self.path)
            .env_clear()
            .env("HOME", &self.home)
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("LC_ALL", "C")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1");
        command
    }

    fn git(&self, args: &[&str]) -> Output {
        let output = self.command().args(args).output().unwrap();
        assert!(output.status.success(), "fixture git command failed");
        output
    }

    fn add(&self, path: &str, bytes: &[u8]) {
        let full = self.path.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, bytes).unwrap();
        self.git(&["add", "--", path]);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.scratch);
    }
}

#[test]
fn reads_index_receipt_and_working_bytes() {
    let fixture = Fixture::new();
    fixture.add("source with spaces.py", b"print('fixture')\n");
    let expected = fixture.git(&["rev-parse", ":source with spaces.py"]);
    let snapshot = read(&fixture.path).unwrap();
    let entry = &snapshot.entries["source with spaces.py"];
    assert_eq!(entry.path, "source with spaces.py");
    assert_eq!(entry.mode, 0o100644);
    assert_eq!(
        entry.blob,
        String::from_utf8(expected.stdout).unwrap().trim()
    );
    assert_eq!(entry.bytes, b"print('fixture')\n");
    assert!(snapshot.untracked.is_empty());
}

#[test]
fn reports_nonignored_untracked_paths() {
    let fixture = Fixture::new();
    fixture.add(".gitignore", b"ignored/\n");
    fs::write(fixture.path.join("new.py"), b"fixture").unwrap();
    fs::create_dir(fixture.path.join("ignored")).unwrap();
    fs::write(fixture.path.join("ignored/output"), b"fixture").unwrap();
    fs::set_permissions(
        fixture.path.join("ignored/output"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();
    let snapshot = read(&fixture.path).unwrap();
    assert_eq!(snapshot.untracked, ["new.py"]);
    assert_eq!(
        snapshot.ignored,
        [IgnoredEntry {
            path: "ignored/output".into(),
            executable: false,
            symlink: false,
        }]
    );
}

#[test]
fn rejects_unstaged_content() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"before\n");
    fs::write(fixture.path.join("source.py"), b"after\n").unwrap();
    let error = read(&fixture.path).unwrap_err();
    assert_eq!(error.code, "unstaged-content");
    assert_eq!(error.path.as_deref(), Some("source.py"));
}

#[test]
fn rejects_unstaged_executable_mode() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    fs::set_permissions(
        fixture.path.join("source.py"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    assert_eq!(read(&fixture.path).unwrap_err().code, "unstaged-mode");
}

#[test]
fn executable_mode_uses_any_execute_bit() {
    let fixture = Fixture::new();
    fixture.add("script", b"#!/bin/sh\n");
    fixture.git(&["update-index", "--chmod=+x", "--", "script"]);
    fs::set_permissions(
        fixture.path.join("script"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    assert_eq!(
        read(&fixture.path).unwrap().entries["script"].mode,
        0o100755
    );
}

#[test]
fn reads_link_text_without_opening_target() {
    let fixture = Fixture::new();
    symlink("missing-target", fixture.path.join("link")).unwrap();
    fixture.git(&["add", "--", "link"]);
    let snapshot = read(&fixture.path).unwrap();
    assert_eq!(snapshot.entries["link"].mode, 0o120000);
    assert_eq!(snapshot.entries["link"].bytes, b"missing-target");
}

#[test]
fn rejects_regular_leaf_replaced_by_link() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    fs::remove_file(fixture.path.join("source.py")).unwrap();
    symlink("/dev/zero", fixture.path.join("source.py")).unwrap();
    assert_eq!(read(&fixture.path).unwrap_err().code, "working-tree-type");
}

#[test]
fn rejects_parent_directory_replaced_by_link() {
    let fixture = Fixture::new();
    fixture.add("nested/source.py", b"fixture\n");
    fs::rename(fixture.path.join("nested"), fixture.path.join("moved")).unwrap();
    symlink("moved", fixture.path.join("nested")).unwrap();
    assert_eq!(read(&fixture.path).unwrap_err().code, "working-tree-parent");
}

#[test]
fn rejects_control_character_path() {
    let fixture = Fixture::new();
    fixture.add("source\n.py", b"fixture\n");
    let error = read(&fixture.path).unwrap_err();
    assert_eq!(error.code, "invalid-path");
    assert!(error.path.is_none());
}

#[test]
fn rejects_unmerged_index_entries() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    let oid = fixture.git(&["rev-parse", ":source.py"]);
    let oid = String::from_utf8(oid.stdout).unwrap();
    fixture.git(&["update-index", "--force-remove", "--", "source.py"]);
    let mut child = fixture
        .command()
        .args(["update-index", "--index-info"])
        .current_dir(&fixture.path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    use std::io::Write;
    writeln!(
        child.stdin.take().unwrap(),
        "100644 {} 1\tsource.py",
        oid.trim()
    )
    .unwrap();
    assert!(child.wait().unwrap().success());
    assert_eq!(read(&fixture.path).unwrap_err().code, "unmerged-index");
}

#[test]
fn rejects_invalid_utf8_path_without_echoing_name() {
    let fixture = Fixture::new();
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        fixture.add("source.py", b"fixture\n");
        let oid = fixture.git(&["rev-parse", ":source.py"]);
        let mut input = b"100644 ".to_vec();
        input.extend_from_slice(oid.stdout.strip_suffix(b"\n").unwrap());
        input.extend_from_slice(b"\tinvalid-\xff.py\0");
        let mut child = fixture
            .command()
            .args(["update-index", "-z", "--index-info"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let write_result = child.stdin.take().unwrap().write_all(&input);
        let status = child.wait().unwrap();
        assert!(write_result.is_ok(), "fixture index input failed");
        assert!(status.success(), "fixture index update failed");
    }
    #[cfg(not(target_os = "macos"))]
    {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        fs::write(
            fixture
                .path
                .join(OsString::from_vec(b"invalid-\xff.py".to_vec())),
            b"fixture",
        )
        .unwrap();
    }
    let error = read(&fixture.path).unwrap_err();
    assert_eq!(error.code, "invalid-path");
    assert!(error.path.is_none());
}

#[test]
fn requires_selected_repository_root() {
    let fixture = Fixture::new();
    fixture.add("nested/source.py", b"fixture\n");
    assert_eq!(
        read(&fixture.path.join("nested")).unwrap_err().code,
        "repository-root"
    );
}

fn metadata_paths(metadata: &[u8]) -> Vec<String> {
    metadata
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let tab = record.iter().position(|byte| *byte == b'\t').unwrap();
            String::from_utf8(record[tab + 1..].to_vec()).unwrap()
        })
        .collect()
}

#[test]
fn held_root_rename_and_repository_replacement_preserve_metadata_binding() {
    let original = Fixture::new();
    original.add("held-source.py", b"held fixture\n");
    let replacement = Fixture::new();
    replacement.add("replacement-source.py", b"replacement fixture\n");
    let root = held_root(&original.path).unwrap();
    let expected = root.read_index_metadata().unwrap();
    let parent_directory = std::env::current_dir().unwrap();
    fs::rename(&original.path, original.scratch.join("held-renamed")).unwrap();
    fs::rename(&replacement.path, &original.path).unwrap();
    let actual = root.read_index_metadata().unwrap();
    assert_eq!(std::env::current_dir().unwrap(), parent_directory);
    assert_eq!(
        metadata_paths(&actual),
        metadata_paths(&expected),
        "Git metadata must belong to the held root after repository replacement"
    );
    assert_eq!(actual, expected);
    assert_eq!(
        root.snapshot().unwrap().entries["held-source.py"].bytes,
        b"held fixture\n"
    );
}

#[test]
fn held_root_rename_and_symlink_replacement_preserve_metadata_binding() {
    let original = Fixture::new();
    original.add("held-source.py", b"held fixture\n");
    let replacement = Fixture::new();
    replacement.add("replacement-source.py", b"replacement fixture\n");
    let root = held_root(&original.path).unwrap();
    let expected = root.read_index_metadata().unwrap();
    let parent_directory = std::env::current_dir().unwrap();
    fs::rename(&original.path, original.scratch.join("held-renamed")).unwrap();
    symlink(&replacement.path, &original.path).unwrap();
    let actual = root.read_index_metadata().unwrap();
    assert_eq!(std::env::current_dir().unwrap(), parent_directory);
    assert_eq!(
        metadata_paths(&actual),
        metadata_paths(&expected),
        "Git metadata must belong to the held root after symlink replacement"
    );
    assert_eq!(actual, expected);
    assert_eq!(
        root.snapshot().unwrap().entries["held-source.py"].bytes,
        b"held fixture\n"
    );
}

#[test]
fn two_root_invocations_do_not_share_metadata_or_parent_directory() {
    let first = Fixture::new();
    first.add("first.py", b"first fixture\n");
    let second = Fixture::new();
    second.add("second.py", b"second fixture\n");
    let first_root = held_root(&first.path).unwrap();
    let second_root = held_root(&second.path).unwrap();
    let parent_directory = std::env::current_dir().unwrap();
    assert_eq!(
        metadata_paths(&first_root.read_index_metadata().unwrap()),
        ["first.py"]
    );
    assert_eq!(
        metadata_paths(&second_root.read_index_metadata().unwrap()),
        ["second.py"]
    );
    assert_eq!(
        metadata_paths(&first_root.read_index_metadata().unwrap()),
        ["first.py"]
    );
    assert_eq!(std::env::current_dir().unwrap(), parent_directory);
}

#[test]
fn selected_alias_resolves_once_before_source_traversal() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    let alias = fixture.scratch.join("selected-alias");
    symlink(&fixture.path, &alias).unwrap();
    assert_eq!(
        read(&alias).unwrap().entries["source.py"].bytes,
        b"fixture\n"
    );
}

#[test]
fn worker_rejects_invalid_startup_without_metadata_or_error_payload() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    let parent_directory = std::env::current_dir().unwrap();
    for args in [
        vec!["--internal-source-git-worker-wrong", "2", "index"],
        vec!["--internal-source-git-worker", "99", "index"],
        vec!["--internal-source-git-worker", "2", "unknown"],
        vec!["--internal-source-git-worker", "2"],
        vec!["--internal-source-git-worker", "2", "index", "extra"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_migration-check"))
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(fs::File::open(&fixture.path).unwrap()))
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
    let not_directory = fixture.scratch.join("not-directory");
    let output = Command::new(env!("CARGO_BIN_EXE_migration-check"))
        .args(["--internal-source-git-worker", "2", "index"])
        .args(startup_args())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(fs::File::create(&not_directory).unwrap()))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(fs::metadata(not_directory).unwrap().len(), 0);
    assert_eq!(std::env::current_dir().unwrap(), parent_directory);
}

#[test]
fn fsmonitor_marker_has_positive_control_and_closed_reads_never_execute_it() {
    let fixture = Fixture::new();
    fixture.add("source.py", b"fixture\n");
    let helper_name = format!("inventory-fsmonitor-{}", std::process::id());
    let (directory, marker) = canary_program(&fixture, &helper_name);
    fixture.git(&["config", "core.fsmonitor", &helper_name]);
    let mut positive = defensive_git(&fixture, &directory, &marker, true, false);
    positive.args([
        "ls-files",
        "--others",
        "--exclude-standard",
        "--full-name",
        "-z",
    ]);
    let _ = input_command(positive, b"");
    assert!(
        marker_count(&marker) > 0,
        "fsmonitor positive control did not execute helper"
    );
    clear_marker(&marker);
    let oid = fixture.git(&["rev-parse", ":source.py"]);
    for (operation, input) in [
        ("root-prefix", Vec::new()),
        ("index", Vec::new()),
        ("untracked", Vec::new()),
        ("all-untracked", Vec::new()),
        ("objects", oid.stdout),
    ] {
        let output = canary_worker(&fixture, &directory, &marker, operation, &input);
        assert!(output.status.success(), "closed read operation failed");
        assert_eq!(
            marker_count(&marker),
            0,
            "closed read operation executed fsmonitor helper"
        );
    }
}

#[test]
fn promisor_marker_proves_no_lazy_fetch_and_local_object_behavior() {
    let fixture = Fixture::new();
    fixture.add("present.py", b"present fixture\n");
    fixture.git(&["config", "user.name", "Fixture"]);
    fixture.git(&["config", "user.email", "fixture@example.com"]);
    let missing = fixture_input(
        &fixture,
        &["hash-object", "--stdin"],
        b"absent fixture payload\n",
    );
    let missing = String::from_utf8(missing.stdout).unwrap().trim().to_owned();
    assert!(!fixture
        .command()
        .args(["cat-file", "-e", &missing])
        .output()
        .unwrap()
        .status
        .success());
    let tree = fixture_input(
        &fixture,
        &["mktree", "--missing"],
        format!("100644 blob {missing}\tmissing.py\n").as_bytes(),
    );
    let tree = String::from_utf8(tree.stdout).unwrap().trim().to_owned();
    let commit = fixture.git(&["commit-tree", &tree, "-m", "fixture"]);
    let commit = String::from_utf8(commit.stdout).unwrap().trim().to_owned();
    let prefix = fixture.path.join(".git/objects/pack/pack");
    let packed = fixture_input(
        &fixture,
        &["pack-objects", prefix.to_str().unwrap()],
        format!("{commit}\n{tree}\n").as_bytes(),
    );
    let packed = String::from_utf8(packed.stdout).unwrap().trim().to_owned();
    assert!(matches!(packed.len(), 40 | 64) && packed.bytes().all(|byte| byte.is_ascii_hexdigit()));
    fs::write(
        fixture
            .path
            .join(format!(".git/objects/pack/pack-{packed}.promisor")),
        b"",
    )
    .unwrap();
    fixture.git(&["prune-packed"]);
    fixture.git(&["update-ref", "HEAD", &commit]);
    fixture_input(
        &fixture,
        &["update-index", "-z", "--index-info"],
        format!("100644 {missing}\tmissing.py\0").as_bytes(),
    );
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let protocol = format!("inventoryfixture{}{nonce}", std::process::id());
    let (directory, marker) = canary_program(&fixture, &format!("git-remote-{protocol}"));
    fixture.git(&["config", "remote.origin.promisor", "true"]);
    fixture.git(&[
        "config",
        "remote.origin.url",
        &format!("{protocol}::fixture"),
    ]);
    fixture.git(&["config", &format!("protocol.{protocol}.allow"), "always"]);
    let input = format!("{missing}\n");
    let mut positive = defensive_git(&fixture, &directory, &marker, false, true);
    positive.args(["cat-file", "--batch"]);
    let _ = input_command(positive, input.as_bytes());
    assert!(
        marker_count(&marker) > 0,
        "promisor positive control did not execute helper"
    );
    clear_marker(&marker);
    let negative = canary_worker(&fixture, &directory, &marker, "objects", input.as_bytes());
    assert!(negative.status.success());
    assert_eq!(negative.stdout, format!("{missing} missing\n").as_bytes());
    assert_eq!(
        marker_count(&marker),
        0,
        "production read attempted lazy fetch"
    );
    let present = fixture.git(&["rev-parse", ":present.py"]);
    let present_id = String::from_utf8(present.stdout.clone())
        .unwrap()
        .trim()
        .to_owned();
    let local = canary_worker(&fixture, &directory, &marker, "objects", &present.stdout);
    assert!(local.status.success());
    assert_eq!(
        local.stdout,
        format!("{present_id} blob 16\npresent fixture\n\n").as_bytes()
    );
    assert_eq!(marker_count(&marker), 0);
}
