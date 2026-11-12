import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeInstructionsWithManagedSection } from "./instructions-content.js";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("safe iteration standard", () => {
  it("delivers the iteration rule through instruction merging", () => {
    const rendered = mergeInstructionsWithManagedSection(read("templates/AGENTS.md"), undefined);
    expect(rendered).toContain("### Fast, safe iterations");
    expect(rendered).toMatch(/affected checks/i);
    expect(rendered).toContain("external state");
    expect(rendered).toContain("without exposing values");
    expect(rendered).toMatch(/unknown inputs.*full/i);
    expect(rendered).toMatch(/required final gate/i);
  });

  it("asks the reviewer to inspect cache validity without weakening verification", () => {
    const reviewer = read("agents/reviewer.md");
    expect(reviewer).toContain("iteration speed");
    expect(reviewer).toContain("cache invalidation");
    expect(reviewer).toContain("fresh, exact-input gate evidence");
    expect(reviewer).toContain("run the required gate when evidence is missing or stale");
    expect(reviewer).toContain("stricter user or project requirements");
    expect(reviewer).toContain("external inputs cannot be verified");
    expect(reviewer).toContain("re-execute affected steps");
    expect(reviewer).not.toContain("Run the full verify suite yourself");
  });

  it("makes performance review proactive and preserves the full gate", () => {
    const skill = read("skill-plugins/workflow/perf-review/SKILL.md");
    expect(skill).toContain("During each iteration");
    expect(skill).toContain("unknown dependencies");
    expect(skill).toContain("without exposing values");
    expect(skill).toContain("required full gate");
  });

  it("includes a behavioral evaluation for safe iteration decisions", () => {
    const cases = JSON.parse(read("skill-plugins/workflow/perf-review/evals/evals.json"));
    const example = cases.evals.find((item: { id: number }) => item.id === 9);
    expect(example).toBeDefined();
    expect(JSON.stringify(example)).toMatch(/unknown.*(full|conservative)/i);
    expect(JSON.stringify(example)).toMatch(/(measure|timing)/i);
  });

  it("adds a safe iteration hint only when the performance brief has data", () => {
    const dir = mkdtempSync(join(tmpdir(), "iteration-speed-"));
    try {
      const helper = join(dir, "helper.mjs");
      writeFileSync(helper, 'console.log("synthetic measured brief")\n');
      const env: NodeJS.ProcessEnv = { ...process.env, AGENTBREW_PERF_HELPER: helper, HOOK_BYPASS_PERF_BRIEF: "1" };
      delete env.HOOK_BYPASS_PERF_BRIEF;
      delete env.BASH_ENV;
      delete env.ENV;
      const call = () =>
        spawnSync("bash", ["hooks/checks/perf-brief.sh"], {
          input: JSON.stringify({ cwd: dir }),
          encoding: "utf8",
          env,
        });
      const withData = call();
      expect(withData.status).toBe(0);
      const context = JSON.parse(withData.stdout).hookSpecificOutput.additionalContext;
      expect(context).toContain("affected checks");
      expect(context).toContain("external state");
      expect(context).toContain("without exposing values");
      expect(context).toContain("required full gate");
      writeFileSync(helper, "");
      expect(call().stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
