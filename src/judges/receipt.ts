import type { JudgeVerdict } from "./verdict.js";

export const MAX_JUDGE_RECEIPT_BYTES = 128 * 1024;

export interface JudgeReceipt {
  version: 1;
  key: string;
  issuedAt: number;
  pass: boolean;
  passBar: number;
  checks: JudgeVerdict[];
}

function isCheck(value: unknown): value is JudgeVerdict {
  if (!value || typeof value !== "object") return false;
  const { check, critique, verdict, evidence } = value as Record<string, unknown>;
  return (
    typeof check === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(check) &&
    typeof critique === "string" &&
    critique.trim().length > 0 &&
    (verdict === "PASS" || verdict === "FAIL") &&
    Array.isArray(evidence) &&
    evidence.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(evidence).size === evidence.length
  );
}

function validateReceipt(value: unknown): JudgeReceipt {
  if (!value || typeof value !== "object") throw new Error("Invalid judge receipt.");
  const { version, key, issuedAt, pass, passBar, checks } = value as Record<string, unknown>;
  if (
    version !== 1 ||
    typeof key !== "string" ||
    !/^[a-f0-9]{64}$/.test(key) ||
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0 ||
    typeof pass !== "boolean" ||
    typeof passBar !== "number" ||
    !Number.isFinite(passBar) ||
    passBar <= 0 ||
    passBar > 1 ||
    !Array.isArray(checks) ||
    checks.length === 0 ||
    !checks.every(isCheck) ||
    new Set(checks.map(({ check }) => check)).size !== checks.length ||
    pass !== checks.filter(({ verdict }) => verdict === "PASS").length / checks.length >= passBar
  ) {
    throw new Error("Invalid judge receipt.");
  }
  return { version, key, issuedAt, pass, passBar, checks };
}

export function decodeJudgeReceipt(line: string): JudgeReceipt {
  if (Buffer.byteLength(line) > MAX_JUDGE_RECEIPT_BYTES || !line.endsWith("\n") || /[\r\n]/.test(line.slice(0, -1))) {
    throw new Error("Invalid judge receipt record.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Invalid judge receipt record.");
  }
  return validateReceipt(parsed);
}

export function encodeJudgeReceipt(receipt: JudgeReceipt): string {
  const line = `${JSON.stringify(validateReceipt(receipt))}\n`;
  if (Buffer.byteLength(line) > MAX_JUDGE_RECEIPT_BYTES) throw new Error("Invalid judge receipt record.");
  return line;
}
