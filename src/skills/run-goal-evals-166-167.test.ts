/** run-goal: retro rules for e2e setup that deletes real data, and sinks a goal makes shareable (#624, #627). */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(SKILL_DIR, "references", "execution.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(SKILL_DIR, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  expectations: string[];
}>;
const expectationsOf = (id: number) => evals.find((e) => e.id === id)?.expectations.join(" ") ?? "";

describe("run-goal retro rules (evals 166-167)", () => {
  it("reads the e2e setup for deletes of real data before the first e2e run", () => {
    expect(execution).toMatch(/Before the first e2e run, read its global setup and teardown/);
    expect(execution).toMatch(/Playwright starts `webServer` before `globalSetup`/);
    expect(expectationsOf(166)).toMatch(/before the first e2e run/);
    expect(expectationsOf(166)).toMatch(/real database file/);
  });

  it("checks old writers before a goal makes a sink shareable", () => {
    expect(execution).toMatch(/list every existing\s+writer into that sink/);
    expect(execution).toMatch(/every value a user can type\s+or\s+import\s+that\s+reaches\s+an\s+external\s+sink/);
    expect(expectationsOf(167)).toMatch(/Every existing writer into the new sink is listed/);
  });

  it("keeps eval ids unique", () => {
    expect(new Set(evals.map((e) => e.id)).size).toBe(evals.length);
  });
});
