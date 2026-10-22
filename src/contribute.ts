/**
 * `agentbrew contribute`: open a PR from the current branch of any GitHub
 * checkout (agentbrew, dotfiles, a skill source) back to its upstream repo.
 *
 * Fork flow, for someone without push access:
 *   1. find the upstream repo (an `upstream` remote, the fork parent of
 *      `origin`, or `origin` itself),
 *   2. fork it to the signed-in GitHub account (`gh repo fork`, idempotent),
 *   3. push the branch to that fork,
 *   4. `gh pr create --repo <upstream> --head <login>:<branch>`.
 * When the signed-in account owns the upstream repo, it pushes to `origin`
 * and opens a same-repo PR instead. `--dry-run` prints the steps only.
 */
import { spawnSync } from "node:child_process";

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string, args: string[], cwd: string) => RunResult;

export const defaultRunner: Runner = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? result.error?.message ?? "").trim(),
  };
};

export interface ContributeOptions {
  cwd?: string;
  dryRun?: boolean;
  title?: string;
  bodyFile?: string;
  base?: string;
  draft?: boolean;
  run?: Runner;
  log?: (line: string) => void;
}

export interface ContributeResult {
  ok: boolean;
  mode?: "fork" | "direct";
  upstream?: string;
  head?: string;
  prUrl?: string;
  error?: string;
}

/** "owner/repo" from a GitHub remote URL (ssh or https), else undefined. */
export function githubSlug(url: string): string | undefined {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function fail(error: string): ContributeResult {
  return { ok: false, error };
}

interface RepoContext {
  cwd: string;
  branch: string;
  me: string;
  remotes: Map<string, string>;
  originSlug?: string;
  upstream: string;
}

interface Step {
  why: string;
  cmd: string;
  args: string[];
}

export function readRemotes(run: Runner, cwd: string): Map<string, string> {
  const remotes = new Map<string, string>();
  for (const line of run("git", ["remote", "-v"], cwd).stdout.split("\n")) {
    const [name, url, kind] = line.split(/\s+/);
    if (name && url && kind === "(push)") remotes.set(name, url);
  }
  return remotes;
}

/** Upstream = the `upstream` remote, else the fork parent of origin, else origin. */
export function resolveUpstream(run: Runner, cwd: string, remotes: Map<string, string>): string | undefined {
  const named = githubSlug(remotes.get("upstream") ?? "");
  if (named) return named;
  const originSlug = githubSlug(remotes.get("origin") ?? "");
  if (!originSlug) return undefined;
  const jq = '.parent.owner.login + "/" + .parent.name';
  const parent = run("gh", ["repo", "view", originSlug, "--json", "parent", "--jq", jq], cwd);
  return parent.status === 0 && parent.stdout && parent.stdout !== "/" ? parent.stdout : originSlug;
}

function readContext(run: Runner, cwdIn: string): RepoContext | string {
  const top = run("git", ["rev-parse", "--show-toplevel"], cwdIn);
  if (top.status !== 0) return "Not inside a git checkout. cd into the repo you changed.";
  const cwd = top.stdout;
  const branch = run("git", ["branch", "--show-current"], cwd).stdout;
  if (!branch) return "Detached HEAD. Create a branch first: git switch -c fix/<short-name>";
  const login = run("gh", ["api", "user", "--jq", ".login"], cwd);
  if (login.status !== 0 || !login.stdout) return "GitHub CLI is not signed in. Run: gh auth login";
  const remotes = readRemotes(run, cwd);
  const upstream = resolveUpstream(run, cwd, remotes);
  if (!upstream) return "No GitHub remote found. Add one: git remote add origin <url>";
  return { cwd, branch, me: login.stdout, remotes, originSlug: githubSlug(remotes.get("origin") ?? ""), upstream };
}

/** Steps that fork upstream, wire the remotes, and return the remote to push to. */
function forkSteps(ctx: RepoContext): { steps: Step[]; pushRemote: string } {
  const forkSlug = `${ctx.me}/${ctx.upstream.split("/")[1]}`;
  const steps: Step[] = [
    {
      why: `Fork ${ctx.upstream} to ${ctx.me} (no-op when the fork exists)`,
      cmd: "gh",
      args: ["repo", "fork", ctx.upstream, "--clone=false", "--remote=false"],
    },
  ];
  const existing = [...ctx.remotes.entries()].find(
    ([, url]) => githubSlug(url)?.toLowerCase() === forkSlug.toLowerCase(),
  );
  let pushRemote = existing?.[0];
  if (!pushRemote) {
    pushRemote = ctx.remotes.has("fork") ? "contrib-fork" : "fork";
    steps.push({
      why: `Add your fork as the "${pushRemote}" remote`,
      cmd: "git",
      args: ["remote", "add", pushRemote, `https://github.com/${forkSlug}.git`],
    });
  }
  if (!ctx.remotes.has("upstream") && ctx.originSlug?.toLowerCase() !== ctx.upstream.toLowerCase()) {
    steps.push({
      why: `Add ${ctx.upstream} as the "upstream" remote`,
      cmd: "git",
      args: ["remote", "add", "upstream", `https://github.com/${ctx.upstream}.git`],
    });
  }
  return { steps, pushRemote };
}

function prCreateArgs(options: ContributeOptions, upstream: string, base: string, head: string): string[] {
  const args = ["pr", "create", "--repo", upstream, "--base", base, "--head", head];
  if (options.title && options.bodyFile) args.push("--title", options.title, "--body-file", options.bodyFile);
  else args.push("--fill");
  if (options.draft) args.push("--draft");
  return args;
}

/** The upstream base branch: --base, else the upstream default branch. */
function resolveBase(run: Runner, ctx: RepoContext, base?: string): string | { error: string } {
  if (base) return base;
  const jq = ".defaultBranchRef.name";
  const def = run("gh", ["repo", "view", ctx.upstream, "--json", "defaultBranchRef", "--jq", jq], ctx.cwd);
  if (def.status !== 0 || !def.stdout) return { error: `Cannot read ${ctx.upstream} on GitHub: ${def.stderr}` };
  return def.stdout;
}

function planSteps(ctx: RepoContext, options: ContributeOptions, base: string) {
  const direct = ctx.upstream.split("/")[0].toLowerCase() === ctx.me.toLowerCase();
  const head = direct ? ctx.branch : `${ctx.me}:${ctx.branch}`;
  const { steps, pushRemote } = direct ? { steps: [] as Step[], pushRemote: "origin" } : forkSteps(ctx);
  steps.push(
    { why: `Push ${ctx.branch} to ${pushRemote}`, cmd: "git", args: ["push", "-u", pushRemote, `HEAD:${ctx.branch}`] },
    {
      why: `Open a PR on ${ctx.upstream} (${base} <- ${head})`,
      cmd: "gh",
      args: prCreateArgs(options, ctx.upstream, base, head),
    },
  );
  return { mode: direct ? ("direct" as const) : ("fork" as const), head, steps };
}

/** Runs (or, on a dry run, prints) each step; returns the PR URL or the failure. */
function runSteps(run: Runner, cwd: string, steps: Step[], dryRun: boolean, log: (line: string) => void) {
  let prUrl: string | undefined;
  for (const step of steps) {
    log(`${dryRun ? "would run" : "run"}: ${step.cmd} ${step.args.join(" ")}  # ${step.why}`);
    if (dryRun) continue;
    const result = run(step.cmd, step.args, cwd);
    if (result.status !== 0) return { error: `${step.why} failed: ${result.stderr}` };
    if (step.cmd === "gh") prUrl = result.stdout.split("\n").pop();
  }
  return { prUrl };
}

export function contribute(options: ContributeOptions = {}): ContributeResult {
  if (Boolean(options.title) !== Boolean(options.bodyFile)) {
    return fail("Pass --title and --body-file together, or neither (the PR then uses your commit message).");
  }
  const run = options.run ?? defaultRunner;
  const log = options.log ?? ((line: string) => console.log(line));
  const ctx = readContext(run, options.cwd ?? process.cwd());
  if (typeof ctx === "string") return fail(ctx);
  const base = resolveBase(run, ctx, options.base);
  if (typeof base !== "string") return fail(base.error);
  if (ctx.branch === base) {
    return fail(`You are on ${base}. Commit your change on a branch first: git switch -c fix/<short-name>`);
  }

  const { mode, head, steps } = planSteps(ctx, options, base);
  log(`agentbrew contribute: ${mode} mode, ${ctx.upstream} <- ${head}`);
  const outcome = runSteps(run, ctx.cwd, steps, Boolean(options.dryRun), log);
  if (outcome.error) return { ok: false, mode, upstream: ctx.upstream, head, error: outcome.error };
  if (outcome.prUrl) log(`PR: ${outcome.prUrl}`);
  return { ok: true, mode, upstream: ctx.upstream, head, prUrl: outcome.prUrl };
}
