import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "lint-changed.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

/** A git repo with one base commit and a biome stub that logs its args, one per line. */
function setup(opts: { biome?: boolean } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "lint-changed-"));
  roots.push(repo);
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  git("init", "-q", "-b", "main");
  write(".gitignore", "node_modules/\n");
  write("src/kept.ts", "export const a = 1;\n");
  write("src/edited.ts", "export const b = 1;\n");
  write("src/removed.ts", "export const c = 1;\n");
  write("docs/guide.md", "# guide\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const log = join(repo, "biome.log");
  if (opts.biome !== false) {
    write("node_modules/.bin/biome", `#!/bin/sh\nfor a in "$@"; do echo "$a" >> "${log}"; done\n`);
    chmodSync(join(repo, "node_modules", ".bin", "biome"), 0o755);
  }
  const run = (...args: string[]) =>
    spawnSync("bash", [SCRIPT, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...gitEnv, LINT_CHANGED_BASE: base },
    });
  const biomeArgs = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { git, write, run, biomeArgs };
}

describe("lint-changed.sh", () => {
  it("checks committed, unstaged, and new source files, and skips deleted and non-source files", () => {
    const { git, write, run, biomeArgs } = setup();
    write("scripts/committed.mjs", "export const d = 1;\n");
    git("add", "scripts/committed.mjs");
    git("commit", "-q", "-m", "work");
    write("src/edited.ts", "export const b = 2;\n");
    write("real-e2e/new.test.ts", "export const e = 1;\n");
    write("docs/guide.md", "# guide 2\n");
    write("vitest.extra.ts", "export const f = 1;\n");
    git("rm", "-q", "src/removed.ts");
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(biomeArgs()).toEqual([
      "check",
      "--error-on-warnings",
      "real-e2e/new.test.ts",
      "scripts/committed.mjs",
      "src/edited.ts",
    ]);
  });

  it("passes extra arguments to biome check", () => {
    const { write, run, biomeArgs } = setup();
    write("src/edited.ts", "export const b = 2;\n");
    expect(run("--write").status).toBe(0);
    expect(biomeArgs()).toEqual(["check", "--error-on-warnings", "--write", "src/edited.ts"]);
  });

  it("does not call biome when no source file changed", () => {
    const { write, run, biomeArgs } = setup();
    write("docs/guide.md", "# guide 2\n");
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no changed source files");
    expect(biomeArgs()).toEqual([]);
  });

  it("fails fast, without npx, when the local biome is missing", () => {
    const { write, run } = setup({ biome: false });
    write("src/edited.ts", "export const b = 2;\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("node_modules/.bin/biome is missing");
  });
});
