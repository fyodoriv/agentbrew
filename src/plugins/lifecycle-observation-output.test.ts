import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./lifecycle-observation-output-fixture.ts", import.meta.url));
const prefix = "lifecycle-stage ";
const fallback = "lifecycle-stage-recorder-failed\n";

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

function parseReceipt(line: string): Record<string, unknown> {
  if (!line.startsWith(prefix)) throw new Error("worker output lacks the stage prefix");
  const body = line.slice(prefix.length);
  try {
    const record: unknown = JSON.parse(body);
    if (typeof record === "object" && record !== null && !Array.isArray(record) && JSON.stringify(record) === body) {
      return record as Record<string, unknown>;
    }
  } catch {
    throw new Error("worker stage output was not valid JSON");
  }
  throw new Error("worker stage output was not a record");
}

function observedTimes(stderr: string, expected: readonly ("begin" | "complete")[]) {
  if (!stderr.endsWith("\n")) throw new Error("worker stage output lacks a terminal newline");
  const lines = stderr.slice(0, -1).split("\n");
  expect(lines.length).toBe(expected.length);
  return expected.map((state, index) => {
    const record = parseReceipt(lines[index]);
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
    expect(report.stdout === fallback && report.stderr === "", "expected only the fixed fallback").toBe(true);
  });

  it("O04 observes the still-open stage and a worker that preserved its action failure", () => {
    const report = capture("action-failed", 17);
    expect(report.stdout === fallback, "expected only the fixed fallback").toBe(true);
    observedTimes(report.stderr, ["begin"]);
  });

  it("O05 leaves the capture unqualified when both channels are lost", () => {
    const report = capture("closed-both", 17);
    expect(report.stdout === "" && report.stderr === "", "closed channels must be empty").toBe(true);
  });
});
