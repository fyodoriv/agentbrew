/**
 * `agentbrew work` (#440): the generic daily routine. It prints an ordered
 * plan for the `/work` command: the checkup steps, the machine rule, watch
 * mode, and end of day. It reads local state only and changes nothing.
 *
 * Steps are agentbrew's built-in defaults, then each Agentfile's
 * `workSteps:` list (the extension point a company overlay uses), in the
 * order the Agentfiles were applied. state.workSteps records which
 * Agentfile declared each step (the same ownership rule as `commands:` dirs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { type PluginLockEntry, readLock } from "./lock.js";
import { loadState } from "./state.js";
import type { AgentBrewState, WorkStepEntry } from "./types.js";
import { expandHome } from "./utils.js";

/** Built-in first steps: agentbrew's own state check. */
export const DEFAULT_WORK_STEPS = ["/agentbrew"];
/** The end-of-day step: deliver what is ready, draft the rest. */
export const END_OF_DAY_STEP = "/wrap-up";

export interface WorkPlan {
  machine: "company" | "personal";
  /** What the agent may edit, and how it treats public repos. */
  rule: string;
  /**
   * `path`: the skill or command file the step runs (null when not found).
   * `userOnly`: the skill sets `disable-model-invocation: true`, so the
   * agent's Skill tool hides it; `/work` reads `path` and follows it (#451).
   */
  steps: Array<{ step: string; from: string; path: string | null; userOnly: boolean }>;
  /** How to run the steps: back to back, no "continue?" stop between them (#508). */
  flow: string;
  /** The only reasons to stop and wait for the user mid-run (#508). */
  stopOnlyFor: string[];
  /** What to do with every other question: save it, ask all at the end (#508). */
  questions: string;
  watch: string;
  endOfDay: string[];
}

/** Replace the steps one Agentfile declares, keeping their place in the list. */
export function mergeWorkSteps(
  existing: WorkStepEntry[] | undefined,
  agentfile: string,
  declared: string[],
): WorkStepEntry[] {
  const current = existing ?? [];
  const at = current.findIndex((entry) => entry.agentfile === agentfile);
  const others = current.filter((entry) => entry.agentfile !== agentfile);
  const mine = declared.map((step) => ({ step, agentfile }));
  const index = at === -1 ? others.length : current.slice(0, at).filter((e) => e.agentfile !== agentfile).length;
  return [...others.slice(0, index), ...mine, ...others.slice(index)];
}

function machineRule(plugins: PluginLockEntry[]): Pick<WorkPlan, "machine" | "rule"> {
  const drafts = "Every public issue, PR, or comment stays a draft until the user says yes.";
  if (plugins.length === 0) {
    return { machine: "personal", rule: `Personal machine: edit the public repos you work on. ${drafts}` };
  }
  const repos = plugins.map((p) => p.source).join(", ");
  return {
    machine: "company",
    rule: `Company machine: edit only the company plugin repos (${repos}). On public repos, open an issue instead of editing. ${drafts}`,
  };
}

/**
 * The file a `/name` step runs, under an agent config root (default
 * `~/.claude`): a skill's SKILL.md first, then a command file.
 */
export function resolveWorkStep(
  step: string,
  root = expandHome("~/.claude"),
): { path: string | null; userOnly: boolean } {
  const name = step.replace(/^\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return { path: null, userOnly: false };
  for (const path of [join(root, "skills", name, "SKILL.md"), join(root, "commands", `${name}.md`)]) {
    if (!existsSync(path)) continue;
    let text = "";
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      // Unreadable: still name the file.
    }
    const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"))?.[1] ?? "";
    return { path, userOnly: /^disable-model-invocation:\s*["']?true["']?\s*(#.*)?$/im.test(front) };
  }
  return { path: null, userOnly: false };
}

/** The only reasons `/work` stops mid-run (#508). */
export const WORK_STOP_ONLY_FOR = [
  "A merge conflict you cannot resolve.",
  "A destructive or public action that needs approval.",
  "A choice only the user can make.",
];

/** The day plan for this machine. */
export function buildWorkPlan(state: AgentBrewState | undefined, plugins: PluginLockEntry[]): WorkPlan {
  const seen = new Set<string>();
  const steps: WorkPlan["steps"] = [];
  const add = (step: string, from: string) => {
    if (seen.has(step) || step === END_OF_DAY_STEP) return;
    seen.add(step);
    steps.push({ step, from, ...resolveWorkStep(step) });
  };
  for (const step of DEFAULT_WORK_STEPS) add(step, "agentbrew");
  for (const entry of state?.workSteps ?? []) add(entry.step, entry.agentfile);
  return {
    ...machineRule(plugins),
    steps,
    flow: 'Run every step and phase back to back. Never stop to ask "continue?". When a step is blocked, report it in one line and go on to the next step.',
    stopOnlyFor: WORK_STOP_ONLY_FOR,
    questions:
      "Save every other question a step raises (for example a checkup's final questions). Ask them all once, after the last step.",
    watch:
      "After the steps, keep watching: re-run a step when its input changes, print one line per update, and stop when the user says end of day.",
    endOfDay: [END_OF_DAY_STEP, "Stop every loop you started, then draft a Today / Tomorrow report for the user."],
  };
}

export function formatWorkPlan(plan: WorkPlan): string {
  const lines = [chalk.bold("Work plan"), "", plan.rule, "", "Steps:"];
  plan.steps.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.step}${s.from === "agentbrew" ? "" : chalk.dim(` (from ${s.from})`)}`);
  });
  lines.push("", plan.watch, "", `End of day: ${plan.endOfDay.join(" ")}`);
  return lines.join("\n");
}

/** `agentbrew work [--json]`. */
export function showWorkPlan(options: { json?: boolean } = {}): void {
  const plan = buildWorkPlan(loadState(), readLock().plugins ?? []);
  console.log(options.json ? JSON.stringify(plan, null, 2) : formatWorkPlan(plan));
}
