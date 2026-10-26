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
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import type { AgentfileWorkStep } from "./agentfile.js";
import { type PluginLockEntry, readLock } from "./lock.js";
import { loadState } from "./state.js";
import type { AgentBrewState, WorkStepEntry } from "./types.js";
import { expandHome, resolveStateHome } from "./utils.js";

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
  steps: Array<{
    step: string;
    from: string;
    path: string | null;
    userOnly: boolean;
    /** What the step changes; empty means unknown, so the step runs alone (#509). */
    scope: string[];
    /** Steps that must finish first (#509). */
    after: string[];
    /** A live feed or watcher: it starts last (#509). */
    longRunning: boolean;
  }>;
  /**
   * Run order (#509): each inner list runs in parallel, one subagent per
   * step; the next stage starts when the whole stage is done.
   */
  stages: string[][];
  /** How to run the steps: back to back, no "continue?" stop between them (#508). */
  flow: string;
  /** The only reasons to stop and wait for the user mid-run (#508). */
  stopOnlyFor: string[];
  /** What to do with every other question: save it, ask all at the end (#508). */
  questions: string;
  watch: string;
  /**
   * The repo-update watch (#516): the applied Agentfile checkouts to poll,
   * and the plugin refresh steps to run after an update.
   */
  repoWatch: { checkouts: string[]; refresh: string[]; how: string };
  endOfDay: string[];
  /** Agentfile dirs whose steps were skipped because the dir no longer exists (#515). */
  staleWorkSteps: string[];
  /** The day's live dashboard (#510): one row per step, updated on every step change. */
  dashboard: WorkDashboard;
}

/** Step status on the dashboard (#510). */
export const WORK_STATUSES = ["done", "running", "waiting", "blocked", "failed"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export interface WorkDashboardRow {
  step: string;
  status: WorkStatus;
  /** One line: what the step did or found. */
  summary: string;
  /** What the step needs from the user; empty when nothing. */
  needsYou: string;
  /** A PR, report, or page for the step; empty when none. */
  link: string;
}

export interface WorkDashboard {
  title: string;
  statuses: readonly WorkStatus[];
  /** Starting rows: every step waiting. */
  rows: WorkDashboardRow[];
  /** What the top of the page shows. */
  top: string;
  /** Where to publish and how to keep it current. */
  publish: string;
  /** The local HTML page, for an agent with no Artifact tool. */
  localPath: string;
  /** The rows as JSON, rewritten on every step change; the optional `/work` pane reads it (#519). */
  statusPath: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildDashboard(steps: WorkPlan["steps"], date: Date, stateHome: string): WorkDashboard {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    title: `Work day ${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`,
    statuses: WORK_STATUSES,
    rows: steps.map((s) => ({ step: s.step, status: "waiting", summary: "", needsYou: "", link: "" })),
    top: 'Counts of done, running, and needs-you steps, then a "Needs you" list with every needsYou text and the saved questions.',
    publish:
      "Publish one page for the day: an Artifact with this title (reuse the one already titled so, if any), or one self-contained HTML file at localPath when you have no Artifact tool. Create it before the first step, or reuse today's page. Update a row each time its step changes. Keep the same URL all day.",
    localPath: join(stateHome, "agentbrew", "work", `${day}.html`),
    statusPath: join(stateHome, "agentbrew", "work", `${day}.json`),
  };
}

/** Replace the steps one Agentfile declares, keeping their place in the list. */
export function mergeWorkSteps(
  existing: WorkStepEntry[] | undefined,
  agentfile: string,
  declared: AgentfileWorkStep[],
): WorkStepEntry[] {
  const current = existing ?? [];
  const at = current.findIndex((entry) => entry.agentfile === agentfile);
  const others = current.filter((entry) => entry.agentfile !== agentfile);
  const mine = declared.map((entry) =>
    typeof entry === "string" ? { step: entry, agentfile } : { ...entry, agentfile, step: entry.step },
  );
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

type StageInput = Pick<WorkPlan["steps"][number], "step" | "scope" | "after" | "longRunning">;

/** Two scopes overlap when they are equal or one path holds the other. */
function scopesOverlap(a: string[], b: string[]): boolean {
  const norm = (x: string) => expandHome(x).replace(/\/+$/, "");
  return a.some((x) =>
    b.some((y) => {
      const [p, q] = [norm(x), norm(y)];
      return p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`);
    }),
  );
}

/**
 * Group steps into stages (#509). A stage holds steps in list order whose
 * scopes do not overlap and whose `after:` steps are done. A step with no
 * scope runs alone, and later steps do not pass it. Long-running steps
 * start after every other step, and so does any step that waits on one. An `after:` name that is not in the plan is
 * ignored; a cycle runs its first step alone, so no step is lost.
 */
export function buildWorkStages(steps: StageInput[]): string[][] {
  const known = new Set(steps.map((s) => s.step));
  const done = new Set<string>();
  const stages: string[][] = [];
  const late = lateSteps(steps);
  for (const group of [steps.filter((s) => !late.has(s.step)), steps.filter((s) => late.has(s.step))]) {
    let remaining = [...group];
    while (remaining.length > 0) {
      const stage = nextStage(remaining, (dep) => done.has(dep) || !known.has(dep));
      for (const s of stage) done.add(s.step);
      remaining = remaining.filter((s) => !stage.includes(s));
      stages.push(stage.map((s) => s.step));
    }
  }
  return stages;
}

/** Long-running steps, plus every step that waits on one: they all start last. */
function lateSteps(steps: StageInput[]): Set<string> {
  const late = new Set(steps.filter((s) => s.longRunning).map((s) => s.step));
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of steps) {
      if (!late.has(s.step) && s.after.some((dep) => late.has(dep))) {
        late.add(s.step);
        grew = true;
      }
    }
  }
  return late;
}

/**
 * The next stage from the steps left, in list order; never empty. When no
 * step can start (a blocked step with no scope is first), the first ready
 * step runs alone; only an `after:` cycle falls back to the first step.
 */
function nextStage(remaining: StageInput[], isDone: (step: string) => boolean): StageInput[] {
  const ready = (s: StageInput) => s.after.every(isDone);
  const stage: StageInput[] = [];
  for (const s of remaining) {
    if (s.scope.length === 0) {
      if (stage.length === 0 && ready(s)) stage.push(s);
      break;
    }
    if (ready(s) && !stage.some((other) => scopesOverlap(other.scope, s.scope))) stage.push(s);
  }
  if (stage.length > 0) return stage;
  return [remaining.find(ready) ?? (remaining[0] as StageInput)];
}

/** What `/work` does on each watch pass for repo updates (#516). */
export const REPO_WATCH_HOW =
  "On each watch pass, fetch the remote of each checkout in `checkouts`. When its branch has new commits and the checkout is clean, fast-forward it (never merge, rebase, or reset), then run `agentbrew sync` once and each `refresh` step. Skip a checkout with local changes or a diverged branch and say so in one line. Print one line per update.";

/** Drop entries whose Agentfile dir is gone (a deleted worktree), so stale steps neither run nor shadow current ones (#515). */
export function pruneMissingWorkSteps(
  entries: WorkStepEntry[],
  dirExists: (dir: string) => boolean = (dir) => existsSync(expandHome(dir)),
): WorkStepEntry[] {
  return entries.filter((entry) => dirExists(entry.agentfile));
}

/** The day plan for this machine. */
export function buildWorkPlan(
  state: AgentBrewState | undefined,
  plugins: PluginLockEntry[],
  options: { date?: Date; stateHome?: string; dirExists?: (dir: string) => boolean } = {},
): WorkPlan {
  const all = state?.workSteps ?? [];
  const current = pruneMissingWorkSteps(all, options.dirExists ?? (() => true));
  const staleWorkSteps = [...new Set(all.filter((e) => !current.includes(e)).map((e) => e.agentfile))];
  const seen = new Set<string>();
  const steps: WorkPlan["steps"] = [];
  const add = (step: string, from: string, entry?: WorkStepEntry) => {
    if (seen.has(step) || step === END_OF_DAY_STEP) return;
    seen.add(step);
    steps.push({
      step,
      from,
      ...resolveWorkStep(step),
      scope: entry?.scope ?? [],
      after: entry?.after ?? [],
      longRunning: entry?.longRunning === true,
    });
  };
  for (const step of DEFAULT_WORK_STEPS) add(step, "agentbrew");
  for (const entry of current) if (!entry.refresh) add(entry.step, entry.agentfile, entry);
  const refresh = [...new Set(current.filter((e) => e.refresh).map((e) => e.step))];
  return {
    staleWorkSteps,
    ...machineRule(plugins),
    steps,
    stages: buildWorkStages(steps),
    flow: 'Run every step and phase back to back. Never stop to ask "continue?". When a step is blocked, report it in one line and go on to the next step.',
    stopOnlyFor: WORK_STOP_ONLY_FOR,
    questions:
      "Save every other question a step raises (for example a checkup's final questions). Ask them all once, after the last step, and again at the end of each watch pass: one batched ask of every item that waits on the user (decisions, drafts to send, sign-ins, approvals). First check that each item is still open (for example, that a draft was not already sent). For each item, say what it is, what each option does, and your pick.",
    watch:
      "After the steps, keep watching: re-run a step when its input changes, print one line per update, and stop when the user says end of day.",
    repoWatch: {
      checkouts: [...new Set(current.map((e) => e.agentfile))],
      refresh,
      how: REPO_WATCH_HOW,
    },
    endOfDay: [
      END_OF_DAY_STEP,
      "Stop every loop you started, then draft a Today / Tomorrow report for the user. Link the day's dashboard in it.",
    ],
    dashboard: buildDashboard(
      steps,
      options.date ?? new Date(),
      options.stateHome ?? resolveStateHome(homedir(), process.env.XDG_STATE_HOME),
    ),
  };
}

export function formatWorkPlan(plan: WorkPlan): string {
  const lines = [chalk.bold("Work plan"), "", plan.rule, "", "Steps:"];
  plan.steps.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.step}${s.from === "agentbrew" ? "" : chalk.dim(` (from ${s.from})`)}`);
  });
  if (plan.stages.some((stage) => stage.length > 1)) {
    lines.push("", "Stages (steps in one stage run in parallel):");
    plan.stages.forEach((stage, i) => {
      lines.push(`  ${i + 1}. ${stage.join(", ")}`);
    });
  }
  if (plan.staleWorkSteps.length > 0) {
    lines.push(
      "",
      `Skipped steps from Agentfile dirs that no longer exist: ${plan.staleWorkSteps.join(", ")}. The next \`agentbrew sync\` removes them.`,
    );
  }
  lines.push("", `Dashboard: ${plan.dashboard.title} (local page: ${plan.dashboard.localPath})`);
  lines.push("", plan.watch);
  if (plan.repoWatch.checkouts.length > 0) {
    const refresh = plan.repoWatch.refresh.length > 0 ? `; then ${plan.repoWatch.refresh.join(", ")}` : "";
    lines.push(`Repo updates: watch ${plan.repoWatch.checkouts.join(", ")}; fast-forward, agentbrew sync${refresh}.`);
  }
  lines.push("", `End of day: ${plan.endOfDay.join(" ")}`);
  return lines.join("\n");
}

/** `agentbrew work [--json]`. */
export function showWorkPlan(options: { json?: boolean } = {}): void {
  const plan = buildWorkPlan(loadState(), readLock().plugins ?? [], {
    dirExists: (dir) => existsSync(expandHome(dir)),
  });
  console.log(options.json ? JSON.stringify(plan, null, 2) : formatWorkPlan(plan));
}
