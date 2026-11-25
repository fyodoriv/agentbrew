import { MARKETPLACE_STAGES } from "./lifecycle-observation.js";
import { MARKETPLACE_INVOCATION, STAGE_PREFIX } from "./lifecycle-observation-output.js";

type Stage = (typeof MARKETPLACE_STAGES)[number];
type RunnerOutcome = "passed" | "timed-out" | "failed" | "unqualified";
type Verdict = { status: "complete" | "unqualified" } | { status: "open-stage" | "failed-stage"; stage: Stage };

const unqualified = { status: "unqualified" } as const;

export function parseStageRecord(line: string): Record<string, unknown> | undefined {
  if (!line.startsWith(STAGE_PREFIX)) return;
  const body = line.slice(STAGE_PREFIX.length);
  try {
    const record: unknown = JSON.parse(body);
    if (typeof record === "object" && record !== null && !Array.isArray(record) && JSON.stringify(record) === body) {
      return record as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
}

function readRecord(line: string, stage: Stage, earliest: number) {
  const fields = parseStageRecord(line);
  if (fields?.stage !== stage || fields.invocation !== MARKETPLACE_INVOCATION) return;
  const { time, state, duration } = fields;
  if (typeof time !== "number" || !Number.isFinite(time) || time < earliest) return;
  return { time, state, duration, fieldCount: Object.keys(fields).length };
}

function readStage(beginLine: string, endLine: string | undefined, stage: Stage, earliest: number) {
  const begin = readRecord(beginLine, stage, earliest);
  if (begin?.state !== "begin" || begin.fieldCount !== 4) return;
  if (endLine === undefined) return { state: "open", time: begin.time } as const;

  const end = readRecord(endLine, stage, begin.time);
  if (!end || end.fieldCount !== 5 || end.duration !== end.time - begin.time) return;
  if (end.state === "complete" || end.state === "failed") return { state: end.state, time: end.time } as const;
}

function classifyIncomplete(stage: Stage, state: "open" | "failed", outcome: RunnerOutcome): Verdict {
  if (state === "open" && outcome === "timed-out") return { status: "open-stage", stage };
  if (state === "failed" && outcome === "failed") return { status: "failed-stage", stage };
  return unqualified;
}

/** The caller must confirm the exact test and both capture channels before supplying a qualified outcome. */
export function classifyMarketplaceObservation(
  stream: string,
  outcome: RunnerOutcome,
  recorderFailed = false,
): Verdict {
  if (outcome === "unqualified" || recorderFailed || stream.length > 32_768 || !stream.endsWith("\n")) {
    return unqualified;
  }
  const lines = stream.slice(0, -1).split("\n");
  const maximumLines = MARKETPLACE_STAGES.length * 2;
  if (lines.length > maximumLines) return unqualified;
  let lastTime = 0;
  for (let line = 0; line < lines.length; line += 2) {
    const stage = MARKETPLACE_STAGES[line / 2];
    const observed = readStage(lines[line], lines[line + 1], stage, lastTime);
    if (!observed) return unqualified;
    if (observed.state !== "complete") {
      if (line + 2 < lines.length) return unqualified;
      return classifyIncomplete(stage, observed.state, outcome);
    }
    lastTime = observed.time;
  }

  return outcome === "passed" && lines.length === maximumLines ? { status: "complete" } : unqualified;
}
