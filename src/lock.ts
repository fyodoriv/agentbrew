import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";
import { getGitHeadSha } from "./skills/skill-versions.js";
import type { Source } from "./types.js";
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

export interface LockFile {
  locked: LockEntry[];
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
    "# agentbrew.lock — auto-generated, records exact commit SHAs for the sources you have installed.\n# Note: these SHAs are tracked, not enforced. `agentbrew sync --pull` re-resolves sources to latest.\n# Use `agentbrew lock --verify` to check drift between the recorded SHA and what's on disk.\n\n";
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
