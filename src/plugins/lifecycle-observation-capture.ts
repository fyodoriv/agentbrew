import { type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGE_FALLBACK, WORKER_STDERR_COMPLETE } from "./lifecycle-observation-output.js";
import { OUTCOME_PREFIX, STDERR_COMPLETE } from "./lifecycle-observation-reporter.js";
import { classifyMarketplaceObservation } from "./lifecycle-observation-verdict.js";

const suite = "plugin commands re-emit the Claude Code plugin copy (#447)";
const test = "add, update, rollback, and remove keep the marketplace copy current";
const relativeTestFile = "src/plugins/cli-plugin.test.ts";
const unqualified = { status: "unqualified" } as const;
const childTimeoutMs = 55_000;
const outputLimit = 262_144;
const reportLimit = 1_048_576;

type Launch = (
  executable: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>;
type Outcome = Parameters<typeof classifyMarketplaceObservation>[1];

interface Assertion {
  title: string;
  fullName: string;
  ancestorTitles: string[];
  status: string;
  failureMessages: string[];
}

interface Report {
  success: boolean;
  testResults: { name: string; status: string; message: string; assertionResults: Assertion[] }[];
}

function readExactResult(text: string, expectedFile: string) {
  const report = JSON.parse(text) as Partial<Report> | null;
  if (report?.testResults?.length !== 1) return;
  const [file] = report.testResults;
  if (file?.name !== expectedFile || file.message !== "" || !Array.isArray(file.assertionResults)) return;
  const executed = file.assertionResults.filter((record) => record?.status !== "skipped" && record?.status !== "todo");
  const [entry] = executed;
  if (executed.length !== 1 || entry?.title !== test || entry.fullName !== `${suite} ${test}`) return;
  if (entry.ancestorTitles?.length !== 1 || entry.ancestorTitles[0] !== suite) return;
  if (!Array.isArray(entry.failureMessages) || entry.status !== file.status) return;
  return { entry, success: report.success };
}

function exactOutcome(report: string, testFile: string, status: number, receipt: string): Outcome {
  const selected = readExactResult(report, testFile);
  if (!selected) return "unqualified";
  const { entry, success } = selected;
  if (status === 0 && success === true && entry.status === "passed" && entry.failureMessages.length === 0)
    return receipt === "passed" ? "passed" : "unqualified";
  if (status !== 1 || success !== false || entry.status !== "failed") return "unqualified";
  const messages = entry.failureMessages;
  if (messages.length === 0 || messages.some((message) => typeof message !== "string")) return "unqualified";
  if (receipt === "timed-out 30000" && messages.length === 1) return "timed-out";
  return receipt === "failed" ? "failed" : "unqualified";
}

function completedTransport(stdout: string, stderr: string, report: string) {
  const stdoutLines = stdout.split("\n");
  if (stdoutLines.filter((line) => line === `JSON report written to ${report}`).length !== 1) return;
  const outcomeLines = stdoutLines.filter((line) => line.startsWith(OUTCOME_PREFIX));
  if (outcomeLines.length !== 1 || !stderr.endsWith("\n")) return;
  const stderrLines = stderr.split("\n");
  const complete = stderrLines.indexOf(STDERR_COMPLETE);
  if (complete < 0 || complete !== stderrLines.lastIndexOf(STDERR_COMPLETE)) return;
  const worker = stderrLines.indexOf(WORKER_STDERR_COMPLETE);
  if (worker < 0 || worker >= complete || worker !== stderrLines.lastIndexOf(WORKER_STDERR_COMPLETE)) return;
  const isStage = (line: string) => line.startsWith("lifecycle-stage");
  if (stderrLines.slice(worker + 1).some(isStage)) return;
  const records = stderrLines.slice(0, worker).filter(isStage);
  return { outcome: outcomeLines[0].slice(OUTCOME_PREFIX.length), stream: `${records.join("\n")}\n` };
}

function readCapture(child: SpawnSyncReturns<string>, reportFile: string, testFile: string) {
  if (child.error || child.signal !== null || child.status === null || !child.output) return unqualified;
  if (child.stdout.includes(STAGE_FALLBACK.trimEnd()) || /^lifecycle-stage/m.test(child.stdout)) return unqualified;
  if (child.stderr.includes(STAGE_FALLBACK.trimEnd())) return unqualified;
  const transport = completedTransport(child.stdout, child.stderr, reportFile);
  if (!transport) return unqualified;
  const reportInfo = lstatSync(reportFile);
  if (!reportInfo.isFile() || reportInfo.size > reportLimit) return unqualified;
  const outcome = exactOutcome(readFileSync(reportFile, "utf8"), testFile, child.status, transport.outcome);
  return classifyMarketplaceObservation(transport.stream, outcome);
}

function captureInScratch(repoRoot: string, launch: Launch) {
  const created = mkdtempSync(join(tmpdir(), "ab-lifecycle-receipt-"));
  try {
    const scratch = realpathSync(created);
    const repo = realpathSync(repoRoot);
    const testFile = join(repo, relativeTestFile);
    const home = join(scratch, "home");
    const report = join(scratch, "result.json");
    mkdirSync(home, { mode: 0o700 });
    const child = launch(
      process.execPath,
      [
        join(repo, "node_modules", "vitest", "vitest.mjs"),
        "run",
        testFile,
        "--testNamePattern",
        `^${suite.replace(/[()]/g, "\\$&")} ${test}$`,
        "--maxWorkers=1",
        "--retry=0",
        "--no-cache",
        "--reporter=json",
        `--reporter=${join(repo, "src", "plugins", "lifecycle-observation-reporter.ts")}`,
        `--outputFile=${report}`,
      ],
      {
        cwd: repo,
        env: {
          HOME: home,
          TMPDIR: scratch,
          PATH: "/usr/bin:/bin",
          DO_NOT_TRACK: "1",
          AGENTBREW_EVENTS: "0",
          AGENTBREW_TELEMETRY: "0",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          PLUGIN_LIFECYCLE_FIXTURE_OUTPUT: "1",
        },
        encoding: "utf8",
        timeout: childTimeoutMs,
        maxBuffer: outputLimit,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return readCapture(child, report, testFile);
  } finally {
    rmSync(created, { recursive: true, force: true });
  }
}

/** Capture the single diagnostic only from its separately approved hosted job. */
export function captureMarketplaceDiagnostic(repoRoot: string, launch?: Launch) {
  if (!launch && process.env.GITHUB_ACTIONS !== "true") return unqualified;
  try {
    return captureInScratch(repoRoot, launch ?? spawnSync);
  } catch {
    return unqualified;
  }
}
