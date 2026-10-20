import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";
import { getGitHeadSha } from "./skills/skill-versions.js";
import type { Source, TeamConfig } from "./types.js";
import { ICON_ERROR, ICON_SUCCESS } from "./ui/output.js";

const LOCK_DIR = join(homedir(), ".config", "agentbrew");
const LOCK_FILE = join(LOCK_DIR, "agentbrew.lock");

export interface LockEntry {
  source: string;
  type: Source["type"];
  sha: string;
  skills: string[];
  lockedAt: string;
}

/** The team overlay pin: the full commit `team set` cloned. */
export interface TeamLockEntry {
  url: string;
  sha: string;
  lockedAt: string;
}

export interface LockFile {
  locked: LockEntry[];
  team?: TeamLockEntry;
}

export function readLock(): LockFile {
  if (!existsSync(LOCK_FILE)) return { locked: [] };

  try {
    const content = readFileSync(LOCK_FILE, "utf-8");
    const parsed = yaml.load(content) as LockFile | undefined;
    return parsed?.locked ? parsed : { locked: [] };
  } catch (e) {
    logSkipped("lock/load", e);
    return { locked: [] };
  }
}

export function writeLock(lock: LockFile): void {
  mkdirSync(dirname(LOCK_FILE), { recursive: true });
  const header =
    "# agentbrew.lock — auto-generated, records exact commit SHAs for the sources you have installed.\n# `agentbrew sync` refuses to deploy when a source drifts from its SHA. `agentbrew sync --pull` re-locks sources; `agentbrew team set` re-pins the team overlay.\n# Use `agentbrew lock --verify` to check drift between the recorded SHA and what's on disk.\n\n";
  const content = yaml.dump(lock, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  writeFileSync(LOCK_FILE, header + content, "utf-8");
}

/** Lock a source at a specific SHA after install. */
export function lockSource(source: Source, skillNames?: string[]): LockEntry | undefined {
  const sha = source.commitSha ?? getGitHeadSha(source);
  if (!sha) return undefined;

  const lock = readLock();
  const existing = lock.locked.find((entry) => entry.source === source.url);

  if (existing) {
    existing.sha = sha;
    existing.lockedAt = new Date().toISOString();
    if (skillNames) {
      for (const name of skillNames) {
        if (!existing.skills.includes(name)) {
          existing.skills.push(name);
        }
      }
    }
    writeLock(lock);
    return existing;
  }

  const entry: LockEntry = {
    source: source.url,
    type: source.type,
    sha,
    skills: skillNames ?? source.skillsInstalled ?? [],
    lockedAt: new Date().toISOString(),
  };
  lock.locked.push(entry);
  writeLock(lock);
  return entry;
}

/** Update the lock to latest SHA for a source (or all sources). */
export function updateLock(sources: Source[], sourceUrl?: string): UpdateLockResult[] {
  const lock = readLock();
  const results: UpdateLockResult[] = [];

  const targetEntries = sourceUrl ? lock.locked.filter((entry) => entry.source === sourceUrl) : lock.locked;

  for (const entry of targetEntries) {
    const source = sources.find((s) => s.url === entry.source);
    if (!source) {
      // A full update sees every installed source, so a missing one was removed.
      results.push({ source: entry.source, status: sourceUrl ? "not-found" : "pruned" });
      continue;
    }

    const newSha = getGitHeadSha(source);
    if (!newSha) {
      results.push({ source: entry.source, status: "error" });
      continue;
    }

    const oldSha = entry.sha;
    if (oldSha === newSha) {
      results.push({ source: entry.source, status: "up-to-date", sha: newSha });
      continue;
    }

    entry.sha = newSha;
    entry.lockedAt = new Date().toISOString();
    results.push({ source: entry.source, status: "updated", oldSha, sha: newSha });
  }

  const pruned = new Set(results.filter((r) => r.status === "pruned").map((r) => r.source));
  lock.locked = lock.locked.filter((entry) => !pruned.has(entry.source));
  writeLock(lock);
  return results;
}

export interface UpdateLockResult {
  source: string;
  status: "updated" | "up-to-date" | "not-found" | "pruned" | "error";
  oldSha?: string;
  sha?: string;
}

export interface VerifyResult {
  source: string;
  lockedSha: string;
  currentSha?: string;
  match: boolean;
  skills: string[];
}

/** Verify that all locked sources match their locked SHAs. */
export function verifyLock(sources: Source[]): VerifyResult[] {
  const lock = readLock();
  const results: VerifyResult[] = [];

  for (const entry of lock.locked) {
    const source = sources.find((s) => s.url === entry.source);
    if (!source) {
      results.push({
        source: entry.source,
        lockedSha: entry.sha,
        match: false,
        skills: entry.skills,
      });
      continue;
    }

    const currentSha = source.commitSha;
    results.push({
      source: entry.source,
      lockedSha: entry.sha,
      currentSha,
      match: currentSha === entry.sha,
      skills: entry.skills,
    });
  }

  return results;
}

/** Full HEAD commit of a local checkout, or undefined when it is not a git repo. */
export function gitHeadOf(dir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    }).trim();
  } catch (e) {
    logSkipped("lock/git-head", e);
    return undefined;
  }
}

/** Pin the team overlay at the commit `team set` cloned. */
export function lockTeam(url: string, sha: string): TeamLockEntry {
  const lock = readLock();
  lock.team = { url, sha, lockedAt: new Date().toISOString() };
  writeLock(lock);
  return lock.team;
}

/** Drop the team overlay pin (on `team unset`). */
export function unlockTeam(): void {
  const lock = readLock();
  if (!lock.team) return;
  delete lock.team;
  writeLock(lock);
}

export interface LockViolation {
  source: string;
  lockedSha: string;
  currentSha: string;
}

/**
 * Locked items that no longer match their pin.
 *
 * A source drifts when its recorded commit differs from the lock. A source
 * with no recorded commit is untracked, not drifted. The team overlay drifts
 * when its checkout HEAD differs from the pinned commit, or when the checkout
 * is gone.
 */
export function findLockViolations(sources: Source[], team?: TeamConfig): LockViolation[] {
  const violations: LockViolation[] = verifyLock(sources)
    .filter((r) => r.currentSha !== undefined && !r.match)
    .map((r) => ({ source: r.source, lockedSha: r.lockedSha, currentSha: r.currentSha as string }));

  const pin = readLock().team;
  if (pin && team?.path && team.url === pin.url) {
    const head = gitHeadOf(team.path) ?? "missing";
    if (head !== pin.sha) violations.push({ source: `team overlay ${pin.url}`, lockedSha: pin.sha, currentSha: head });
  }
  return violations;
}

/**
 * Fail closed when anything locked drifted: print each violation, set exit
 * code 1, and return true so the caller stops before it deploys.
 */
export function refuseLockDrift(sources: Source[], team?: TeamConfig): boolean {
  const violations = findLockViolations(sources, team);
  if (violations.length === 0) return false;
  console.error(chalk.red("\n✗ Sync stopped: these items no longer match agentbrew.lock"));
  for (const v of violations) {
    console.error(`  ${ICON_ERROR} ${v.source} — locked ${v.lockedSha.slice(0, 8)}, now ${v.currentSha.slice(0, 8)}`);
  }
  console.error(
    chalk.dim(
      "  Run `agentbrew sync --pull` to re-lock sources, or `agentbrew team set <url>` to re-pin the team overlay.\n",
    ),
  );
  process.exitCode = 1;
  return true;
}

/** Display lock file status. */
export function showLock(): void {
  const lock = readLock();

  if (lock.locked.length === 0) {
    console.log(chalk.dim("\nNo sources locked. Install skills to start tracking."));
    console.log(chalk.dim("  Run: agentbrew install <skill>\n"));
    return;
  }

  console.log(chalk.bold(`\nLock file (${lock.locked.length} source(s))\n`));

  for (const entry of lock.locked) {
    const shaShort = entry.sha.slice(0, 8);
    const skills = entry.skills.length > 0 ? chalk.dim(` (${entry.skills.join(", ")})`) : "";
    console.log(`  ${chalk.cyan(entry.source)} ${chalk.dim(`@${shaShort}`)}${skills}`);
    console.log(chalk.dim(`    locked: ${entry.lockedAt}`));
  }
  console.log();
}

/** Display lock verification results. */
export function showVerify(sources: Source[]): void {
  const results = verifyLock(sources);

  if (results.length === 0) {
    console.log(chalk.dim("\nNothing to verify — lock file is empty.\n"));
    return;
  }

  console.log(chalk.bold(`\nVerifying ${results.length} locked source(s)...\n`));

  let allMatch = true;
  for (const result of results) {
    if (result.match) {
      console.log(`  ${ICON_SUCCESS} ${result.source} — ${chalk.dim(`@${result.lockedSha.slice(0, 8)}`)}`);
    } else if (!result.currentSha) {
      allMatch = false;
      console.log(`  ${chalk.yellow("?")} ${result.source} — ${chalk.yellow("no version tracked")}`);
    } else {
      allMatch = false;
      console.error(`  ${ICON_ERROR} ${result.source} — ${chalk.red("SHA mismatch")}`);
      console.log(chalk.dim(`    locked: ${result.lockedSha.slice(0, 8)}  current: ${result.currentSha.slice(0, 8)}`));
    }
  }

  if (allMatch) {
    console.log(chalk.green("\n✓ All sources match their locked versions.\n"));
  } else {
    console.log(chalk.yellow("\n⚠ Some sources don't match. Run `agentbrew sync --pull` to re-lock.\n"));
  }
}
