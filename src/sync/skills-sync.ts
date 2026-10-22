import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import yaml from "js-yaml";
import { getSourceCacheDir } from "../catalog/index-source.js";
import { filterReadsFromAgents } from "../core/agents.js";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import { errorMessage } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import { findAgentbrewRepoRoot } from "../core/repo-root.js";
import { BACKUPS_DIR, INSTALLED_SKILLS_DIR } from "../paths.js";
import { pluginSkillDirs } from "../plugins/contributions.js";
import { loadState } from "../state.js";
import type { AgentConfig, SkillFeature, SkillSourceDir, Source, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS, DEFAULT_SUPPORTED_SKILL_FEATURES, VENDOR_NEUTRAL_SKILLS_DIR } from "../types.js";
import { expandHome } from "../utils.js";

interface SkillSource {
  label: string;
  path: string;
  scanner: (sourcePath: string) => string[];
  installedSkillNames?: Set<string>;
}

interface SourceSkillFilter {
  rootPath: string;
  installedSkillNames: Set<string>;
}

/** Carve-out: shared (per-entry skill predicate; isolating this keeps
 *  {@link scanSkillDirs} under biome's cognitive-complexity limit).
 *  Uses `statSync` (follows symlinks) so source layouts like
 *  trailofbits/skills — where `.codex/skills/<name>` is a relative symlink
 *  into `plugins/<plugin>/skills/<name>` — are recognized as skill entries.
 *  Broken symlinks throw from `statSync` and fall through to the catch. */
function isSkillEntry(entryPath: string): boolean {
  try {
    return statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"));
  } catch (e) {
    logSkipped("sync/skills-sync/isSkillEntry", e);
    return false;
  }
}

/** Read directory entries safely — returns [] on any error (missing dir, permission denied, etc.).
 *  Carve-out: shared (used by the deep-scan fallback in {@link scanSkillDirs}). */
function readDirEntriesSafe(dir: string): { isDirectory(): boolean; name: string }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }) ?? [];
  } catch (e) {
    logSkipped("sync/skills-sync/readDirEntriesSafe", e);
    return [];
  }
}

/** Carve-out: shared (per-entry filter for {@link deepScanSkillDirs}; isolating
 *  this keeps the outer scan under biome's cognitive-complexity limit). */
function isScanCandidate(entry: { isDirectory(): boolean; name: string }): boolean {
  if (!entry.isDirectory() || entry.name.startsWith(".")) return false;
  if (entry.name === "node_modules" || entry.name === "__pycache__") return false;
  return true;
}

/** Carve-out: shared (deep-scan fallback for non-standard skill layouts).
 *  Recursively find all directories containing SKILL.md anywhere in the tree.
 *  Skips node_modules, __pycache__, and hidden directories. Bounded by maxDepth
 *  (default 6) to avoid pathological deep trees. Mirrors the catalog code path
 *  in {@link "../catalog/index-source.ts" } `deepScanForSkills` — handles repo
 *  layouts where skills live at non-standard paths, e.g. team-skills' nested
 *  `teams/<team>/<skill>/SKILL.md` and `templates/<skill>/SKILL.md`. */
function deepScanSkillDirs(rootPath: string, maxDepth = 6): string[] {
  const results: string[] = [];
  const seenNames = new Set<string>();
  const queue: { dir: string; depth: number }[] = [{ dir: rootPath, depth: 0 }];

  for (let current = queue.shift(); current; current = queue.shift()) {
    if (current.depth > maxDepth) continue;
    for (const entry of readDirEntriesSafe(current.dir)) {
      if (!isScanCandidate(entry)) continue;
      const entryPath = join(current.dir, entry.name);
      if (existsSync(join(entryPath, "SKILL.md")) && !seenNames.has(entry.name)) {
        seenNames.add(entry.name);
        results.push(entryPath);
      }
      queue.push({ dir: entryPath, depth: current.depth + 1 });
    }
  }
  return results;
}

/** Carve-out: shared (default scanner used for every local + remote skill source).
 *  Scan for skill directories (each containing SKILL.md) at root and in skills/ subdir.
 *  Falls back to a recursive deep scan when neither location yields anything — needed
 *  for nested layouts like team-skills (`teams/<team>/<skill>/`, `templates/<skill>/`)
 *  and obs-as-code (`src/scaffold/<agent>/skills/<skill>/`). The same deep-scan
 *  fallback exists in `catalog/index-source.ts` `scanDirectoryForSkills`; both code
 *  paths agree on which directories count as a skill. */
function scanSkillDirs(sourcePath: string): string[] {
  if (!existsSync(sourcePath)) return [];
  const dirs = [sourcePath];
  const skillsSubdir = join(sourcePath, "skills");
  if (existsSync(skillsSubdir)) dirs.push(skillsSubdir);
  const seen = new Set<string>();
  const results: string[] = [];
  try {
    for (const dir of dirs) {
      for (const entry of readdirSync(dir)) {
        if (seen.has(entry)) continue;
        const entryPath = join(dir, entry);
        if (isSkillEntry(entryPath)) {
          seen.add(entry);
          results.push(entryPath);
        }
      }
    }
  } catch (e) {
    logSkipped("sync/skills-sync/scanSkillDirs/readdir", e);
  }
  // Deep-scan fallback: only when standard locations found nothing. This avoids
  // double-discovering skills for repos with the standard root/skills layout
  // while still finding skills in repos like team-skills (nested under teams/).
  if (results.length === 0) {
    return deepScanSkillDirs(sourcePath);
  }
  return results;
}

/** Carve-out: shared (legacy `format: tasks-md` source layout — read by every
 *  carve-out's deploy phase regardless of which agent owns the source dir). */
function scanTasksMdSkills(commandsDir: string): string[] {
  if (!existsSync(commandsDir)) return [];
  const skills: string[] = [];
  try {
    for (const agentDir of readdirSync(commandsDir)) {
      const skillsPath = join(commandsDir, agentDir, "skills");
      if (!existsSync(skillsPath)) continue;
      for (const skill of readdirSync(skillsPath)) {
        const skillPath = join(skillsPath, skill);
        try {
          // statSync follows symlinks — matches the trailofbits fix in isSkillEntry.
          if (statSync(skillPath).isDirectory()) {
            skills.push(skillPath);
          }
        } catch (e) {
          logSkipped("sync/skills-sync/push", e);
          // skip unreadable
        }
      }
    }
  } catch (e) {
    logSkipped("sync/skills-sync/scanTasksMdSkills/readdir", e);
    // commands dir not readable
  }
  return skills;
}

function normalizedPath(path: string): string {
  return resolve(expandHome(path)).replace(/\/+$/, "");
}

function isWithinPath(path: string, rootPath: string): boolean {
  const normalized = normalizedPath(path);
  const root = normalizedPath(rootPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

function sourceRootPath(source: Source): string {
  return source.type === "local" ? expandHome(source.url) : getSourceCacheDir(source);
}

function buildSourceSkillFilters(sources: Source[]): SourceSkillFilter[] {
  return sources.map((source) => ({
    rootPath: sourceRootPath(source),
    installedSkillNames: new Set(source.skillsInstalled),
  }));
}

function filterForPath(path: string, filters: SourceSkillFilter[]): Set<string> | undefined {
  let matched: SourceSkillFilter | undefined;
  for (const filter of filters) {
    if (!isWithinPath(path, filter.rootPath)) continue;
    if (!matched || normalizedPath(filter.rootPath).length > normalizedPath(matched.rootPath).length) {
      matched = filter;
    }
  }
  return matched?.installedSkillNames;
}

function selectedSkillPaths(skillPaths: string[], installedSkillNames: Set<string> | undefined): string[] {
  if (!installedSkillNames) return skillPaths;
  return skillPaths.filter((skillPath) => installedSkillNames.has(basename(skillPath)));
}

function allInstalledSkillNames(sources: Source[]): Set<string> {
  return new Set(sources.flatMap((source) => source.skillsInstalled));
}

function legacyInstalledSkillNames(
  path: string,
  filters: SourceSkillFilter[],
  sources: Source[],
): Set<string> | undefined {
  if (isWithinPath(path, INSTALLED_SKILLS_DIR)) return allInstalledSkillNames(sources);
  return filterForPath(path, filters);
}

/** Carve-out: shared (returns the same source list for every carve-out's
 *  deploy phase; per-agent filtering happens later in {@link buildDeployTargets}). */
export function getSkillSources(): SkillSource[] {
  const agentBrewDir =
    process.env.AGENTBREW_DIR ??
    findAgentbrewRepoRoot("skill-plugins/dev") ??
    resolve(join(import.meta.dirname, "..", ".."));
  const state = loadState();
  const stateSources = state?.sources ?? [];
  const sourceFilters = buildSourceSkillFilters(stateSources);
  const localSources: SkillSource[] = stateSources
    .filter((s) => s.type === "local")
    .map((s) => ({
      label: basename(s.url),
      path: expandHome(s.url),
      scanner: scanSkillDirs,
      installedSkillNames: new Set(s.skillsInstalled),
    }));
  const legacySources: SkillSource[] = (state?.skillSourceDirs ?? []).map((dir: SkillSourceDir) => ({
    label: dir.label,
    path: expandHome(dir.path),
    scanner: dir.format === "tasks-md" ? scanTasksMdSkills : scanSkillDirs,
    installedSkillNames: legacyInstalledSkillNames(dir.path, sourceFilters, stateSources),
  }));
  // Deduplicate by path — local sources take precedence over legacy
  const seenPaths = new Set(localSources.map((s) => s.path));
  const uniqueLegacy = legacySources.filter((s) => !seenPaths.has(s.path));
  const builtIn: SkillSource = {
    label: "agentbrew",
    path: join(agentBrewDir, "skill-plugins", "dev"),
    scanner: scanSkillDirs,
  };
  // v2 plugin skill dirs come from the lock on every sync, never from state (#208).
  const pluginSources: SkillSource[] = pluginSkillDirs().map((d) => ({ ...d, scanner: scanSkillDirs }));
  // User sources first (higher priority), then plugins, then built-in
  return [...localSources, ...uniqueLegacy, ...pluginSources, builtIn];
}

/** Carve-out: shared (per-entry user-data preserver; isolating this keeps
 *  {@link cleanSymlinks} under biome's cognitive-complexity limit).
 *  Removes broken/agentbrew-managed symlinks and `.agentbrew-filtered`-marked
 *  directories; preserves user-created symlinks pointing at non-source paths. */
function cleanEntry(entryPath: string, directory: string, knownSourcePaths: Set<string>): boolean {
  try {
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = readlinkSync(entryPath);
      const resolvedTarget = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(join(directory, linkTarget));
      if (knownSourcePaths.has(resolvedTarget) || !existsSync(resolvedTarget)) {
        unlinkSync(entryPath);
        return true;
      }
    } else if (stat.isDirectory() && existsSync(join(entryPath, ".agentbrew-filtered"))) {
      rmSync(entryPath, { recursive: true });
      return true;
    }
  } catch (e) {
    logSkipped("sync/skills-sync/cleanEntry", e);
  }
  return false;
}

/** Carve-out: shared (every carve-out's skillsDir is swept by this before redeploy). */
function cleanSymlinks(directory: string, knownSourcePaths: Set<string>): number {
  if (!existsSync(directory)) return 0;
  let removed = 0;
  try {
    for (const entry of readdirSync(directory)) {
      if (cleanEntry(join(directory, entry), directory, knownSourcePaths)) removed++;
    }
  } catch (e) {
    logSkipped("sync/skills-sync/cleanSymlinks", e);
  }
  return removed;
}

/** Carve-out: shared (single-dir broken-symlink sweeper; used by both detected
 *  carve-outs at apply time and the global post-sync sweep below). */
function removeBrokenSymlinksFromDir(skillsDir: string): number {
  let removed = 0;
  try {
    for (const entry of readdirSync(skillsDir)) {
      const entryPath = join(skillsDir, entry);
      try {
        if (!lstatSync(entryPath).isSymbolicLink()) continue;
        const linkTarget = readlinkSync(entryPath);
        const resolvedTarget = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(join(skillsDir, linkTarget));
        if (!existsSync(resolvedTarget)) {
          unlinkSync(entryPath);
          removed++;
        }
      } catch (e) {
        logSkipped("sync/skills-sync/removeBrokenSymlinksFromDir/unlink", e);
      }
    }
  } catch (e) {
    logSkipped("sync/skills-sync/removeBrokenSymlinksFromDir/readdir", e);
  }
  return removed;
}

/**
 * Carve-out: shared (sweeps every detected + non-detected agent's skillsDir,
 * including former carve-outs the user has uninstalled). Exported for
 * `src/repair.ts` to share this implementation instead of duplicating it.
 *
 * Issue 3/4 of `sync-idempotent-and-complete`: a regular `sync` used to
 * ignore stale symlinks in dirs of uninstalled agents and hand them off
 * to `status --fix`. Calling this at the tail of `syncSkills` closes that
 * gap so `sync` converges to zero drift in one pass.
 */
export function cleanBrokenSymlinksGlobally(): number {
  const targets = AGENT_DEFINITIONS.filter((a) => existsSync(expandHome(a.skillsDir))).map((a) =>
    expandHome(a.skillsDir),
  );
  const vendorNeutral = expandHome(VENDOR_NEUTRAL_SKILLS_DIR);
  if (existsSync(vendorNeutral)) targets.push(vendorNeutral);

  let removed = 0;
  for (const skillsDir of targets) {
    removed += removeBrokenSymlinksFromDir(skillsDir);
  }
  return removed;
}

// ── Pure types ──────────────────────────────────────────────────────────────

interface CollectedSkill {
  name: string;
  sourcePath: string;
  sourceLabel: string;
  /** Features declared in SKILL.md frontmatter. Empty for "basic" skills. */
  features: SkillFeature[];
}

interface SkillSkipped {
  name: string;
  /** Human-readable reason, e.g. `unsupported feature: hooks`. */
  reason: string;
  /** Machine-readable list of features this agent does not support. */
  missingFeatures: SkillFeature[];
}

interface SkillTargetDiff {
  label: string;
  skillsDir: string;
  symlinks: Array<{ name: string; sourcePath: string }>;
  /** Skills not deployed to this target because the agent does not support
   *  one or more features the skill declares. Surfaced in status output so
   *  users see why a skill is missing instead of treating it as a silent bug. */
  skipped: SkillSkipped[];
}

/** A real directory where sync puts a managed skill symlink. It holds a
 *  SKILL.md, so it is a copy of the skill, and agents load the copy instead
 *  of the source (#366). */
export interface SkillCopy {
  /** Deploy target: an agent name, or `.agents` for `~/.agents/skills`. */
  label: string;
  name: string;
  /** The copy: `<skillsDir>/<name>`. */
  path: string;
  sourcePath: string;
}

/** A skill copy that sync moved into the backups folder. */
export interface ReplacedSkillCopy extends SkillCopy {
  backupPath: string;
}

export interface SkillsSyncResult {
  agentCount: number;
  skillCount: number;
  bySource: Record<string, number>;
  vendorNeutral: boolean;
  /** Per-target skip lists — mirrors SkillTargetDiff.skipped. Empty when no
   *  skill/agent pair triggers a compatibility miss. */
  skipped: Record<string, SkillSkipped[]>;
  /** Skill copies this run moved to the backups folder and replaced with the
   *  managed symlink. */
  replacedCopies: ReplacedSkillCopy[];
}

// ── Pure functions (no I/O, trivially testable) ─────────────────────────────

/** Carve-out: shared (frontmatter parser feeding {@link missingAgentFeatures}).
 *  Skills without explicit features deploy everywhere. */
export function extractFrontmatterFeatures(frontmatter: Record<string, unknown> | null | undefined): SkillFeature[] {
  if (!frontmatter || typeof frontmatter !== "object") return [];
  const features: SkillFeature[] = [];
  if (frontmatter["allowed-tools"] !== undefined) features.push("allowed-tools");
  const context = frontmatter.context;
  // Skills CLI matrix uses `context: fork` (string). Also accept an array
  // containing "fork" for forward-compat with richer context syntaxes.
  if (context === "fork" || (Array.isArray(context) && context.includes("fork"))) {
    features.push("context-fork");
  }
  if (frontmatter.hooks !== undefined) features.push("hooks");
  return features;
}

/** Carve-out: shared (compatibility-matrix lookup; `undefined` agent support
 *  treated as the {@link DEFAULT_SUPPORTED_SKILL_FEATURES} baseline). */
export function missingAgentFeatures(
  skillFeatures: readonly SkillFeature[],
  agentSupported: readonly SkillFeature[] | undefined,
): SkillFeature[] {
  const supported = new Set(agentSupported ?? DEFAULT_SUPPORTED_SKILL_FEATURES);
  return skillFeatures.filter((feat) => !supported.has(feat));
}

/** Carve-out: shared (deduplicates skills from pre-scanned sources;
 *  first source wins. `featuresByPath` absent → every skill is feature-free). */
export function collectSkills(
  scannedSources: Array<{ label: string; skillPaths: string[] }>,
  featuresByPath?: Map<string, SkillFeature[]>,
): {
  skills: Map<string, CollectedSkill>;
  bySource: Record<string, number>;
} {
  const skills = new Map<string, CollectedSkill>();
  const bySource: Record<string, number> = {};

  for (const source of scannedSources) {
    for (const skillPath of source.skillPaths) {
      const name = basename(skillPath);
      if (!skills.has(name)) {
        skills.set(name, {
          name,
          sourcePath: skillPath,
          sourceLabel: source.label,
          features: featuresByPath?.get(skillPath) ?? [],
        });
        bySource[source.label] = (bySource[source.label] ?? 0) + 1;
      }
    }
  }

  return { skills, bySource };
}

/** Carve-out: shared (per-target symlink plan; skills declaring a feature
 *  the target agent doesn't support are routed to `skipped` not `symlinks`). */
export function computeSkillsDiff(
  filteredSkills: Map<string, CollectedSkill>,
  targets: Array<{ label: string; skillsDir: string; supportedSkillFeatures?: SkillFeature[] }>,
): SkillTargetDiff[] {
  return targets.map((target) => {
    const symlinks: Array<{ name: string; sourcePath: string }> = [];
    const skipped: SkillSkipped[] = [];
    for (const [name, skill] of filteredSkills.entries()) {
      const missing = missingAgentFeatures(skill.features, target.supportedSkillFeatures);
      if (missing.length === 0) {
        symlinks.push({ name, sourcePath: skill.sourcePath });
      } else {
        const suffix = missing.length === 1 ? "feature" : "features";
        skipped.push({
          name,
          reason: `unsupported ${suffix}: ${missing.join(", ")}`,
          missingFeatures: missing,
        });
      }
    }
    return { label: target.label, skillsDir: target.skillsDir, symlinks, skipped };
  });
}

/** Carve-out: shared (sync-options unpacker). */
function parseSyncConfig(
  options?: SyncOptions,
  ctx?: Partial<Context>,
): { quiet: boolean; verbose: boolean; dryRun: boolean; log: Logger } {
  const quiet = options?.quiet ?? false;
  const verbose = options?.verbose ?? false;
  const dryRun = options?.dryRun ?? false;
  const log = ctx?.logger ?? createContext({ quiet, compact: options?.compact }).logger;
  return { quiet, verbose, dryRun, log };
}

/** Carve-out: shared (copy predicate for sync and `status`). True when
 *  `dest` is a real directory with a SKILL.md and is not a skill source
 *  itself. A directory without SKILL.md is the user's own data and stays. */
function isSkillCopy(dest: string, sourcePath: string, knownSourcePaths: Set<string>): boolean {
  if (!existsSync(sourcePath) || !existsSync(join(dest, "SKILL.md"))) return false;
  try {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    const realDest = realpathSync(dest);
    if (knownSourcePaths.has(resolve(dest)) || knownSourcePaths.has(realDest)) return false;
    const realSource = realpathSync(sourcePath);
    return !isWithinPath(realSource, realDest) && !isWithinPath(realDest, realSource);
  } catch (e) {
    logSkipped("sync/skills-sync/isSkillCopy", e);
    return false;
  }
}

/** Carve-out: shared (moves a skill copy into the backups folder so sync can
 *  link the source in its place; nothing is deleted). */
function backUpSkillCopy(dest: string, backupPath: string): void {
  mkdirSync(dirname(backupPath), { recursive: true });
  try {
    renameSync(dest, backupPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    cpSync(dest, backupPath, { recursive: true, verbatimSymlinks: true });
    rmSync(dest, { recursive: true });
  }
}

/** Where one sync run moves skill copies: `<backups>/skill-copies/<stamp>`. */
interface CopyBackups {
  root: string;
  replaced: ReplacedSkillCopy[];
}

/** Carve-out: shared (collision resolver — protects user-created entries in
 *  every carve-out's skillsDir before we redeploy). */
function resolveExistingDest(
  dest: string,
  symlink: { name: string; sourcePath: string },
  skillsDir: string,
  knownSourcePaths: Set<string>,
): "replaced" | "copy" | "skip-symlink" | "skip-directory" | "none" {
  if (!existsSync(dest)) return "none";
  const destStat = lstatSync(dest);
  if (destStat.isSymbolicLink()) {
    const linkTarget = readlinkSync(dest);
    const resolvedTarget = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(join(skillsDir, linkTarget));
    if (knownSourcePaths.has(resolvedTarget)) {
      unlinkSync(dest);
      return "replaced";
    }
    return "skip-symlink";
  }
  if (destStat.isDirectory()) {
    return isSkillCopy(dest, symlink.sourcePath, knownSourcePaths) ? "copy" : "skip-directory";
  }
  return "none";
}

/** Carve-out: shared (per-symlink writer; called for every carve-out's diff entry). */
function deploySymlinkEntry(
  symlink: { name: string; sourcePath: string },
  diff: SkillTargetDiff,
  knownSourcePaths: Set<string>,
  backups: CopyBackups,
  options: { verbose: boolean; log: Logger },
): "deployed" | "failed" | "skipped" {
  const { verbose, log } = options;
  const dest = join(diff.skillsDir, symlink.name);
  if (!existsSync(symlink.sourcePath)) {
    if (verbose) {
      log.log(`  ${log.yellow("!")} ${diff.label}: skipping ${symlink.name} (source missing)`);
    }
    return "skipped";
  }
  try {
    const resolution = resolveExistingDest(dest, symlink, diff.skillsDir, knownSourcePaths);
    if (resolution === "skip-symlink" || resolution === "skip-directory") {
      if (verbose) {
        const reason = resolution === "skip-symlink" ? "user-created symlink" : "user-created directory";
        log.log(`  ⚠ ${diff.label}: skipping ${symlink.name} (${reason})`);
      }
      return "skipped";
    }
    if (resolution === "copy") {
      const backupPath = join(backups.root, diff.label, symlink.name);
      backUpSkillCopy(dest, backupPath);
      backups.replaced.push({
        label: diff.label,
        name: symlink.name,
        path: dest,
        sourcePath: symlink.sourcePath,
        backupPath,
      });
    }
    symlinkSync(symlink.sourcePath, dest);
    return "deployed";
  } catch (err) {
    const message = errorMessage(err);
    log.log(`  ${log.red("✗")} Failed to deploy skill ${symlink.name} to ${dest}: ${message}`);
    return "failed";
  }
}

/** Carve-out: shared (per-target deploy loop — runs once for each detected
 *  carve-out's SkillTargetDiff). */
function deployDiffTarget(
  diff: SkillTargetDiff,
  knownSourcePaths: Set<string>,
  backups: CopyBackups,
  options: { quiet: boolean; verbose: boolean; dryRun: boolean; log: Logger },
): { label: string; deployed: number; failed: number; skipped: number } {
  const { quiet, verbose, dryRun, log } = options;
  if (!dryRun) {
    try {
      mkdirSync(diff.skillsDir, { recursive: true });
      cleanSymlinks(diff.skillsDir, knownSourcePaths);
    } catch (error) {
      if (!quiet) log.log(`  ${log.red("✗")} ${diff.label}: cannot create skills dir — ${errorMessage(error)}`);
      return { label: diff.label, deployed: 0, failed: 1, skipped: 0 };
    }
  }
  let deployed = 0;
  let failed = 0;
  let skipped = 0;
  for (const symlink of diff.symlinks) {
    if (dryRun) {
      deployed++;
      continue;
    }
    const result = deploySymlinkEntry(symlink, diff, knownSourcePaths, backups, { verbose, log });
    if (result === "deployed") deployed++;
    else if (result === "failed") failed++;
    else skipped++;
  }
  return { label: diff.label, deployed, failed, skipped };
}

/** Carve-out: shared (per-carve-out summary line for the sync log). */
function formatTargetLine(
  result: { deployed: number; failed: number; skipped: number; label: string; incompatible?: number },
  verbose: boolean,
  dryRun: boolean,
  log: Logger,
): string | null {
  const hasChanges = result.deployed > 0 || result.failed > 0 || (result.incompatible ?? 0) > 0;
  if (!verbose && !hasChanges) return null;
  const failedSuffix = result.failed > 0 ? ` (${result.failed} failed)` : "";
  const skippedSuffix = result.skipped > 0 ? ` (${result.skipped} user-owned, skipped)` : "";
  const incompatibleSuffix = (result.incompatible ?? 0) > 0 ? ` (${result.incompatible} incompatible, skipped)` : "";
  const icon = dryRun ? log.blue("~") : log.green("✓");
  return `  ${icon} ${result.label}: ${result.deployed} skills${failedSuffix}${skippedSuffix}${incompatibleSuffix}`;
}

/** Carve-out: shared (skill-path → declared-features map fed to {@link computeSkillsDiff}). */
function buildFeatureMap(scannedSources: Array<{ label: string; skillPaths: string[] }>): Map<string, SkillFeature[]> {
  const map = new Map<string, SkillFeature[]>();
  for (const source of scannedSources) {
    for (const skillPath of source.skillPaths) {
      const features = readSkillFeatures(skillPath);
      if (features.length > 0) map.set(skillPath, features);
    }
  }
  return map;
}

/** Carve-out: shared (per-skill frontmatter loader; malformed → empty so a
 *  bad skill does not block the sync). */
function readSkillFeatures(skillPath: string): SkillFeature[] {
  const skillMd = join(skillPath, "SKILL.md");
  if (!existsSync(skillMd)) return [];
  try {
    const content = readFileSync(skillMd, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) return [];
    const parsed = yaml.load(fmMatch[1]) as Record<string, unknown> | null | undefined;
    return extractFrontmatterFeatures(parsed);
  } catch (e) {
    logSkipped("sync/skills-sync/readSkillFeatures", e);
    return [];
  }
}

/** Carve-out: shared (final summary line covering every carve-out + sources). */
function logSyncSummary(
  bySource: Record<string, number>,
  allSkillsSize: number,
  targetCount: number,
  dryRun: boolean,
  log: Logger,
): void {
  const sourceBreakdown = Object.entries(bySource)
    .map(([label, count]) => `${count} from ${label}`)
    .join(", ");
  const summaryIcon = dryRun ? log.blue("~") : log.green("✓");
  const verb = dryRun ? "Would deploy" : "Deployed";
  log.log(`\n${summaryIcon} ${verb} ${allSkillsSize} skills to ${targetCount} targets (${sourceBreakdown})`);
}

interface DeployTarget {
  label: string;
  skillsDir: string;
  supportedSkillFeatures?: SkillFeature[];
}

/** Carve-out: shared (filters AGENT_DEFINITIONS to detected carve-outs +
 *  any non-delegated agents that still receive native sync writes). */
function resolveDetectedAgents(
  stateAgents: Array<{ name: string; detected: boolean }>,
): Omit<AgentConfig, "detected">[] {
  const detectedNames = new Set(stateAgents.filter((a) => a.detected).map((a) => a.name));
  if (detectedNames.size > 0) {
    return AGENT_DEFINITIONS.filter((agent) => detectedNames.has(agent.name));
  }
  return AGENT_DEFINITIONS.filter((agent) => {
    const parentDir = join(expandHome(agent.skillsDir), "..");
    return existsSync(parentDir);
  });
}

/** Carve-out: shared (one DeployTarget per detected carve-out + the optional
 *  vendor-neutral `~/.agents/skills/` superset target — declares all features
 *  supported so nothing is needlessly skipped at the symlink-fan-out layer). */
function buildDeployTargets(
  filteredAgents: Omit<AgentConfig, "detected">[],
  vendorNeutralEnabled: boolean,
): DeployTarget[] {
  const targets: DeployTarget[] = filteredAgents.map((agent) => ({
    label: agent.name,
    skillsDir: expandHome(agent.skillsDir),
    supportedSkillFeatures: agent.supportedSkillFeatures,
  }));
  if (vendorNeutralEnabled) {
    targets.push({
      label: ".agents",
      skillsDir: expandHome(VENDOR_NEUTRAL_SKILLS_DIR),
      supportedSkillFeatures: ["allowed-tools", "context-fork", "hooks"],
    });
  }
  return targets;
}

interface SkillsPlan {
  detectedAgents: Omit<AgentConfig, "detected">[];
  allSkills: Map<string, CollectedSkill>;
  bySource: Record<string, number>;
  deployTargets: DeployTarget[];
  vendorNeutralEnabled: boolean;
  diffs: SkillTargetDiff[];
  /** Every scanned skill source path, so sync can tell its own symlinks apart. */
  knownSourcePaths: Set<string>;
}

/** Carve-out: shared (read and pure diff phases of {@link syncSkills};
 *  {@link findSkillCopies} reuses them, so `status` checks the same targets
 *  sync writes). Returns null when no agent is detected. */
function planSkillsSync(stateAgents: Array<{ name: string; detected: boolean }>): SkillsPlan | null {
  const sources = getSkillSources();
  const detectedAgents = resolveDetectedAgents(stateAgents);
  if (detectedAgents.length === 0) return null;

  const rawScannedSources = sources.map((source) => ({
    label: source.label,
    skillPaths: source.scanner(source.path),
    installedSkillNames: source.installedSkillNames,
  }));

  const scannedSources = rawScannedSources.map((source) => ({
    label: source.label,
    skillPaths: selectedSkillPaths(source.skillPaths, source.installedSkillNames),
  }));

  // Read SKILL.md feature declarations (allowed-tools / context-fork / hooks)
  // so computeSkillsDiff can route incompatible skills to the `skipped` list
  // per the vercel-labs/skills compatibility matrix.
  const featuresByPath = buildFeatureMap(scannedSources);

  const { skills: allSkills, bySource } = collectSkills(scannedSources, featuresByPath);

  const filteredAgentNames = new Set(detectedAgents.map((a) => a.name));
  const filteredAgents = filterReadsFromAgents(detectedAgents, filteredAgentNames);

  const vendorNeutralEnabled = process.env.AGENTBREW_VENDOR_NEUTRAL !== "0";
  const deployTargets = buildDeployTargets(filteredAgents, vendorNeutralEnabled);

  const diffs = computeSkillsDiff(allSkills, deployTargets);

  // Collect all known skill source paths so cleanSymlinks can identify agentbrew-managed symlinks
  const knownSourcePaths = new Set<string>();
  for (const source of rawScannedSources) {
    for (const skillPath of source.skillPaths) {
      knownSourcePaths.add(resolve(skillPath));
    }
  }

  return { detectedAgents, allSkills, bySource, deployTargets, vendorNeutralEnabled, diffs, knownSourcePaths };
}

/** Carve-out: shared (every skill copy in the plan's deploy targets). */
function copiesInPlan(plan: SkillsPlan): SkillCopy[] {
  const copies: SkillCopy[] = [];
  for (const diff of plan.diffs) {
    for (const { name, sourcePath } of diff.symlinks) {
      const path = join(diff.skillsDir, name);
      if (isSkillCopy(path, sourcePath, plan.knownSourcePaths)) {
        copies.push({ label: diff.label, name, path, sourcePath });
      }
    }
  }
  return copies;
}

/** Carve-out: shared (every skill copy that stands where sync puts a managed
 *  symlink, in every deploy target). `status` reports them as skills drift;
 *  `sync` moves them to the backups folder and links the source (#366). */
export function findSkillCopies(): SkillCopy[] {
  const plan = planSkillsSync(loadState()?.agents ?? []);
  return plan ? copiesInPlan(plan) : [];
}

/** Carve-out: shared (tells the user about every skill copy sync moved, or
 *  would move in a dry run. A warning, so compact `sync` output shows it too:
 *  it changes the skill text agents load). */
function logSkillCopies(plan: SkillsPlan, backups: CopyBackups, dryRun: boolean, log: Logger): void {
  if (dryRun) {
    for (const copy of copiesInPlan(plan)) {
      log.warn(
        `  ~ ${copy.label}: ${copy.name} is a copy; sync would move it to the backups folder and link the source`,
      );
    }
    return;
  }
  for (const copy of backups.replaced) {
    log.warn(`  ↻ ${copy.label}: ${copy.name} was a copy; moved it to ${copy.backupPath} and linked the source`);
  }
}

/** Carve-out: shared (entry-point orchestrator; per-carve-out branching is
 *  data-driven via {@link buildDeployTargets}). */
export async function syncSkills(options?: SyncOptions, ctx?: Partial<Context>): Promise<SkillsSyncResult> {
  const { quiet, verbose, dryRun, log } = parseSyncConfig(options, ctx);

  // ── Read and pure diff phases ───────────────────────────────────────────
  const _state = ctx?.state ? ctx.state.load() : loadState();
  const plan = planSkillsSync(_state?.agents ?? []);

  if (!plan) {
    if (!quiet) log.warn("No agents detected — skipping skills sync.");
    return { agentCount: 0, skillCount: 0, bySource: {}, vendorNeutral: false, skipped: {}, replacedCopies: [] };
  }
  const { detectedAgents, allSkills, bySource, deployTargets, vendorNeutralEnabled, diffs, knownSourcePaths } = plan;

  // ── Apply phase ─────────────────────────────────────────────────────────
  if (!quiet) {
    log.log(log.bold("\nSkills sync\n"));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups: CopyBackups = { root: join(expandHome(BACKUPS_DIR), "skill-copies", stamp), replaced: [] };
  const targetResults = diffs.map((diff) => {
    const base = deployDiffTarget(diff, knownSourcePaths, backups, { quiet, verbose, dryRun, log });
    return { ...base, incompatible: diff.skipped.length };
  });

  const skippedByTarget: Record<string, SkillSkipped[]> = {};
  for (const diff of diffs) {
    if (diff.skipped.length > 0) skippedByTarget[diff.label] = diff.skipped;
  }

  sweepBrokenSymlinksPostSync({ dryRun, verbose, log });

  if (!quiet) {
    logSkillCopies(plan, backups, dryRun, log);
    logSyncOutput({
      targetResults,
      diffs,
      bySource,
      allSkillsSize: allSkills.size,
      targetCount: deployTargets.length,
      verbose,
      dryRun,
      log,
    });
  }

  return {
    agentCount: detectedAgents.length,
    skillCount: allSkills.size,
    bySource,
    vendorNeutral: vendorNeutralEnabled,
    skipped: skippedByTarget,
    replacedCopies: backups.replaced,
  };
}

interface LogSyncOutputOpts {
  targetResults: Array<{ deployed: number; failed: number; skipped: number; label: string; incompatible?: number }>;
  diffs: SkillTargetDiff[];
  bySource: Record<string, number>;
  allSkillsSize: number;
  targetCount: number;
  verbose: boolean;
  dryRun: boolean;
  log: Logger;
}

/** Carve-out: shared (verbose-aware sync output dispatcher; extracted to keep
 *  {@link syncSkills} under biome's cognitive-complexity limit). */
function logSyncOutput(opts: LogSyncOutputOpts): void {
  const { targetResults, diffs, bySource, allSkillsSize, targetCount, verbose, dryRun, log } = opts;
  for (const result of targetResults) {
    const line = formatTargetLine(result, verbose, dryRun, log);
    if (line) log.log(line);
  }
  if (verbose) {
    for (const diff of diffs) {
      for (const entry of diff.skipped) {
        log.log(`  ${log.yellow("~")} ${diff.label}: skipping ${entry.name} (${entry.reason})`);
      }
    }
  }
  logSyncSummary(bySource, allSkillsSize, targetCount, dryRun, log);
}

/** Carve-out: shared (post-sync global broken-symlink sweep — issue 3/4 of
 *  `sync-idempotent-and-complete`: covers former-carve-out skill dirs too,
 *  so `sync` converges to zero drift in one pass without `status --fix`). */
function sweepBrokenSymlinksPostSync(options: { dryRun: boolean; verbose: boolean; log: Logger }): void {
  if (options.dryRun) return;
  const globallyRemoved = cleanBrokenSymlinksGlobally();
  if (globallyRemoved > 0 && options.verbose) {
    options.log.log(options.log.dim(`  ✓ cleaned ${globallyRemoved} broken symlink(s) from non-synced agent dirs`));
  }
}
