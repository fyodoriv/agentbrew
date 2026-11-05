import type { JudgeDefinition } from "./definition.js";
import { type JudgeVerdict, normalizeJudgeVerdict } from "./verdict.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const ASSERTION_FAILURE = 1;
const ENGINE_FAILURE = 2;

function hasEngineError(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function readJudgeEvaluation(judge: JudgeDefinition, report: unknown, sourceIds?: readonly string[]) {
  if ((judge.sees === "artifact+sources") !== (sourceIds !== undefined)) {
    throw new Error("Judge result does not match its declared context mode.");
  }
  const rows = object(object(report)?.results)?.results;
  const row = Array.isArray(rows) && rows.length === 1 ? object(rows[0]) : undefined;
  if (
    row?.failureReason === ENGINE_FAILURE ||
    (hasEngineError(row?.error) && row?.failureReason !== ASSERTION_FAILURE)
  ) {
    throw new Error("Judge engine returned an error.");
  }
  const grades = object(row?.gradingResult)?.componentResults;
  if (!Array.isArray(grades) || grades.length !== judge.rubric.length || grades.length === 0) {
    throw new Error("Judge results must cover every rubric check.");
  }

  const expected = new Set(judge.rubric.map(({ id }) => id));
  const verdicts = new Map<string, JudgeVerdict>();
  for (const grade of grades) {
    if (hasEngineError(object(grade)?.error)) throw new Error("Judge engine returned an error.");
    const assertion = object(object(grade)?.assertion);
    const id = assertion?.metric;
    if (assertion?.type !== "llm-rubric" || typeof id !== "string" || !expected.has(id) || verdicts.has(id)) {
      throw new Error("Judge results must cover every rubric check exactly once.");
    }
    verdicts.set(id, normalizeJudgeVerdict(id, grade, sourceIds));
  }
  const checks = judge.rubric.map(({ id }) => {
    const verdict = verdicts.get(id);
    if (!verdict) throw new Error("Judge result is missing a declared check.");
    return verdict;
  });
  const passingFraction = checks.filter(({ verdict }) => verdict === "PASS").length / checks.length;
  return { checks, passingFraction, pass: passingFraction >= judge.passBar };
}
