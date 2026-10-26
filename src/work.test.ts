/** `agentbrew work` (#440): the ordered day plan and the machine rule. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginLockEntry } from "./lock.js";
import type { AgentBrewState, WorkStepEntry } from "./types.js";
import {
  buildWorkPlan,
  buildWorkStages,
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

  it("ends every cycle with one batched ask of what waits on the user (#517)", () => {
    const plan = buildWorkPlan(state(), []);
    expect(plan.questions).toMatch(/each watch pass/);
    expect(plan.questions).toMatch(/still open/);
    expect(plan.questions).toMatch(/what each option does/);
    expect(plan.questions).toMatch(/your pick/);
  });
});

describe("parallel stages (#509)", () => {
  const entry = (step: string, extra: Partial<WorkStepEntry> = {}): WorkStepEntry => ({
    step,
    agentfile: "/a",
    ...extra,
  });

  it("groups steps whose scopes do not overlap; after: waits; no scope runs alone; long-running steps go last", () => {
    const plan = buildWorkPlan(
      state([
        entry("/a", { scope: ["~/apps/tooling"] }),
        entry("/b", { scope: ["~/apps/career"] }),
        entry("/c", { scope: ["~/apps/tooling/agentbrew"] }),
        entry("/d", { scope: ["github.com"], after: ["/a"] }),
        entry("/e"),
        entry("/feed", { scope: ["~/apps/feed"], longRunning: true }),
        entry("/f", { scope: ["~/apps/f"] }),
      ]),
      [],
    );
    expect(plan.stages).toEqual([["/agentbrew"], ["/a", "/b"], ["/c", "/d"], ["/e"], ["/f"], ["/feed"]]);
    const a = plan.steps.find((s) => s.step === "/a");
    expect(a?.scope).toEqual(["~/apps/tooling"]);
    expect(plan.steps.find((s) => s.step === "/d")?.after).toEqual(["/a"]);
    expect(plan.steps.find((s) => s.step === "/feed")?.longRunning).toBe(true);
    expect(plan.steps.find((s) => s.step === "/agentbrew")?.scope).toEqual([]);
  });

  it("never loses a step: an after: cycle or an unknown after: name still runs", () => {
    const stages = buildWorkStages([
      { step: "/x", scope: ["~/x"], after: ["/y"], longRunning: false },
      { step: "/y", scope: ["~/y"], after: ["/x"], longRunning: false },
      { step: "/z", scope: ["~/z"], after: ["/missing"], longRunning: false },
    ]);
    expect(stages).toEqual([["/z"], ["/x"], ["/y"]]);
  });

  it("keeps an unscoped step behind the step it waits for", () => {
    const stages = buildWorkStages([
      { step: "/u", scope: [], after: ["/x"], longRunning: false },
      { step: "/x", scope: ["~/x"], after: [], longRunning: false },
    ]);
    expect(stages).toEqual([["/x"], ["/u"]]);
  });

  it("moves a step that waits on a long-running step to the end, after it", () => {
    const stages = buildWorkStages([
      { step: "/report", scope: ["~/r"], after: ["/feed"], longRunning: false },
      { step: "/feed", scope: ["~/feed"], after: [], longRunning: true },
      { step: "/other", scope: ["~/o"], after: [], longRunning: false },
    ]);
    expect(stages).toEqual([["/other"], ["/feed"], ["/report"]]);
  });

  it("runs two long-running steps with overlapping scopes in separate stages", () => {
    const stages = buildWorkStages([
      { step: "/w1", scope: ["~/apps/"], after: [], longRunning: true },
      { step: "/w2", scope: ["~/apps/x"], after: [], longRunning: true },
    ]);
    expect(stages).toEqual([["/w1"], ["/w2"]]);
  });

  it("reads state saved before #509 (no scope fields) as one step per stage", () => {
    const plan = buildWorkPlan(state([{ step: "/old", agentfile: "/a" }]), []);
    expect(plan.stages).toEqual([["/agentbrew"], ["/old"]]);
    expect(formatWorkPlan(plan)).not.toContain("Stages");
  });

  it("prints the stages when some steps run in parallel", () => {
    const plan = buildWorkPlan(state([entry("/a", { scope: ["~/a"] }), entry("/b", { scope: ["~/b"] })]), []);
    expect(formatWorkPlan(plan)).toContain("2. /a, /b");
  });
});

describe("dashboard block (#510)", () => {
  it("gives one waiting row per step, the statuses, and a dated place to publish", () => {
    const plan = buildWorkPlan(state([{ step: "/tooling-checkup", agentfile: "/a" }]), [], {
      date: new Date(2026, 9, 26, 9, 0),
      stateHome: "/state",
    });
    expect(plan.dashboard.title).toBe("Work day Mon Oct 26");
    expect(plan.dashboard.statuses).toEqual(["done", "running", "waiting", "blocked", "failed"]);
    expect(plan.dashboard.rows).toEqual([
      { step: "/agentbrew", status: "waiting", summary: "", needsYou: "", link: "" },
      { step: "/tooling-checkup", status: "waiting", summary: "", needsYou: "", link: "" },
    ]);
    expect(plan.dashboard.localPath).toBe(join("/state", "agentbrew", "work", "2026-10-26.html"));
    expect(plan.dashboard.publish).toMatch(/Artifact/);
    expect(plan.dashboard.publish).toMatch(/same URL/);
    expect(plan.dashboard.top).toMatch(/Needs you/);
    expect(formatWorkPlan(plan)).toContain(`Dashboard: Work day Mon Oct 26 (local page: ${plan.dashboard.localPath})`);
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

  it("keeps scope, after, and longRunning from an object entry (#509)", () => {
    const steps = mergeWorkSteps(undefined, "/a", [
      "/plain",
      { step: "/feed", scope: ["~/apps/feed"], after: ["/plain"], longRunning: true },
    ]);
    expect(steps).toEqual([
      { step: "/plain", agentfile: "/a" },
      { step: "/feed", agentfile: "/a", scope: ["~/apps/feed"], after: ["/plain"], longRunning: true },
    ]);
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
