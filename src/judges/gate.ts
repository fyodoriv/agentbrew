import type { LoadedJudge } from "./load.js";
import { isFreshJudgePass, type JudgeSourceContext, judgeReceiptKey, receiptSources } from "./receipt-key.js";
import { readJudgeReceipt } from "./receipt-store.js";

export const JUDGE_RECEIPT_MAX_AGE = 15 * 60 * 1000;

interface GateInput {
  judges: readonly LoadedJudge[];
  event: LoadedJudge["definition"]["on"][number];
  artifact: Uint8Array;
  contexts?: ReadonlyMap<string, JudgeSourceContext>;
  receiptDirectory: string;
  now: number;
  maxAge: number;
}

export function missingJudgePasses(input: GateInput): string[] {
  const missing: string[] = [];
  for (const { definition, sha256 } of input.judges) {
    if (!definition.on.includes(input.event)) continue;
    const context = input.contexts?.get(definition.name);
    if ((definition.sees === "artifact+sources") !== (context !== undefined)) {
      missing.push(definition.name);
      continue;
    }
    const key = judgeReceiptKey({
      artifact: input.artifact,
      judge: definition.name,
      rubricSha256: sha256,
      model: definition.model,
      event: input.event,
      sources: receiptSources(context),
    });
    try {
      const receipt = readJudgeReceipt(input.receiptDirectory, key);
      if (
        receipt &&
        isFreshJudgePass(receipt, key, input.now, input.maxAge) &&
        receipt.passBar === definition.passBar &&
        receipt.checks.length === definition.rubric.length &&
        receipt.checks.every(({ check }, index) => check === definition.rubric[index].id)
      ) {
        continue;
      }
    } catch {
      // An unreadable or malformed local record cannot authorize delivery.
    }
    missing.push(definition.name);
  }
  return missing;
}
