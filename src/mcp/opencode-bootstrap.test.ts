import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { buildOpencodeProviderConfig, computeOllamaEnv, opencodeMajorFromVersion } from "./opencode-bootstrap.js";

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

  it("keeps the legacy provider on V1 and writes the proven reasoning body only on V2", () => {
    const legacy = {
      provider: {
        ollama: {
          name: "Ollama (local)",
          models: { "qwen3:0.6b": { name: "Qwen3 0.6B", tools: true } },
        },
      },
      providers: {
        ollama: {
          canonical: "ollama",
          env: ["OLLAMA_API_KEY"],
          compatibility: { requireReasoning: false },
          headers: { "X-Team": "local" },
          body: { temperature: 0.2 },
        },
      },
      small_model: "ollama/qwen3:0.6b",
      theme: "dark",
    };
    expect(buildOpencodeProviderConfig({}, "qwen3:14b", 1)).not.toHaveProperty("providers");
    expect(buildOpencodeProviderConfig(legacy, "qwen3:14b", 1).providers).toEqual(legacy.providers);
    expect(buildOpencodeProviderConfig(legacy, "qwen3:14b", 1).small_model).toBe("ollama/qwen3:0.6b");

    const config = buildOpencodeProviderConfig(legacy, "qwen3:14b", 2);
    expect(config.providers).toEqual({
      ollama: {
        canonical: "ollama",
        env: ["OLLAMA_API_KEY"],
        compatibility: { requireReasoning: false },
        headers: { "X-Team": "local" },
        body: { temperature: 0.2 },
        name: "Ollama (local)",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "http://localhost:11434/v1" },
        models: {
          "qwen3:14b": {
            name: "qwen3:14b",
            capabilities: { tools: true },
            body: { reasoning_effort: "none" },
            limit: { context: 40960, output: 4096 },
          },
        },
      },
    });
    expect(config.compaction).toEqual({ auto: false });
    expect(config).not.toHaveProperty("small_model");
    expect(config).not.toHaveProperty("provider");
    expect(config.theme).toBe("dark");
    const configForValidation = Object.fromEntries(Object.entries(config).filter(([key]) => key !== "theme"));
    expect(validate(configForValidation)).toEqual([]);
  });

  it("preserves compaction choices and unrelated model limits on V2", () => {
    const config = buildOpencodeProviderConfig(
      {
        compaction: { auto: true, keep: { tokens: 12000 } },
        providers: {
          ollama: {
            models: {
              "qwen3:14b": {
                limit: { output: 8192 },
              },
            },
          },
        },
      },
      "qwen3:14b",
      2,
    );

    expect(config.compaction).toEqual({ auto: false, keep: { tokens: 12000 } });
    expect(config.providers).toMatchObject({
      ollama: { models: { "qwen3:14b": { limit: { context: 40960, output: 8192 } } } },
    });
  });

  it("does not apply Qwen3 readiness defaults to other model families", () => {
    const config = buildOpencodeProviderConfig(
      {
        compaction: { auto: true },
        providers: {
          ollama: {
            models: { "llama3.1:8b": { limit: { context: 8192, output: 1024 } } },
          },
        },
      },
      "llama3.1:8b",
      2,
    );

    expect(config.compaction).toEqual({ auto: true });
    expect(config.providers).toMatchObject({
      ollama: { models: { "llama3.1:8b": { limit: { context: 8192, output: 1024 } } } },
    });
  });

  it("uses the effective Ollama context and keeps smaller-memory profiles bounded", () => {
    expect(computeOllamaEnv({ totalMemoryGB: 32 } as Parameters<typeof computeOllamaEnv>[0]).OLLAMA_NUM_CTX).toBe(
      "40960",
    );
    expect(computeOllamaEnv({ totalMemoryGB: 64 } as Parameters<typeof computeOllamaEnv>[0]).OLLAMA_NUM_CTX).toBe(
      "40960",
    );
    expect(computeOllamaEnv({ totalMemoryGB: 16 } as Parameters<typeof computeOllamaEnv>[0]).OLLAMA_NUM_CTX).toBe(
      "8192",
    );

    const config = buildOpencodeProviderConfig({}, "qwen3:14b", 2, 32768);
    expect(config.providers).toMatchObject({
      ollama: { models: { "qwen3:14b": { limit: { context: 32768, output: 4096 } } } },
    });
  });

  it("reads installed V1 and V2 version strings and rejects unknown versions", () => {
    expect(opencodeMajorFromVersion("1.19.5")).toBe(1);
    expect(opencodeMajorFromVersion("opencode v2.2.6")).toBe(2);
    expect(() => opencodeMajorFromVersion("not-a-version")).toThrow();
    expect(() => opencodeMajorFromVersion("opencode v3.0.0")).toThrow();
  });
});
