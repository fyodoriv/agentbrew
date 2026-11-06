import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillEval } from "./skill-contract-test-helpers.js";
import { validateEvals } from "./validate.js";

const root = join(resolve(import.meta.dirname, "../.."), "skill-plugins/workflow/run-goal");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const evals = JSON.parse(readFileSync(join(root, "evals/evals.json"), "utf8")).evals as SkillEval[];
const recipe = () => evals.find(({ prompt }) => prompt.includes("two-zone air fryer"));
const status = () => evals.find(({ prompt }) => prompt.includes("user's app shows a nudge"));
const response = (entry: SkillEval | undefined) => {
  expect(entry).toBeDefined();
  return [entry?.expected_output, ...(entry?.expectations ?? [])].join(" ");
};

describe("run-goal contributed recipe and status cases", () => {
  it("preserves the earlier cases and retains both distinct contributions", () => {
    expect(
      createHash("sha256")
        .update(JSON.stringify(evals.slice(0, 241)))
        .digest("hex"),
    ).toBe("7ab8d489d56d1a6f495045620f29119486192597cfe2b9ba04336ea74624f41b");
    expect(evals.slice(241)).toHaveLength(4);
    expect(recipe()?.id).toBe(242);
    expect(status()?.id).toBe(245);
    for (const [offset, hash] of [
      [242, "165b7591cc0223c8e2e04be0efc6899720b79340d56fbdefb33857b5df5b5197"],
      [243, "30cc5ede1c7f19cae2e27472712e3b6a0dc25fd1386d4caa85e6bdec7340168e"],
    ] as const) {
      expect(createHash("sha256").update(JSON.stringify(evals[offset])).digest("hex")).toBe(hash);
    }
    expect(new Set(evals.map(({ id }) => id)).size).toBe(evals.length);
  });

  it("passes the existing minimum-check schema for both contributions", () => {
    expect(validateEvals(root).filter(({ severity }) => severity === "error")).toEqual([]);
    expect(recipe()?.expectations?.length).toBeGreaterThanOrEqual(3);
    expect(status()?.expectations?.length).toBeGreaterThanOrEqual(3);
  });

  it("diagnoses recipe publication from evidence instead of a predetermined defect", () => {
    const text = response(recipe());
    expect(text).not.toContain("no scheduled import, recipes missing from the publish hash");
    expect(text).toMatch(/diagnos[\s\S]*evidence/i);
    expect(text).toMatch(/confirmed[\s\S]*defect[\s\S]*test/i);
    expect(text).toMatch(/does not[\s\S]*(?:invent|presume)[\s\S]*defect/i);
  });

  it("keeps recipe corrections, phone proof and queued-gate honesty", () => {
    const text = response(recipe());
    expect(text).toMatch(/saved recipes[\s\S]*memory/i);
    expect(text).toMatch(/per.person[\s\S]*big.zone/i);
    expect(text).toMatch(/phone[\s\S]*screenshot/i);
    expect(text).toMatch(/(?:not|never)[\s\S]*(?:done|green)[\s\S]*queued/i);
  });

  it("answers a nudge and continues actionable work or a supported quiet wait", () => {
    const text = response(status());
    expect(text).toMatch(/answers[\s\S]*one.line/i);
    expect(text).toMatch(/actionable work[\s\S]*same turn/i);
    expect(text).toMatch(/only[\s\S]*external wait[\s\S]*supported[\s\S]*quiet.wait/i);
    expect(text).not.toContain("then calls tools again in the same turn");
    expect(skill).not.toContain("then more tool calls");
    expect(skill).toMatch(/status nudge[\s\S]*actionable work[\s\S]*external wait[\s\S]*supported/i);
  });

  it("requires verified original criteria rather than printed check lines for completion", () => {
    const text = response(status());
    expect(text).not.toContain("only when all criteria have Goal check lines");
    expect(text).toMatch(/original[\s\S]*criteria[\s\S]*fresh evidence/i);
    expect(text).toMatch(/(?:printed|status)[\s\S]*(?:not|never)[\s\S]*completion/i);
    expect(skill).toMatch(/printed[\s\S]*check line[\s\S]*not[\s\S]*completion/i);
    expect(skill).toContain("references/external-waits.md");
  });
});
