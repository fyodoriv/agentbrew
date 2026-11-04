use fetch_mutation::{prepare, Policy};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::{symlink, DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

const GIT: &str = "/opt/homebrew/bin/git";
static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "fetch-mutation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn shell_env(home: &Path) -> BTreeMap<String, String> {
    [
        ("PATH", "/opt/homebrew/bin:/usr/bin:/bin"),
        ("LANG", "C"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_ALLOW_PROTOCOL", "file"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_OPTIONAL_LOCKS", "0"),
        ("GIT_AUTHOR_NAME", "Fixture"),
        ("GIT_AUTHOR_EMAIL", "fixture@example.com"),
        ("GIT_COMMITTER_NAME", "Fixture"),
        ("GIT_COMMITTER_EMAIL", "fixture@example.com"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .chain([("HOME".into(), home.to_str().unwrap().into())])
    .collect()
}

fn run(
    dir: &Path,
    env: &BTreeMap<String, String>,
    args: impl IntoIterator<Item = impl AsRef<OsStr>>,
) -> Output {
    Command::new(GIT)
        .current_dir(dir)
        .env_clear()
        .envs(env)
        .args(args)
        .output()
        .unwrap()
}

fn git(dir: &Path, env: &BTreeMap<String, String>, args: &[&str]) -> String {
    let out = run(dir, env, args);
    assert!(
        out.status.success(),
        "fixture Git operation {:?} failed: {}",
        args[0],
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().into()
}

#[derive(Debug, PartialEq, Eq)]
enum Leaf {
    File(u32, Vec<u8>),
    Directory(u32),
    Symlink(PathBuf),
}
type Manifest = BTreeMap<PathBuf, Leaf>;
fn manifest(root: &Path, omit_dot_git: bool) -> Manifest {
    fn visit(root: &Path, relative: &Path, omit_dot_git: bool, result: &mut Manifest) {
        for entry in fs::read_dir(root.join(relative)).unwrap() {
            let path = relative.join(entry.unwrap().file_name());
            if omit_dot_git && path == Path::new(".git") {
                continue;
            }
            let absolute = root.join(&path);
            let metadata = fs::symlink_metadata(&absolute).unwrap();
            let mode = metadata.permissions().mode() & 0o777;
            let item = if metadata.is_symlink() {
                Leaf::Symlink(fs::read_link(&absolute).unwrap())
            } else if metadata.is_dir() {
                visit(root, &path, false, result);
                Leaf::Directory(mode)
            } else {
                assert!(metadata.is_file());
                Leaf::File(mode, fs::read(absolute).unwrap())
            };
            result.insert(path, item);
        }
    }
    let mut result = Manifest::new();
    visit(root, Path::new(""), omit_dot_git, &mut result);
    result
}

fn refs(repo: &Path, env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    git(
        repo,
        env,
        &["for-each-ref", "--format=%(refname) %(objectname)"],
    )
    .lines()
    .map(|line| {
        let (name, oid) = line.split_once(' ').unwrap();
        (name.into(), oid.into())
    })
    .collect()
}

fn tracking(name: &str) -> bool {
    name.starts_with("refs/remotes/origin/")
}

fn fixture(widen: bool) {
    let scratch = Scratch::new();
    let root = &scratch.0;
    let home = root.join("home");
    let writer = root.join("writer");
    let origin = root.join("origin");
    let client = root.join("client");
    let template = root.join("empty");
    for path in [&home, &writer, &client, &template] {
        fs::create_dir(path).unwrap();
    }
    let env = shell_env(&home);
    let template_arg = format!("--template={}", template.display());
    git(
        &writer,
        &env,
        &["init", "-q", "--initial-branch=main", &template_arg],
    );
    fs::write(writer.join("tracked"), b"before\n").unwrap();
    git(&writer, &env, &["add", "tracked"]);
    git(&writer, &env, &["commit", "-qm", "baseline"]);
    let old = git(&writer, &env, &["rev-parse", "HEAD"]);
    fs::write(writer.join("tracked"), b"after\n").unwrap();
    git(&writer, &env, &["commit", "-qam", "candidate"]);
    let new = git(&writer, &env, &["rev-parse", "HEAD"]);
    git(
        root,
        &env,
        &[
            "clone",
            "-q",
            "--bare",
            "--no-local",
            &template_arg,
            writer.to_str().unwrap(),
            origin.to_str().unwrap(),
        ],
    );
    git(&origin, &env, &["update-ref", "refs/heads/main", &old]);
    git(&origin, &env, &["update-ref", "refs/heads/stale", &old]);
    git(
        &client,
        &env,
        &["init", "-q", "--initial-branch=main", &template_arg],
    );
    let url = format!("file://{}", origin.display());
    git(&client, &env, &["remote", "add", "origin", &url]);
    git(&client, &env, &["fetch", "--quiet", "origin"]);
    git(
        &client,
        &env,
        &["switch", "-c", "primary", "refs/remotes/origin/main"],
    );
    git(&client, &env, &["tag", "keep-local"]);
    fs::write(client.join("untracked"), b"untracked sentinel\n").unwrap();
    symlink("untracked", client.join("untracked-link")).unwrap();
    fs::write(
        client.join(".git/FETCH_HEAD"),
        b"owned FETCH_HEAD sentinel\n",
    )
    .unwrap();

    if widen {
        for (key, value) in [
            ("remote.origin.fetch", "+refs/heads/*:refs/heads/widened/*"),
            ("remote.origin.pruneTags", "true"),
            ("fetch.pruneTags", "true"),
            ("fetch.recurseSubmodules", "on-demand"),
            ("maintenance.auto", "true"),
        ] {
            git(&client, &env, &["config", "--add", key, value]);
        }
    }
    git(&origin, &env, &["update-ref", "refs/heads/main", &new]);
    git(&origin, &env, &["update-ref", "refs/heads/new", &new]);
    git(&origin, &env, &["update-ref", "-d", "refs/heads/stale"]);
    let missing = run(&client, &env, ["cat-file", "-e", new.as_str()]);
    assert!(
        !missing.status.success(),
        "fixture remote object already present"
    );

    const ORIGIN_HEAD: &str = "refs/remotes/origin/HEAD";
    const ORIGIN_MAIN: &str = "refs/remotes/origin/main";
    git(&client, &env, &["symbolic-ref", ORIGIN_HEAD, ORIGIN_MAIN]);
    let before_refs = refs(&client, &env);
    let before_work = manifest(&client, true);
    let before_git = manifest(&client.join(".git"), false);
    let legacy = std::env::var_os("FETCH_MUTATION_LEGACY").is_some();
    let result = if legacy {
        assert!(widen);
        run(&client, &env, ["fetch", "--prune", "--quiet", "origin"])
    } else {
        let request = prepare(
            client.to_str().unwrap(),
            60,
            &Policy {
                owner_env: env.clone(),
                ssh_command: None,
            },
        )
        .unwrap();
        assert_eq!(Path::new(&request.cwd), &client);
        run(&client, &request.env, &request.args)
    };
    assert!(
        result.status.success(),
        "candidate/legacy fetch did not reach result: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let after_refs = refs(&client, &env);
    let after_work = manifest(&client, true);
    let after_git = manifest(&client.join(".git"), false);
    let expected_tracking = BTreeMap::from([
        ("refs/remotes/origin/main".into(), new.clone()),
        ("refs/remotes/origin/new".into(), new.clone()),
    ]);
    assert_eq!(before_refs.get("refs/remotes/origin/main"), Some(&old));
    assert_eq!(before_refs.get("refs/remotes/origin/stale"), Some(&old));
    assert_eq!(
        after_refs
            .iter()
            .filter(|(name, _)| tracking(name) && name.as_str() != ORIGIN_HEAD)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<BTreeMap<_, _>>(),
        expected_tracking
    );
    assert!(run(&client, &env, ["cat-file", "-e", new.as_str()])
        .status
        .success());

    let protected_refs = |values: &BTreeMap<String, String>| {
        values
            .iter()
            .filter(|(name, _)| !tracking(name))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    let mut changed = BTreeSet::new();
    let mut unknown = 0;
    let mut protected_files = 0;
    for key in before_git
        .keys()
        .chain(after_git.keys())
        .collect::<BTreeSet<_>>()
    {
        if before_git.get(key) == after_git.get(key) {
            continue;
        }
        let name = key.to_str().unwrap();
        if name == "objects" || name.starts_with("objects/") {
            changed.insert("objects");
        } else if name == "refs/remotes/origin"
            || name.starts_with("refs/remotes/origin/")
            || name == "logs/refs/remotes/origin"
            || name.starts_with("logs/refs/remotes/origin/")
        {
            changed.insert("origin-tracking");
        } else if matches!(name, "HEAD" | "index" | "config" | "FETCH_HEAD")
            || name.starts_with("refs/heads/")
            || name.starts_with("refs/tags/")
            || name.starts_with("logs/refs/heads/")
        {
            protected_files += 1;
        } else {
            unknown += 1;
        }
    }
    let protected_refs_same = protected_refs(&before_refs) == protected_refs(&after_refs);
    let alias = Path::new(ORIGIN_HEAD);
    assert_eq!(before_git.get(alias), after_git.get(alias));
    assert_eq!(
        git(&client, &env, &["symbolic-ref", ORIGIN_HEAD]),
        ORIGIN_MAIN
    );
    let worktree_same = before_work == after_work;
    println!("FETCH_MUTATION case={} legacy={} fetch=0 tracking=3 object=1 protected_refs_same={} worktree_same={} protected_files={} unknown={} classes={:?}",
        if widen { "M02" } else { "M01" }, legacy, protected_refs_same, worktree_same, protected_files, unknown, changed);
    assert!(
        protected_refs_same && worktree_same && protected_files == 0 && unknown == 0,
        "protected Git state changed"
    );
    assert_eq!(changed, BTreeSet::from(["objects", "origin-tracking"]));
}

#[test]
fn m01_tracking_only() {
    fixture(false);
}

#[test]
fn m02_widened_config_refuses_protected_mutation() {
    fixture(true);
}
