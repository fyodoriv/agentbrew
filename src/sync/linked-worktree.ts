/**
 * A project Agentfile in a linked git worktree of a checkout agentbrew
 * already uses must not be registered as a new source (sync-skip-linked-
 * worktree-agentfile). Registering it shadows the live commands with a copy
 * that disappears when the worktree is removed.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";

/** The main checkout of the linked worktree at `dir`, or undefined when `dir` is not one. */
function mainCheckoutOf(dir: string): string | undefined {
  try {
    if (!statSync(resolve(dir, ".git")).isFile()) return undefined;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(resolve(dir, ".git"), "utf-8"))?.[1]?.trim();
    const match = gitdir && /^(.*)[/\\]\.git[/\\]worktrees[/\\][^/\\]+[/\\]?$/.exec(resolve(dir, gitdir));
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function isUnder(path: string, root: string): boolean {
  const p = resolve(expandHome(path));
  return p === root || p.startsWith(`${root}/`);
}

/** The main checkout to name in a warning when sync should skip the project Agentfile at `dir`. */
export function linkedWorktreeToSkip(dir: string, state: AgentBrewState | undefined): string | undefined {
  const main = mainCheckoutOf(dir);
  if (!main || !state) return undefined;
  const entries = [
    ...(state.skillSourceDirs ?? []),
    ...(state.commandSourceDirs ?? []),
    ...(state.agentSourceDirs ?? []),
  ];
  return entries.some((e) => isUnder(e.path, main)) ? main : undefined;
}

/** The one warning line sync prints when it skips the project Agentfile. */
export function linkedWorktreeWarning(main: string, home = homedir()): string {
  const shown = main.startsWith(`${home}/`) ? `~${main.slice(home.length)}` : main;
  return `⚠ Skipped this worktree's Agentfile: it is a linked worktree of ${shown}. Sync from there.`;
}
