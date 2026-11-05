import { readJudgeEvaluation } from "./evaluation-result.js";
import type { LoadedJudge } from "./load.js";
import { buildJudgeEvaluation } from "./promptfoo-config.js";
import { evaluateWithPromptfoo } from "./promptfoo-dispatch.js";
import type { JudgeReceipt } from "./receipt.js";
import { type JudgeSourceContext, judgeReceiptKey } from "./receipt-key.js";
import { writeJudgeReceipt } from "./receipt-store.js";
import { readJudgeInput } from "./review-input.js";

interface RunInput {
  judge: LoadedJudge;
  event: LoadedJudge["definition"]["on"][number];
  artifact: Uint8Array;
  context?: JudgeSourceContext;
  receiptDirectory: string;
}

type Evaluate = (config: ReturnType<typeof buildJudgeEvaluation>) => unknown;

export async function runJudge(
  input: RunInput,
  evaluate: Evaluate = evaluateWithPromptfoo,
  clock = Date.now,
): Promise<JudgeReceipt> {
  const { definition, sha256 } = input.judge;
  if (!definition.on.includes(input.event)) throw new Error("Judge does not handle this event.");
  const { text, context, sourceIds, sources } = readJudgeInput(input.artifact, input.context);
  const config = buildJudgeEvaluation(definition, text, context);
  const key = judgeReceiptKey({
    artifact: input.artifact,
    judge: definition.name,
    rubricSha256: sha256,
    model: definition.model,
    event: input.event,
    sources,
  });
  const result = readJudgeEvaluation(definition, await evaluate(config), sourceIds);
  const receipt: JudgeReceipt = {
    version: 1,
    key,
    issuedAt: clock(),
    pass: result.pass,
    passBar: definition.passBar,
    checks: result.checks,
  };
  writeJudgeReceipt(input.receiptDirectory, receipt);
  return receipt;
}
