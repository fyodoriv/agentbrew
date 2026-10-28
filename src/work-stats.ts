/**
 * `agentbrew work stats`: what one /work run costs. It adds two local
 * measures and uploads nothing:
 *   - the instruction bytes a run loads: the /work command text plus the
 *     `agentbrew work --json` plan, so a shorter plan is measurable;
 *   - every recorded /work run from the agent perf log (agent-perf.mjs
 *     `work`): wall time, tool time, calls, blocked calls, Artifact
 *     publishes, subagents, and time per step.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { logSkipped } from "./core/logger.js";
import { readLock } from "./lock.js";
import { perfScriptCandidates } from "./metrics/usage.js";
import { loadState } from "./state.js";
import { builtinCommandsDir } from "./sync/builtin-commands.js";
import { expandHome } from "./utils.js";
import { buildWorkPlan, type WorkPlan } from "./work.js";

export interface WorkInstructionBytes {
  commandBytes: number;
  planBytes: number;
  totalBytes: number;
}

export interface WorkRun {
  session: string;
  project: string | null;
  start: string;
  wallMs: number;
  turns: number;
  toolMs: number;
  calls: number;
  blocked: number;
  humanWaitMs: number;
  artifactCalls: number;
  subagents: number;
  steps: Array<{ step: string; ms: number }>;
}

export interface WorkStats {
  instructions: WorkInstructionBytes;
  /** False when agent-perf.mjs is not installed; runs is then empty. */
  available: boolean;
  scope: { project: string; days: number };
  runs: WorkRun[];
  totals: {
    runs: number;
    medianWallMs: number;
    medianToolMs: number;
    medianCalls: number;
    medianBlocked: number;
    medianArtifactCalls: number;
  };
  /** The runs as agent-perf.mjs prints them; left out of `--json`. */
  runsText?: string;
}

/** Bytes the agent reads to start /work: the command text and the plan exactly as `--json` prints it. */
export function workInstructionBytes(plan: WorkPlan, commandText: string): WorkInstructionBytes {
  const commandBytes = Buffer.byteLength(commandText);
  const planBytes = Buffer.byteLength(`${JSON.stringify(plan, null, 2)}\n`);
  return { commandBytes, planBytes, totalBytes: commandBytes + planBytes };
}

interface WorkPerfModule {
  buildWorkReport: (
    opts: Record<string, unknown>,
    ctx?: { dir?: string; nowMs?: number },
  ) => Pick<WorkStats, "runs" | "totals"> & { scope: { project: string; days: number } };
  formatWorkReport: (report: unknown) => string;
}

export interface WorkStatsOptions {
  days?: number;
  project?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  /** Override where agent-perf.mjs is loaded from (tests). */
  perfScript?: string;
  /** Override the candidate list, tried in order (tests). */
  perfScripts?: string[];
  /** Override the /work command text (tests). */
  commandText?: string;
  /** Override the plan (tests); defaults to this machine's plan. */
  plan?: WorkPlan;
}

function workCommandText(): string {
  const dir = builtinCommandsDir();
  const path = dir ? join(dir, "work.md") : undefined;
  return path && existsSync(path) ? readFileSync(path, "utf-8") : "";
}

/** The synced copy can predate the `work` report (until the next `agentbrew sync`): use the first that has it. */
async function loadWorkReader(candidates: string[]): Promise<WorkPerfModule | undefined> {
  for (const script of candidates.filter((path) => existsSync(path))) {
    const loaded = (await import(pathToFileURL(script).href)) as Partial<WorkPerfModule>;
    if (typeof loaded.buildWorkReport === "function" && typeof loaded.formatWorkReport === "function") {
      return loaded as WorkPerfModule;
    }
  }
  return undefined;
}

export async function collectWorkStats(options: WorkStatsOptions = {}): Promise<WorkStats> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const days = options.days && options.days > 0 ? options.days : 30;
  const plan =
    options.plan ??
    buildWorkPlan(loadState(), readLock().plugins ?? [], { dirExists: (dir) => existsSync(expandHome(dir)) });
  const instructions = workInstructionBytes(plan, options.commandText ?? workCommandText());
  const empty: WorkStats = {
    instructions,
    available: false,
    scope: { project: options.project ?? "all", days },
    runs: [],
    totals: { runs: 0, medianWallMs: 0, medianToolMs: 0, medianCalls: 0, medianBlocked: 0, medianArtifactCalls: 0 },
  };
  const candidates = options.perfScript ? [options.perfScript] : (options.perfScripts ?? perfScriptCandidates(home));
  try {
    const mod = await loadWorkReader(candidates);
    if (!mod) return empty;
    // Same layout as agent-perf.mjs perfDir(), but rooted at the given home.
    const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state");
    const report = mod.buildWorkReport(
      { days, project: options.project },
      { dir: join(stateHome, "agentbrew", "perf"), nowMs: options.nowMs ?? Date.now() },
    );
    return {
      instructions,
      available: true,
      scope: report.scope,
      runs: report.runs,
      totals: report.totals,
      runsText: mod.formatWorkReport(report),
    };
  } catch (error) {
    logSkipped("work-stats/collectWorkStats", error);
    return empty;
  }
}

export function formatWorkStats(stats: WorkStats): string {
  const { commandBytes, planBytes, totalBytes } = stats.instructions;
  const lines = [`Instructions per run: ${totalBytes} bytes (/work command ${commandBytes} + plan ${planBytes}).`, ""];
  if (!stats.available || stats.runsText === undefined) {
    lines.push("Run history: perf log reader not installed (run `agentbrew sync` to deploy agent-perf.mjs).");
    return lines.join("\n");
  }
  lines.push(stats.runsText);
  return lines.join("\n");
}

/** `agentbrew work stats [--days N] [--project NAME] [--json]`. */
export async function showWorkStats(options: { json?: boolean; days?: string; project?: string } = {}): Promise<void> {
  const stats = await collectWorkStats({ days: Number(options.days) || undefined, project: options.project });
  const { runsText: _text, ...json } = stats;
  console.log(options.json ? JSON.stringify(json, null, 2) : formatWorkStats(stats));
}
