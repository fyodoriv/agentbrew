import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { MEMORY_AGENT_LABEL } from "../memory/launchagent.js";
import {
  LAUNCHAGENT_LANG,
  launchAgentPathHasRequiredPrefixes,
  resolveDotfilesBinPath,
} from "../sync/scheduler-paths.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

const AGENTBREW_LA_PREFIX = "com.agentbrew.";

/** The memory daemon plist builds its own fixed PATH (memoryDaemonPath); rewriting it restarts the daemon. */
const SELF_MANAGED_PATH_PLISTS = new Set([`${MEMORY_AGENT_LABEL}.plist`]);

export function plistManagesOwnPath(plistPath: string): boolean {
  return SELF_MANAGED_PATH_PLISTS.has(basename(plistPath));
}

/** Extract PATH from a LaunchAgent plist XML string. */
export function extractPlistPath(plistContent: string): string | undefined {
  const match = plistContent.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/u);
  return match?.[1];
}

/** Replace PATH in a LaunchAgent plist XML string. Returns input unchanged when no PATH key exists. */
export function setPlistPath(plistContent: string, pathValue: string): string {
  const pathRegex = /(<key>PATH<\/key>\s*<string>)[^<]*(<\/string>)/u;
  if (!pathRegex.test(plistContent)) return plistContent;
  return plistContent.replace(pathRegex, `$1${pathValue}$2`);
}

/** True when a LaunchAgent plist sets LANG or LC_ALL. */
export function plistHasLocale(plistContent: string): boolean {
  return /<key>(?:LANG|LC_ALL)<\/key>/u.test(plistContent);
}

/**
 * Add LANG right after the PATH entry, at the same indentation.
 * Returns input unchanged when a locale is already set or PATH is missing.
 */
export function ensurePlistLocale(plistContent: string): string {
  if (plistHasLocale(plistContent)) return plistContent;
  return plistContent.replace(
    /(^[ \t]*)?<key>PATH<\/key>\s*<string>[^<]*<\/string>/mu,
    (entry: string, indent = "") => `${entry}\n${indent}<key>LANG</key>\n${indent}<string>${LAUNCHAGENT_LANG}</string>`,
  );
}

/** List installed com.agentbrew.* plist paths on disk (macOS only). */
export function listAgentbrewLaunchAgentPlists(): string[] {
  if (process.platform !== "darwin") return [];
  const dir = expandHome("~/Library/LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(AGENTBREW_LA_PREFIX) && name.endsWith(".plist"))
    .map((name) => join(dir, name));
}

/**
 * Detect stale environment on com.agentbrew.* LaunchAgents — PATH missing the
 * node bin dir or dotfiles/bin, or no locale.
 */
export function checkLaunchAgentPathDrift(): DriftItem[] {
  if (process.platform !== "darwin") return [];

  const home = expandHome("~");
  const items: DriftItem[] = [];

  for (const plistPath of listAgentbrewLaunchAgentPlists()) {
    let content: string;
    try {
      content = readFileSync(plistPath, "utf-8");
    } catch {
      continue;
    }
    const pathValue = extractPlistPath(content);
    if (!pathValue) continue;

    if (!plistManagesOwnPath(plistPath) && !launchAgentPathHasRequiredPrefixes(pathValue, home)) {
      items.push({
        agent: "launchagent",
        type: "launchagent",
        detail: `${plistPath}: PATH missing node or ${resolveDotfilesBinPath(home)} — run agentbrew fix`,
      });
    }

    if (!plistHasLocale(content)) {
      items.push({
        agent: "launchagent",
        type: "launchagent",
        detail: `${plistPath}: no LANG, so launchd runs it without a locale — run agentbrew fix`,
      });
    }
  }

  return items;
}
