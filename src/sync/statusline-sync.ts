/**
 * Manages the Claude Code `statusLine` setting in `~/.claude/settings.json`.
 *
 * agentbrew points it at `agent-perf.mjs statusline` (model, wall time, API
 * and tool time, slowest step, context use). Ownership rule: agentbrew writes
 * the setting only when it is absent, or when it still equals the value that
 * agentbrew wrote last time (`manifest.managedStatusLine`). Any other value is
 * the user's own and is kept; `agentbrew status` lists it as a user addition.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { existingText, jsonTextFor } from "../core/json-text-edit.js";
import { logSkipped } from "../core/logger.js";
import type { Manifest } from "../manifest.js";
import { HELPER_SCRIPTS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";

export interface StatusLineSetting {
  type: "command";
  command: string;
  refreshInterval?: number;
}

export type StatusLineAction = "installed" | "updated" | "unchanged" | "kept-user";

/** The statusLine value agentbrew deploys. */
export function desiredStatusLine(): StatusLineSetting {
  const helper = expandHome(join(HELPER_SCRIPTS_DIR, "agent-perf.mjs"));
  return { type: "command", command: `node ${helper} statusline`, refreshInterval: 5 };
}

/** Decide what to do with the current value. Never returns a write for a value agentbrew did not write. */
export function planStatusLine(current: unknown, lastWritten: unknown, desired: StatusLineSetting): StatusLineAction {
  if (current === undefined || current === null) return "installed";
  if (isDeepStrictEqual(current, desired)) return "unchanged";
  if (lastWritten !== undefined && isDeepStrictEqual(current, lastWritten)) return "updated";
  return "kept-user";
}

function readSettings(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (e) {
    // An unreadable settings file is never rewritten from scratch.
    logSkipped("sync/statusline-sync/readSettings", e);
    return null;
  }
}

/**
 * Apply the plan to one Claude Code settings file. Returns the action, or
 * null when the file cannot be parsed. Reads and writes synchronously, so it
 * cannot interleave with another sync module's settings write.
 */
export function syncStatusLine(options: {
  settingsPath: string;
  manifest: Manifest;
  dryRun: boolean;
}): StatusLineAction | null {
  const settings = readSettings(options.settingsPath);
  if (settings === null) return null;
  const desired = desiredStatusLine();
  const action = planStatusLine(settings.statusLine, options.manifest.managedStatusLine, desired);
  if (options.dryRun || action === "kept-user") return action;
  if (action !== "unchanged") {
    settings.statusLine = desired;
    mkdirSync(dirname(options.settingsPath), { recursive: true });
    writeFileAtomicSync(options.settingsPath, jsonTextFor(existingText(options.settingsPath), settings), "utf-8");
  }
  options.manifest.managedStatusLine = desired;
  return action;
}

/** The current statusLine when it is the user's own value, else null. Used by `agentbrew status`. */
export function userStatusLine(settingsPath: string, manifest: Manifest): unknown {
  const settings = readSettings(settingsPath);
  if (!settings) return null;
  const action = planStatusLine(settings.statusLine, manifest.managedStatusLine, desiredStatusLine());
  return action === "kept-user" ? settings.statusLine : null;
}
