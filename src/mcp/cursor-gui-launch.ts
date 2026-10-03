import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { McpServer } from "../types.js";
import { expandHome } from "../utils.js";

const HOME_EXPORT_PREFIX = `export HOME="\${HOME:-/Users/$(/usr/bin/id -un)}"; `;
const LAUNCHER_PATH = "bin/mcp-cursor-launch.sh";

/** Launcher paths of the `dotfiles-*` clones in `parent`, in name order. */
function overlayLauncherCandidates(parent: string): string[] {
  try {
    return readdirSync(parent)
      .filter((name) => name.startsWith("dotfiles-"))
      .sort()
      .map((name) => join(parent, name, LAUNCHER_PATH));
  } catch {
    return [];
  }
}

/**
 * Resolve the dotfiles overlay launcher when present on this machine.
 *
 * Order: `DOTFILES_OVERLAY_ROOT`, `EXTRA_OVERLAY_ROOT`, then the first
 * `dotfiles-*` clone that ships the launcher, searched in the same clone
 * layouts as dotfiles `lib/overlay-locate.sh`.
 */
export function resolveMcpCursorLauncher(): string | null {
  for (const root of [process.env.DOTFILES_OVERLAY_ROOT, process.env.EXTRA_OVERLAY_ROOT]) {
    if (root && existsSync(join(root, LAUNCHER_PATH))) return join(root, LAUNCHER_PATH);
  }
  const home = expandHome("~");
  const repos = process.env.DOTFILES_REPOS_DIR ?? join(home, "apps");
  for (const parent of [join(repos, "tooling"), repos, join(home, "apps/tooling"), join(home, "apps")]) {
    const launcher = overlayLauncherCandidates(parent).find((path) => existsSync(path));
    if (launcher) return launcher;
  }
  return null;
}

/** Resolve org dotfiles overlay root (directory containing bin/*-wrapper.sh). */
export function resolveMcpCursorOverlayRoot(): string | null {
  const launcher = resolveMcpCursorLauncher();
  if (!launcher) return null;
  return join(launcher, "..", "..");
}

const OVERLAY_WRAPPER_EXEC_RE = /exec\s+"?\$overlay\/bin\/([a-z0-9.-]+-wrapper\.sh)"?/;

/** Rewrite fragile bash -lc overlay resolution to absolute wrapper paths. */
function rewriteOverlayBashLcEntry(
  entry: Record<string, unknown>,
  launcher: string,
  overlayRoot: string,
): Record<string, unknown> | null {
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  if (args[0] !== "-lc" || typeof args[1] !== "string") return null;

  const match = args[1].match(OVERLAY_WRAPPER_EXEC_RE);
  if (!match) return null;

  const wrapperPath = join(overlayRoot, "bin", match[1]);
  if (!existsSync(wrapperPath)) return null;

  const wrapped: Record<string, unknown> = match[1].includes("google-drive")
    ? { command: wrapperPath, args: [] }
    : { command: launcher, args: [wrapperPath] };

  if (entry.env && typeof entry.env === "object") wrapped.env = entry.env;
  return wrapped;
}

function isAlreadyWrapped(entry: Record<string, unknown>): boolean {
  const command = typeof entry.command === "string" ? entry.command : "";
  if (command.endsWith("mcp-cursor-launch.sh")) return true;
  const args = Array.isArray(entry.args) ? entry.args : [];
  return args.some((arg) => typeof arg === "string" && arg.includes("mcp-cursor-launch.sh"));
}

function needsHomeExportInBashLc(script: string): boolean {
  return !script.includes("HOME:-") && !script.includes('HOME="${HOME');
}

function wrapNpxOrMcpm(entry: Record<string, unknown>, server: McpServer, launcher: string): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {
    command: launcher,
    args: [server.command, ...server.args],
  };
  if (entry.env && typeof entry.env === "object") {
    wrapped.env = entry.env;
  }
  return wrapped;
}

function wrapBashLcOverlay(
  entry: Record<string, unknown>,
  server: McpServer,
  launcher: string | null,
  overlayRoot: string | null,
): Record<string, unknown> {
  const script = server.args[1];
  if (typeof script !== "string") return entry;

  if (launcher && overlayRoot) {
    const rewritten = rewriteOverlayBashLcEntry(
      { command: server.command, args: server.args, env: entry.env },
      launcher,
      overlayRoot,
    );
    if (rewritten) return rewritten;
  }

  if (!needsHomeExportInBashLc(script)) return entry;
  return {
    ...entry,
    args: ["-lc", `${HOME_EXPORT_PREFIX}${script}`],
  };
}

/**
 * Cursor's GUI MCP host spawns stdio servers without a login shell PATH or HOME.
 * Wrap npx/mcpm via mcp-cursor-launch.sh and inject HOME into overlay bash -lc scripts.
 */
export function wrapCursorGuiStdioEntry(
  server: McpServer,
  entry: Record<string, unknown>,
  agentName: string,
): Record<string, unknown> {
  if (agentName !== "cursor" || server.url) return entry;
  if (isAlreadyWrapped(entry)) return entry;

  const launcher = resolveMcpCursorLauncher();
  const overlayRoot = resolveMcpCursorOverlayRoot();

  if (server.command === "/bin/bash" && server.args[0] === "-lc") {
    return wrapBashLcOverlay(entry, server, launcher, overlayRoot);
  }

  if (!launcher) return entry;

  const cmdBase = basename(server.command);
  if (cmdBase === "npx" || cmdBase === "mcpm") {
    return wrapNpxOrMcpm(entry, server, launcher);
  }

  return entry;
}

function finalizeCursorGuiEntry(
  entry: Record<string, unknown>,
  launcher: string,
  overlayRoot: string | null,
): Record<string, unknown> | undefined {
  if (entry.url || isAlreadyWrapped(entry)) return undefined;

  const command = typeof entry.command === "string" ? entry.command : "";
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  if (command === "/bin/bash" && args[0] === "-lc" && typeof args[1] === "string") {
    return finalizeBashLcEntry(entry, args[1], launcher, overlayRoot);
  }

  const cmdBase = basename(command);
  if (cmdBase !== "npx" && cmdBase !== "mcpm") return undefined;
  const wrapped: Record<string, unknown> = { command: launcher, args: [command, ...args] };
  if (entry.env) wrapped.env = entry.env;
  return wrapped;
}

function finalizeBashLcEntry(
  entry: Record<string, unknown>,
  script: string,
  launcher: string,
  overlayRoot: string | null,
): Record<string, unknown> | undefined {
  if (overlayRoot) {
    const rewritten = rewriteOverlayBashLcEntry(entry, launcher, overlayRoot);
    if (rewritten) return rewritten;
  }
  return needsHomeExportInBashLc(script) ? { ...entry, args: ["-lc", `${HOME_EXPORT_PREFIX}${script}`] } : undefined;
}

/** Post-process every Cursor mcp.json entry (including user-managed servers). */
export function finalizeCursorGuiMcpEntries(entries: Record<string, Record<string, unknown>>): void {
  const launcher = resolveMcpCursorLauncher();
  const overlayRoot = resolveMcpCursorOverlayRoot();
  if (!launcher) return;

  for (const [name, entry] of Object.entries(entries)) {
    const finalized = finalizeCursorGuiEntry(entry, launcher, overlayRoot);
    if (finalized) entries[name] = finalized;
  }
}
