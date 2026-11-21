import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_STAGES } from "./lifecycle-observation.js";
import { captureMarketplaceDiagnostic } from "./lifecycle-observation-capture.js";
import {
  MARKETPLACE_INVOCATION,
  STAGE_FALLBACK,
  STAGE_PREFIX,
  WORKER_STDERR_COMPLETE,
} from "./lifecycle-observation-output.js";
import { OUTCOME_PREFIX, STDERR_COMPLETE } from "./lifecycle-observation-reporter.js";

const repo = realpathSync(process.cwd());
const testFile = join(repo, "src", "plugins", "cli-plugin.test.ts");
const suite = "plugin commands re-emit the Claude Code plugin copy (#447)";
const title = "add, update, rollback, and remove keep the marketplace copy current";
const syntheticChild = `
  const { writeFileSync } = require("node:fs");
  const sample = JSON.parse(process.argv[1]);
  writeFileSync(sample.path, sample.report);
  process.stdout.write(sample.stdout);
  process.stderr.write(sample.stderr);
  if (sample.signal) process.kill(process.pid, "SIGTERM");
  process.exitCode = sample.exit;
`;

function frame(stage: string, state: string, time: number, duration?: number) {
  return `${STAGE_PREFIX}${JSON.stringify({ invocation: MARKETPLACE_INVOCATION, stage, state, time, duration })}\n`;
}

function completedStages(count: number) {
  return MARKETPLACE_STAGES.slice(0, count)
    .map((stage, index) => frame(stage, "begin", index * 10) + frame(stage, "complete", index * 10 + 1, 1))
    .join("");
}

const completed = completedStages(MARKETPLACE_STAGES.length);
const open = completedStages(3) + frame("update", "begin", 30);
const failed = completedStages(5) + frame("rollback", "begin", 50) + frame("rollback", "failed", 52, 2);
const originalTimeout = "Error: STACK_TRACE_ERROR\n    at fixture (example.test.ts:1:1)";
const relativeTestFile = "src/plugins/cli-plugin.test.ts";
const FIXTURE_CASE_TIMEOUT_MS = 125;
const NESTED_CAPTURE_TEST_TIMEOUT_MS = 25_000;

interface Sample {
  file?: string;
  title?: string;
  duplicate?: boolean;
  nested?: boolean;
  pending?: boolean;
  error?: string;
  outcome?: string;
  signal?: boolean;
  stdout?: string;
  stderr?: string;
  truncate?: boolean;
  missingStdoutReceipt?: boolean;
  missingStderrReceipt?: boolean;
  missingWorkerReceipt?: boolean;
  reversedStderrReceipts?: boolean;
}

function capture(sample: Sample) {
  let scratch = "";
  const verdict = captureMarketplaceDiagnostic(repo, (executable, args, options) => {
    expect(executable).toBe(process.execPath);
    expect(args.slice(0, 10)).toEqual([
      join(repo, "node_modules", "vitest", "vitest.mjs"),
      "run",
      testFile,
      "--testNamePattern",
      `^src/plugins/cli-plugin\\.test\\.ts plugin commands re-emit the Claude Code plugin copy \\(#447\\) ${title}$`,
      "--maxWorkers=1",
      "--retry=0",
      "--no-cache",
      "--reporter=json",
      `--reporter=${join(repo, "src", "plugins", "lifecycle-observation-reporter.ts")}`,
    ]);
    const path = args[10].replace(/^--outputFile=/, "");
    scratch = dirname(path);
    expect(existsSync(path)).toBe(false);
    expect(options.cwd).toBe(repo);
    expect(options.env?.HOME).toBe(join(scratch, "home"));
    expect(options.env?.PLUGIN_LIFECYCLE_FIXTURE_OUTPUT).toBe("1");
    expect(options.env?.GH_TOKEN).toBeUndefined();
    expect(options.timeout).toBe(55_000);
    expect(options.maxBuffer).toBe(262_144);

    const status = sample.error ? "failed" : "passed";
    const titled = sample.title ?? title;
    const ancestry = sample.nested ? [relativeTestFile, "nested", suite] : [relativeTestFile, suite];
    const assertion = {
      title: titled,
      fullName: [...ancestry, titled].join(" "),
      ancestorTitles: ancestry,
      status,
      failureMessages: sample.error ? [sample.error] : [],
    };
    const result = {
      success: status === "passed",
      testResults: [
        {
          name: sample.file ?? testFile,
          status,
          message: "",
          assertionResults: sample.duplicate
            ? [assertion, assertion]
            : [assertion, { status: sample.pending ? "pending" : "skipped" }],
        },
      ],
    };
    const report = JSON.stringify(result);
    const workerReceipt = sample.missingWorkerReceipt ? "" : `${WORKER_STDERR_COMPLETE}\n`;
    const coordinatorReceipt = sample.missingStderrReceipt ? "" : `${STDERR_COMPLETE}\n`;
    const stderrReceipts = sample.reversedStderrReceipts
      ? coordinatorReceipt + workerReceipt
      : workerReceipt + coordinatorReceipt;
    const data = {
      path,
      report: sample.truncate ? report.slice(0, -1) : report,
      stdout:
        (sample.stdout ?? "") +
        (sample.missingStdoutReceipt ? "" : `JSON report written to ${path}\n`) +
        `${OUTCOME_PREFIX}${sample.outcome ?? status}\n`,
      stderr: (sample.stderr ?? completed) + stderrReceipts,
      signal: sample.signal ?? false,
      exit: status === "passed" ? 0 : 1,
    };
    return spawnSync(executable, ["-e", syntheticChild, JSON.stringify(data)], options);
  });
  expect(scratch).not.toBe("");
  expect(existsSync(scratch)).toBe(false);
  return verdict;
}

describe("capture the exact marketplace lifecycle case", () => {
  it("accepts a complete result from the named case", () => {
    expect(capture({})).toEqual({ status: "complete" });
  });

  it("uses the exact in-test timeout and its open stage", () => {
    expect(capture({ error: originalTimeout, outcome: "timed-out 30000", stderr: open })).toEqual({
      status: "open-stage",
      stage: "update",
    });
  });

  it("reports a failed stage without returning the raw error", () => {
    expect(capture({ error: "SYNTHETIC_PRIVATE_ERROR", stderr: failed })).toEqual({
      status: "failed-stage",
      stage: "rollback",
    });
  });

  it.each<[string, Sample]>([
    ["a different file", { file: "different.test.ts" }],
    ["a different test", { title: "different case" }],
    ["multiple executed tests", { duplicate: true }],
    ["a signaled process", { signal: true }],
    ["a recorder failure", { stdout: STAGE_FALLBACK }],
    ["a stage on stdout", { stdout: completed }],
    ["incomplete result JSON", { truncate: true }],
    ["a different test timeout", { error: originalTimeout, outcome: "timed-out 200", stderr: open }],
    ["a nested lookalike", { nested: true }],
    ["a pending second assertion", { pending: true }],
    ["a missing report completion receipt", { missingStdoutReceipt: true }],
    ["a missing stderr completion receipt", { missingStderrReceipt: true }],
    ["a missing worker completion receipt", { missingWorkerReceipt: true }],
    ["stderr receipts out of order", { reversedStderrReceipts: true }],
  ])("refuses %s", (_label, sample) => {
    expect(capture(sample)).toEqual({ status: "unqualified" });
  });

  it(
    "observes the typed result from a harmless real Vitest timeout",
    () => {
      const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "ab-lifecycle-typed-timeout-")));
      try {
        const fixture = join(sandbox, relativeTestFile);
        mkdirSync(dirname(fixture), { recursive: true });
        mkdirSync(join(sandbox, "node_modules"));
        symlinkSync(join(repo, "node_modules", "vitest"), join(sandbox, "node_modules", "vitest"), "dir");
        for (const name of [
          "lifecycle-observation",
          "lifecycle-observation-output",
          "lifecycle-observation-reporter",
        ]) {
          const path = `src/plugins/${name}.ts`;
          copyFileSync(join(repo, path), join(sandbox, path));
        }
        writeFileSync(
          join(sandbox, "vitest.config.mjs"),
          `export default { cacheDir: ${JSON.stringify(join(sandbox, "cache"))}, test: { cache: false } };\n`,
        );
        writeFileSync(
          fixture,
          `import { afterEach, describe, it } from "vitest";
import { completeMarketplaceWorkerOutput } from "./lifecycle-observation-output.js";
describe(${JSON.stringify(suite)}, () => {
  afterEach(completeMarketplaceWorkerOutput);
  it(${JSON.stringify(title)}, async () => {
    process.stderr.write(${JSON.stringify(frame("add", "begin", 0))});
    await new Promise(() => {});
  }, ${FIXTURE_CASE_TIMEOUT_MS});
});
describe("nested", () => {
  describe(${JSON.stringify(suite)}, () => {
    it(${JSON.stringify(title)}, () => { throw new Error("Unexpected lookalike execution"); });
  });
});`,
          { mode: 0o600 },
        );
        let verified = false;
        const verdict = captureMarketplaceDiagnostic(sandbox, (executable, args, options) => {
          expect(args[2]).toBe(fixture);
          const result = spawnSync(executable, args, { ...options, timeout: 16_000 });
          expect(result.error === undefined).toBe(true);
          expect(result.status).toBe(1);
          expect(result.stdout.includes(`${OUTCOME_PREFIX}timed-out ${FIXTURE_CASE_TIMEOUT_MS}\n`)).toBe(true);
          const worker = result.stderr.indexOf(`${WORKER_STDERR_COMPLETE}\n`);
          expect(worker).toBeGreaterThanOrEqual(0);
          expect(result.stderr.indexOf(`${STDERR_COMPLETE}\n`)).toBeGreaterThan(worker);
          const outputPath = args[10].replace(/^--outputFile=/, "");
          expect(result.stdout.includes(`JSON report written to ${outputPath}\n`)).toBe(true);
          const captured = JSON.parse(readFileSync(outputPath, "utf8"));
          const results = captured.testResults[0].assertionResults;
          expect(results.map(({ status }: { status: string }) => status)).toEqual(["failed", "skipped"]);
          expect(results[0].ancestorTitles).toEqual([relativeTestFile, suite]);
          expect(existsSync(join(sandbox, "node_modules", ".vite"))).toBe(false);
          verified = true;
          return result;
        });
        expect(verified).toBe(true);
        expect(verdict).toEqual({ status: "unqualified" });
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
    NESTED_CAPTURE_TEST_TIMEOUT_MS,
  );
});
