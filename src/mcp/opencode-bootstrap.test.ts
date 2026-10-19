import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { buildOpencodeProviderConfig } from "./opencode-bootstrap.js";

// Trimmed copy of https://opencode.ai/config.json (see its $comment).
const schema = JSON.parse(
  readFileSync(new URL("./fixtures/opencode-config-schema.trimmed.json", import.meta.url), "utf8"),
);

function validate(config: unknown): string[] {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const check = ajv.compile(schema);
  return check(config) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

describe("buildOpencodeProviderConfig", () => {
  it("writes a config that validates against the opencode schema", () => {
    expect(validate(buildOpencodeProviderConfig({}, "qwen3:32b"))).toEqual([]);
  });

  it("pins the provider/model shape", () => {
    const config = buildOpencodeProviderConfig({}, "qwen3:32b");
    expect(config.model).toBe("ollama/qwen3:32b");
    expect(config.provider).toEqual({
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: { baseURL: "http://localhost:11434/v1" },
        models: { "qwen3:32b": { name: "qwen3:32b" } },
      },
    });
  });

  it("keeps unrelated keys and drops the old small-model key", () => {
    const config = buildOpencodeProviderConfig({ mcp: { a: 1 }, small_model: { big: "x" } }, "m");
    expect(config.mcp).toEqual({ a: 1 });
    expect(config).not.toHaveProperty("small_model");
  });
});
