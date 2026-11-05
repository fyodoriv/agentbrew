import "./fixtures/http-version-port.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runJudge } from "./runner.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const spawn = vi.mocked(spawnSync);
const MARKER = "SYNTHETIC_PRIVATE_METADATA";
const version = '{"version":"0.40.14"}';
let root: string;
let signals: AbortSignal[];
let streams: ReadableStream<Uint8Array>[];
let fetcher: ReturnType<typeof vi.fn>;
let invocation = 0;
let saved: string | undefined;
function bytes(body: string) {
  return new TextEncoder().encode(body);
}
function response(body: string, status = 200) {
  const data = bytes(body);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (offset < data.length) {
        c.enqueue(data.slice(offset, offset + 2048));
        offset += 2048;
      } else c.close();
    },
  });
  streams.push(stream);
  return new Response(stream, { status });
}
function install(kind: string) {
  fetcher = vi.fn(async (url: unknown, init: RequestInit) => {
    expect(url).toBe("http://127.0.0.1:11434/api/version");
    expect(Object.keys(init).sort()).toEqual(["credentials", "method", "redirect", "signal"]);
    expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const signal = init.signal as AbortSignal;
    signals.push(signal);
    if (kind === "headers")
      return await new Promise<Response>((_r, reject) =>
        signal.addEventListener("abort", () => reject(new Error(MARKER)), { once: true }),
      );
    if (kind === "held" || kind === "readerror") {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          if (kind === "readerror") c.error(new Error(MARKER));
          else signal.addEventListener("abort", () => c.error(new Error(MARKER)), { once: true });
        },
      });
      streams.push(stream);
      return new Response(stream);
    }
    if (kind === "redirect") throw new TypeError(MARKER);
    if (kind === "old") return response('{"version":"0.39.0"}');
    if (kind === "unknown") return response('{"version":"0.40.15"}');
    if (kind === "missing") return response("{}");
    if (kind === "nonstring") return response('{"version":14}');
    if (kind === "malformed") return response(MARKER);
    if (kind === "503") return response(MARKER, 503);
    if (kind === "oversize") return response(version + " ".repeat(4097 - bytes(version).length));
    if (kind === "exactcap") return response(version + " ".repeat(4096 - bytes(version).length));
    return response(version);
  });
  vi.stubGlobal("fetch", fetcher);
}
async function attempt() {
  const receiptDirectory = join(root, `receipts-${++invocation}`);
  let error: unknown;
  try {
    await runJudge({
      judge: {
        definition: {
          name: "clarity",
          on: ["pr-create"],
          sees: "artifact",
          rubric: [{ id: "clear", check: "Clear?" }],
          passBar: 1,
          model: "ollama:chat:qwen3:14b",
          maxRounds: 1,
          instructions: "",
          calibration: { cases: ["synthetic"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
        },
        sha256: "a".repeat(64),
      } as never,
      event: "pr-create",
      artifact: bytes("Synthetic complete result."),
      receiptDirectory,
    });
  } catch (e) {
    error = e;
  }
  let receipts = 0;
  try {
    receipts = readdirSync(receiptDirectory).length;
  } catch {}
  return { error, receipts };
}
beforeEach(() => {
  vi.useFakeTimers();
  spawn.mockReset();
  signals = [];
  streams = [];
  invocation = 0;
  root = realpathSync(mkdtempSync(join(tmpdir(), "j752-version-")));
  mkdirSync(join(root, "engine/dist/src"), { recursive: true });
  writeFileSync(join(root, "engine/package.json"), JSON.stringify({ name: "promptfoo", version: "0.124.1" }));
  writeFileSync(join(root, "engine/dist/src/entrypoint.js"), "");
  saved = process.env.AGENTBREW_PROMPTFOO_PACKAGE;
  process.env.AGENTBREW_PROMPTFOO_PACKAGE = join(root, "engine");
  spawn.mockImplementation((_program, args) => {
    const argv = args as string[];
    writeFileSync(
      argv[argv.indexOf("--output") + 1],
      JSON.stringify({
        results: {
          results: [
            {
              failureReason: 0,
              success: true,
              gradingResult: {
                componentResults: [
                  {
                    assertion: { type: "llm-rubric", metric: "clear" },
                    pass: true,
                    score: 1,
                    reason: JSON.stringify({ critique: "Synthetic result", verdict: "PASS", evidence: [] }),
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    return { status: 0 } as ReturnType<typeof spawnSync>;
  });
});
afterEach(() => {
  if (saved === undefined) delete process.env.AGENTBREW_PROMPTFOO_PACKAGE;
  else process.env.AGENTBREW_PROMPTFOO_PACKAGE = saved;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});
const cases = [
  ["V01", "match", 1],
  ["V02", "old", 0],
  ["V03", "unknown", 0],
  ["V04", "missing", 0],
  ["V05", "nonstring", 0],
  ["V06", "malformed", 0],
  ["V07", "503", 0],
  ["V08", "redirect", 0],
  ["V09", "headers", 0],
  ["V10", "held", 0],
  ["V11", "oversize", 0],
  ["V13", "readerror", 0],
  ["V14", "exactcap", 1],
] as const;
for (const [id, kind, calls] of cases)
  it(`${id} ${kind}`, async () => {
    install(kind);
    const pending = attempt();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(spawn.mock.calls.length).toBe(calls);
    expect(result.receipts).toBe(calls);
    if (calls) {
      expect(result.error).toBeUndefined();
    } else {
      expect(result.error).toBeInstanceOf(Error);
      expect(String(result.error)).toBe("Error: Judge requires qualified local Ollama 0.40.14.");
    }
    if (signals.length) {
      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(true);
      expect(streams.every((s) => !s.locked)).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
it("V12 each invocation has its own fresh witness", async () => {
  install("match");
  const first = await attempt();
  expect(first.error).toBeUndefined();
  expect(first.receipts).toBe(1);
  expect(spawn).toHaveBeenCalledTimes(1);
  install("old");
  const second = await attempt();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(second.receipts).toBe(0);
  expect(second.error).toBeInstanceOf(Error);
  expect(signals).toHaveLength(2);
  expect(signals[0]).not.toBe(signals[1]);
  expect(signals.every((s) => s.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
