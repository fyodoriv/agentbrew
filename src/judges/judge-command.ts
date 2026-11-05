import { readSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { loadState } from "../state.js";
import { activeJudgeSets } from "../sync/stale-agentfile-artifacts.js";
import { readJudgeArtifact } from "./artifact.js";
import { runCalibrationPair, summarizeCalibrationPairs } from "./calibration.js";
import { loadCalibrationCases } from "./calibration-cases.js";
import { readDeliveryContexts } from "./delivery-context.js";
import { JUDGE_RECEIPT_MAX_AGE, missingJudgePasses } from "./gate.js";
import { loadJudgeDefinitions } from "./load.js";

import { checkJudgePrDelivery } from "./pr-delivery.js";
import { readJudgeInput } from "./review-input.js";
import { reserveJudgeRound } from "./review-rounds.js";
import { runJudge } from "./runner.js";

function currentJudges(name?: string, allowEmpty = false) {
  const entries = Object.values(activeJudgeSets(loadState()?.agentfileJudges ?? {})).flat();
  const selected = name === undefined ? entries : entries.filter((entry) => entry.definition.name === name);
  if (!selected.length && !allowEmpty) throw new Error("No matching judges. Apply the declaring Agentfile first.");
  const judgeSources = selected.map(({ owner, path }) => ({ owner, paths: [path] }));
  return loadJudgeDefinitions({ judgeSources }, process.cwd());
}

interface RunOptions {
  event?: string;
  artifact: string;
  request?: string;
  reviewId?: string;
  source?: string[];
}

function readContext(request: string, sources: string[]) {
  return {
    request: readJudgeArtifact(request),
    sources: sources.map((entry) => {
      const separator = entry.indexOf("=");
      if (separator < 1 || separator === entry.length - 1) {
        throw new Error("Each judge source must use id=path.");
      }
      return { id: entry.slice(0, separator), bytes: readJudgeArtifact(entry.slice(separator + 1)) };
    }),
  };
}

function selectRunJudges(name: string | undefined, eventOption?: string) {
  if (!name && !eventOption) throw new Error("Choose a judge name or --event.");
  const judges = currentJudges(name);
  const [first] = judges;
  const event = eventOption ?? (first.definition.on.length === 1 ? first.definition.on[0] : undefined);
  if (!event) throw new Error("This judge handles multiple events. Select an event with --event.");
  const selected = judges.flatMap((judge) => {
    const match = judge.definition.on.find((entry) => entry === event);
    return match ? [{ judge, event: match }] : [];
  });
  if (!selected.length) throw new Error("No declared judges handle this event.");
  return selected;
}

function contextForRun(sourceAware: boolean, { request, source }: RunOptions) {
  if (sourceAware && request && source?.length) return readContext(request, source);
  if (!sourceAware && !request && !source?.length) return undefined;
  throw new Error("Supply --request and --source only when a selected judge requires sources.");
}

function readHookValue(): unknown {
  const buffer = Buffer.alloc(8 * 128 * 1024 + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(0, buffer, length, buffer.length - length, null);
    if (!count) break;
    length += count;
  }
  if (length === buffer.length) throw new Error("Judge command input exceeds the size limit.");
  return JSON.parse(buffer.subarray(0, length).toString("utf8"));
}

function readHookArguments(): string[] {
  const argv = readHookValue();
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new Error("Judge command input must be a literal argument list.");
  }
  return argv;
}

function receiptDirectory(): string {
  return join(homedir(), ".config", "agentbrew", "judge-receipts");
}

function checkTextDelivery(event: "report-final" | "draft-save"): void {
  const judges = currentJudges(undefined, true);
  if (!judges.some(({ definition }) => definition.on.includes(event))) return;
  const text = readHookValue();
  if (typeof text !== "string" || !text.length) {
    if (event === "draft-save") process.exitCode = 2;
    return;
  }
  const missing = missingJudgePasses({
    judges,
    event: event,
    contexts: readDeliveryContexts(judges, event),
    artifact: Buffer.from(text),
    receiptDirectory: receiptDirectory(),
    now: Date.now(),
    maxAge: JUDGE_RECEIPT_MAX_AGE,
  });
  if (missing.length) process.exitCode = 2;
}

export function registerJudgeCommand(program: Command): void {
  const command = program.command("judge").description("Run and calibrate artifact judges");
  command.command("gate-report", { hidden: true }).action(() => checkTextDelivery("report-final"));
  command.command("gate-draft", { hidden: true }).action(() => checkTextDelivery("draft-save"));
  command
    .command("gate-pr", { hidden: true })
    .argument("<event>")
    .action((event: string) => {
      if (event !== "pr-create" && event !== "pr-ready") throw new Error("Unsupported judge PR event.");
      const judges = currentJudges(undefined, true);
      const missing = checkJudgePrDelivery({
        event,
        argv: readHookArguments(),
        judges,
        cwd: process.cwd(),
        receiptDirectory: receiptDirectory(),
        now: Date.now(),
      });
      if (missing.length) {
        console.error(`A fresh verdict is required for: ${missing.join(", ")}.`);
        process.exitCode = 2;
      }
    });
  command
    .command("run")
    .description("Grade an artifact and save verdicts for its exact input")
    .argument("[name]", "Judge name. Omit when selecting by event.")
    .option("--event <event>", "Select a delivery event for the named judge or all declared judges")
    .requiredOption("--artifact <file>", "Exact artifact to judge")
    .option("--review-id <id>", "Keep one round limit across revisions stored at different paths")
    .option("--request <file>", "Original request for source-aware judges")
    .option("--source <id=path...>", "Named evidence files for source-aware judges")
    .action(async (name: string | undefined, options: RunOptions) => {
      const selected = selectRunJudges(name, options.event);
      const context = contextForRun(
        selected.some(({ judge }) => judge.definition.sees === "artifact+sources"),
        options,
      );
      const artifact = readJudgeArtifact(options.artifact);
      readJudgeInput(artifact, context);
      const scope = options.reviewId ? ["review", options.reviewId] : ["path", resolve(options.artifact)];
      const results = [];
      for (const { judge, event } of selected) {
        reserveJudgeRound(receiptDirectory(), [...scope, judge.owner, judge.path, event], judge.definition.maxRounds);
        const receipt = await runJudge({
          judge,
          event,
          artifact,
          receiptDirectory: receiptDirectory(),
          context: judge.definition.sees === "artifact+sources" ? context : undefined,
        });
        results.push({ judge: judge.definition.name, pass: receipt.pass, checks: receipt.checks });
      }
      const checks = results.flatMap((result) =>
        result.checks.map((check) => (results.length === 1 ? check : { judge: result.judge, ...check })),
      );
      console.log(JSON.stringify(checks));
      if (results.some((result) => !result.pass)) process.exitCode = 1;
    });
  command
    .command("eval")
    .description("Calibrate declared judges against their labeled examples")
    .argument("[name]", "Judge name. Omit to calibrate every declared judge.")
    .action(async (name?: string) => {
      const jobs = currentJudges(name).map((judge) => ({ judge, pairs: loadCalibrationCases(judge) }));
      const results = [];
      for (const { judge, pairs } of jobs) {
        const fixtures = [];
        for (const [index, pair] of pairs.entries()) {
          const score = await runCalibrationPair(judge.definition, pair);
          fixtures.push({ fixture: judge.definition.calibration.cases[index], ...score });
        }
        const summary = summarizeCalibrationPairs(fixtures, judge.definition.calibration);
        results.push({ judge: judge.definition.name, ...summary, fixtures });
      }
      console.log(JSON.stringify(results));
      if (results.some((result) => !result.pass)) process.exitCode = 1;
    });
}
