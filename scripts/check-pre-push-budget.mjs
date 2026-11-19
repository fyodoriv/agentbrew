import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMIT_MS = 10_000;
const SAMPLES = 5;
const FIXTURE_FILES = 5;
const FIXTURE_COMMAND_LIMIT_MS = 30_000;
const NPM_SETUP_LIMIT_MS = 120_000;
const root = fileURLToPath(new URL("..", import.meta.url));

export function samplePasses({ code, elapsedMs, ranHook }) {
  return code === 0 && ranHook && elapsedMs <= LIMIT_MS;
}

function fixtureEnv(scratch) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: join(scratch, "npm-globalconfig"),
    XDG_CONFIG_HOME: join(scratch, "config"),
    OSS_READINESS_INTERNAL_PATTERN: "^example-pre-push-canary[0-9]{12}$",
    CHECK_OFFLINE: "1",
    NO_CACHE: "1",
    NEW_PROJECT_NO_COPIER: "1",
  };
}

function run(file, args, cwd, env, options = {}) {
  try {
    return execFileSync(file, args, { cwd, env, encoding: "utf8", timeout: FIXTURE_COMMAND_LIMIT_MS, ...options });
  } catch (error) {
    throw new Error(`${file} failed during fixture setup (exit ${error.status ?? "unavailable"})`);
  }
}

function prepareDiff(repo, remote, env) {
  const git = (...args) => run("git", args, repo, env).trim();
  git("init", "--template=", "-q", "-b", "main");
  git("config", "core.hooksPath", join(repo, ".git", "empty-hooks"));
  git("config", "user.name", "Fixture test");
  git("config", "user.email", "fixture@example.com");
  git("add", "-A");
  const base = git("commit-tree", git("write-tree"), "-m", "Fixture base");
  for (let n = 1; n <= FIXTURE_FILES; n += 1) {
    writeFileSync(join(repo, `pre-push-fixture-${n}.txt`), "Timing fixture.\n");
  }
  git("add", "-A");
  const head = git("commit-tree", git("write-tree"), "-p", base, "-m", "Fixture change");
  git("update-ref", "refs/heads/main", head);
  git("update-ref", "refs/remotes/origin/main", base);
  git("remote", "add", "origin", remote);
  const files = git("diff", "--name-only", base, head).split("\n");
  if (files.length !== FIXTURE_FILES) throw new Error("Unexpected fixture diff");
  return `${files.join("\n")}\n`;
}

function runGroup(file, args, { cwd, env, input, signal, limitMs }) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let failure;
    const stop = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") failure = error;
      }
    };
    const timer = setTimeout(stop, limitMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.stdin.on("error", (error) => {
      if (error.code === "EPIPE") return;
      failure = error;
      stop();
    });
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else resolve({ code, elapsedMs: performance.now() - started, output });
    });
    child.stdin.end(input);
  });
}

async function measure(repo, files, expectedOutput, env, signal) {
  const { code, elapsedMs, output } = await runGroup(
    "lefthook",
    ["run", "pre-push", "--no-auto-install", "--no-tty", "--files-from-stdin"],
    { cwd: repo, env, input: files, signal, limitMs: LIMIT_MS },
  );
  return { code, elapsedMs, ranHook: expectedOutput.test(output) };
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-pre-push-"));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const env = fixtureEnv(scratch);
    run("lefthook", ["version"], root, env);
    const remote = join(scratch, "remote.git");
    run("git", ["init", "--template=", "-q", "--bare", remote], scratch, env);
    const own = join(scratch, "agentbrew");
    const scaffold = join(scratch, "scaffold");
    mkdirSync(own);
    const commit = run("git", ["rev-parse", "HEAD"], root, env).trim();
    console.log(`Fixture revision ${commit}`);
    const archive = run("git", ["archive", "--format=tar", commit], root, env, {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    run("tar", ["-xf", "-", "-C", own], scratch, env, { input: archive });
    const install = await runGroup("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: own,
      env,
      signal: controller.signal,
      limitMs: NPM_SETUP_LIMIT_MS,
    });
    controller.signal.throwIfAborted();
    if (install.code !== 0) {
      throw new Error(`npm failed during fixture setup (exit ${install.code ?? "unavailable"})`);
    }
    run(
      "bash",
      [
        join(own, "skill-plugins/workflow/new-project/scripts/scaffold.sh"),
        scaffold,
        "--profile",
        "tool",
        "--name",
        "timing-fixture",
        "--stack",
        "none",
      ],
      scratch,
      env,
    );

    const fixtures = [
      { label: "Agentbrew", repo: own, expectedOutput: /check:oss|src\/oss\//u },
      { label: "New scaffold", repo: scaffold, expectedOutput: /check\.sh: fast gate passed/u },
    ];
    let passed = true;
    for (const fixture of fixtures) {
      const files = prepareDiff(fixture.repo, remote, env);
      for (let sample = 1; sample <= SAMPLES; sample += 1) {
        controller.signal.throwIfAborted();
        const result = await measure(fixture.repo, files, fixture.expectedOutput, env, controller.signal);
        controller.signal.throwIfAborted();
        const ok = samplePasses(result);
        passed &&= ok;
        const status = ok ? "pass" : `fail (exit ${result.code ?? "unavailable"}, ran hook ${result.ranHook})`;
        console.log(`${fixture.label} ${sample}/${SAMPLES} · ${(result.elapsedMs / 1000).toFixed(3)} s · ${status}`);
      }
    }
    if (!passed) process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
