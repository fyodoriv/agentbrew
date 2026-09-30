import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Logic tests for scripts/lint-tasks-stability.mjs — the cross-tooling gate
// that keeps stability-tagged tasks out of P2/P3 (see ~/.config/devin/AGENTS.md
// § Task queues). The verify chain runs the script against this repo's real
// TASKS.md; these tests prove the script's classification + allowlist behavior
// against fixtures.

const SCRIPT = fileURLToPath(new URL("../../scripts/lint-tasks-stability.mjs", import.meta.url));

function runLint(tasksMd: string, allowlist?: string): number {
  const dir = mkdtempSync(join(tmpdir(), "tasks-stability-"));
  try {
    writeFileSync(join(dir, "TASKS.md"), tasksMd);
    if (allowlist !== undefined) {
      writeFileSync(join(dir, ".tasks-stability-allowlist"), allowlist);
    }
    execFileSync("node", [SCRIPT, join(dir, "TASKS.md")], { stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const header = "# Tasks\n\n## P0\n\n## P1\n\n## P2\n\n## P3\n";

const stabilityBlock = (id: string, tags: string) =>
  `\n- [ ] a task\n  **ID**: ${id}\n  **Tags**: ${tags}\n  **Details**: x\n`;

describe("lint-tasks-stability.mjs", () => {
  it("fails when a stability-tagged task sits in P3", () => {
    const md = header + stabilityBlock("foo-obs", "scout, observability, x");
    expect(runLint(md)).toBe(1);
  });

  it("passes when the same stability task is in P1", () => {
    const md = `# Tasks\n\n## P0\n\n## P1\n${stabilityBlock("foo-obs", "scout, observability, x")}\n## P2\n\n## P3\n`;
    expect(runLint(md)).toBe(0);
  });

  it("passes when a non-stability task sits in P3", () => {
    const md = header + stabilityBlock("foo-dx", "scout, dx, ux");
    expect(runLint(md)).toBe(0);
  });

  it("passes when the P3 stability task is grandfathered in the allowlist", () => {
    const md = header + stabilityBlock("foo-leak", "scout, leak");
    expect(runLint(md, "foo-leak\n")).toBe(0);
  });

  it("fails on a dead allowlist entry (no longer a P2/P3 stability task)", () => {
    const md = header + stabilityBlock("foo-dx", "scout, dx");
    expect(runLint(md, "ghost-id\n")).toBe(1);
  });

  it("recognizes every documented stability-class tag", () => {
    for (const tag of [
      "observability",
      "regression-guard",
      "data-integrity",
      "data-safety",
      "ci-gate",
      "flake",
      "leak",
      "git-safety",
      "auth-path",
      "deployment-infra",
    ]) {
      const md = header + stabilityBlock(`t-${tag}`, `scout, ${tag}`);
      expect(runLint(md)).toBe(1);
    }
  });
});
