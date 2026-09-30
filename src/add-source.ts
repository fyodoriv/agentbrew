import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { getStateSources } from "./agentfile.js";
import { formatItemCounts, getSourceCachePath, indexSource } from "./catalog/index-source.js";
import {
  AGENTBREW_ONLY_AGENTS,
  AGENTBREW_ONLY_AGENTS_RATIONALE,
  buildSkillsCliAgentArgs,
} from "./core/agent-name-map.js";
import { logSkipped } from "./core/logger.js";
import { detectSourceType } from "./git-source-url.js";
import { lockSource } from "./lock.js";
import { COMMANDS_DIR } from "./paths.js";
import { recordSourceSha } from "./skills/skill-versions.js";
import { requireState, saveState } from "./state.js";
import { addMcpServer } from "./sync/mcp-sync.js";
import { loadSharedRules, saveSharedRules } from "./sync/rules-sync.js";
import type { AgentBrewState, Source, SourceItem } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

interface IndexedSource {
  items: SourceItem[];
  bootstrapScript?: string;
}

interface RegisterSourceArgs {
  state: AgentBrewState;
  source: string;
  sourceType: Source["type"];
  skillName?: string;
  origin?: "user" | "agentfile" | "catalog";
  bootstrapScript?: string;
}

export { detectSourceType, isAbsoluteGitRemote, isGithubShorthand, resolveGitCloneUrl } from "./git-source-url.js";

export async function listSourceItems(sourceUrl: string): Promise<void> {
  const sourceType = detectSourceType(sourceUrl);
  const tempSource: Source = {
    url: sourceUrl,
    type: sourceType,
    skillsInstalled: [],
    availableItems: [],
    addedAt: new Date().toISOString(),
  };

  console.log(chalk.bold(`\nAvailable items in ${sourceUrl}\n`));
  const items = indexSource(tempSource);

  if (items.length === 0) {
    console.log(chalk.dim("  No items found."));
    console.log();
    return;
  }

  const grouped = groupByType(items);
  for (const [type, typeItems] of Object.entries(grouped)) {
    const label = TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type;
    console.log(chalk.bold(`  ${label}\n`));
    for (const item of typeItems) {
      const desc = item.description ? chalk.dim(` — ${item.description}`) : "";
      console.log(`    ${chalk.cyan(item.name)}${desc}`);
    }
    console.log();
  }
}

const TYPE_LABELS = { skill: "Skills", mcp: "MCP Servers", rule: "Rules", command: "Commands" } as const;
const SKILLS_CLI_TROUBLESHOOTING_HINT =
  "See README 'Delegated skill install networking' for npm/GitHub/skills.sh and offline-cache troubleshooting.";

function groupByType(items: SourceItem[]): Record<string, SourceItem[]> {
  const groups: Record<string, SourceItem[]> = {};
  for (const item of items) {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push(item);
  }
  return groups;
}

interface AddSourceOptions {
  skill?: string;
  mcp?: string;
  rule?: string;
  command?: string;
  list?: boolean;
  yes?: boolean;
  /**
   * Provenance tag for `state.sources[].origin`. Defaults to `"user"` (the
   * normal `agentbrew install` path). Set to `"catalog"` when registering on
   * behalf of an overlay (e.g. team overlay `repo_sources` auto-registration) so
   * symmetric removal on `team unset` can find these and leave user-added
   * sources untouched.
   */
  origin?: "user" | "agentfile" | "catalog";
}

/**
 * Clone (or pull) the remote source into agentbrew's cache and index every
 * item it contains. The function's contract evolved over the
 * `delegate-skill-install-to-skills-cli` slices:
 *
 *   - Pre-delegation, this was `tryGitCloneFirst` — the primary install path
 *     for any remote source.
 *   - Post-slice-5 (PR #805 / 2026-04-26), `delegateRemoteSkill` is the
 *     primary install path for skill-shaped sources to the skills-CLI-supported
 *     intersection; this function now serves three purposes:
 *       (a) clone the cache so {@link maybeRunSkillsCliDelegation} can run
 *           {@link isSkillShaped} against the on-disk content,
 *       (b) register items so {@link handleClonedRemoteSource} can deploy
 *           skills to carve-out agents (`claude-desktop`, `overlay-desktop` —
 *           see {@link AGENTBREW_ONLY_AGENTS_RATIONALE}) that skills CLI
 *           doesn't target,
 *       (c) feed `delegateRemoteSkill` so it can detect "no items" and
 *           refuse the subprocess instead of running it for nothing.
 *
 * Renamed from `tryGitCloneFirst` in `audit-trygitclonefirst-post-slice-5`
 * (TASKS.md P2, 2026-04-26) so the name reflects the post-delegation role
 * instead of the historical pre-delegation framing.
 *
 * **Slice 7 verdict (2026-04-26): permanent post-delegation.** All three
 * roles above are still required because the carve-out agents
 * (`claude-desktop`, `overlay-desktop`) are not fully covered by skills CLI's
 * current target model — `claude-desktop` shares `~/.claude/skills` with
 * `claude-code` via `readsFrom` (a different design problem upstream
 * conflates under one agent), and `overlay-desktop` is organization-internal. Until
 * those agents either land upstream or are deprecated locally, the native
 * deploy path — and this function's clone/index step that feeds it — stay.
 * Deletion is reconsidered if the carve-out set becomes empty;
 * `agent-name-map.ts`'s `AGENTBREW_ONLY_AGENTS_RATIONALE` is the
 * source-of-truth list to watch.
 *
 * Returns `undefined` (not an empty array) when no items are found, so
 * callers can use `?? someFallback()` to chain the next step.
 */
function cloneAndIndexRemoteSource(source: string, sourceType: Source["type"]): IndexedSource | undefined {
  const tempSource: Source = {
    url: source,
    type: sourceType,
    skillsInstalled: [],
    availableItems: [],
    addedAt: new Date().toISOString(),
  };
  try {
    const items = indexSource(tempSource);
    if (items.length === 0 && !tempSource.bootstrapScript) return undefined;
    return { items, bootstrapScript: tempSource.bootstrapScript };
  } catch (e) {
    logSkipped("add-source/indexSource", e);
    return undefined;
  }
}

/**
 * Heuristic from `delegate-skill-install-to-skills-cli` slice 4: detect
 * whether a remote source contains skills-CLI-shaped content. Returns true
 * when:
 *   - any indexed item is a `skill` (i.e. the scanner found a SKILL.md),
 *     OR
 *   - the cloned cache contains a `.claude-plugin/marketplace.json`
 *     manifest (Anthropic's plugin distribution shape; skills CLI honors
 *     this format and indexes per-skill from the manifest).
 *
 * The two checks together cover the {@link https://github.com/vercel-labs/skills}
 * source corpus end-to-end. Sources without either are non-skill (rules,
 * commands, MCP servers, multi-purpose repos) and stay on the native path.
 *
 * `.claude-plugin/plugin.json` is intentionally NOT in the heuristic — that
 * file appears alongside `marketplace.json` in plugin distributions, never
 * as a standalone signal. Slice 9 of `delegate-skill-install-to-skills-cli`
 * (2026-04-27) closed the carve-out applicability question: this heuristic
 * routes manifest-shaped sources to `delegateRemoteSkill` for
 * skills-CLI-supported intersection agents; the narrow gap (carve-out-only
 * detection + manifest-format source + no SKILL.md) is deferred per docs/competition/
 * vercel-skills-cli-vs-agentbrew.md § "Gap 2: Plugin manifest discovery".
 */
function isSkillShaped(items: SourceItem[], cachePath: string | undefined): boolean {
  if (items.some((i) => i.type === "skill")) return true;
  if (cachePath && existsSync(join(cachePath, ".claude-plugin", "marketplace.json"))) return true;
  return false;
}

/**
 * Slice 5 of `delegate-skill-install-to-skills-cli` (TASKS.md): when a
 * skill-shaped remote source is added and at least one intersection agent
 * (any agent that is NOT in `AGENTBREW_ONLY_AGENTS` — i.e. not
 * `claude-desktop` / `overlay-desktop`) is detected, run
 * `npx skills add ... --agent <name> ...` BEFORE the native registration so
 * those agents' skills directories are populated by skills CLI rather than
 * by agentbrew's native scanner.
 *
 * Carve-out agents stay on the native installer; the native deploy step
 * (run by `skills-sync`) detects skills CLI's symlinks at `~/.<agent>/skills/*`
 * via `resolveExistingDest()` and treats them as user-created (target is
 * outside agentbrew's known source paths), so intersection agents are
 * automatically skipped during the native sync — no double-deploy, no
 * symlink conflict. Carve-outs continue to receive symlinks from the
 * native sync because skills CLI doesn't target them.
 *
 * Slice 4 (PR #804, 2026-04-26) introduced this gate as a `claude-code`-only
 * canary; slice 5 broadened it to the full skills-CLI-supported intersection.
 * The `agentAllowlist`
 * parameter on {@link delegateRemoteSkill} that slice 4 added is now
 * unused at this call site — slice 5 passes `undefined` and lets
 * {@link delegateRemoteSkill} read the full detected-agent list from
 * state. Slice 7 (2026-04-26) closed the original "may collapse it" hook
 * by confirming {@link cloneAndIndexRemoteSource} is permanent
 * post-delegation (the remaining carve-outs are still native); the parameter
 * stays on the signature as cheap forward-compat for any future scope
 * narrowing (e.g. a per-source override flag), but no follow-up slice
 * is queued.
 *
 * Skipped when:
 *   - `skillInstallMode === "native"` — user opt-out for offline / proxy
 *     environments where `npx skills add` is unreliable.
 *   - source is not skill-shaped (the heuristic returned false).
 *   - no intersection agents are detected (every detected agent is a
 *     carve-out, e.g. `claude-desktop` only — skills CLI has nothing to
 *     do; the native installer covers all detected agents).
 *
 * Returns true when delegation ran (regardless of subprocess success —
 * failures fall through to the native path which deploys via agentbrew's
 * own scan); false when skipped.
 */
function maybeRunSkillsCliDelegation(
  source: string,
  options: AddSourceOptions,
  state: AgentBrewState,
  clonedItems: SourceItem[] | undefined,
  cachePath: string | undefined,
): boolean {
  const mode = state.skillInstallMode ?? "auto";
  if (mode === "native") return false;
  if (!clonedItems || !isSkillShaped(clonedItems, cachePath)) return false;
  // At least one intersection agent must be detected for the delegation to
  // accomplish anything. When every detected agent is a carve-out, skills
  // CLI emits zero `--agent` flags and `delegateRemoteSkill` would refuse
  // the subprocess anyway — short-circuit here so we don't print the
  // "Skill-shaped source detected" note when no work will happen.
  const detectedNames = state.agents.filter((a) => a.detected).map((a) => a.name);
  const intersectionDetected = detectedNames.some((name) => !AGENTBREW_ONLY_AGENTS.has(name));
  if (!intersectionDetected) return false;

  console.log(
    chalk.dim("\n  Skill-shaped source detected — delegating to skills CLI for all detected intersection agents."),
  );
  delegateRemoteSkill(source, options, /*wantsNonSkill*/ true, state);
  return true;
}

/** Register a cloned remote source's cache as a skillSourceDir for skill deployment. */
function registerSkillSourceDir(state: AgentBrewState, sourceUrl: string, items: SourceItem[]): void {
  if (!state.skillSourceDirs) state.skillSourceDirs = [];
  const skills = items.filter((i) => i.type === "skill");
  if (skills.length === 0) return;
  const label =
    sourceUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop() ?? "remote";
  const tempSource: Source = {
    url: sourceUrl,
    type: detectSourceType(sourceUrl),
    skillsInstalled: [],
    availableItems: [],
    addedAt: "",
  };
  const cachePath = getSourceCachePath(tempSource);
  if (!cachePath) return;

  // Find directories that contain skill subdirectories (dirs with SKILL.md).
  // Standard repos put skills at root or skills/ — but many repos use non-standard
  // paths (e.g. .agents/skills/, skill-plugins/orchestrator/, src/scaffold/cursor/skills/).
  // Register each distinct skill parent directory so skills-sync can deploy them.
  const skillDirs = findSkillParentDirs(cachePath);
  let registered = 0;
  for (const dir of skillDirs) {
    const dirLabel = dir === cachePath ? label : `${label}-${dir.split("/").slice(-1)[0]}`;
    if (state.skillSourceDirs.some((d) => d.path === dir || d.label === dirLabel)) continue;
    state.skillSourceDirs.push({ label: dirLabel, path: dir });
    registered++;
  }
  if (registered > 0) {
    console.log(chalk.dim(`  Registered skill source: ${label} (${skills.length} skills, ${registered} dir(s))`));
  }
}

/** Find directories within a repo that directly contain skill subdirectories (dirs with SKILL.md). */
function findSkillParentDirs(repoPath: string, maxDepth = 5): string[] {
  const parents = new Set<string>();
  const queue: { dir: string; depth: number }[] = [{ dir: repoPath, depth: 0 }];

  for (let current = queue.shift(); current; current = queue.shift()) {
    if (current.depth > maxDepth) continue;
    scanDirForSkillParents(current.dir, current.depth, parents, queue);
  }
  return [...parents];
}

/** Check if a directory contains a skill definition file (SKILL.md, skill.md, or DESIGN.md). */
function hasSkillDefinition(dirPath: string): boolean {
  return (
    existsSync(join(dirPath, "SKILL.md")) ||
    existsSync(join(dirPath, "skill.md")) ||
    existsSync(join(dirPath, "DESIGN.md"))
  );
}

/** Scan a single directory: if an entry has a skill definition, add its parent; otherwise enqueue for deeper scan. */
function scanDirForSkillParents(
  dir: string,
  depth: number,
  parents: Set<string>,
  queue: { dir: string; depth: number }[],
): void {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    logSkipped("add-source/readdirSync", e);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldSkipDir(entry.name, depth)) continue;
    const entryPath = join(dir, entry.name);
    if (hasSkillDefinition(entryPath)) {
      parents.add(dir);
    } else {
      queue.push({ dir: entryPath, depth: depth + 1 });
    }
  }
}

/** Skip hidden dirs (except at depth 0 for .agents/), node_modules, and .git. */
function shouldSkipDir(name: string, depth: number): boolean {
  if (name === "node_modules" || name === "__pycache__" || name === ".git") return true;
  return name.startsWith(".") && depth > 0;
}

/**
 * Delegate remote skill install to npx skills CLI. Returns false if failed
 * and no non-skill work remains.
 *
 * Builds the `--agent` arg list via {@link buildSkillsCliAgentArgs} so the
 * rename pairs in {@link AGENTBREW_TO_SKILLS_CLI} (`copilot` → `github-copilot`, `kiro` → `kiro-cli`,
 * `roo-code` → `roo`) translate at the subprocess boundary and
 * {@link AGENTBREW_ONLY_AGENTS} are filtered before the subprocess runs.
 *
 * Slice 3 of `delegate-skill-install-to-skills-cli` (2026-04-26):
 * the dispatcher now reads detected agents from state and passes the
 * explicit list through `buildSkillsCliAgentArgs(detectedNames)` —
 * `--agent <claude-code> --agent <cursor> ...` instead of the previous
 * `--agent *` wildcard. This narrows the install to agents the user
 * actually has and surfaces carve-outs as a one-line warning so callers
 * see why their `claude-desktop`/`overlay-desktop` skills must
 * still come from the native installer.
 *
 * Slice 4 (PR #804, 2026-04-26): introduced the optional `agentAllowlist`
 * parameter so the canary path in {@link addSource} could pass
 * `["claude-code"]` and delegate ONLY to claude-code while other agents
 * stayed on the native installer.
 *
 * Slice 5 (2026-04-26): {@link maybeRunSkillsCliDelegation} now passes
 * `undefined` for the allowlist so all detected intersection agents flow
 * through the same delegation path. The parameter remains on the
 * signature as a forward-compat hook.
 *
 * Slice 7 (2026-04-26) confirmed {@link cloneAndIndexRemoteSource} stays
 * (remaining carve-outs `claude-desktop`/`overlay-desktop` stay native, so
 * the cache-clone + index step that feeds the native deploy is permanent).
 * The `agentAllowlist` hook is no longer
 * pending a "collapse with cloneAndIndexRemoteSource deletion" — it stays
 * as cheap forward-compat for any future per-source override flag.
 *
 * Pre-init fallback: when state.agents is empty (first-run before
 * `agentbrew init`), the dispatcher falls back to `"all"` mode so the
 * subprocess still does something useful instead of refusing.
 */
function delegateRemoteSkill(
  source: string,
  options: AddSourceOptions,
  wantsNonSkill: boolean,
  state?: AgentBrewState,
  agentAllowlist?: readonly string[],
): boolean {
  const detectedNames = agentAllowlist ?? state?.agents.filter((a) => a.detected).map((a) => a.name) ?? [];
  const { args: agentArgs, carveOuts } =
    detectedNames.length > 0 ? buildSkillsCliAgentArgs(detectedNames) : buildSkillsCliAgentArgs("all");

  // All detected agents are carve-outs — skills CLI has nothing to install.
  // Surface this as a soft skip so the caller can still process non-skill
  // work (mcp/rule/command) without the subprocess running with no `--agent`
  // flags (which would default to skills CLI's own auto-detection and
  // contradict agentbrew's detection).
  if (detectedNames.length > 0 && agentArgs.length === 0) {
    console.error(
      chalk.yellow(
        `\nSkipping skills CLI delegation — no detected agent is supported (carve-outs: ${carveOuts.join(", ")}).`,
      ),
    );
    return wantsNonSkill;
  }

  if (carveOuts.length > 0) {
    const verb = carveOuts.length === 1 ? "is" : "are";
    console.log(
      chalk.yellow(`  Note: ${carveOuts.join(", ")} ${verb} not supported by skills CLI; install via native path.`),
    );
    // Per-agent rationale (slice 6 of delegate-skill-install). Each
    // bullet is ≤ 200 chars per the rationale Record's length contract,
    // so it fits on one terminal line. Falling back to a generic note if
    // a future carve-out is added without a rationale (test enforces
    // both maps stay in sync, but defensive code costs nothing).
    for (const agent of carveOuts) {
      const reason = AGENTBREW_ONLY_AGENTS_RATIONALE[agent] ?? "(no rationale recorded)";
      console.log(chalk.dim(`    • ${agent}: ${reason}`));
    }
  }

  const skillArgs = ["skills", "add", source, "--global", ...agentArgs];
  if (options.skill) skillArgs.push("--skill", options.skill);
  if (options.yes) skillArgs.push("-y");

  console.log(chalk.dim(`  Running: npx ${skillArgs.join(" ")}\n`));

  try {
    execFileSync("npx", skillArgs, { stdio: "inherit", timeout: 120_000 });
  } catch (e) {
    logSkipped("add-source/execFileSync", e);
    console.error(chalk.red(`\nnpx skills add failed. ${SKILLS_CLI_TROUBLESHOOTING_HINT}`));
    if (!wantsNonSkill) return false;
  }
  return true;
}

/** Register or update source entry in state. */
function registerSource(args: RegisterSourceArgs): void {
  const { state, source, sourceType, skillName, origin = "user", bootstrapScript } = args;
  const existingSource = getStateSources(state).find((s) => s.url === source);
  if (existingSource) {
    console.log(chalk.dim("\nSource already tracked, updating timestamp."));
    existingSource.addedAt = new Date().toISOString();
    if (skillName && !existingSource.skillsInstalled.includes(skillName)) {
      existingSource.skillsInstalled.push(skillName);
    }
    if (bootstrapScript) {
      existingSource.bootstrapScript = bootstrapScript;
    } else {
      delete existingSource.bootstrapScript;
    }
    // Provenance is sticky on a re-add: a user-added source that the catalog
    // also declares stays `origin: "user"` (and survives `team unset`); a
    // catalog-added source that the user later runs `agentbrew install` against
    // stays `origin: "catalog"` (it was the overlay's idea first). The
    // implementing agent has the freedom to revisit this rule if a use case
    // appears, but the safe default is "first writer wins."
  } else {
    if (!state.sources) state.sources = [];
    state.sources.push({
      url: source,
      type: sourceType,
      skillsInstalled: skillName ? [skillName] : [],
      availableItems: [],
      addedAt: new Date().toISOString(),
      origin,
      ...(bootstrapScript ? { bootstrapScript } : {}),
    });
  }
}

/** Install non-skill types (MCP, rule, command) from a cached source. */
async function installNonSkillTypes(targetSource: Source, options: AddSourceOptions): Promise<void> {
  const cachePath = getSourceCachePath(targetSource);
  if (cachePath) {
    if (options.mcp !== undefined) await installMcpFromSource(cachePath, options.mcp);
    if (options.rule !== undefined) installRuleFromSource(cachePath, options.rule);
    if (options.command !== undefined) installCommandFromSource(cachePath, options.command);
  } else {
    console.error(chalk.yellow("  Could not access source cache for non-skill installs."));
  }
}

/** Index source items, record SHA, and lock local sources. */
function indexAndLockSource(
  _source: string,
  targetSource: Source,
  isRemote: boolean,
  _skillName?: string,
): SourceItem[] {
  console.log(chalk.dim("\nIndexing available items..."));
  const items = indexSource(targetSource);
  targetSource.availableItems = items;
  targetSource.indexedAt = new Date().toISOString();
  if (!isRemote) {
    recordSourceSha(targetSource);
  }
  return items;
}

/** Lock source SHA and log for local sources. */
function lockLocalSource(source: string, targetSource: Source, isRemote: boolean, skillName?: string): void {
  if (isRemote) return;
  const lockEntry = lockSource(targetSource, skillName ? [skillName] : undefined);
  if (lockEntry) {
    console.log(chalk.dim(`  Locked ${source} @${lockEntry.sha.slice(0, 8)}`));
  }
}

/** Validate local source path exists. Returns false if invalid. */
function validateLocalSource(source: string, sourceType: Source["type"]): boolean {
  if (sourceType !== "local") return true;
  const expandedPath = expandHome(source);
  if (!existsSync(expandedPath)) {
    console.error(chalk.red(`Path not found: ${expandedPath}`));
    return false;
  }
  return true;
}

/** Handle remote source that was successfully cloned with items. Returns true if handled. */
function handleClonedRemoteSource(
  state: AgentBrewState,
  source: string,
  sourceType: Source["type"],
  indexedSource: IndexedSource,
  options: AddSourceOptions,
): boolean {
  registerSource({
    state,
    source,
    sourceType,
    skillName: options.skill,
    origin: options.origin,
    bootstrapScript: indexedSource.bootstrapScript,
  });
  const targetSource = getStateSources(state).find((s) => s.url === source);
  if (targetSource) {
    targetSource.availableItems = indexedSource.items;
    targetSource.indexedAt = new Date().toISOString();
  }
  registerSkillSourceDir(state, source, indexedSource.items);
  saveState(state);
  console.log(`\n${ICON_SUCCESS} Source registered: ${source}`);
  if (indexedSource.items.length > 0) {
    console.log(`  ${formatItemCounts(indexedSource.items)} available — run \`agentbrew catalog --search\` to browse`);
  } else {
    console.log(chalk.dim("  No items found in this source yet."));
  }
  console.log("  Run `agentbrew catalog --sources` to see all tracked sources.\n");
  return true;
}

export async function addSource(source: string, options: AddSourceOptions): Promise<void> {
  const state = requireState();
  if (!state) return;

  if (options.list) {
    await listSourceItems(source);
    return;
  }

  const sourceType = detectSourceType(source);
  if (!validateLocalSource(source, sourceType)) return;

  console.log(chalk.bold(`\nAdding source: ${source}\n`));
  console.log(chalk.dim(`  Type: ${sourceType}`));

  const wantsSkill = options.skill !== undefined;
  const wantsNonSkill = options.mcp !== undefined || options.rule !== undefined || options.command !== undefined;
  const isRemote = sourceType === "github" || sourceType === "url";

  // For remote sources: try git clone first to discover items.
  // Slice 5 of `delegate-skill-install-to-skills-cli` (TASKS.md): for
  // skill-shaped sources, delegate to skills CLI for all detected
  // skills-CLI-supported agents BEFORE the native registration. Carve-out
  // agents (`claude-desktop`, `overlay-desktop`) stay on the native path —
  // skills CLI doesn't target them. Slice 4 (PR #804) shipped this as a
  // `claude-code`-only canary; slice 5 generalized it to the full supported
  // intersection in one shot.
  // Fall back to npx skills add for the full agent set only when clone
  // returns nothing (no items to register natively).
  if (isRemote && (wantsSkill || !wantsNonSkill)) {
    const clonedItems = cloneAndIndexRemoteSource(source, sourceType);
    const cachePath = getSourceCachePath({
      url: source,
      type: sourceType,
      skillsInstalled: [],
      availableItems: [],
      addedAt: "",
    });
    maybeRunSkillsCliDelegation(source, options, state, clonedItems?.items, cachePath);
    if (clonedItems && handleClonedRemoteSource(state, source, sourceType, clonedItems, options)) return;
    if (!delegateRemoteSkill(source, options, wantsNonSkill, state)) return;
  }

  await finalizeSource({ state, source, sourceType, isRemote, wantsNonSkill, options });
}

/** Register, index, install non-skills, lock, and save a source. */
async function finalizeSource(args: {
  state: AgentBrewState;
  source: string;
  sourceType: Source["type"];
  isRemote: boolean;
  wantsNonSkill: boolean;
  options: AddSourceOptions;
}): Promise<void> {
  const { state, source, sourceType, isRemote, wantsNonSkill, options } = args;
  registerSource({
    state,
    source,
    sourceType,
    skillName: options.skill,
    origin: options.origin,
  });

  const targetSource = getStateSources(state).find((s) => s.url === source);
  if (!targetSource) {
    console.error(chalk.red(`  Internal error: source '${source}' not found after registration.`));
    return;
  }

  const items = indexAndLockSource(source, targetSource, isRemote, options.skill);

  if (wantsNonSkill) {
    await installNonSkillTypes(targetSource, options);
  }

  lockLocalSource(source, targetSource, isRemote, options.skill);
  saveState(state);

  console.log(`\n${ICON_SUCCESS} Source registered: ${source}`);
  if (items.length > 0) {
    console.log(`  ${formatItemCounts(items)} available — run \`agentbrew catalog --search\` to browse`);
  } else {
    console.log(chalk.dim("  No items found in this source yet."));
  }
  console.log("  Run `agentbrew catalog --sources` to see all tracked sources.\n");
}

async function installMcpFromSource(cachePath: string, serverName: string): Promise<void> {
  const mcpFile = join(cachePath, "mcp-servers.yaml");
  if (!existsSync(mcpFile)) {
    console.error(chalk.yellow("  No mcp-servers.yaml found in source."));
    return;
  }

  try {
    const yaml = await import("js-yaml");
    const content = readFileSync(mcpFile, "utf-8");
    const data = yaml.load(content) as Record<string, Record<string, unknown>> | undefined;
    if (!data?.[serverName]) {
      console.error(
        chalk.yellow(
          `  MCP server '${serverName}' not found in source. Available: ${Object.keys(data ?? {}).join(", ")}`,
        ),
      );
      return;
    }

    const entry = data[serverName];
    await addMcpServer(
      serverName,
      (entry.command as string) ?? "",
      (entry.args as string[]) ?? [],
      (entry.env as Record<string, string>) ?? {},
      { url: entry.url as string | undefined, headers: entry.headers as Record<string, string> | undefined },
    );
    console.log(`  ${ICON_SUCCESS} MCP server '${serverName}' installed`);
  } catch (error) {
    console.error(chalk.red(`  Failed to install MCP server '${serverName}': ${error}`));
  }
}

function installRuleFromSource(cachePath: string, ruleName: string): void {
  const ruleFile = join(cachePath, "rules", `${ruleName}.md`);
  if (!existsSync(ruleFile)) {
    console.error(chalk.yellow(`  Rule '${ruleName}' not found in source. Expected: rules/${ruleName}.md`));
    return;
  }

  const content = readFileSync(ruleFile, "utf-8");
  const existing = loadSharedRules();
  if (existing === undefined) {
    console.log(chalk.yellow("  No shared-rules.md found. Run `agentbrew rules init` first."));
    return;
  }

  if (existing.includes(content.trim())) {
    console.log(`  ${ICON_SUCCESS} Rule '${ruleName}' — already present in shared-rules.md`);
    return;
  }

  const separator = `\n\n<!-- rule: ${ruleName} -->\n`;
  const updated = `${existing.trimEnd()}${separator}${content.trimEnd()}\n`;
  saveSharedRules(updated);
  console.log(`  ${ICON_SUCCESS} Rule '${ruleName}' — added to shared-rules.md`);
}

function installCommandFromSource(cachePath: string, commandName: string): void {
  const commandFile = join(cachePath, "commands", `${commandName}.md`);
  if (!existsSync(commandFile)) {
    console.error(chalk.yellow(`  Command '${commandName}' not found in source. Expected: commands/${commandName}.md`));
    return;
  }

  const targetDir = expandHome(COMMANDS_DIR);
  mkdirSync(targetDir, { recursive: true });
  const targetFile = join(targetDir, `${commandName}.md`);

  copyFileSync(commandFile, targetFile);
  console.log(`  ${ICON_SUCCESS} Command '${commandName}' — copied to commands/`);
  console.log(chalk.dim("  Run `agentbrew sync --only commands` to deploy to all agents."));
}

export async function removeSource(url: string): Promise<void> {
  const state = requireState();
  if (!state) return;

  if (!state.sources) state.sources = [];
  const index = state.sources.findIndex((s) => s.url === url);
  if (index === -1) {
    console.error(chalk.red(`Source '${url}' not found.`));
    console.log(chalk.dim("  Run `agentbrew catalog --sources` to list registered sources."));
    return;
  }

  state.sources.splice(index, 1);
  saveState(state);

  console.log(`${ICON_SUCCESS} Source '${url}' removed from tracking.`);
  console.log(chalk.dim("  Skills from this source are still installed. Use `npx skills remove` to uninstall."));
}

export { findSkillParentDirs, registerSkillSourceDir };
