import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "worktree-deps.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A main checkout with node_modules, a worktree, and an npm stub that logs its args. */
function setup(opts: { worktreeLock: string; mainModules?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "worktree-deps-"));
  roots.push(root);
  const main = join(root, "main");
  const wt = join(root, "wt");
  mkdirSync(main);
  mkdirSync(wt);
  writeFileSync(join(main, "package-lock.json"), '{"lock":1}\n');
  writeFileSync(join(wt, "package-lock.json"), opts.worktreeLock);
  if (opts.mainModules !== false) {
    mkdirSync(join(main, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(main, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  }
  const log = join(root, "npm.log");
  const npm = join(root, "npm-stub");
  writeFileSync(npm, `#!/bin/sh\necho "$@" >> "${log}"\n`);
  chmodSync(npm, 0o755);
  const run = () =>
    spawnSync("bash", [SCRIPT, main], {
      cwd: wt,
      encoding: "utf8",
      env: { ...process.env, WORKTREE_DEPS_NPM: npm },
    });
  const npmCalls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { wt, run, npmCalls };
}

describe("worktree-deps.sh", () => {
  it("clones node_modules when the lockfiles match", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cloned node_modules");
    expect(readFileSync(join(wt, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(npmCalls()).toBe("");
  });

  it("runs npm ci when the lockfiles differ", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("package-lock.json differs");
    expect(npmCalls().trim()).toBe("ci");
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });

  it("runs npm ci when the main checkout has no node_modules", () => {
    const { run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n', mainModules: false });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("main checkout has no node_modules");
    expect(npmCalls().trim()).toBe("ci");
  });
});
