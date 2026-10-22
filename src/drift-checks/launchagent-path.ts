import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { MEMORY_AGENT_LABEL } from "../memory/launchagent.js";
import {
  LAUNCHAGENT_LANG,
  launchAgentPathHasRequiredPrefixes,
  resolveDotfilesBinPath,
  resolveSchedulerNode,
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

/**
 * Node bin dir the plist itself runs: the directory of an absolute
 * ProgramArguments[0] that is named `node`. Undefined for other plists.
 * The running process can be a development checkout on another Node, so the
 * deployed plist is the contract, not `process.execPath`.
 */
export function plistNodeBinDir(plistContent: string): string | undefined {
  const array = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/u.exec(plistContent);
  const program = array?.[1];
  if (!program || !isAbsolute(program) || basename(program) !== "node") return undefined;
  return dirname(program);
}

/** Read the ProgramArguments strings from a LaunchAgent plist. */
export function extractPlistProgramArguments(plistContent: string): string[] {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(plistContent);
  if (!array) return [];
  return [...array[1].matchAll(/<string>([^<]*)<\/string>/gu)].map((match) => match[1]);
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

/** The auto-repair plist; `agentbrew fix` rewrites it wholesale. */
const CHECK_PLIST = "com.agentbrew.check.plist";

/**
 * Node drift on the auto-repair plist (#356): its Node is gone, or it runs a
 * versioned path (such as a Homebrew Cellar folder) while a link that
 * survives upgrades points at the same Node. A Node picked with
 * AGENTBREW_NODE_BIN (kept in the job env) is never drift.
 */
function checkPlistNodeDrift(plistPath: string, content: string): DriftItem[] {
  if (basename(plistPath) !== CHECK_PLIST) return [];
  const program = extractPlistProgramArguments(content)[0];
  if (!program || !isAbsolute(program) || basename(program) !== "node") return [];
  const drift = (detail: string): DriftItem[] => [{ agent: "launchagent", type: "launchagent", detail }];
  if (!existsSync(program)) return drift(`${plistPath}: runs ${program}, which no longer exists — run agentbrew fix`);
  const override = /<key>AGENTBREW_NODE_BIN<\/key>\s*<string>([^<]*)<\/string>/u.exec(content)?.[1];
  if (override === program) return [];
  const stable = resolveSchedulerNode({ execPath: program, env: {} });
  if (stable === program) return [];
  return drift(`${plistPath}: runs ${program}, which a Node upgrade deletes; use ${stable} — run agentbrew fix`);
}

/**
 * Detect stale environment on com.agentbrew.* LaunchAgents — PATH missing the
 * node bin dir or dotfiles/bin, or no locale — and a Node path on the
 * auto-repair plist that is gone or does not survive upgrades.
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

    if (
      !plistManagesOwnPath(plistPath) &&
      !launchAgentPathHasRequiredPrefixes(pathValue, home, plistNodeBinDir(content))
    ) {
      items.push({
        agent: "launchagent",
        type: "launchagent",
        detail: `${plistPath}: PATH missing node or ${resolveDotfilesBinPath(home)} — run agentbrew fix`,
      });
    }

    items.push(...checkPlistNodeDrift(plistPath, content));

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
