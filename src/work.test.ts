/** `agentbrew work` (#440): the ordered day plan and the machine rule. */
import { describe, expect, it } from "vitest";
import type { PluginLockEntry } from "./lock.js";
import type { AgentBrewState } from "./types.js";
import { buildWorkPlan, DEFAULT_WORK_STEPS, END_OF_DAY_STEP, formatWorkPlan, mergeWorkSteps } from "./work.js";

const state = (workSteps?: AgentBrewState["workSteps"]): AgentBrewState =>
  ({ agents: [], catalogVersion: "test", workSteps }) as AgentBrewState;
const plugin = (name: string, source: string) => ({ name, source }) as PluginLockEntry;

describe("buildWorkPlan", () => {
  it("runs the built-in steps first, then each Agentfile's workSteps in order, each once", () => {
    const plan = buildWorkPlan(
      state([
        { step: "/tooling-checkup", agentfile: "/a" },
        { step: "/agentbrew", agentfile: "/a" },
        { step: "/team-oncall", agentfile: "/b" },
      ]),
      [],
    );
    expect(plan.steps.map((s) => s.step)).toEqual([...DEFAULT_WORK_STEPS, "/tooling-checkup", "/team-oncall"]);
    expect(plan.steps.find((s) => s.step === "/team-oncall")?.from).toBe("/b");
    expect(plan.endOfDay[0]).toBe(END_OF_DAY_STEP);
  });

  it("on a personal machine (no company plugin), edits public repos and drafts public posts", () => {
    const plan = buildWorkPlan(state(), []);
    expect(plan.machine).toBe("personal");
    expect(plan.rule).toMatch(/public repos/);
    expect(plan.rule).toMatch(/draft/);
  });

  it("on a machine with a company plugin, edits only the plugin repos and opens issues on public repos", () => {
    const plan = buildWorkPlan(state(), [plugin("acme", "git@git.example.com:acme/agentbrew-acme.git")]);
    expect(plan.machine).toBe("company");
    expect(plan.rule).toContain("git@git.example.com:acme/agentbrew-acme.git");
    expect(plan.rule).toMatch(/issue/);
    expect(plan.rule).toMatch(/draft/);
  });

  it("prints a human plan with the steps, watch mode, and end of day", () => {
    const text = formatWorkPlan(buildWorkPlan(state([{ step: "/tooling-checkup", agentfile: "/a" }]), []));
    expect(text).toContain("1. /agentbrew");
    expect(text).toContain("/tooling-checkup");
    expect(text).toMatch(/end of day/i);
  });
});

describe("mergeWorkSteps", () => {
  it("keeps each Agentfile's steps in its own place and replaces them on re-apply", () => {
    let steps = mergeWorkSteps(undefined, "/a", ["/x", "/y"]);
    steps = mergeWorkSteps(steps, "/b", ["/z"]);
    expect(steps.map((s) => s.step)).toEqual(["/x", "/y", "/z"]);
    steps = mergeWorkSteps(steps, "/a", ["/y2"]);
    expect(steps.map((s) => `${s.agentfile}:${s.step}`)).toEqual(["/a:/y2", "/b:/z"]);
    steps = mergeWorkSteps(steps, "/b", []);
    expect(steps.map((s) => s.step)).toEqual(["/y2"]);
  });
});
