import { MAX_JUDGE_INPUT_BYTES } from "./artifact.js";
import type { JudgeDefinition } from "./definition.js";
import { readJudgeEvaluation } from "./evaluation-result.js";
import { buildJudgeEvaluation, type JudgeExample } from "./promptfoo-config.js";
import { evaluateWithPromptfoo } from "./promptfoo-dispatch.js";

const ORDERS = ["forward", "reverse"] as const;
type CalibrationOrder = (typeof ORDERS)[number];
type Label = "PASS" | "FAIL";

interface LabeledCase {
  id: string;
  expected: Label;
}

interface CalibrationCase extends LabeledCase {
  order: CalibrationOrder;
}

interface CalibrationResult {
  id: string;
  order: CalibrationOrder;
  verdict: Label;
}

export function planCalibration(cases: readonly LabeledCase[]): CalibrationCase[] {
  if (
    new Set(cases.map(({ id }) => id)).size !== cases.length ||
    !cases.some(({ expected }) => expected === "PASS") ||
    !cases.some(({ expected }) => expected === "FAIL")
  ) {
    throw new Error("Calibration requires unique cases and both verdict labels.");
  }
  return ORDERS.flatMap((order) =>
    (order === "forward" ? cases : [...cases].reverse()).map((entry) => ({ ...entry, order })),
  );
}

interface CalibrationRates {
  truePositiveRate: number;
  trueNegativeRate: number;
}

type CalibrationThresholds = Pick<JudgeDefinition["calibration"], "minTruePositiveRate" | "minTrueNegativeRate">;

function passesCalibration(rates: readonly CalibrationRates[], thresholds: CalibrationThresholds): boolean {
  return rates.every(
    (rate) =>
      rate.truePositiveRate >= thresholds.minTruePositiveRate &&
      rate.trueNegativeRate >= thresholds.minTrueNegativeRate,
  );
}

export function scoreCalibration(
  cases: readonly LabeledCase[],
  results: readonly CalibrationResult[],
  thresholds: CalibrationThresholds,
) {
  const plan = planCalibration(cases);
  const key = ({ id, order }: { id: string; order: CalibrationOrder }) => JSON.stringify([id, order]);
  const verdicts = new Map(results.map((result) => [key(result), result.verdict]));
  if (
    results.length !== plan.length ||
    verdicts.size !== plan.length ||
    plan.some((entry) => !verdicts.has(key(entry))) ||
    results.some(({ verdict }) => verdict !== "PASS" && verdict !== "FAIL")
  ) {
    throw new Error("Calibration results must match every case and order.");
  }
  const rates = (order: CalibrationOrder) => {
    const rate = (expected: Label) => {
      const labeled = cases.filter((entry) => entry.expected === expected);
      return labeled.filter(({ id }) => verdicts.get(key({ id, order })) === expected).length / labeled.length;
    };
    return { truePositiveRate: rate("PASS"), trueNegativeRate: rate("FAIL") };
  };
  const forward = rates("forward");
  const reverse = rates("reverse");
  return {
    forward,
    reverse,
    orderDisagreements: cases.filter(
      ({ id }) => verdicts.get(key({ id, order: "forward" })) !== verdicts.get(key({ id, order: "reverse" })),
    ).length,
    pass: passesCalibration([forward, reverse], thresholds),
  };
}

export async function runCalibrationPair(
  judge: JudgeDefinition,
  pair: readonly [LabeledCase & JudgeExample, LabeledCase & JudgeExample],
  evaluate: (config: ReturnType<typeof buildJudgeEvaluation>) => unknown = evaluateWithPromptfoo,
) {
  const plan = planCalibration(pair);
  const examples = pair.map(({ artifact, context }) => ({ artifact, context }));
  const results: CalibrationResult[] = [];
  for (const { id, order } of plan) {
    const ordered: [JudgeExample, JudgeExample] =
      order === "forward" ? [examples[0], examples[1]] : [examples[1], examples[0]];
    const first = order === "forward" ? pair[0] : pair[1];
    const target = id === first.id ? 1 : 2;
    const { artifact, context } = ordered[target - 1];
    const config = buildJudgeEvaluation(judge, artifact, context, { target, examples: ordered });
    if (Buffer.byteLength(config.tests[0].providerOutput) > MAX_JUDGE_INPUT_BYTES) {
      throw new Error("Judge calibration input exceeds the size limit.");
    }
    const result = readJudgeEvaluation(
      judge,
      await evaluate(config),
      context?.sources.map(({ id }) => id),
    );
    results.push({ id, order, verdict: result.pass ? "PASS" : "FAIL" });
  }
  return scoreCalibration(pair, results, judge.calibration);
}

export function summarizeCalibrationPairs(
  pairs: readonly ReturnType<typeof scoreCalibration>[],
  thresholds: CalibrationThresholds,
) {
  if (!pairs.length) throw new Error("Judge calibration requires at least one labeled pair.");
  // Each pair contributes one PASS and one FAIL example in each order.
  const rates = (order: CalibrationOrder) => ({
    truePositiveRate: pairs.reduce((sum, pair) => sum + pair[order].truePositiveRate, 0) / pairs.length,
    trueNegativeRate: pairs.reduce((sum, pair) => sum + pair[order].trueNegativeRate, 0) / pairs.length,
  });
  const forward = rates("forward");
  const reverse = rates("reverse");
  return {
    forward,
    reverse,
    orderDisagreements: pairs.reduce((sum, pair) => sum + pair.orderDisagreements, 0),
    pass: passesCalibration([forward, reverse], thresholds),
  };
}
