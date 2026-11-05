import { isDeepStrictEqual } from "node:util";

export function judgeProvider(model: string, sourceIds?: readonly string[]) {
  const evidence =
    sourceIds === undefined
      ? { type: "array", items: { type: "string" }, maxItems: 0 }
      : { type: "array", items: { type: "string", enum: [...sourceIds] }, minItems: 1, uniqueItems: true };
  return {
    id: model,
    config: {
      temperature: 0,
      num_ctx: 4096,
      truncate: false,
      passthrough: { shift: false },
      format: {
        type: "object",
        properties: {
          reason: {
            type: "object",
            properties: {
              critique: { type: "string", minLength: 1 },
              verdict: { type: "string", enum: ["PASS", "FAIL"] },
              evidence,
            },
            required: ["critique", "verdict", "evidence"],
            additionalProperties: false,
          },
          pass: { type: "boolean" },
          score: { type: "integer", enum: [0, 1] },
        },
        required: ["reason", "pass", "score"],
        additionalProperties: false,
      },
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isJudgeProvider(value: unknown): boolean {
  const provider = object(value);
  if (
    typeof provider.id !== "string" ||
    !/^ollama:chat:[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/.test(provider.id)
  ) {
    return false;
  }
  const format = object(object(provider.config).format);
  const reason = object(object(format.properties).reason);
  const evidence = object(object(reason.properties).evidence);
  const ids = object(evidence.items).enum;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return false;
    if (ids.some((id) => typeof id !== "string" || id === "request" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) return false;
    return isDeepStrictEqual(value, judgeProvider(provider.id, ids));
  }
  return isDeepStrictEqual(value, judgeProvider(provider.id));
}
