import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { CLAUDE_DESKTOP_MAIN_LOG_PATH } from "../paths.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Bytes read from the end of the log. Desktop logs grow to megabytes; one start fits well inside this. */
const MAX_TAIL_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 200;

const APP_START = /\] Starting app\b/;
const INVALID_ENTRIES = /Skipped invalid MCP server config entries:\s*(.+)$/;
const CONNECT_FAILED = /\[LocalMcpServerManager\] Failed to connect to (\S+?):(?:\s|$)/;

export interface DesktopMcpFailure {
  name: string;
  kind: "invalid-config" | "connect-failed";
  /** The log line that named the failure, trimmed. */
  line: string;
  fix: string;
}

function connectFix(name: string): string {
  return name.startsWith("plugin:")
    ? "this is an account-synced plugin: turn it off or update it in Claude Desktop under Customize > Plugins"
    : "check the server entry in Claude Desktop config, then run `agentbrew sync`";
}

function linesSinceLastStart(logText: string): string[] {
  const lines = logText.split("\n");
  const lastStart = lines.reduce((found, line, index) => (APP_START.test(line) ? index : found), -1);
  return lines.slice(lastStart + 1);
}

function parseLine(raw: string): DesktopMcpFailure[] {
  const line = raw.slice(0, MAX_LINE_CHARS).trim();
  const invalid = INVALID_ENTRIES.exec(line)?.[1];
  if (invalid) {
    return invalid
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        kind: "invalid-config" as const,
        line,
        fix: "config entry is invalid: run `agentbrew sync` to rewrite it",
      }));
  }
  const name = CONNECT_FAILED.exec(line)?.[1];
  return name ? [{ name, kind: "connect-failed", line, fix: connectFix(name) }] : [];
}

/**
 * Failures from the latest Desktop start only.
 *
 * Desktop logs `Starting app` once per launch, so everything before the last
 * marker is history that a fix has already outdated.
 */
export function parseDesktopMcpFailures(logText: string): DesktopMcpFailure[] {
  const byName = new Map<string, DesktopMcpFailure>();
  for (const failure of linesSinceLastStart(logText).flatMap(parseLine)) byName.set(failure.name, failure);
  return [...byName.values()];
}

function readTail(path: string): string {
  const size = statSync(path).size;
  const length = Math.min(size, MAX_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf-8");
}

/** Reads the Desktop log tail. A missing log (no Desktop, not macOS) or any read error yields no failures. */
export function readDesktopMcpFailures(
  logPath: string = expandHome(CLAUDE_DESKTOP_MAIN_LOG_PATH),
): DesktopMcpFailure[] {
  if (!existsSync(logPath)) return [];
  try {
    return parseDesktopMcpFailures(readTail(logPath));
  } catch (error) {
    logSkipped("claude-desktop-mcp/read", error);
    return [];
  }
}

export function checkClaudeDesktopMcpDrift(logPath?: string): DriftItem[] {
  return readDesktopMcpFailures(logPath).map((failure) => ({
    agent: "claude-desktop",
    type: "claude-desktop-mcp",
    detail: `${failure.name} failed at Claude Desktop startup (${failure.line}) — ${failure.fix}`,
  }));
}
