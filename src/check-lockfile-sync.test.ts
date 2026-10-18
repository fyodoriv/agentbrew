import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..");
const SCRIPT = join(REPO, "scripts", "check-lockfile-sync.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project dir with a `file:` dependency and an npx stub running `body`. */
function setup(body: string, timeout = "30") {
  const root = mkdtempSync(join(tmpdir(), "lockfile-sync-"));
  roots.push(root);
  const project = join(root, "project");
  mkdirSync(join(project, "stubs", "local-dep"), { recursive: true });
  writeFileSync(join(project, "stubs", "local-dep", "package.json"), '{"name":"local-dep","version":"1.0.0"}\n');
  writeFileSync(join(project, "package.json"), '{"name":"p","dependencies":{"local-dep":"file:stubs/local-dep"}}\n');
  writeFileSync(join(project, "package-lock.json"), '{"lockfileVersion":3}\n');
  const npx = join(root, "npx-stub");
  writeFileSync(npx, `#!/bin/sh\necho "cwd=$PWD args=$*" >> "${root}/calls"\n${body}\n`);
  chmodSync(npx, 0o755);
  const run = () =>
    spawnSync("/bin/bash", [SCRIPT], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CEILING_DIRECTORIES: root,
        LOCKFILE_SYNC_NPX: npx,
        LOCKFILE_SYNC_TIMEOUT: timeout,
      },
    });
  const calls = () => readFileSync(join(root, "calls"), "utf8");
  return { project, run, calls };
}

describe("check-lockfile-sync.sh", () => {
  it("passes when npm 10 accepts the lockfile, in a copy of the project", () => {
    const { project, run, calls } = setup("test -f stubs/local-dep/package.json || exit 9; exit 0");
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("lockfile-sync: ok");
    expect(calls()).toContain("--package=npm@10");
    expect(calls()).toContain("npm ci --dry-run --ignore-scripts");
    expect(calls()).not.toContain(`cwd=${project} `);
  });

  it("fails with the missing entries when the lockfile is out of sync", () => {
    const { run } = setup(
      'echo "npm error \\`npm ci\\` can only install packages when your package.json and package-lock.json are in sync." >&2\n' +
        'echo "npm error Missing: gcp-metadata@7.0.1 from lock file" >&2\nexit 1',
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out of sync for npm@10");
    expect(result.stderr).toContain("Missing: gcp-metadata@7.0.1 from lock file");
  });

  it("says the network is down instead of reporting drift", () => {
    const { run } = setup('echo "npm error code ENOTFOUND" >&2\nexit 1');
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("network down?");
  });

  it("gives up at the time limit instead of hanging", () => {
    const { run } = setup("sleep 30", "1");
    const started = Date.now();
    const result = run();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("gave up after 1s");
  });

  it("is wired into the pre-push hook and into npm run verify", () => {
    expect(readFileSync(join(REPO, "lefthook.yml"), "utf8")).toContain("bash scripts/check-lockfile-sync.sh");
    const verify = readFileSync(join(REPO, "scripts", "verify.sh"), "utf8");
    expect(verify).toMatch(/^lockfile-sync bash scripts\/check-lockfile-sync\.sh$/m);
  });
});
