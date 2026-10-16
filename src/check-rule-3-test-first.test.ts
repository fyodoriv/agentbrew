import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/check-rule-3-test-first.mjs");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const repos: string[] = [];

function git(repo: string, ...args: string[]): void {
  execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
    env,
    stdio: "ignore",
  });
}

function write(repo: string, path: string, body = "x\n"): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), body);
}

/** A repo on a feature branch off `main`, with one seed commit. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-test-first-"));
  repos.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "README.md");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: seed");
  git(dir, "switch", "-q", "-c", "feature");
  return dir;
}

function commit(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function check(dir: string, base = "main") {
  return spawnSync("node", [script, "--base", base], { cwd: dir, env, encoding: "utf8" });
}

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-rule-3-test-first", () => {
  it("fails and names the file when src changes with no test diff", () => {
    const dir = repo();
    write(dir, "src/foo.ts");
    commit(dir, "feat: foo");

    const result = check(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/foo.ts");
  });

  it("fails on an uncommitted src change with no test diff", () => {
    const dir = repo();
    write(dir, "src/foo.ts");

    expect(check(dir).status).toBe(1);
  });

  it("passes when the branch also changes a test", () => {
    const dir = repo();
    write(dir, "src/foo.ts");
    write(dir, "src/foo.test.ts");
    commit(dir, "feat: foo");

    expect(check(dir).status).toBe(0);
  });

  it("passes with a Test exemption line in a commit message", () => {
    const dir = repo();
    write(dir, "src/foo.ts");
    commit(dir, "refactor: rename foo\n\nTest exemption: pure rename, covered by tsc");

    expect(check(dir).status).toBe(0);
  });

  it("passes when no behavior file under src changes", () => {
    const dir = repo();
    write(dir, "docs/notes.md");
    commit(dir, "docs: notes");

    expect(check(dir).status).toBe(0);
  });

  it("skips when the base ref does not exist", () => {
    const dir = repo();
    write(dir, "src/foo.ts");

    const result = check(dir, "origin/missing");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skipped");
  });
});
