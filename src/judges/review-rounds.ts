import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPrivateJudgeDirectory } from "./receipt-store.js";

export function reserveJudgeRound(receiptDirectory: string, scope: readonly string[], limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid judge round limit.");
  const key = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  const parents = [receiptDirectory, join(receiptDirectory, "rounds"), join(receiptDirectory, "rounds", key)];
  for (const directory of parents) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!isPrivateJudgeDirectory(directory)) throw new Error("Judge review directory is unavailable.");
  }
  const directory = parents[parents.length - 1];
  for (let round = 1; round <= limit; round++) {
    try {
      mkdirSync(join(directory, String(round)), { mode: 0o700 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Judge round limit reached. Ask the user to review the artifact before continuing.");
}
