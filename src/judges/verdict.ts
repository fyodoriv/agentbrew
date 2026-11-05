export interface JudgeVerdict {
  check: string;
  critique: string;
  verdict: "PASS" | "FAIL";
  evidence: string[];
}

function validEvidence(value: unknown, sourceIds?: readonly string[]): value is string[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length) return false;
  if (sourceIds === undefined) return value.length === 0;
  return value.length > 0 && value.every((id) => typeof id === "string" && sourceIds.includes(id));
}

export function normalizeJudgeVerdict(check: string, result: unknown, sourceIds?: readonly string[]): JudgeVerdict {
  try {
    if (!result || typeof result !== "object") throw new Error();
    const { pass, score, reason } = result as Record<string, unknown>;
    if (typeof pass !== "boolean" || score !== Number(pass)) {
      throw new Error();
    }
    const encoded = typeof reason === "string" ? reason : JSON.stringify(reason);
    if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > 8192) throw new Error();
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const { critique, verdict, evidence } = parsed as Record<string, unknown>;
    const expectedVerdict = pass ? "PASS" : "FAIL";
    if (typeof critique !== "string" || !critique.trim() || verdict !== expectedVerdict) throw new Error();
    if (!validEvidence(evidence, sourceIds)) throw new Error();
    return { check, critique: critique.trim(), verdict: expectedVerdict, evidence };
  } catch {
    throw new Error(`Invalid judge verdict for check ${JSON.stringify(check)}`);
  }
}
