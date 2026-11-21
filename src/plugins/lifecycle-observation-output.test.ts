import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_STAGES } from "./lifecycle-observation.js";
import { MARKETPLACE_INVOCATION, STAGE_FALLBACK, STAGE_PREFIX } from "./lifecycle-observation-output.js";
import { classifyMarketplaceObservation, parseStageRecord } from "./lifecycle-observation-verdict.js";

const fixture = fileURLToPath(new URL("./lifecycle-observation-output-fixture.ts", import.meta.url));

function capture(scenario: string, status: number, enabled = true) {
  const report = spawnSync(process.execPath, ["--import", "tsx", fixture, scenario], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", ...(enabled ? { PLUGIN_LIFECYCLE_FIXTURE_OUTPUT: "1" } : {}) },
    timeout: 8_000,
    maxBuffer: 8_192,
  });
  const error = report.error as NodeJS.ErrnoException | undefined;
  if (error) throw new Error(error.code === "ETIMEDOUT" ? "worker exceeded its deadline" : "worker failed to launch");
  expect(report.signal).toBeNull();
  expect(report.status).toBe(status);
  expect((report.stdout + report.stderr).includes("LIFECYCLE_SYNTHETIC_PRIVATE_MARKER")).toBe(false);
  return { stdout: report.stdout, stderr: report.stderr };
}

function observedTimes(stderr: string, expected: readonly ("begin" | "complete")[]) {
  if (!stderr.endsWith("\n")) throw new Error("worker stage output lacks a terminal newline");
  const lines = stderr.slice(0, -1).split("\n");
  expect(lines.length).toBe(expected.length);
  return expected.map((state, index) => {
    const record = parseStageRecord(lines[index]);
    if (!record) throw new Error("worker output lacks a framed stage record");
    const { invocation, stage, state: actualState, time, duration } = record;
    expect(invocation === "marketplace-copy" && stage === "add" && actualState === state).toBe(true);
    expect(Object.keys(record).length).toBe(state === "complete" ? 5 : 4);
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0) throw new Error("invalid stage time");
    if (state === "complete" && (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)) {
      throw new Error("invalid stage duration");
    }
    return { time, duration: state === "complete" ? (duration as number) : undefined };
  });
}

describe("lifecycle recorder output from an external worker", () => {
  it("O01 captures both intact stage records outside the worker", () => {
    const report = capture("intact", 0);
    expect(report.stdout === "", "unexpected stdout").toBe(true);
    const [begin, complete] = observedTimes(report.stderr, ["begin", "complete"]);
    expect(complete.time).toBeGreaterThanOrEqual(begin.time);
    expect(complete.duration).toBe(complete.time - begin.time);
  });

  it("O02 keeps both streams quiet in the ordinary mode", () => {
    const report = capture("intact", 0, false);
    expect(report.stdout === "" && report.stderr === "", "ordinary output must be empty").toBe(true);
  });

  it("O03 observes fallback and no action after the primary channel closes", () => {
    const report = capture("closed-primary", 17);
    expect(report.stdout === STAGE_FALLBACK && report.stderr === "", "expected only the fixed fallback").toBe(true);
  });

  it("O04 observes the still-open stage and a worker that preserved its action failure", () => {
    const report = capture("action-failed", 17);
    expect(report.stdout === STAGE_FALLBACK, "expected only the fixed fallback").toBe(true);
    observedTimes(report.stderr, ["begin"]);
  });

  it("O05 leaves the capture unqualified when both channels are lost", () => {
    const report = capture("closed-both", 17);
    expect(report.stdout === "" && report.stderr === "", "closed channels must be empty").toBe(true);
  });
});

function record(stage: string, state: "begin" | "complete" | "failed", time: number, duration?: number): string {
  return `${STAGE_PREFIX}${JSON.stringify({ invocation: MARKETPLACE_INVOCATION, stage, state, time, duration })}\n`;
}

function completeStages(count: number): string {
  return MARKETPLACE_STAGES.slice(0, count)
    .map((stage, index) => record(stage, "begin", index * 10) + record(stage, "complete", index * 10 + 2, 2))
    .join("");
}

describe("marketplace lifecycle diagnostic receipt", () => {
  const completed = completeStages(9);
  const open = completeStages(3) + record("update", "begin", 30);
  const failed = completeStages(5) + record("rollback", "begin", 50) + record("rollback", "failed", 53, 3);

  it("certifies a confirmed run with every stage complete", () => {
    expect(classifyMarketplaceObservation(completed, "passed")).toEqual({ status: "complete" });
  });

  it("identifies only the open stage during a confirmed test timeout", () => {
    expect(classifyMarketplaceObservation(open, "timed-out")).toEqual({ status: "open-stage", stage: "update" });
  });

  it("identifies the last stage when the exact test and stage both report failure", () => {
    expect(classifyMarketplaceObservation(failed, "failed")).toEqual({ status: "failed-stage", stage: "rollback" });
  });

  it.each([
    ["missing records", "", "timed-out", false],
    ["recorder failure marker", open, "timed-out", true],
    ["truncated frame", open.slice(0, -1), "timed-out", false],
    ["duplicate begin", open + record("update", "begin", 31), "timed-out", false],
    ["skipped stage", completeStages(2) + record("update", "begin", 30), "timed-out", false],
    ["invalid duration", record("add", "begin", 1) + record("add", "failed", 5, 1), "failed", false],
    ["conflicting verdict", completed, "timed-out", false],
    ["unconfirmed test", completed, "unqualified", false],
  ] as const)("withholds diagnosis with %s", (_label, output, outcome, recorderFailed) => {
    expect(classifyMarketplaceObservation(output, outcome, recorderFailed)).toEqual({ status: "unqualified" });
  });
});
