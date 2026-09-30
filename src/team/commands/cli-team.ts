import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";
import yaml from "js-yaml";
import { detectSourceType } from "../../git-source-url.js";
import { cloneOrUpdateRepo, deriveRepoName } from "../../mcp/mcp-git.js";
import { mergeMemoryPackPaths, removeTeamMemoryPackPaths } from "../../memory/enable.js";
import { resolveMemoryPackPaths } from "../../memory/pack-paths.js";
import { loadState, requireState, saveState } from "../../state.js";
import type { AgentBrewState } from "../../types.js";
import { ICON_SUCCESS } from "../../ui/output.js";

/**
 * Registers the `agentbrew team` command group — manages team overlays.
 *
 * ## What `team set <url>` does
 *
 * Clones the overlay repo to ~/.config/agentbrew/mcp-repos/<repo>/, reads its
 * Agentfile.yaml, and merges its contents into state with origin: "team:<label>".
 * If a team is already set, cleanly replaces it (one team at a time).
 * Re-running with the same URL refreshes overlay paths from the latest clone.
 *
 * ## What `team unset` does
 *
 * Removes all state entries tagged origin: "team:<label>" and clears state.team.
 * User-added entries (origin: "user") and globally-defined entries (origin: "global")
 * survive untouched. Idempotent — running unset with no team set is a no-op.
 *
 * ## What `team status` does
 *
 * Reports the current team configuration or "No team overlay set." if none is active.
 * Always exits 0 (informational, not a check).
 */
export function registerTeamCommands(program: Command): void {
  const team = program.command("team").description("Manage team overlays (one team at a time)");

  team
    .command("set <url>")
    .description("Install and activate a team overlay")
    .action(async (url: string) => {
      const state = requireState();
      if (!state) return;
      await teamSetAction(state, url);
    });

  team
    .command("unset")
    .description("Remove the active team overlay")
    .action(() => {
      const state = requireState();
      if (!state) return;

      if (!state.team) {
        console.log(chalk.dim("No team overlay set."));
        return;
      }

      const label = state.team.label;
      unsetTeam(state);
      saveState(state);
      console.log(`${ICON_SUCCESS} Team "${label}" unset`);
    });

  team
    .command("status")
    .description("Show the current team overlay")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const state = loadState();

      if (!state?.team) {
        if (options.json) {
          console.log(JSON.stringify({ team: null }, null, 2));
        } else {
          console.log("No team overlay set.");
          console.log(chalk.dim("Run `agentbrew team set <url>` to install one."));
        }
        return;
      }

      const { label, url, lastSyncedAt } = state.team;

      if (options.json) {
        console.log(JSON.stringify({ team: state.team }, null, 2));
      } else {
        console.log(chalk.bold(`Team: ${label}`));
        console.log(`URL:  ${url}`);
        if (lastSyncedAt) {
          const relativeTime = getRelativeTime(new Date(lastSyncedAt));
          console.log(`Last sync: ${lastSyncedAt} (${relativeTime})`);
        }
      }
    });
}

/** Remove all state entries tagged with origin: "team:<label>". */
function unsetTeam(state: AgentBrewState): void {
  if (!state.team) return;

  const origin = `team:${state.team.label}`;

  // Remove sources with this origin
  if (state.sources) {
    state.sources = state.sources.filter((s) => s.origin !== origin);
  }

  // Remove MCP servers with this origin
  if (state.mcpServers) {
    state.mcpServers = state.mcpServers.filter((m) => m.source !== origin);
  }

  // Remove skill source dirs with this origin
  if (state.skillSourceDirs) {
    state.skillSourceDirs = state.skillSourceDirs.filter((d) => d.origin !== origin);
  }

  if (state.team.memoryPackPaths?.length) {
    removeTeamMemoryPackPaths(state, state.team.memoryPackPaths);
  }

  // Clear team config
  state.team = undefined;
}

/** Format a date as human-readable relative time (e.g., "12 min ago"). */
function getRelativeTime(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return `${Math.floor(seconds / 604800)} weeks ago`;
}

/** Load and parse Agentfile.yaml from the team overlay directory. */
function loadTeamAgentfile(teamPath: string): Record<string, unknown> | undefined {
  const agentfilePath = join(teamPath, "Agentfile.yaml");
  if (!existsSync(agentfilePath)) {
    console.error(chalk.red(`✗ Agentfile.yaml not found at ${agentfilePath}`));
    return undefined;
  }

  try {
    const content = readFileSync(agentfilePath, "utf-8");
    return (yaml.load(content) as Record<string, unknown>) || {};
  } catch (error) {
    console.error(chalk.red(`✗ Failed to parse Agentfile.yaml: ${error}`));
    return undefined;
  }
}

/** Merge team overlay Agentfile contents into state. */
function mergeTeamAgentfile(
  state: AgentBrewState,
  agentfile: Record<string, unknown>,
  label: string,
  now: string,
): void {
  const origin = `team:${label}`;

  // Merge sources
  if (Array.isArray(agentfile.sources)) {
    if (!state.sources) state.sources = [];
    for (const sourceUrl of agentfile.sources) {
      const existing = state.sources.find((s) => s.url === sourceUrl);
      if (!existing) {
        state.sources.push({
          url: sourceUrl,
          type: detectSourceType(sourceUrl),
          skillsInstalled: [],
          availableItems: [],
          addedAt: now,
          origin,
        });
      }
    }
  }

  // Merge MCP servers (placeholder for full implementation)
  if (Array.isArray(agentfile.mcp)) {
    // MCP registration happens elsewhere
  }

  // Merge rules (placeholder for full implementation)
  if (typeof agentfile.rules === "string") {
    // Rules merging happens elsewhere
  }
}

/** Resolve a single overlay-relative path from the Agentfile; warn + return
 *  undefined if declared but missing. */
function resolveOverlayPath(teamPath: string, rel: unknown, label: string): string | undefined {
  if (typeof rel !== "string") return undefined;
  const resolved = join(teamPath, rel);
  if (existsSync(resolved)) return resolved;
  console.error(chalk.yellow(`⚠ ${label} declared at ${rel} but not found at ${resolved} — skipped`));
  return undefined;
}

/** Resolve the overlay-provided extension paths (catalogOverlay, adapters[],
 *  agents) declared in the overlay Agentfile. */
function resolveOverlayPaths(
  teamPath: string,
  agentfile: Record<string, unknown>,
): { catalogOverlayPath?: string; adapterDirs: string[]; agentsOverlayPath?: string } {
  const catalogOverlayPath = resolveOverlayPath(teamPath, agentfile.catalogOverlay, "catalogOverlay");
  const agentsOverlayPath = resolveOverlayPath(teamPath, agentfile.agents, "agents overlay");
  const adapterDirs: string[] = [];
  if (Array.isArray(agentfile.adapters)) {
    for (const rel of agentfile.adapters) {
      const resolved = resolveOverlayPath(teamPath, rel, "adapter");
      if (resolved) adapterDirs.push(resolved);
    }
  }
  return {
    ...(catalogOverlayPath ? { catalogOverlayPath } : {}),
    adapterDirs,
    ...(agentsOverlayPath ? { agentsOverlayPath } : {}),
  };
}

/** Handle `agentbrew team set <url>` command. */
async function teamSetAction(state: AgentBrewState, url: string): Promise<void> {
  const sameTeam = state.team?.url === url;
  if (sameTeam) {
    console.log(chalk.dim(`Refreshing team "${state.team?.label}" overlay...`));
    if (state.team?.memoryPackPaths?.length) {
      removeTeamMemoryPackPaths(state, state.team.memoryPackPaths);
    }
  } else if (state.team) {
    console.log(chalk.dim(`Existing team "${state.team.label}" detected — replacing`));
    unsetTeam(state);
  }

  const repoName = deriveRepoName(url);
  const teamPath = cloneOrUpdateRepo(url, repoName);

  console.log(`${ICON_SUCCESS} Using overlay at ${teamPath}`);

  // Load and parse Agentfile.yaml
  const agentfile = loadTeamAgentfile(teamPath);
  if (!agentfile) {
    process.exitCode = 1;
    return;
  }

  // Derive label from Agentfile name field, fallback to repo basename
  const label = (agentfile.name as string) || repoName;
  const now = new Date().toISOString();

  // Resolve the overlay-provided extension paths (catalog, MCP-format adapters,
  // agents) declared in the overlay Agentfile, relative to the team-clone root.
  const { catalogOverlayPath, adapterDirs, agentsOverlayPath } = resolveOverlayPaths(teamPath, agentfile);

  const memoryPackPaths = Array.isArray(agentfile.memoryPacks)
    ? resolveMemoryPackPaths(
        teamPath,
        agentfile.memoryPacks.filter((x): x is string => typeof x === "string"),
      )
    : [];
  if (memoryPackPaths.length) {
    mergeMemoryPackPaths(state, memoryPackPaths);
  }

  // Set team config in state
  state.team = {
    label,
    url,
    cachedAt: now,
    lastSyncedAt: now,
    ...(catalogOverlayPath ? { catalogOverlayPath } : {}),
    ...(adapterDirs.length > 0 ? { adapterDirs } : {}),
    ...(agentsOverlayPath ? { agentsOverlayPath } : {}),
    ...(memoryPackPaths.length ? { memoryPackPaths } : {}),
  };

  // Merge Agentfile contents into state
  mergeTeamAgentfile(state, agentfile, label, now);

  saveState(state);
  console.log(`${ICON_SUCCESS} Team "${label}" active`);
  console.log(chalk.dim("  Run `agentbrew sync` to deploy overlay skills to your agents."));
}
