/** `agentbrew work` (#440): the ordered day plan and the machine rule. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginLockEntry } from "./lock.js";
import type { AgentBrewState } from "./types.js";
import {
  buildWorkPlan,
  DEFAULT_WORK_STEPS,
  END_OF_DAY_STEP,
  formatWorkPlan,
  mergeWorkSteps,
  resolveWorkStep,
} from "./work.js";

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

describe("run without stops (#508)", () => {
  it("tells /work to run steps back to back and lists the only reasons to stop", () => {
    const plan = buildWorkPlan(state(), []);
    expect(plan.flow).toMatch(/back to back/);
    expect(plan.flow).toMatch(/one line/);
    expect(plan.stopOnlyFor).toHaveLength(3);
    expect(plan.stopOnlyFor.join(" ")).toMatch(/merge conflict/);
    expect(plan.stopOnlyFor.join(" ")).toMatch(/destructive or public/);
    expect(plan.stopOnlyFor.join(" ")).toMatch(/only the user can make/);
    expect(plan.questions).toMatch(/once, after the last step/);
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

describe("resolveWorkStep (#451)", () => {
  it("names the file of a user-only skill so /work can read and follow it", () => {
    const root = mkdtempSync(join(tmpdir(), "work-steps-"));
    try {
      mkdirSync(join(root, "skills", "tooling-checkup"), { recursive: true });
      writeFileSync(
        join(root, "skills", "tooling-checkup", "SKILL.md"),
        "---\nname: tooling-checkup\ndisable-model-invocation: true\n---\nbody\n",
      );
      mkdirSync(join(root, "commands"), { recursive: true });
      writeFileSync(join(root, "commands", "agentbrew.md"), "---\ndescription: x\n---\n");

      expect(resolveWorkStep("/tooling-checkup", root)).toEqual({
        path: join(root, "skills", "tooling-checkup", "SKILL.md"),
        userOnly: true,
      });
      expect(resolveWorkStep("/agentbrew", root)).toEqual({
        path: join(root, "commands", "agentbrew.md"),
        userOnly: false,
      });
      expect(resolveWorkStep("/missing", root)).toEqual({ path: null, userOnly: false });
      mkdirSync(join(root, "skills", "crlf"), { recursive: true });
      writeFileSync(
        join(root, "skills", "crlf", "SKILL.md"),
        '---\r\nname: crlf\r\ndisable-model-invocation: "true"\r\n---\r\n',
      );
      expect(resolveWorkStep("/crlf", root).userOnly).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("puts path and userOnly on every step of the plan", () => {
    const plan = buildWorkPlan(state(), []);
    for (const step of plan.steps) {
      expect(step).toHaveProperty("path");
      expect(step).toHaveProperty("userOnly");
    }
  });
});
