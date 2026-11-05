import { readDeliveryContexts } from "./delivery-context.js";
import { JUDGE_RECEIPT_MAX_AGE, missingJudgePasses } from "./gate.js";
import type { LoadedJudge } from "./load.js";
import { parseJudgePrArguments } from "./pr-arguments.js";
import { readJudgePrBody } from "./pr-body.js";

export function checkJudgePrDelivery(input: {
  event: "pr-create" | "pr-ready";
  argv: readonly string[];
  judges: readonly LoadedJudge[];
  cwd: string;
  receiptDirectory: string;
  now: number;
  contextManifest?: string;
}) {
  if (!input.judges.some(({ definition }) => definition.on.includes(input.event))) return [];
  const target = parseJudgePrArguments(input.argv);
  if (target.event !== input.event) throw new Error("Judge PR event does not match the command.");
  return missingJudgePasses({
    ...input,
    artifact: readJudgePrBody(target, input.cwd),
    contexts: readDeliveryContexts(input.judges, input.event, input.contextManifest),
    maxAge: JUDGE_RECEIPT_MAX_AGE,
  });
}
