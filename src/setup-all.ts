/**
 * `agentbrew setup --all`: the multi-repo setup chain (#442 part 4).
 *
 * One command runs, in order: `agentbrew sync`, the dotfiles installer, the
 * careerbrew installer, then `agentbrew audit-skills`. It asks one question
 * round (which repos to include) unless `--yes` or no terminal, skips steps a
 * past run finished, keeps going after a failed step, lists the failed steps
 * at the end, and ends with how to send feedback.
 *
 * Done-step state lives in a JSON file under ~/.local/state/agentbrew
 * (file scope: survives reruns; delete it or pass --force to rerun all).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Runner } from "./contribute.js";

export type RepoName = "dotfiles" | "careerbrew";

export interface SetupStep {
  id: string;
  title: string;
  /** Repo this step belongs to; the question round can drop a repo. */
  repo: "agentbrew" | RepoName;
  cmd: string;
  args: string[];
  cwd: string;
  /** Run every time (report-only steps); never recorded as done. */
  always?: boolean;
  /** Already satisfied without state, for example an existing clone. */
  satisfied?: () => boolean;
}

export interface SetupAllOptions {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  dir?: string;
  stateFile?: string;
  run?: Runner;
  ask?: (question: string) => Promise<boolean>;
  log?: (line: string) => void;
  isTTY?: boolean;
  /** Finds an existing checkout of a repo; defaults to findCheckout. */
  locate?: (repo: RepoName, dir: string) => string | undefined;
}

export interface SetupAllResult {
  ran: string[];
  skipped: string[];
  failed: string[];
}

const REPOS: Record<RepoName, string> = {
  dotfiles: "https://github.com/fyodoriv/dotfiles.git",
  careerbrew: "https://github.com/fyodoriv/careerbrew.git",
};

/** Streams installer output live and lets installers prompt (stdio inherit). */
export const inheritRunner: Runner = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  return { status: result.status ?? 1, stdout: "", stderr: result.error?.message ?? "" };
};

export function defaultStateFile(): string {
  return join(homedir(), ".local", "state", "agentbrew", "setup-all.json");
}

function originMatches(checkout: string, repo: RepoName): boolean {
  if (!existsSync(join(checkout, ".git"))) return false;
  const res = spawnSync("git", ["-C", checkout, "config", "--get", "remote.origin.url"], { encoding: "utf-8" });
  return new RegExp(`[/:]fyodoriv/${repo}(\\.git)?/?$`).test((res.stdout ?? "").trim());
}

function checkoutFromPath(repo: RepoName): string | undefined {
  for (const bin of (process.env.PATH ?? "").split(":")) {
    const candidate = join(bin, repo);
    if (!bin || !existsSync(candidate)) continue;
    let d = dirname(realpathSync(candidate));
    for (let i = 0; i < 3; i++, d = dirname(d)) if (originMatches(d, repo)) return d;
  }
  return undefined;
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Finds an existing checkout: the repo's command on PATH, then a clone whose
 * origin matches anywhere under `dir` up to depth 2 (for example ~/apps/tooling/dotfiles).
 */
export function findCheckout(repo: RepoName, dir: string): string | undefined {
  const fromPath = checkoutFromPath(repo);
  if (fromPath) return fromPath;
  for (const one of subdirs(dir)) {
    if (originMatches(one, repo)) return one;
    for (const two of subdirs(one)) if (originMatches(two, repo)) return two;
  }
  return undefined;
}

function repoSteps(repo: RepoName, dir: string, existing: string | undefined): SetupStep[] {
  const path = existing ?? join(dir, repo);
  const install =
    repo === "dotfiles"
      ? { cmd: "bash", args: [join(path, "bin", "dotfiles-install"), "run", "--yes", "--no-agentbrew"] }
      : { cmd: "bash", args: [join(path, "scripts", "install.sh")] };
  return [
    {
      id: `${repo}-clone`,
      title: existing ? `use existing ${repo} checkout ${path}` : `clone ${repo} into ${path}`,
      repo,
      cmd: "git",
      args: ["clone", REPOS[repo], path],
      cwd: dir,
      satisfied: () => existing !== undefined || existsSync(join(path, ".git")),
    },
    { id: `${repo}-install`, title: `${repo} installer`, repo, ...install, cwd: path },
  ];
}

export function buildSteps(
  dir: string,
  agentbrewBin: string[],
  existing: Partial<Record<RepoName, string>> = {},
): SetupStep[] {
  const [abCmd, ...abArgs] = agentbrewBin;
  return [
    {
      id: "agentbrew-sync",
      title: "agentbrew sync",
      repo: "agentbrew",
      cmd: abCmd,
      args: [...abArgs, "sync"],
      cwd: dir,
    },
    ...repoSteps("dotfiles", dir, existing.dotfiles),
    ...repoSteps("careerbrew", dir, existing.careerbrew),
    {
      id: "audit-skills",
      title: "agentbrew audit-skills",
      repo: "agentbrew",
      cmd: abCmd,
      args: [...abArgs, "audit-skills"],
      cwd: dir,
      always: true,
    },
  ];
}

function readDone(file: string, log: (line: string) => void): Set<string> {
  if (!existsSync(file)) return new Set();
  try {
    const data = JSON.parse(readFileSync(file, "utf-8")) as { done?: string[] };
    return new Set(data.done ?? []);
  } catch (err) {
    log(`! Cannot read setup state ${file} (${(err as Error).message}); running every step.`);
    return new Set();
  }
}

function writeDone(file: string, done: Set<string>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ done: [...done].sort() }, null, 2)}\n`);
}

async function defaultAsk(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** One question round. With --yes, --dry-run, or no terminal, use the defaults (all repos). */
async function chooseRepos(options: SetupAllOptions): Promise<Set<string>> {
  const repos = new Set<string>(["agentbrew", "dotfiles", "careerbrew"]);
  const interactive = !options.yes && !options.dryRun && (options.isTTY ?? Boolean(process.stdin.isTTY));
  if (!interactive) return repos;
  const ask = options.ask ?? defaultAsk;
  for (const repo of ["dotfiles", "careerbrew"]) {
    if (!(await ask(`Set up ${repo} too?`))) repos.delete(repo);
  }
  return repos;
}

type StepOutcome = "ran" | "skipped" | "failed";

interface StepContext {
  done: Set<string>;
  failedRepos: Set<string>;
  stateFile: string;
  dryRun: boolean;
  run: Runner;
  log: (line: string) => void;
}

function runStep(step: SetupStep, ctx: StepContext): StepOutcome {
  if (!step.always && (ctx.done.has(step.id) || step.satisfied?.())) {
    ctx.log(`- skip ${step.title} (done)`);
    return "skipped";
  }
  if (ctx.failedRepos.has(step.repo) && step.repo !== "agentbrew") {
    ctx.log(`- skip ${step.title} (an earlier ${step.repo} step failed)`);
    return "failed";
  }
  if (ctx.dryRun) {
    ctx.log(`- would run ${step.title}: ${[step.cmd, ...step.args].join(" ")}`);
    return "ran";
  }
  ctx.log(`- run ${step.title}`);
  const res = ctx.run(step.cmd, step.args, step.cwd);
  if (res.stdout) ctx.log(res.stdout);
  if (res.status !== 0) {
    if (res.stderr) ctx.log(res.stderr);
    ctx.log(`  failed (exit ${res.status}); continuing`);
    ctx.failedRepos.add(step.repo);
    return "failed";
  }
  if (!step.always) {
    ctx.done.add(step.id);
    writeDone(ctx.stateFile, ctx.done);
  }
  return "ran";
}

export async function runSetupAll(options: SetupAllOptions = {}, steps?: SetupStep[]): Promise<SetupAllResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dir = options.dir ?? join(homedir(), "apps");
  const stateFile = options.stateFile ?? defaultStateFile();
  const locate = options.locate ?? findCheckout;
  const all =
    steps ??
    buildSteps(dir, [process.execPath, process.argv[1] ?? "agentbrew"], {
      dotfiles: locate("dotfiles", dir),
      careerbrew: locate("careerbrew", dir),
    });
  const repos = await chooseRepos(options);
  const ctx: StepContext = {
    done: options.force ? new Set<string>() : readDone(stateFile, log),
    failedRepos: new Set<string>(),
    stateFile,
    dryRun: Boolean(options.dryRun),
    run: options.run ?? inheritRunner,
    log,
  };
  const result: SetupAllResult = { ran: [], skipped: [], failed: [] };

  if (!options.dryRun) mkdirSync(dir, { recursive: true });
  for (const step of all.filter((s) => repos.has(s.repo))) {
    result[runStep(step, ctx)].push(step.id);
  }

  log("");
  if (result.failed.length > 0) {
    log(`Failed steps: ${result.failed.join(", ")}. Rerun \`agentbrew setup --all\` to retry them.`);
  } else {
    log(options.dryRun ? "Dry run: nothing changed." : "Setup finished.");
  }
  log("Feedback: `agentbrew contribute` opens a fix PR; `agentbrew report` files an issue.");
  return result;
}
