import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export function expandHome(path: string): string {
  return path.replace(/^~/, homedir());
}

/**
 * Format a duration (milliseconds since epoch represented as ISO date string)
 * as a human-readable relative time string, e.g. "2d ago", "3h ago", "just now".
 * Shared by motd.ts and status.ts to avoid divergent formatting.
 */
export function formatAge(isoDate: string): string {
  const age = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(age / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function skipStringContent(jsonc: string, startPos: number): { content: string; endPos: number } {
  let result = jsonc[startPos]; // opening quote
  let i = startPos + 1;
  let isEscaped = false;
  while (i < jsonc.length) {
    const char = jsonc[i];
    result += char;
    if (isEscaped) {
      isEscaped = false;
    } else if (char === "\\") {
      isEscaped = true;
    } else if (char === '"') {
      return { content: result, endPos: i + 1 };
    }
    i++;
  }
  return { content: result, endPos: i };
}

/** Strip single-line (//) and multi-line comments from JSONC content. */
function stripJsonComments(jsonc: string): string {
  let result = "";
  let i = 0;

  while (i < jsonc.length) {
    const char = jsonc[i];
    const next = jsonc[i + 1];

    if (char === '"') {
      const str = skipStringContent(jsonc, i);
      result += str.content;
      i = str.endPos;
      continue;
    }

    if (char === "/" && next === "/") {
      i = jsonc.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = jsonc.indexOf("*/", i + 2);
      i = end === -1 ? jsonc.length : end + 2;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/** Parse JSONC (JSON with comments) content. */
export function parseJsonc<T = unknown>(jsonc: string): T {
  return JSON.parse(stripJsonComments(jsonc)) as T;
}

/** Build the platform-specific path to a VS Code extension's global storage config. */
export function vscodeExtConfigPath(extensionId: string, filename: string): string {
  const base =
    process.platform === "darwin"
      ? "~/Library/Application Support/Code/User/globalStorage"
      : "~/.config/Code/User/globalStorage";
  return `${base}/${extensionId}/settings/${filename}`;
}

/** Build the platform-specific path to VS Code's main settings.json. */
export function vscodeSettingsPath(): string {
  return process.platform === "darwin"
    ? "~/Library/Application Support/Code/User/settings.json"
    : "~/.config/Code/User/settings.json";
}

/**
 * Verifies that git is available on PATH before any operation that clones or
 * fetches git repositories. Without this check the user would see a cryptic
 * ENOENT from deep inside execFileSync, which gives no actionable guidance.
 * Returns false with a human-readable error when git is missing.
 */
export function checkGitAvailable(): boolean {
  const result = spawnSync("git", ["--version"], { stdio: "pipe", timeout: 5_000 });
  if (result.error || result.status !== 0) {
    console.error("Error: git is required but was not found on your PATH.");
    console.error("Install git (https://git-scm.com/downloads) and try again.");
    return false;
  }
  return true;
}

/**
 * Checks for stale PATH binaries named `agentbrew` that could shadow the
 * Node.js CLI. Returns paths to conflicting binaries (non-Node.js scripts).
 * Used by `agentbrew init` to warn users who may have legacy bash scripts.
 */
export function checkPathConflicts(): string[] {
  const result = spawnSync("which", ["-a", "agentbrew"], { stdio: "pipe", timeout: 5_000 });
  if (result.error || result.status !== 0) return [];

  const paths = result.stdout
    .toString()
    .split("\n")
    .filter((p) => p.trim().length > 0);

  const conflicts: string[] = [];
  for (const binPath of paths) {
    try {
      const head = readFileSync(binPath, "utf-8").slice(0, 512);
      const isNode = head.startsWith("#!/usr/bin/env node") || /^#!.*\bnode\b/.test(head.split("\n")[0]);
      if (!isNode) {
        conflicts.push(binPath);
      }
    } catch {
      // Unreadable binary (compiled executable, etc.) — not a conflict
    }
  }
  return conflicts;
}

/** Parse an array of KEY=VALUE strings into a Record. Values may contain `=`. */
export function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    result[key] = rest.join("=");
  }
  return result;
}
