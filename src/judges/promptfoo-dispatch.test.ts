import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateWithPromptfoo } from "./promptfoo-dispatch.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

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
            provider,
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

  it("uses the pinned engine and a fixed loopback endpoint with isolated inputs", () => {
    report(0, '{"results":{}}');
    expect(evaluateWithPromptfoo(config(), root)).toEqual({ results: {} });
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

  it("rejects file, remote and malformed providers before dispatch", () => {
    for (const provider of ["file:///fixture.js", "openai:gpt", "ollama:chat:model\nextra"]) {
      expect(() => evaluateWithPromptfoo(config(provider), root)).toThrow(/Ollama/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a missing or unpinned engine before dispatch", () => {
    expect(() => evaluateWithPromptfoo(config(), join(root, "absent"))).toThrow(/0\.124\.1/);
    engine("0.124.2");
    expect(() => evaluateWithPromptfoo(config(), root)).toThrow(/0\.124\.1/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns a completed assertion failure report to the verdict reader", () => {
    report(100, '{"results":{"results":[{"success":false}]}}');
    expect(evaluateWithPromptfoo(config(), root)).toEqual({ results: { results: [{ success: false }] } });
  });

  it("distinguishes a timeout from a failed engine process without exposing engine errors", () => {
    spawn.mockReturnValueOnce({
      pid: 0,
      output: [null, null, null],
      stdout: "",
      stderr: "",
      signal: null,
      status: null,
      error: Object.assign(new Error("private fixture engine detail"), { code: "ETIMEDOUT" }),
    });
    expect(() => evaluateWithPromptfoo(config(), root)).toThrow(/^Promptfoo timed out\.$/);
    report(2, "{}");
    expect(() => evaluateWithPromptfoo(config(), root)).toThrow(
      /^Promptfoo could not complete the judge evaluation\.$/,
    );
  });

  it("refuses missing or malformed reports", () => {
    for (const [status, body] of [
      [0, undefined],
      [100, "broken"],
    ] as const) {
      report(status, body);
      expect(() => evaluateWithPromptfoo(config(), root)).toThrow(/readable judge report/);
    }
  });
});
