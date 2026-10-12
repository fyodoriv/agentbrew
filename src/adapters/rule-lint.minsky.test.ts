import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultMinskyDir, MinskyRuleLint } from "./rule-lint.minsky.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rule-lint-"));
  dirs.push(dir);
  return dir;
}

/** Fake Minsky checkout: each script is a tiny node program. */
function fakeMinsky(scripts: Record<string, string>): string {
  const root = tempDir();
  mkdirSync(join(root, "scripts"));
  for (const [name, body] of Object.entries(scripts)) writeFileSync(join(root, "scripts", name), body);
  return root;
}

const REPORTS_REPO = `// parses --repo
const repo = process.argv.find((a) => a.startsWith("--repo=")).slice(7);
console.log("checked " + repo + " from cwd " + process.cwd());`;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MinskyRuleLint", () => {
  it("passes --repo and the target cwd, and reports pass on exit 0", async () => {
    const target = tempDir();
    const lint = new MinskyRuleLint(fakeMinsky({ "check-rule-9-tasksmd-fields.mjs": REPORTS_REPO }));
    const result = await lint.run("rule-9", target);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain(`checked ${target}`);
  });

  it("reports fail with the linter output on a non-zero exit", async () => {
    const lint = new MinskyRuleLint(
      fakeMinsky({
        "check-rule-9-tasksmd-fields.mjs": `// --repo\nconsole.error("rule-9 violation: fixture-task"); process.exit(1);`,
      }),
    );
    const result = await lint.run("rule-9", tempDir());
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("rule-9 violation: fixture-task");
  });

  it("skips a script that does not accept --repo, so it never checks Minsky's own tree", async () => {
    const lint = new MinskyRuleLint(
      fakeMinsky({ "check-rule-9-tasksmd-fields.mjs": `const REPO_ROOT = "x"; process.exit(1);` }),
    );
    const result = await lint.run("rule-9", tempDir());
    expect(result.status).toBe("skip");
    expect(result.detail).toContain("does not accept --repo");
  });

  it("skips when the Minsky checkout is missing", async () => {
    const lint = new MinskyRuleLint(join(tempDir(), "no-minsky"));
    const result = await lint.run("rule-1", tempDir());
    expect(result.status).toBe("skip");
    expect(result.detail).toContain("not found");
  });

  it("skips an unknown rule id", async () => {
    const result = await new MinskyRuleLint(tempDir()).run("rule-99", tempDir());
    expect(result).toEqual({ ruleId: "rule-99", status: "skip", detail: "unknown rule id rule-99" });
  });

  it("lists at least five rules and self-tests with rule 9", async () => {
    const lint = new MinskyRuleLint(fakeMinsky({ "check-rule-9-tasksmd-fields.mjs": REPORTS_REPO }));
    expect(lint.ruleIds().length).toBeGreaterThanOrEqual(5);
    expect((await lint.selfTest(tempDir())).ruleId).toBe("rule-9");
  });

  it("finds Minsky through AGENTBREW_MINSKY_DIR", () => {
    const before = process.env.AGENTBREW_MINSKY_DIR;
    process.env.AGENTBREW_MINSKY_DIR = "/x/minsky";
    try {
      expect(defaultMinskyDir()).toBe("/x/minsky");
    } finally {
      if (before === undefined) delete process.env.AGENTBREW_MINSKY_DIR;
      else process.env.AGENTBREW_MINSKY_DIR = before;
    }
  });
});
