import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, type TestContext } from "vitest";

const check = fileURLToPath(new URL("../../scripts/check-orphan-tests.mjs", import.meta.url));
const lintChanged = fileURLToPath(new URL("../../scripts/lint-changed.sh", import.meta.url));
const dependencies = fileURLToPath(new URL("../../node_modules", import.meta.url));

function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "named-test-imports-"));
  t.onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(cwd, "empty-global"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  git("init", "--quiet", "--template=");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  mkdirSync(join(cwd, "scripts"));
  writeFileSync(join(cwd, "scripts/source.js"), "export const present = 1;");
  writeFileSync(
    join(cwd, "scripts/bridge.mjs"),
    'export { present as viaBridge } from "./source.js";\nexport * from "./source.js";',
  );
  writeFileSync(join(cwd, "scripts/broken.mjs"), 'export { removed as throughBroken } from "./source.js";');
  const testFile = join(cwd, "scripts/check.test.mjs");
  const write = (path: string, text: string) => writeFileSync(join(cwd, "scripts", path), text);
  function run(testSource: string, runtime = false) {
    writeFileSync(testFile, testSource);
    return spawnSync(process.execPath, [runtime ? testFile : check], { cwd, env, encoding: "utf8", timeout: 5000 });
  }
  function runChangedLint() {
    return spawnSync("bash", [lintChanged], {
      cwd,
      env: { ...env, LINT_CHANGED_BASE: "HEAD" },
      encoding: "utf8",
      timeout: 5000,
    });
  }
  return { cwd, git, run, runChangedLint, write };
}

it("reports direct and re-exported missing names with the source file", (t) => {
  const { run } = fixture(t);
  const result = run(`import { removed as alias } from "./source.js";
import { throughBroken } from "./broken.mjs";`);
  expect(result.status, result.error?.message ?? result.stderr).toBe(1);
  expect(result.stderr).toContain(
    'scripts/check.test.mjs:1: No matching export in "scripts/source.js" for import "removed"',
  );
  expect(result.stderr).toContain(
    'scripts/broken.mjs:1: No matching export in "scripts/source.js" for import "removed"',
  );
  expect(result.stderr.trim().split("\n")).toHaveLength(2);
});

it("allows valid aliases and literal text without evaluating files or writing a bundle", (t) => {
  const { cwd, run } = fixture(t);
  const result = run(`import { present as directAlias } from "./source.js";
import { viaBridge, present } from "./bridge.mjs";
import { writeFileSync } from "node:fs";
import { packageValue } from "fixture-package";
const sample = 'import { removed } from "./source.js"';
// import { removed } from "./source.js";
writeFileSync("executed", "unexpected");`);
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(existsSync(join(cwd, "executed"))).toBe(false);
  expect(existsSync(join(cwd, "named-import-check"))).toBe(false);
});

it("uses the explicit JavaScript file when a TypeScript file has the same stem", (t) => {
  const { cwd, run, write } = fixture(t);
  write("source.ts", "export const typesOnly = 1;");
  const valid = 'import { present } from "./source.js";';
  const invalid = 'import { typesOnly } from "./source.js";';
  expect(run(valid, true).status).toBe(0);
  expect(run(valid).status).toBe(0);
  expect(run(invalid, true).status).toBe(1);
  const result = run(invalid);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('for import "typesOnly"');
  rmSync(join(cwd, "scripts/source.js"));
  expect(run(invalid, true).status).toBe(1);
  const missingFile = run(invalid);
  expect(missingFile.status).toBe(1);
  expect(missingFile.stderr).toContain("Cannot find explicit JavaScript module ./source.js");
});

it("rejects a conflicting star export and accepts an explicit selection", (t) => {
  const { run, write } = fixture(t);
  write("other.mjs", "export const present = 2;");
  write("stars.mjs", 'export * from "./source.js"; export * from "./other.mjs";');
  const source = 'import { present } from "./stars.mjs";';
  expect(run(source, true).status).toBe(1);
  const ambiguous = run(source);
  expect(ambiguous.status).toBe(1);
  expect(ambiguous.stderr).toContain('Ambiguous import "present"');
  write("stars.mjs", 'export * from "./other.mjs"; export { present } from "./source.js";');
  expect(run(source, true).status).toBe(0);
  expect(run(source).status).toBe(0);
});

it("runs import lint when deleting the only changed source file", (t) => {
  const { cwd, git, runChangedLint, write } = fixture(t);
  write("check.test.mjs", 'import { present } from "./source.js";');
  symlinkSync(dependencies, join(cwd, "node_modules"), "dir");
  git("add", "--", "scripts", "package.json");
  git("commit", "--quiet", "-m", "test: create deletion fixture");
  rmSync(join(cwd, "scripts/source.js"));
  expect(git("diff", "--name-only").trim()).toBe("scripts/source.js");
  const result = runChangedLint();
  expect(result.status, result.error?.message ?? result.stderr).toBe(1);
  expect(result.stderr).toContain("Cannot find explicit JavaScript module ./source.js");
});
