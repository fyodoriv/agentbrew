/** run-goal: act on the first failed CI job, then collect the rest from the same run (PR 1373). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL_DIR = join(ROOT, "skill-plugins", "workflow", "run-goal");
const waits = readFileSync(join(SKILL_DIR, "references", "external-waits.md"), "utf-8");
const execution = readFileSync(join(SKILL_DIR, "references", "execution.md"), "utf-8");
const hook = readFileSync(join(ROOT, "hooks", "checks", "background-suite-fail-fast.sh"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal CI fail-fast loop", () => {
  it("waits with the fail-fast watcher, not a full-run gh run watch", () => {
    expect(waits).toMatch(/ci-watch-fail-fast\.sh <run-id>/);
    expect(waits).not.toMatch(/timeout \d+ gh run watch/);
    expect(waits).toMatch(/background-suite-fail-fast/);
  });

  it("writes the loop: first failure, fix, --rest for more, fold or push", () => {
    const loop = waits.slice(waits.indexOf("## Act on the first failure"));
    expect(loop).toMatch(/\*\*First failure\.\*\*/);
    expect(loop).toMatch(/never cancels the run/i);
    expect(loop).toMatch(/\*\*Fix\.\*\*[\s\S]*Do not push yet/);
    expect(loop).toMatch(/\*\*More failures\.\*\*[\s\S]*--rest/);
    expect(loop).toMatch(/\*\*Fold or push\.\*\*[\s\S]*push\s+once/);
  });

  it("links the loop from Hosted checks in execution.md", () => {
    const hosted = execution.slice(execution.indexOf("## Hosted checks"));
    expect(hosted).toMatch(/external-waits\.md#act-on-the-first-failure/);
    expect(hosted).toMatch(/--rest/);
  });

  it("has a hook that names the watcher for gh run watch and gh pr checks --watch", () => {
    expect(hook).toMatch(/run\[\[:space:\]\]\+watch/);
    expect(hook).toMatch(/--watch\)/);
    expect(hook).toMatch(/ci-watch-fail-fast\.sh/);
  });

  it("has one eval that replaces a full-run wait on run 46110246456", () => {
    const cases = evals.filter((e) => /46110246456/.test(e.prompt) && /gh run watch/.test(e.prompt));
    expect(cases).toHaveLength(1);
    const text = cases[0]?.expectations.join(" ") ?? "";
    expect(text).toMatch(/ci-watch-fail-fast\.sh/);
    expect(text).toMatch(/--rest/);
    expect(text).toMatch(/one push/);
  });
});
