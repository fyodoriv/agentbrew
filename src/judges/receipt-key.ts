import { createHash } from "node:crypto";
import type { JudgeDefinition } from "./definition.js";

export interface JudgeSourceContext {
  request: Uint8Array;
  sources: ReadonlyArray<{ id: string; bytes: Uint8Array }>;
}

export function receiptSources(context?: JudgeSourceContext): JudgeReceiptInput["sources"] {
  return context ? [{ id: "request", bytes: context.request }, ...context.sources] : undefined;
}

interface JudgeReceiptInput {
  artifact: Uint8Array;
  judge: string;
  rubricSha256: string;
  model: string;
  event: JudgeDefinition["on"][number];
  sources?: ReadonlyArray<{ id: string; bytes: Uint8Array }>;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function judgeReceiptKey(input: JudgeReceiptInput): string {
  return sha256(
    JSON.stringify([
      "agentbrew-judge-receipt-v1",
      sha256(input.artifact),
      input.judge,
      input.rubricSha256,
      input.model,
      input.event,
      input.sources?.map(({ id, bytes }) => [id, sha256(bytes)]) ?? null,
    ]),
  );
}

export function isFreshJudgePass(receipt: unknown, key: string, now: number, maxAge: number): boolean {
  if (!receipt || typeof receipt !== "object" || !/^[a-f0-9]{64}$/.test(key)) return false;
  const { version, key: recordedKey, pass, issuedAt } = receipt as Record<string, unknown>;
  return (
    version === 1 &&
    recordedKey === key &&
    pass === true &&
    typeof issuedAt === "number" &&
    Number.isSafeInteger(issuedAt) &&
    issuedAt >= 0 &&
    Number.isSafeInteger(now) &&
    Number.isSafeInteger(maxAge) &&
    maxAge > 0 &&
    issuedAt <= now &&
    now - issuedAt <= maxAge
  );
}
