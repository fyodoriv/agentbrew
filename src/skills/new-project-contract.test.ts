import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, afterEach, beforeAll, describe, expect, it, type RunnerTask } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "new-project");
const scaffold = join(skillRoot, "scripts", "scaffold.sh");
const checkSetup = join(skillRoot, "scripts", "check-setup.sh");
// The copy fallback is the default here; the Copier tests below opt in.
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", NEW_PROJECT_NO_COPIER: "1" };
// The gate's own NO_CACHE=1 run must not leak into the cache test below.
delete env.NO_CACHE;
const gitEnv = {
  ...env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
// uv keeps its cache and Pythons under HOME, which is a new scratch dir for each test file
// (vitest.isolated-home.ts), so each run downloaded Python and Copier again. Keep them in
// node_modules/.cache, next to the vitest cache, where the next run finds them.
const uvDir = join(process.cwd(), "node_modules", ".cache", "uv");
const copierEnv: NodeJS.ProcessEnv = {
  ...gitEnv,
  NEW_PROJECT_NO_COPIER: "",
  UV_CACHE_DIR: env.UV_CACHE_DIR ?? join(uvDir, "cache"),
  UV_PYTHON_INSTALL_DIR: env.UV_PYTHON_INSTALL_DIR ?? join(uvDir, "python"),
};
// Copier runs from PATH or through uvx (which may need the network once).
const copierCmd = ["copier", "uvx copier@9.19.1"].find(
  (cmd) => spawnSync("bash", ["-c", `${cmd} --version`], { env: copierEnv, encoding: "utf-8" }).status === 0,
);
const profiles = [
  { profile: "tool", stack: "ts" },
  { profile: "assistant", stack: "python" },
  { profile: "side-project", stack: "rust" },
] as const;
const required = [
  "vision",
  "metrics",
  "observability",
  "user-stories",
  "setup",
  "e2e",
  "self-improving",
  "tasks",
  "checkup",
  "caching",
];
// The shared setup holds every real scaffold of the file, so it gets the time a loaded machine needs.
const SETUP_TIMEOUT = 300_000;
// One child process (and its children) is killed after this, before a hook times out.
const CHILD_TIMEOUT = 240_000;

// Scaffolds that beforeAll builds once and then makes read-only. A test that changes files
// works on a copy from fresh().
const sharedScaffolds: { name: string; profile: string; stack: string }[] = [
  ...profiles.map(({ profile, stack }) => ({ name: profile, profile, stack })),
  { name: "tool-none", profile: "tool", stack: "none" },
  { name: "side-project-none", profile: "side-project", stack: "none" },
];
// check-setup.sh runs on the shared scaffolds, once each: [scaffold name, profile, flags].
const sharedScoreRuns: [string, string, string[]][] = [
  ...profiles.flatMap(({ profile }): [string, string, string[]][] => [
    [profile, profile, []],
    [profile, profile, ["--strict"]],
  ]),
  ["side-project-none", "side-project", []],
];

type Run = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };
type TemplateUpdate = { repo: string; out: string; answers: string; update: Run };
// Each part keeps its own error, so one failed scaffold fails only the tests that use it.
type Outcome<T> = { value: T } | { error: unknown };
type CopierResults = { pairs: Map<string, Outcome<void>>; upgrade: Outcome<TemplateUpdate> };

let scratch = "";
const sharedErrors = new Map<string, unknown>();
const sharedScores = new Map<string, Outcome<Run>>();
// beforeAll's work. afterAll waits for it before it deletes the scratch dir.
let sharedWork: Promise<void> | undefined;
// The Copier scaffolds start in beforeAll and run while the tests before them run. Never rejects.
let copierWork: Promise<CopierResults> | undefined;
const COPIER_SUITE = "with Copier (skips when neither copier nor uvx copier@9.19.1 runs)";

function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

function unwrap<T>(outcome: Outcome<T>): T {
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Kills a process and all its descendants (bash may have started uvx and python). */
function killTree(pid: number) {
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf-8" }).stdout ?? "";
  for (const kid of kids.split("\n").filter(Boolean)) killTree(Number(kid));
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // It already ended.
  }
}

/** Like spawnSync, but the event loop keeps running, so the other scaffolds go on meanwhile. */
function spawnAsync(cmd: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", reject);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    // A hung child is killed with all it started, and its pipes are closed, so "close" always comes.
    const timer = setTimeout(() => {
      // Only while it runs: after it exits, its pid may already belong to another process.
      if (child.pid && child.exitCode === null && child.signalCode === null) killTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
    }, CHILD_TIMEOUT);
    timer.unref();
  });
}

/** Like execFileSync: the output, or an error when the command fails. */
async function execAsync(cmd: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) {
  const run = await spawnAsync(cmd, args, options);
  if (run.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${run.status ?? run.signal}\n${run.stdout}${run.stderr}`);
  }
  return run.stdout;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf-8" });
}

/** A shared scaffold. Throws its scaffold's error when that run failed. */
function sharedDir(name: string) {
  if (sharedErrors.has(name)) throw sharedErrors.get(name);
  return join(scratch, "shared", name);
}

/** A writable copy of a shared scaffold, for a test that changes files. */
function fresh(name: string, copy: string) {
  const dir = join(scratch, copy);
  cpSync(sharedDir(name), dir, { recursive: true, verbatimSymlinks: true });
  execFileSync("chmod", ["-R", "u+w", dir]);
  return dir;
}

function parseScore(run: Run) {
  const match = /score: (\d+)\/(\d+)/.exec(run.stdout);
  expect(match, run.stdout + run.stderr).not.toBeNull();
  return { status: run.status, pass: Number(match?.[1]), total: Number(match?.[2]), out: run.stdout };
}

function score(dir: string, profile: string, ...flags: string[]) {
  return parseScore(
    spawnSync("/bin/bash", [checkSetup, dir, "--profile", profile, ...flags], { encoding: "utf-8", env }),
  );
}

/** The beforeAll score of a shared scaffold. */
function sharedScore(name: string, ...flags: string[]) {
  const key = [name, ...flags].join(" ");
  const run = sharedScores.get(key);
  if (!run) throw sharedErrors.get(name) ?? new Error(`no shared score for ${key}`);
  return parseScore(unwrap(run));
}

function scaffoldArgs(dir: string, profile: string, stack: string) {
  return [scaffold, dir, "--profile", profile, "--name", `demo-${profile}`, "--stack", stack];
}

function scaffoldInto(dir: string, profile: string, stack: string) {
  return execFileSync("/bin/bash", scaffoldArgs(dir, profile, stack), { encoding: "utf-8", env });
}

/** Writes one profile with the same answers through the copy fallback and through Copier. */
async function copierPair(profile: string, stack: string) {
  const viaCopy = join(scratch, `copy-${profile}`);
  const viaCopier = join(scratch, `copier-${profile}`);
  const args = ["--profile", profile, "--name", "same", "--stack", stack, "--owner", "Ann", "--description", "D."];
  const runs = await Promise.allSettled([
    execAsync("/bin/bash", [scaffold, viaCopy, ...args], { env }),
    execAsync("/bin/bash", [scaffold, viaCopier, ...args], { env: copierEnv }),
  ]);
  for (const run of runs) if (run.status === "rejected") throw run.reason;
  await execAsync("chmod", ["-R", "a-w", viaCopy, viaCopier], { env });
}

/** An older repo, scaffolded from a versioned template, with its own edit; then `copier update` to the template's fix. */
async function templateUpdate(): Promise<TemplateUpdate> {
  // A versioned template: the skill files in their own git repo.
  const tpl = join(scratch, "template-repo");
  for (const part of ["copier.yml", "templates", "scripts"]) {
    cpSync(join(skillRoot, part), join(tpl, part), { recursive: true, verbatimSymlinks: true });
  }
  git(tpl, "init", "-q", "-b", "main");
  git(tpl, "add", "-A");
  git(tpl, "commit", "-qm", "template v1");

  const repo = join(scratch, "updated");
  const out = await execAsync(
    "/bin/bash",
    [join(tpl, "scripts", "scaffold.sh"), repo, "--profile", "tool", "--name", "u", "--stack", "ts"],
    { env: copierEnv },
  );
  const answersFile = join(repo, ".copier-answers.yml");
  const answers = existsSync(answersFile) ? readFileSync(answersFile, "utf-8") : "";
  appendFileSync(join(repo, "README.md"), "Local note kept by the repo.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "scaffold plus a local edit");

  appendFileSync(join(tpl, "templates", "docs", "learnings.md"), "- Template fix line from v2.\n");
  git(tpl, "commit", "-qam", "template v2");

  const update = await spawnAsync("bash", ["-c", `${copierCmd} update --defaults --quiet --vcs-ref HEAD`], {
    cwd: repo,
    env: copierEnv,
  });
  return { repo, out, answers, update };
}

/** The template update is the longest chain, so it starts at once; the pairs start after `pairsAfter`. */
async function copierResults(pairsAfter: Promise<unknown> = Promise.resolve()): Promise<CopierResults> {
  const upgrade = settle(templateUpdate());
  await settle(pairsAfter);
  const pairs = new Map<string, Outcome<void>>();
  await Promise.all(
    profiles.map(async ({ profile, stack }) => pairs.set(profile, await settle(copierPair(profile, stack)))),
  );
  return { pairs, upgrade: await upgrade };
}

/** Builds and scores the shared scaffolds. Never rejects: errors stay with the scaffold or score they belong to. */
async function buildShared() {
  mkdirSync(join(scratch, "shared"), { recursive: true });
  await Promise.all(
    sharedScaffolds.map(async ({ name, profile, stack }) => {
      const dir = join(scratch, "shared", name);
      const built = await settle(execAsync("/bin/bash", scaffoldArgs(dir, profile, stack), { env }));
      if ("error" in built) sharedErrors.set(name, built.error);
    }),
  );
  await Promise.all(
    sharedScoreRuns
      .filter(([name]) => !sharedErrors.has(name))
      .map(async ([name, profile, flags]) => {
        const args = [checkSetup, sharedDir(name), "--profile", profile, ...flags];
        sharedScores.set([name, ...flags].join(" "), await settle(spawnAsync("/bin/bash", args, { env })));
      }),
  );
}

/** True when this run has a test in the suite `name`: a -t filter can skip them all. */
function runsSuite(task: RunnerTask, name: string, inside = false): boolean {
  const within = inside || task.name === name;
  if (task.type === "test") return within && task.mode === "run";
  return task.tasks.some((child) => runsSuite(child, name, within));
}

// biome-ignore lint/correctness/noEmptyPattern: vitest passes the file suite only after a destructured context.
beforeAll(async ({}, file) => {
  scratch = mkdtempSync(join(tmpdir(), "new-project-"));
  sharedWork = buildShared();
  if (copierCmd && runsSuite(file, COPIER_SUITE)) copierWork = copierResults(sharedWork);
  await sharedWork;
  // Read-only: a test that writes to a shared scaffold fails, instead of breaking the tests after it.
  execFileSync("chmod", ["-R", "a-w", join(scratch, "shared")]);
}, SETUP_TIMEOUT);

// Vitest starts the next test without a turn of the event loop, so the Copier work would not see its
// child processes end until the Copier tests. Two setImmediate turns always include one I/O poll.
afterEach(() => new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve))));

afterAll(async () => {
  await Promise.allSettled([sharedWork, copierWork]);
  if (!scratch) return;
  try {
    execFileSync("chmod", ["-R", "u+w", scratch]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, SETUP_TIMEOUT);

describe("new-project skill", () => {
  it.each(profiles)("scaffolds a $profile repo that scores 100%", ({ profile }) => {
    const dir = sharedDir(profile);
    const result = sharedScore(profile);
    expect(result.out).not.toContain("FAIL");
    expect(result.status).toBe(0);
    expect(readlinkSync(join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("fails an app whose checkup does not list open PRs and branches first", () => {
    const dir = fresh("side-project-none", "no-open-work");
    const label = "FAIL [checkup] scripts/checkup.sh lists open PRs and branches first";
    expect(sharedScore("side-project-none").out).not.toContain(label);
    writeFileSync(join(dir, "scripts", "checkup.sh"), "#!/usr/bin/env bash\nscripts/doctor.sh\n");
    const result = score(dir, "side-project");
    expect(result.out).toContain(label);
    expect(result.status).toBe(1);
  });

  it.each(profiles)("strict mode fails a fresh $profile scaffold until FILL: markers are replaced", ({ profile }) => {
    expect(sharedScore(profile, "--strict").status).toBe(1);
    const dir = fresh(profile, `filled-${profile}`);
    execFileSync("bash", ["-c", "grep -rIlw 'FILL' --exclude-dir=.git . | xargs perl -pi -e 's/\\bFILL\\b/Filled/g'"], {
      cwd: dir,
    });
    expect(score(dir, profile, "--strict").status).toBe(0);
  });

  it.each(profiles)("enforces every required area for $profile", ({ profile }) => {
    const areas = /areas: (.*)/.exec(sharedScore(profile).out)?.[1].trim().split(" ") ?? [];
    for (const area of required) expect(areas, area).toContain(area);
  });

  it("runs the one-line setup, e2e, docs check, and speed report in a fresh scaffold", () => {
    const dir = fresh("side-project-none", "run");
    const run = (script: string) =>
      execFileSync("bash", [join(dir, "scripts", script)], { cwd: dir, encoding: "utf-8", env });
    expect(run("setup.sh")).toContain("doctor: all checks passed");
    expect(run("e2e.sh")).toContain("ok US-01 setup");
    expect(run("check-docs.sh")).toContain("docs match the code");
    writeFileSync(
      join(dir, ".metrics", "events.jsonl"),
      '{"ts":"t","event":"check.step","name":"unit","seconds":3,"ok":true}\n',
    );
    expect(run("metrics.sh")).toMatch(/unit\s+1\s+3\.0/);
  });

  it("keeps check-docs and e2e right with prose, helpers, and required env keys", () => {
    const dir = fresh("tool-none", "edge");
    const stories = join(dir, "docs", "user-stories.md");
    writeFileSync(stories, `${readFileSync(stories, "utf-8")}\nSee tests/e2e/us-01-setup.sh.\n`);
    mkdirSync(join(dir, "tests", "e2e", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "tests", "e2e", "lib.sh"), "exit 1\n");
    writeFileSync(join(dir, ".env.example"), "API_KEY=  # required\n");
    const run = (script: string) =>
      execFileSync("/bin/bash", [join(dir, "scripts", script)], { cwd: dir, encoding: "utf-8", env });
    expect(run("check-docs.sh")).toContain("docs match the code");
    expect(run("e2e.sh")).toContain("e2e: 1 file(s) passed");
  });

  it("fails check-docs when a story test does not name its story id", () => {
    const dir = fresh("tool-none", "story-id");
    const test = join(dir, "tests", "e2e", "us-01-setup.sh");
    writeFileSync(test, readFileSync(test, "utf-8").replaceAll("US-01", "story one"));
    const result = spawnSync("/bin/bash", [join(dir, "scripts", "check-docs.sh")], {
      cwd: dir,
      encoding: "utf-8",
      env,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not name its story US-01");
  });

  it("lets an existing repo map an area to its own files or waive it with a reason", () => {
    const dir = fresh("tool-none", "mapped");
    renameSync(join(dir, "docs", "VISION.md"), join(dir, "VISION.md"));
    expect(score(dir, "tool").status).toBe(1);
    mkdirSync(join(dir, ".agents"), { recursive: true });
    writeFileSync(
      join(dir, ".agents", "requirements.yaml"),
      "map.vision: VISION.md\nwaive.e2e: spec-only repo; the CLI package owns the e2e\n",
    );
    const mapped = score(dir, "tool");
    expect(mapped.status).toBe(0);
    expect(mapped.out).toContain("PASS [vision] mapped to VISION.md");
    expect(mapped.out).toContain("WAIVED [e2e]");
    expect(mapped.out).toContain("waived: 1");
    writeFileSync(join(dir, ".agents", "requirements.yaml"), "map.vision: MISSING.md\n");
    expect(score(dir, "tool").out).toContain("FAIL [vision] mapped to MISSING.md");
  });

  it("caches gate steps by input hash and re-runs them after any change", () => {
    const dir = fresh("tool-none", "cached");
    const gitEnv = { ...env, CHECK_OFFLINE: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com" };
    execFileSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
    const check = (extra: Record<string, string> = {}) =>
      execFileSync("/bin/bash", [join(dir, "scripts", "check.sh"), "fast"], {
        cwd: dir,
        encoding: "utf-8",
        env: { ...gitEnv, ...extra },
      });
    expect(check()).not.toContain("cached");
    expect(check()).toContain("docs cached (inputs unchanged)");
    writeFileSync(join(dir, "docs", "plans", "note.md"), "a change\n");
    expect(check()).not.toContain("cached");
    expect(check({ NO_CACHE: "1" })).not.toContain("cached");
    expect(readFileSync(join(dir, ".metrics", "events.jsonl"), "utf-8")).toContain('"cached":true');
  });

  it("says when the monthly audit is due and records a run", () => {
    const repo = join(scratch, "audited");
    mkdirSync(repo, { recursive: true });
    const stateEnv = { ...env, XDG_STATE_HOME: join(scratch, "state") };
    const due = (...flags: string[]) =>
      spawnSync("/bin/bash", [join(skillRoot, "scripts", "audit-due.sh"), repo, ...flags], {
        encoding: "utf-8",
        env: stateEnv,
      });
    expect(due().stdout).toContain("due (never run)");
    expect(due("--record").status).toBe(0);
    const after = due();
    expect(after.status).toBe(1);
    expect(after.stdout).toContain("not due");
    expect(due("--days", "0").status).toBe(0);
  });

  it("records an audit run in a linked worktree under the repo's name, not the worktree's", () => {
    const repo = join(scratch, "main-repo");
    const tree = join(scratch, "checkup-20261018");
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8", env });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
    expect(git("worktree", "add", "-q", tree).status).toBe(0);
    const stateEnv = { ...env, XDG_STATE_HOME: join(scratch, "state-worktree") };
    const run = (dir: string, ...flags: string[]) =>
      spawnSync("/bin/bash", [join(skillRoot, "scripts", "audit-due.sh"), dir, ...flags], {
        encoding: "utf-8",
        env: stateEnv,
      });
    expect(run(tree, "--record").stdout).toContain("main-repo.last");
    expect(run(repo).stdout).toContain("not due");
  });

  it("tracks every template file in git, so a global gitignore cannot drop one", () => {
    const onDisk = execFileSync("find", [join(skillRoot, "templates"), "(", "-type", "f", "-o", "-type", "l", ")"], {
      encoding: "utf-8",
    })
      .trim()
      .split("\n").length;
    const tracked = execFileSync("git", ["ls-files", join(skillRoot, "templates")], { encoding: "utf-8" })
      .trim()
      .split("\n").length;
    expect(tracked).toBe(onDisk);
  });

  it.each(profiles)("scores an empty dir at 20% or less for $profile", ({ profile }) => {
    const empty = join(scratch, `empty-${profile}`);
    mkdirSync(empty, { recursive: true });
    const result = score(empty, profile);
    expect(result.status).toBe(1);
    expect(result.pass / result.total).toBeLessThanOrEqual(0.2);
  });

  it("never overwrites an existing file", () => {
    const dir = join(scratch, "keep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "mine\n");
    const out = scaffoldInto(dir, "tool", "none");
    expect(out).toContain("kept    README.md");
    expect(readFileSync(join(dir, "README.md"), "utf-8")).toBe("mine\n");
  });

  it("ships valid YAML templates and a valid evals file", () => {
    const assistant = (dir: string) => `{% if PROFILE == 'assistant' %}${dir}{% endif %}`;
    yaml.load(readFileSync(join(skillRoot, "templates", assistant("config"), "models.yaml"), "utf-8"));
    yaml.loadAll(
      readFileSync(join(skillRoot, "templates", assistant("evals"), "cases", "001-start-session.yaml"), "utf-8"),
    );
    const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8"));
    expect(evals.skill_name).toBe("new-project");
    expect(JSON.stringify(evals)).toMatch(/interview prep/);
  });

  describe.skipIf(!copierCmd)(COPIER_SUITE, () => {
    let copier: CopierResults;
    beforeAll(async () => {
      copierWork ??= copierResults();
      copier = await copierWork;
    }, SETUP_TIMEOUT);
    const files = (dir: string) =>
      execFileSync("bash", ["-c", "find . \\( -type f -o -type l \\) ! -path './.git/*' | sort"], {
        cwd: dir,
        encoding: "utf-8",
      });

    it.each(profiles)("writes the same $profile files as the copy fallback, plus the answers file", ({ profile }) => {
      const pair = copier.pairs.get(profile);
      if (pair && "error" in pair) throw pair.error;
      const viaCopy = join(scratch, `copy-${profile}`);
      const viaCopier = join(scratch, `copier-${profile}`);
      expect(existsSync(join(viaCopier, ".copier-answers.yml"))).toBe(true);
      const copierFiles = files(viaCopier)
        .split("\n")
        .filter((file) => file !== "./.copier-answers.yml")
        .join("\n");
      expect(copierFiles).toBe(files(viaCopy));
      const diff = spawnSync("diff", ["-r", "--no-dereference", "-x", ".git", viaCopy, viaCopier], {
        encoding: "utf-8",
      });
      expect(diff.stdout + diff.stderr).toBe(`Only in ${viaCopier}: .copier-answers.yml\n`);
    });

    it("brings a template fix into an older repo and keeps the repo's own edits", () => {
      const { repo, out, answers, update } = unwrap(copier.upgrade);
      expect(out).toContain("created .copier-answers.yml");
      expect(answers).toMatch(/_commit: \S+/);
      expect(update.status, update.stderr).toBe(0);
      expect(readFileSync(join(repo, "docs", "learnings.md"), "utf-8")).toContain("- Template fix line from v2.");
      expect(readFileSync(join(repo, "README.md"), "utf-8")).toContain("Local note kept by the repo.");
      expect(git(repo, "status", "--porcelain")).not.toContain(".rej");
      const result = score(repo, "tool");
      expect(result.status, result.out).toBe(0);
      expect(result.pass).toBe(result.total);
    });
  });
});
