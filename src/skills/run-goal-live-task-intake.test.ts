import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillEval } from "./skill-contract-test-helpers.js";
import { validateEvals } from "./validate.js";

const root = join(resolve(import.meta.dirname, "../.."), "skill-plugins/workflow/run-goal");
const evals = JSON.parse(readFileSync(join(root, "evals/evals.json"), "utf8")).evals as SkillEval[];
const historicalHash = "7873fd15c3b907ff70c3ccd5dd8a784e953ccf5f8e21f8f984e507bb4c6caee9";
const prefixHash = (entries: SkillEval[]) =>
  createHash("sha256")
    .update(JSON.stringify(entries.slice(0, 245)))
    .digest("hex");
const scenario = () => {
  const entry = evals.find(({ id }) => id === 246);
  expect(entry, "missing registered live-task intake case 246").toBeDefined();
  return entry;
};
const fixture = () => {
  const entry = scenario();
  const match = /Task intake fixture:\n```json\n([\s\S]+?)\n```/.exec(entry?.prompt ?? "");
  expect(match, "missing independently gradeable task identities").not.toBeNull();
  return JSON.parse(match?.[1] ?? "{}");
};
const oracle = () => {
  const entry = scenario();
  const match = /Task intake oracle:\n```json\n([\s\S]+?)\n```/.exec(entry?.expected_output ?? "");
  expect(match, "missing grader-only registered outcomes").not.toBeNull();
  return JSON.parse(match?.[1] ?? "[]");
};
const control = (name: string) => ({
  ...fixture().controls.find((item: { name: string }) => item.name === name),
  ...oracle().find((item: { name: string }) => item.name === name),
});
const response = () => {
  const entry = scenario();
  return [entry?.expected_output, ...(entry?.expectations ?? [])].join(" ");
};

describe("run-goal fresh task intake", () => {
  it("preserves historical objects except the documented clock correction and passes the schema", () => {
    expect(prefixHash(evals)).toBe(historicalHash);
    expect(new Set(evals.map(({ id }) => id)).size).toBe(evals.length);
    expect(validateEvals(root).filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("accepts additive cases while rejecting undocumented historical mutation", () => {
    const addition = { id: "synthetic-later-case", prompt: "Synthetic addition" } as unknown as SkillEval;
    expect(prefixHash([...evals, addition])).toBe(historicalHash);
    const changed = structuredClone(evals);
    changed[244].prompt = `${changed[244].prompt} changed`;
    expect(prefixHash(changed)).not.toBe(historicalHash);
  });

  it("supplies discovered backend and non-default remote/ref evidence", () => {
    expect(fixture().source).toEqual({
      declaredIn: "Agentfile.yaml",
      backend: "tasks-md",
      remote: "upstream",
      defaultBranch: "trunk",
      taskPath: "TASKS.md",
    });
  });

  it("makes removed and added task identities decisive in the stale control", () => {
    expect(control("stale")).toEqual({
      name: "stale",
      local: ["old-a", "old-b", "old-c", "keep-d"],
      authoritative: ["keep-d", "new-e", "new-f"],
      freshRead: "success",
      selected: ["keep-d", "new-e", "new-f"],
      excluded: ["old-a", "old-b", "old-c"],
      verified: true,
    });
  });

  it("keeps already-current and unchanged controls distinct from stale input", () => {
    const controls = fixture().controls;
    expect(control("already current")).toEqual({
      name: "already current",
      local: ["keep-d", "new-e", "new-f"],
      authoritative: ["keep-d", "new-e", "new-f"],
      freshRead: "success",
      selected: ["keep-d", "new-e", "new-f"],
      excluded: [],
      verified: true,
    });
    expect(control("unchanged")).toEqual({
      name: "unchanged",
      local: ["keep-d"],
      authoritative: ["keep-d"],
      freshRead: "success",
      selected: ["keep-d"],
      excluded: [],
      verified: true,
    });
    expect(controls.map((item: { name: string }) => item.name)).toEqual([
      "stale",
      "already current",
      "unchanged",
      "unavailable",
    ]);
  });

  it("leaves selection unverified when authoritative fetching or reading fails", () => {
    expect(control("unavailable")).toEqual({
      name: "unavailable",
      local: ["old-a", "old-b", "old-c", "keep-d"],
      authoritative: null,
      freshRead: "failure",
      selected: null,
      excluded: [],
      verified: false,
    });
    expect(response()).toMatch(/unavailable[\s\S]*unverified/i);
    expect(response()).toMatch(/(?:not|never)[\s\S]*stale[\s\S]*fresh/i);
  });

  it("keeps selection answer keys in grader expectations rather than actor input", () => {
    expect(scenario()?.prompt).not.toMatch(/"(?:selected|excluded|verified)"\s*:/);
    expect(oracle().map((item: { name: string }) => item.name)).toEqual([
      "stale",
      "already current",
      "unchanged",
      "unavailable",
    ]);
    for (const item of oracle()) {
      expect(Object.keys(item).sort()).toEqual(["excluded", "name", "selected", "verified"]);
    }
  });

  it("requires discovery and a fresh read before contracting without deleting local work", () => {
    const text = response();
    expect(text).toMatch(/discover[\s\S]*backend[\s\S]*remote[\s\S]*default[\s\S]*before[\s\S]*fetch/i);
    expect(text).toMatch(/fetch[\s\S]*read[\s\S]*before[\s\S]*contract/i);
    expect(text).toMatch(/issue[\s\S]*declared[\s\S]*CLI/i);
    expect(text).toMatch(/preserve[\s\S]*local[\s\S]*(?:changes|work)/i);
    expect(text).toMatch(/(?:not|never)[\s\S]*(?:complete|completion)/i);
  });
});
