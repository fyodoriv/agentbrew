/**
 * Per-repo classification (`solo` / `shared`) so downstream tools can scale
 * safety guards by repo class.
 *
 * Source: 2026-04-27 user incident — `safe-admin-merge.sh` blocked an admin
 * merge on a personal grind run because the rate-limit guard fires the same
 * way against solo personal repos as against shared-master organization repos.
 * agentbrew is the source of truth for the *machine-level* `state.team`
 * flag, but the granularity needed here is *per-repo* (the user can have
 * personal projects under `~/apps/` on an organization machine).
 *
 * **API surface**:
 *   - `getRepoClass(repoPath)` — classify a repo synchronously. Override file
 *     wins; otherwise auto-detect via `git log` committer count.
 *   - `setRepoClass(repoPath, "solo" | "shared")` — write an explicit override.
 *   - `unsetRepoClass(repoPath)` — remove the override (revert to auto-detect).
 *
 * **Default behaviour**: lazy / on-demand. No daemon, no sync-step. Callers
 * (minsky, scripts) consult the classifier as a passive lookup.
 *
 * **Auto-detection**: walk the repo's last-365-day committer set via
 * `git log --format='%aE' --since='1 year ago' | sort -u`. ≤1 unique
 * committer email → `solo`; ≥2 → `shared`. Cached per-process so repeated
 * lookups skip the `git log` cost.
 *
 * **Override file**: `~/.config/agentbrew/repo-class.yaml`, keyed by absolute
 * repo path. Format:
 *   ```yaml
 *   /Users/alice/apps/personal-fork: shared   # I want shared-repo norms
 *   /Users/alice/apps/example-app: shared  # explicit (auto-detect agrees)
 *   ```
 * Override always wins. Tests use `AGENTBREW_REPO_CLASS_PATH` to swap the
 * file location.
 *
 * Out of scope: changing how `safe-admin-merge` enforces the rate limit
 * (downstream concern); auto-classifying every repo on the machine at sync
 * time (lazy / on-demand only); building a UI for managing overrides
 * (CLI only).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";
import { expandHome } from "./utils.js";

/** Persistent override-file location. Tests swap via `AGENTBREW_REPO_CLASS_PATH`. */
const DEFAULT_OVERRIDE_PATH = "~/.config/agentbrew/repo-class.yaml";

/** Classification result. `unknown` is reserved for callers that need a
 *  three-state read; `getRepoClass()` always returns `solo` or `shared`. */
type RepoClass = "solo" | "shared" | "unknown";

/** Resolve the override file path, honoring the test env override. */
function overridePath(): string {
  return expandHome(process.env.AGENTBREW_REPO_CLASS_PATH ?? DEFAULT_OVERRIDE_PATH);
}

/** Per-process cache: absolute repo path → classification.
 *  Keyed AFTER the override+autodetect resolution so callers see one
 *  consistent answer per session. Reset between tests via `_resetRepoClassCacheForTests`. */
const cache = new Map<string, RepoClass>();

/** Test-only cache reset. Not exported in the public CLI surface. */
export function _resetRepoClassCacheForTests(): void {
  cache.clear();
}

/** Read the override file, returning a Record keyed by absolute repo path.
 *  Missing file → empty record. Malformed YAML → empty record + logSkipped. */
function readOverrideFile(): Record<string, RepoClass> {
  const path = overridePath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Filter to valid entries — silently drop anything that's not a string
    // mapping to "solo" or "shared". The CLI write path enforces this; a
    // hand-edited file with garbage shouldn't crash the lookup.
    const result: Record<string, RepoClass> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "solo" || value === "shared") {
        result[key] = value;
      }
    }
    return result;
  } catch (e) {
    logSkipped("repo-class/readOverrideFile", e);
    return {};
  }
}

/** Write the override file, creating parent dirs as needed. Atomic write. */
function writeOverrideFile(overrides: Record<string, RepoClass>): void {
  const path = overridePath();
  mkdirSync(dirname(path), { recursive: true });
  // Sort keys alphabetically so diffs are stable across writes from
  // different repos on different days. Empty file → empty mapping rather
  // than `{}` (more idiomatic YAML).
  const sortedKeys = Object.keys(overrides).sort();
  if (sortedKeys.length === 0) {
    writeFileSync(path, "", "utf-8");
    return;
  }
  const sorted: Record<string, RepoClass> = {};
  for (const key of sortedKeys) sorted[key] = overrides[key];
  writeFileSync(path, yaml.dump(sorted), "utf-8");
}

/**
 * Run `git log --format='%aE' --since='1 year ago'` in the repo to count
 * unique committer emails over the last year. Returns the count, or `null`
 * if the repo isn't a git repository (or git isn't available).
 *
 * Uses `--no-merges` so merge-commit re-attributions don't inflate the
 * count. Slice 1 of the user incident: a personal repo with 1 author + N
 * merge commits from CI bots would otherwise read as `shared`.
 */
function countUniqueCommittersLastYear(repoPath: string): number | null {
  try {
    const output = execFileSync("git", ["log", "--format=%aE", "--since=1 year ago", "--no-merges"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5_000,
    });
    const emails = new Set(
      output
        .split("\n")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    return emails.size;
  } catch (e) {
    logSkipped("repo-class/countUniqueCommittersLastYear", e);
    return null;
  }
}

/**
 * Classify a repo as `solo` (single-committer over the last year, no
 * shared-master risk surface) or `shared` (multi-engineer). Override file
 * always wins; otherwise auto-detect via `git log` committer count.
 *
 * Returns `solo` for non-git directories — the rate-limit guards that read
 * this classification are designed to relax on solo repos, and a non-git
 * directory has no shared-master surface to protect. If the caller needs
 * to distinguish "definitely solo" from "no git", they should call
 * `getRepoClassDetailed()` (returns `RepoClass | "unknown"`).
 *
 * Cached per-process per absolute path.
 */
export function getRepoClass(repoPath: string): "solo" | "shared" {
  const detailed = getRepoClassDetailed(repoPath);
  return detailed === "unknown" ? "solo" : detailed;
}

/**
 * Detailed classification. Like `getRepoClass()` but returns `unknown` for
 * directories that aren't git repositories (rather than collapsing to
 * `solo`). Use this when the caller wants to distinguish "definitely solo"
 * from "no git history available."
 */
export function getRepoClassDetailed(repoPath: string): RepoClass {
  const absolute = resolve(repoPath);
  const cached = cache.get(absolute);
  if (cached !== undefined) return cached;

  // Override always wins. Hand-edited overrides survive auto-detect drift.
  const overrides = readOverrideFile();
  const override = overrides[absolute];
  if (override !== undefined) {
    cache.set(absolute, override);
    return override;
  }

  // Auto-detect via `git log` committer count.
  const count = countUniqueCommittersLastYear(absolute);
  if (count === null) {
    cache.set(absolute, "unknown");
    return "unknown";
  }
  const klass: RepoClass = count <= 1 ? "solo" : "shared";
  cache.set(absolute, klass);
  return klass;
}

/**
 * Write an explicit classification override for a repo. Subsequent
 * `getRepoClass()` calls return this value, ignoring auto-detect. Use
 * to flip a personal fork from auto-detected `solo` to `shared` when the
 * fork should still inherit shared-repo norms (e.g. a personal fork of an
 * upstream repo with one committer that gets PRs from teammates).
 */
export function setRepoClass(repoPath: string, klass: "solo" | "shared"): void {
  const absolute = resolve(repoPath);
  const overrides = readOverrideFile();
  overrides[absolute] = klass;
  writeOverrideFile(overrides);
  cache.set(absolute, klass);
}

/**
 * Remove an explicit classification override for a repo. Subsequent
 * `getRepoClass()` calls revert to auto-detect.
 */
export function unsetRepoClass(repoPath: string): void {
  const absolute = resolve(repoPath);
  const overrides = readOverrideFile();
  if (!(absolute in overrides)) {
    cache.delete(absolute);
    return;
  }
  delete overrides[absolute];
  writeOverrideFile(overrides);
  cache.delete(absolute);
}
