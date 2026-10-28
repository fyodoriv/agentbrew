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
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import chalk from "chalk";
import { type Agentfile, type AgentfileWorkStep, loadAgentfile } from "./agentfile.js";
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
  /**
   * Plugin review: plugin checkouts (`<tool>-<org>` beside `<tool>`, plus
   * installed plugins) whose unshipped changes may belong in the main tool.
   */
  pluginReview: { checkouts: string[]; how: string };
}

/** Where plugin checkouts live beside their main tool. */
export const PLUGIN_ROOTS = ["~/apps", "~/apps/tooling"];

export const PLUGIN_REVIEW_HOW =
  "On each cycle, in each checkout in `checkouts` that holds a plugin (a careerbrew, agentbrew, or dotfiles plugin, or any app's plugin), list uncommitted files and unpushed commits. Skip a checkout that is not a plugin, in one line. For each change, decide if it is generic: could someone outside the org use it, with no company name, internal host, or private data? A generic change belongs in the main tool: draft the move (an issue or PR on the main tool, with the org-specific parts left behind a generic setting) and add it to the batched questions. Never move or publish anything before the user says yes.";

/**
 * Plugin checkouts beside a main tool: `<root>/<tool>-<name>` when
 * `<root>/<tool>` is a git checkout too. Reads directory names only.
 */
export function findPluginCheckouts(
  roots: string[] = PLUGIN_ROOTS,
  list: (dir: string) => string[] = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  isRepo: (dir: string) => boolean = (dir) => existsSync(join(dir, ".git")),
): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const dir = expandHome(root);
    const names = list(dir);
    const tools = new Set(names.filter((n) => isRepo(join(dir, n))));
    for (const name of names) {
      const tool = [...tools].find((t) => name.startsWith(`${t}-`));
      if (tool && isRepo(join(dir, name))) out.push(`${root}/${name}`);
    }
  }
  return out;
}

/** The git checkout that holds `path`: the nearest folder at or above it with a `.git`. */
function enclosingRepo(path: string, isRepo: (dir: string) => boolean, home = homedir()): string | undefined {
  for (let dir = path; dir !== dirname(dir) && dir !== home; dir = dirname(dir)) {
    if (isRepo(dir)) return dir;
  }
  return undefined;
}

/**
 * The app checkouts a plugin works with (#600), from its Agentfile: the
 * `workCheckouts:` list (any path, `~` allowed), plus the git checkout of each
 * local `sources:`, `commands:`, and `agents:` path that sits outside the
 * plugin's own checkout. A `workCheckouts:` entry that is not a git checkout
 * is skipped. Auto-detected ones count only under `home`, so a
 * source in a system folder never adds an unrelated repo. A folder name is
 * never used. Paths come back as `~/...` under the home folder.
 */
export function findParentCheckouts(
  pluginDir: string,
  load: (dir: string) => Agentfile | undefined = loadAgentfile,
  isRepo: (dir: string) => boolean = (dir) => existsSync(join(dir, ".git")),
  home = homedir(),
): string[] {
  const own = expandHome(pluginDir);
  const ownRepo = enclosingRepo(own, isRepo, home);
  const file = load(own);
  const found = new Set<string>();
  for (const entry of [...(file?.sources ?? []), ...(file?.commands ?? []), ...(file?.agents ?? [])]) {
    if (!/^[.~/]/.test(entry)) continue;
    const repo = enclosingRepo(resolve(own, expandHome(entry)), isRepo, home);
    if (repo?.startsWith(`${home}/`) && repo !== own && repo !== ownRepo) found.add(repo);
  }
  for (const entry of file?.workCheckouts ?? []) {
    const repo = resolve(own, expandHome(entry));
    // A missing folder or a folder that is not a checkout cannot be fetched.
    if (isRepo(repo)) found.add(repo);
  }
  return [...found].map((repo) => (repo.startsWith(`${home}/`) ? `~${repo.slice(home.length)}` : repo));
}

/** One real path per folder, so `~/x` and `/Users/me/x` (or a symlink to it) match. */
function canonicalPath(path: string): string {
  const full = resolve(expandHome(path));
  try {
    return realpathSync(full);
  } catch {
    return full;
  }
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
    publish:
      "Publish one page for the day: an Artifact with this title (reuse the one already titled so, if any), or one self-contained HTML file at localPath when you have no Artifact tool. Create it before the first step, or reuse today's page. Rewrite statusPath on every row change. Republish the page only when a stage ends, when a watch pass changes a row, when a row starts to need the user, and at end of day. Keep the same URL all day.",
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

/** What `/work` does for repo updates: before the first step and on each watch pass (#516, #600). */
export const REPO_WATCH_HOW =
  "Before the first step and on each watch pass, fetch the remote of each checkout in `checkouts`. When its branch has new commits and the checkout is clean, fast-forward it (`git merge --ff-only @{u}` only; never a merge commit, rebase, or reset), then run `agentbrew sync` once and each `refresh` step. Print one line per checkout: updated, current, or skipped (<reason>: dirty, diverged, no upstream, detached HEAD, failed fetch).";

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
  options: {
    date?: Date;
    stateHome?: string;
    dirExists?: (dir: string) => boolean;
    pluginCheckouts?: string[];
    parentsOf?: (agentfileDir: string) => string[];
  } = {},
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
  const parentsOf = options.parentsOf ?? ((d: string) => findParentCheckouts(d));
  const seenPaths = new Set<string>();
  const checkouts = [...new Set(current.map((e) => e.agentfile))]
    .flatMap((dir) => [dir, ...parentsOf(dir)])
    .filter((dir) => {
      const key = canonicalPath(dir);
      if (seenPaths.has(key)) return false;
      seenPaths.add(key);
      return true;
    });
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
      checkouts,
      refresh,
      how: REPO_WATCH_HOW,
    },
    endOfDay: [
      END_OF_DAY_STEP,
      "Stop every loop you started, then draft a Today / Tomorrow report for the user. Link the day's dashboard in it.",
    ],
    pluginReview: {
      checkouts: [...new Set([...(options.pluginCheckouts ?? findPluginCheckouts()), ...plugins.map((p) => p.source)])],
      how: PLUGIN_REVIEW_HOW,
    },
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
  if (plan.pluginReview.checkouts.length > 0) {
    lines.push(
      `Plugin review: check ${plan.pluginReview.checkouts.join(", ")} for changes that belong in the main tool.`,
    );
  }
  if (plan.repoWatch.checkouts.length > 0) {
    const refresh = plan.repoWatch.refresh.length > 0 ? `; then ${plan.repoWatch.refresh.join(", ")}` : "";
    lines.push(
      `Repo updates: fast-forward ${plan.repoWatch.checkouts.join(", ")} before step 1 and on each watch pass; agentbrew sync${refresh}.`,
    );
  }
  lines.push("", `End of day: ${plan.endOfDay.join(" ")}`);
  return lines.join("\n");
}

/** The plan as `--json` prints it: compact, since an agent reads it on every /work run (work_instruction_bytes). */
export function workPlanJson(plan: WorkPlan): string {
  return JSON.stringify(plan);
}

/** `agentbrew work [--json]`. */
export function showWorkPlan(options: { json?: boolean } = {}): void {
  const plan = buildWorkPlan(loadState(), readLock().plugins ?? [], {
    dirExists: (dir) => existsSync(expandHome(dir)),
  });
  console.log(options.json ? workPlanJson(plan) : formatWorkPlan(plan));
}
