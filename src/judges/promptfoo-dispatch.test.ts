import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateWithPromptfoo } from "./promptfoo-dispatch.js";
import { judgeProvider } from "./promptfoo-provider.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
// Metadata decisions are exercised through the real dispatcher in ollama-version.test.ts.
vi.mock("./ollama-version.js", () => ({ assertQualifiedOllamaVersion: vi.fn(async () => {}) }));

const spawn = vi.mocked(spawnSync);

function config(provider = "ollama:chat:llama3.2:3b") {
  return {
    prompts: ["Judge artifact"],
    providers: ["echo"],
    tests: [
      {
        providerOutput: "Synthetic artifact",
        assert: [
          {
            type: "llm-rubric" as const,
            metric: "clear",
            value: { check: "Is it clear?", instructions: "" },
            provider: judgeProvider(provider),
            rubricPrompt: "",
          },
        ],
      },
    ],
  };
}

describe("judge engine dispatch", () => {
  let root: string;

  function engine(version: string) {
    mkdirSync(join(root, "dist", "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "promptfoo", version }));
    writeFileSync(join(root, "dist", "src", "entrypoint.js"), "");
  }

  function report(status: number, body?: string) {
    spawn.mockImplementationOnce((_program, args) => {
      const argv = args as string[];
      if (body !== undefined) writeFileSync(argv[argv.indexOf("--output") + 1], body);
      return { status } as ReturnType<typeof spawnSync>;
    });
  }

  beforeEach(() => {
    spawn.mockReset();
    root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-engine-test-")));
    engine("0.124.1");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("uses the pinned engine and a fixed loopback endpoint with isolated inputs", async () => {
    report(0, '{"results":{}}');
    expect(await evaluateWithPromptfoo(config(), root)).toEqual({ results: {} });
    const [program, args, options] = spawn.mock.calls[0];
    expect(program).toBe(process.execPath);
    expect(args?.[0]).toBe(join(root, "dist", "src", "entrypoint.js"));
    expect(options).toMatchObject({
      stdio: "ignore",
      env: {
        HOME: options?.cwd,
        TMPDIR: options?.cwd,
        PROMPTFOO_CONFIG_DIR: options?.cwd,
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      },
    });
    expect(Object.keys(options?.env ?? {}).sort()).toEqual([
      "HOME",
      "OLLAMA_BASE_URL",
      "PROMPTFOO_CONFIG_DIR",
      "PROMPTFOO_DISABLE_TELEMETRY",
      "PROMPTFOO_DISABLE_UPDATE",
      "TMPDIR",
    ]);
  });

  it("rejects file, remote and malformed providers before dispatch", async () => {
    for (const provider of ["file:///fixture.js", "openai:gpt", "ollama:chat:model\nextra"]) {
      await expect(evaluateWithPromptfoo(config(provider), root)).rejects.toThrow(/Ollama/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects provider overrides and schema changes before dispatch", async () => {
    const allowed = config().tests[0].assert[0].provider;
    const variants = [
      { ...allowed, config: { ...allowed.config, baseUrl: "https://other.example" } },
      { ...allowed, config: { ...allowed.config, temperature: 1 } },
      { ...allowed, config: { ...allowed.config, format: { type: "object" } } },
      { ...allowed, env: { OLLAMA_BASE_URL: "https://other.example" } },
      { ...allowed, config: { ...allowed.config, tools: ["file:///fixture.js"] } },
      allowed.id,
    ];
    for (const provider of variants) {
      const input = config();
      input.tests[0].assert[0].provider = provider as typeof allowed;
      await expect(evaluateWithPromptfoo(input, root)).rejects.toThrow(/fixed response schema/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("allows the fixed source-aware schema", async () => {
    const input = config();
    input.tests[0].assert[0].provider = judgeProvider("ollama:chat:llama3.2:3b", ["S1"]);
    report(0, '{"results":{}}');
    expect(await evaluateWithPromptfoo(input, root)).toEqual({ results: {} });
  });

  it("rejects a missing or unpinned engine before dispatch", async () => {
    await expect(evaluateWithPromptfoo(config(), join(root, "absent"))).rejects.toThrow(/0\.124\.1/);
    engine("0.124.2");
    await expect(evaluateWithPromptfoo(config(), root)).rejects.toThrow(/0\.124\.1/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns a completed assertion failure report to the verdict reader", async () => {
    report(100, '{"results":{"results":[{"success":false}]}}');
    expect(await evaluateWithPromptfoo(config(), root)).toEqual({ results: { results: [{ success: false }] } });
  });

  it("distinguishes a timeout from a failed engine process without exposing engine errors", async () => {
    spawn.mockReturnValueOnce({
      pid: 0,
      output: [null, null, null],
      stdout: "",
      stderr: "",
      signal: null,
      status: null,
      error: Object.assign(new Error("private fixture engine detail"), { code: "ETIMEDOUT" }),
    });
    await expect(evaluateWithPromptfoo(config(), root)).rejects.toThrow(/^Promptfoo timed out\.$/);
    report(2, "{}");
    await expect(evaluateWithPromptfoo(config(), root)).rejects.toThrow(
      /^Promptfoo could not complete the judge evaluation\.$/,
    );
  });

  it("refuses missing or malformed reports", async () => {
    for (const [status, body] of [
      [0, undefined],
      [100, "broken"],
    ] as const) {
      report(status, body);
      await expect(evaluateWithPromptfoo(config(), root)).rejects.toThrow(/readable judge report/);
    }
  });
});
