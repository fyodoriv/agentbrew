/**
 * Hook manifest reader + translator.
 *
 * Reads `agentbrew/hooks/manifest.yaml` (canonical, in-repo) and the
 * optional `~/.config/agentbrew/hooks-overlay/manifest.yaml` (per-machine
 * overlay). Merges them: overlay entries with matching `id` REPLACE the
 * canonical entry; canonical entries with `id` listed in overlay
 * `disabled:` are skipped (logged with `reason: "disabled-by-overlay"`
 * at hook-fire time via the deployed script's verdict logic).
 *
 * Output: an array of `ManagedHook` records ready for the existing
 * `syncHooks()` pipeline at `src/sync/hooks-sync.ts`. The script files
 * themselves get deployed by `deployHookScripts()` (sibling module).
 *
 * **Why this layer**: the existing `syncHooks()` reads `state.hooks`
 * (user-added). This module produces additional ManagedHook entries
 * from the declarative manifest. Both lists merge into the final
 * settings.json["hooks"] write — the manifest is the canonical source-
 * of-truth, state.hooks is operator-added (e.g. via `agentbrew hooks add`).
 *
 * **Test**: `src/hooks/manifest.test.ts` — runs against the actual
 * `agentbrew/hooks/manifest.yaml` to verify the canonical entries parse.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";
import { logSkipped } from "../core/logger.js";
import type { ManagedHook } from "../types.js";

/** Canonical Claude Code event names — kept narrow to catch typos at parse time. */
const VALID_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Notification",
]);

const VALID_TIERS = new Set(["deterministic", "verifier"]);
const VALID_VERDICTS = new Set(["block", "warn", "mutate"]);

/**
 * One hook entry in the manifest. The shape is more verbose than the
 * `ManagedHook` it produces — extra fields (sourceRule, tier, verdict)
 * are documentation that the operator + reviewer + future-self need;
 * `syncHooks()` doesn't use them.
 */
export interface ManifestHookEntry {
  id: string;
  description: string;
  event: string;
  matcher?: string;
  script: string;
  tier: "deterministic" | "verifier";
  verdict: "block" | "warn" | "mutate";
  bypassEnvVar?: string;
  model?: string;
  promptVersion?: number;
  sourceRule?: string;
  agents?: string[];
}

interface ManifestFile {
  version: number;
  hooks: ManifestHookEntry[];
  /** Overlay manifests can list canonical hook IDs to disable on this machine. */
  disabled?: string[];
}

/** Resolved manifest after merging canonical + overlay. */
export interface ResolvedManifest {
  /** All hook entries the operator wants deployed (canonical minus disabled, plus overlay additions). */
  hooks: ManifestHookEntry[];
  /** Hook IDs that were explicitly disabled by overlay. */
  disabledByOverlay: string[];
  /** Hook IDs in overlay that REPLACED a canonical entry. */
  overrides: string[];
}

/** Default location of the canonical manifest, relative to the agentbrew repo root. */
export function canonicalManifestPath(repoRoot: string): string {
  return join(repoRoot, "hooks", "manifest.yaml");
}

/** Default location of the per-machine overlay manifest. */
export function overlayManifestPath(): string {
  return join(homedir(), ".config", "agentbrew", "hooks-overlay", "manifest.yaml");
}

/**
 * Load and parse a single manifest file. Returns the parsed contents or
 * null if the file doesn't exist (overlay is optional). Throws on
 * malformed YAML or schema-invalid entries — the operator wants to
 * know IMMEDIATELY if their manifest is broken, not at first hook fire.
 */
export function loadManifestFile(path: string): ManifestFile | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    logSkipped(`hook manifest: cannot read ${path}`, err);
    return null;
  }
  const parsed = yaml.load(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`hook manifest: ${path} is not a YAML object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`hook manifest: ${path} has unsupported version ${obj.version} (only 1 supported)`);
  }
  const hooks = (obj.hooks ?? []) as unknown[];
  if (!Array.isArray(hooks)) {
    throw new Error(`hook manifest: ${path} hooks field is not an array`);
  }
  const disabled = obj.disabled ?? [];
  if (!Array.isArray(disabled) || disabled.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`hook manifest: ${path} disabled field must be an array of non-empty strings`);
  }
  for (const [i, entry] of hooks.entries()) {
    validateEntry(entry as Record<string, unknown>, path, i);
  }
  return obj as unknown as ManifestFile;
}

function validateRequiredString(where: string, id: string, field: string, value: unknown): void {
  if (typeof value !== "string" || !value) {
    throw new Error(`${where} (${id}): ${field} must be a non-empty string`);
  }
}

interface ValidationContext {
  where: string;
  id: string;
  field: string;
}

function validateEnum(ctx: ValidationContext, value: unknown, validSet: Set<string>, validDesc: string): void {
  if (typeof value !== "string" || !validSet.has(value)) {
    throw new Error(`${ctx.where} (${ctx.id}): ${ctx.field} '${value}' must be ${validDesc}`);
  }
}

function validateOptionalString(ctx: ValidationContext, value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${ctx.where} (${ctx.id}): ${ctx.field} must be a string or omitted`);
  }
}

function validateOptionalStringArray(ctx: ValidationContext, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${ctx.where} (${ctx.id}): ${ctx.field} must be an array of non-empty strings or omitted`);
  }
}

/** Validate a single manifest entry. Throws with a precise error message
 *  identifying the file + index + missing/invalid field. */
function validateEntry(entry: Record<string, unknown>, path: string, index: number): void {
  const where = `${path} hooks[${index}]`;
  const id = entry.id as string;
  validateRequiredString(where, id, "id", entry.id);
  validateRequiredString(where, id, "description", entry.description);
  validateEnum({ where, id, field: "event" }, entry.event, VALID_EVENTS, `one of ${[...VALID_EVENTS].join(", ")}`);
  validateRequiredString(where, id, "script", entry.script);
  validateEnum({ where, id, field: "tier" }, entry.tier, VALID_TIERS, "deterministic or verifier");
  validateEnum({ where, id, field: "verdict" }, entry.verdict, VALID_VERDICTS, "block, warn, or mutate");
  validateOptionalString({ where, id, field: "matcher" }, entry.matcher);
  validateOptionalString({ where, id, field: "bypassEnvVar" }, entry.bypassEnvVar);
  validateOptionalString({ where, id, field: "model" }, entry.model);
  validateOptionalStringArray({ where, id, field: "agents" }, entry.agents);
  if (entry.promptVersion !== undefined && typeof entry.promptVersion !== "number") {
    throw new Error(`${where} (${id}): promptVersion must be a number or omitted`);
  }
}

/**
 * Resolve the canonical manifest layered with optional overlay.
 *
 * Merge rules:
 *   - overlay entries with matching `id` REPLACE canonical entries
 *   - overlay `disabled:` list of IDs removes those entries
 *   - new IDs in overlay get ADDED to the final list
 *
 * Returns a `ResolvedManifest` with the final hook list + diagnostics
 * about what overlay actions fired (operator-visible drift surface).
 */
export function resolveManifest(repoRoot: string, opts?: { overlayPath?: string }): ResolvedManifest {
  const canonical = loadManifestFile(canonicalManifestPath(repoRoot));
  const overlayPathResolved = opts?.overlayPath ?? overlayManifestPath();
  const overlay = loadManifestFile(overlayPathResolved);

  const disabled = new Set(overlay?.disabled ?? []);
  const overlayById = new Map<string, ManifestHookEntry>();
  for (const entry of overlay?.hooks ?? []) {
    overlayById.set(entry.id, entry);
  }

  const hooks: ManifestHookEntry[] = [];
  const overrides: string[] = [];
  const canonicalIds = new Set<string>();

  for (const entry of canonical?.hooks ?? []) {
    canonicalIds.add(entry.id);
    if (disabled.has(entry.id)) continue;
    const override = overlayById.get(entry.id);
    if (override) {
      hooks.push(override);
      overrides.push(entry.id);
    } else {
      hooks.push(entry);
    }
  }
  // Overlay-only entries (additions, not overrides)
  for (const [id, entry] of overlayById.entries()) {
    if (!canonicalIds.has(id)) {
      hooks.push(entry);
    }
  }

  return {
    hooks,
    disabledByOverlay: [...disabled],
    overrides,
  };
}

/**
 * Translate a manifest entry into a `ManagedHook` ready for the existing
 * `syncHooks()` pipeline.
 *
 * The translation is straightforward: the manifest's `script` path
 * (relative to agentbrew/hooks/) becomes the absolute path to the
 * deployed copy in `~/.claude/codeassist/hooks-scripts/<id>.sh`. The
 * deployed path is what Claude Code actually exec's at hook fire time.
 *
 * `deployScriptDir` is the absolute path of the deploy target — the
 * caller (sync engine) controls it so tests can deploy to a temp dir.
 */
export function manifestEntryToManagedHook(entry: ManifestHookEntry, deployScriptDir: string): ManagedHook {
  const deployedPath = join(deployScriptDir, `${entry.id}.sh`);
  return {
    event: entry.event,
    matcher: entry.matcher,
    type: "command",
    command: `bash ${deployedPath}`,
    // 60s default Claude Code timeout is way too generous for our hooks;
    // pin per-tier so a stuck verifier doesn't freeze a tool call.
    timeout: entry.tier === "verifier" ? 10 : 5,
    agents: entry.agents,
    source: "agentbrew-hooks-manifest",
  };
}

/**
 * Top-level helper: read both manifests, return the final ManagedHook[]
 * the sync engine should feed into `syncHooks()`.
 *
 * Throws on schema-invalid manifest (operator wants immediate feedback).
 */
export function loadManagedHooksFromManifest(
  repoRoot: string,
  deployScriptDir: string,
  opts?: { overlayPath?: string },
): { managed: ManagedHook[]; resolved: ResolvedManifest } {
  const resolved = resolveManifest(repoRoot, opts);
  const managed = resolved.hooks.map((entry) => manifestEntryToManagedHook(entry, deployScriptDir));
  return { managed, resolved };
}

/** Resolve the absolute path of a hook script source file, given the
 *  manifest entry's `script` field (relative to agentbrew/hooks/) and
 *  the repo root. */
export function resolveScriptSource(repoRoot: string, scriptRelative: string): string {
  return resolve(join(repoRoot, "hooks", scriptRelative));
}

/** Same for overlay — resolves relative to ~/.config/agentbrew/hooks-overlay/. */
export function resolveOverlayScriptSource(scriptRelative: string): string {
  return resolve(join(dirname(overlayManifestPath()), scriptRelative));
}
