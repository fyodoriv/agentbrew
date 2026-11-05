import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = (id: number) => evals.find((entry) => entry.id === id);
const expected = (id: number) => [scenario(id)?.expected_output, ...(scenario(id)?.expectations ?? [])].join(" ");

describe("run-goal ownership and proof (#778)", () => {
  it("probes actual ownership and a valid submission route before promising changes", () => {
    const intake = skill.split("## Phase 1")[1]?.split("## Phase 2")[0] ?? "";
    expect(intake).toMatch(/actual owner[\s\S]*writable[\s\S]*valid submission route/i);
    expect(intake).toMatch(/unknown[\s\S]*ownership[\s\S]*route[\s\S]*unverified/i);
  });

  it("preserves externally owned criteria unless the user explicitly approves a revised goal", () => {
    const contract = skill.split("## Phase 2")[1]?.split("## Phase 3")[0] ?? "";
    expect(contract).not.toMatch(/scope a "resolve" goal to what\s+this session controls/);
    expect(contract).toMatch(/original acceptance criteria[\s\S]*blocked or unverified/i);
    expect(contract).toMatch(/explicit user approval[\s\S]*replace[\s\S]*criteria/i);
    expect(contract).toMatch(/owner.ask draft[\s\S]*not[\s\S]*original goal[\s\S]*complete/i);
    expect(expected(67)).toMatch(/original[\s\S]*blocked or unverified[\s\S]*explicit user approval/i);
    expect(expected(67)).not.toContain("Names the other team's action as out of scope");
  });

  it("reads proof images and reconciles the same run's authoritative log before completion", () => {
    const verify = skill.split("## Phase 5")[1]?.split("## Phase 6")[0] ?? "";
    expect(verify).toMatch(/every proof image[\s\S]*image itself[\s\S]*system-of-record log/i);
    expect(verify).toMatch(/same run[\s\S]*caption[\s\S]*not[\s\S]*completion/i);
    expect(verify).toMatch(/unavailable[\s\S]*unverified/i);
  });

  it("supplies owner and route lookup evidence without authorizing a message or a substitute outcome", () => {
    const fixture = scenario(236);
    expect(fixture).toBeDefined();
    const raw = /Ownership lookup fixture:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const lookup = JSON.parse(raw?.[1] ?? "{}") as {
      targets: Array<{ criterion: string; owner: string; writable: boolean; route: string; routeVerified: boolean }>;
    };
    expect(lookup.targets.filter(({ writable }) => !writable).map(({ criterion }) => criterion)).toEqual([
      "React 18 runtime",
      "shared plugin list",
    ]);
    expect(lookup.targets.every(({ owner, route, routeVerified }) => owner && route && routeVerified)).toBe(true);
    expect(expected(236)).toMatch(/probe[\s\S]*owner[\s\S]*submission route[\s\S]*before/i);
    expect(expected(236)).toMatch(/original[\s\S]*blocked or unverified[\s\S]*explicit user approval/i);
    expect(expected(236)).toMatch(/draft[\s\S]*does not post[\s\S]*does not[\s\S]*complete/i);
    expect(expected(236)).toMatch(/unknown[\s\S]*unverified/i);
  });

  it("supplies a readable waiting image and same-run log despite a misleading completion caption", () => {
    const fixture = scenario(237);
    expect(fixture).toBeDefined();
    const raw = /System-of-record log:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const log = JSON.parse(raw?.[1] ?? "{}") as {
      runId: string;
      state: string;
      inputPending: boolean;
      completed: boolean;
    };
    expect(log).toEqual({ runId: "run-proof-1", state: "waiting-input", inputPending: true, completed: false });
    const image = readFileSync(join(root, "evals", "fixtures", "waiting-proof.svg"), "utf8");
    expect(image).toContain("run-proof-1");
    expect(image).toContain("Waiting for your answer");
    expect(image).toContain("Input pending");
    expect(fixture?.prompt).toMatch(/human-complete[\s\S]*waiting-proof\.svg/);
    expect(expected(237)).toMatch(/read[\s\S]*image itself[\s\S]*system-of-record log[\s\S]*same run/i);
    expect(expected(237)).toMatch(/not complete[\s\S]*unavailable[\s\S]*unverified/i);
  });

  it("retains independent grading and cited approval requirements", () => {
    expect(skill).toContain("a fresh-context subagent to grade each");
    expect(skill).toMatch(/An approval\s+you cannot cite/);
  });
});
