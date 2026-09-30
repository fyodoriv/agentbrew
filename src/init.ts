import chalk from "chalk";
import { generateAgentfile, globalAgentfileDir, loadAgentfile, writeAgentfile } from "./agentfile.js";
import { detectAgents, discoverAllSkills } from "./agents.js";
import { install } from "./catalog/install.js";
import { fetchSources } from "./fetch-sources.js";
import { discoverMcpServers } from "./mcp/mcp.js";
import { installShellHook, isShellHookInstalled } from "./shell-hook.js";
import { defaultState, getStatePath, loadState, saveState } from "./state.js";
import { applySchemaMigrations, printMigrationHints } from "./state-migrations.js";
import { installAutoSync, isAutoSyncInstalled } from "./sync/auto-sync.js";
import { autoSync } from "./sync-runner.js";
import type { AgentBrewState, AgentConfig, McpServer, SkillInfo } from "./types.js";
import { ICON_SUCCESS, ICON_WARNING } from "./ui/output.js";
import { checkGitAvailable, checkPathConflicts } from "./utils.js";

interface InitResult {
  agents: AgentConfig[];
  detectedAgents: AgentConfig[];
  skills: Map<string, SkillInfo>;
  mcpServers: McpServer[];
}

function detectAndSave(previousState?: AgentBrewState): InitResult | undefined {
  const agents = detectAgents();
  const detectedAgents = agents.filter((a) => a.detected);

  if (detectedAgents.length === 0) {
    console.log(chalk.yellow("No AI coding agents detected."));
    console.log("Install at least one agent (Claude Code, Cursor, Windsurf, etc.) and try again.");
    return undefined;
  }

  // Check git availability before persisting state — if git is missing, we must
  // not save state that makes subsequent `init` think it's already initialized.
  if (!checkGitAvailable()) {
    process.exitCode = 1;
    return undefined;
  }

  // Warn about stale PATH binaries that shadow the Node.js CLI
  const conflicts = checkPathConflicts();
  if (conflicts.length > 0) {
    console.log(chalk.bold("\nPATH conflict detected:\n"));
    for (const p of conflicts) {
      console.log(`  ${ICON_WARNING} ${p} is not a Node.js binary and may shadow agentbrew`);
    }
    console.log(chalk.dim(`\n  Remove the conflicting file(s) so the npm-installed CLI takes priority.\n`));
  }

  console.log(chalk.bold("\nDetecting agents...\n"));
  for (const agent of detectedAgents) {
    console.log(`  ${ICON_SUCCESS} ${agent.name}`);
  }

  console.log(chalk.bold("\nDiscovering existing config...\n"));
  const skills = discoverAllSkills(detectedAgents);
  const discoveredServers = discoverMcpServers(detectedAgents);

  console.log(`  Skills: ${chalk.bold(String(skills.size))} unique across ${detectedAgents.length} agents`);
  console.log(`  MCP servers: ${chalk.bold(String(discoveredServers.length))} unique`);

  const state = defaultState();
  // Strip non-serializable fields (commandTransform is a function) before persisting
  state.agents = agents.map(({ commandTransform, ...rest }) => rest);

  // Merge discovered MCP servers with any existing user-added servers
  const existingServers = previousState?.mcpServers ?? [];
  const discoveredNames = new Set(discoveredServers.map((s) => s.name));
  const preservedServers = existingServers.filter((s) => !discoveredNames.has(s.name));
  state.mcpServers = [...discoveredServers, ...preservedServers];

  // Preserve user configuration that detection doesn't touch
  if (previousState?.sources) state.sources = previousState.sources;
  if (previousState?.skillSourceDirs) state.skillSourceDirs = previousState.skillSourceDirs;
  if (previousState?.agentSourceDirs) state.agentSourceDirs = previousState.agentSourceDirs;
  if (previousState?.commandSourceDirs) state.commandSourceDirs = previousState.commandSourceDirs;

  // One-time migration hints fire when an upgraded user runs init/sync against
  // a state.yaml that still carries removed fields. Each removed field is
  // dropped on this save — saveState serialises the typed state only, so any
  // field TypeScript doesn't know about disappears from disk. See
  // `src/state-migrations.ts` for the registry and how to add a new migration.
  printMigrationHints(applySchemaMigrations(previousState));

  saveState(state);

  return { agents, detectedAgents, skills, mcpServers: state.mcpServers };
}

/** Print post-init summary with discovered/installed counts. */
function printInitSummary(result: InitResult, options?: { skipInstall?: boolean; skipSync?: boolean }): void {
  const skipInstall = options?.skipInstall ?? false;
  const skipSync = options?.skipSync ?? false;
  console.log(chalk.bold("\n── Summary ─────────────────────────────────\n"));
  console.log(`  ${ICON_SUCCESS} ${result.detectedAgents.length} agents detected`);
  console.log(`  ${ICON_SUCCESS} ${result.skills.size} skills discovered`);
  console.log(`  ${ICON_SUCCESS} ${result.mcpServers.length} MCP servers discovered`);
  if (!skipInstall) console.log(`  ${ICON_SUCCESS} Recommended skills + MCP servers installed`);
  if (!skipSync) console.log(`  ${ICON_SUCCESS} Synced to all agents`);
  console.log(`  ${ICON_SUCCESS} State saved to ${getStatePath()}`);

  const globalDir = globalAgentfileDir();
  if (!loadAgentfile(globalDir)) {
    const content = generateAgentfile();
    if (content) {
      const agentfilePath = writeAgentfile(globalDir, content);
      console.log(`  ${ICON_SUCCESS} Global Agentfile written to ${agentfilePath}`);
    }
  }

  if (skipInstall || skipSync) {
    console.log(chalk.bold("\n── Next steps ──────────────────────────────\n"));
    if (skipInstall) {
      console.log(`  ${chalk.cyan("agentbrew install --recommended")}   Install curated skills + MCP servers`);
    }
    if (skipSync) {
      console.log(`  ${chalk.cyan("agentbrew sync")}                    Deploy everything to all agents`);
    }
    console.log(`  ${chalk.cyan("agentbrew catalog")}                 Browse the full catalog`);
    console.log(`  ${chalk.cyan("agentbrew status")}                  See what's configured`);
  } else {
    console.log(chalk.bold("\n  Done! Run `agentbrew status` to see what's configured.\n"));
  }
}

async function postInit(result: InitResult, options?: { skipInstall?: boolean; skipSync?: boolean }): Promise<void> {
  // Auto-install background drift repair (macOS: LaunchAgent, Linux: systemd/cron)
  if (!isAutoSyncInstalled()) {
    console.log(chalk.bold("\nSetting up auto-repair...\n"));
    await installAutoSync();
  }

  // Auto-install shell hook (cd detection for Agentfile/skills/MCP)
  if (!isShellHookInstalled()) {
    installShellHook();
  }

  // Auto-fetch sources
  console.log(chalk.bold("\nFetching sources...\n"));
  await fetchSources();

  // Always install recommended + sync — both are idempotent no-ops on a
  // fully-synced system (installRecommended returns early when `pending.total
  // === 0`; autoSync repairs drift or exits quietly). Dropping the previous
  // `isFirstRun` gate means `init` now fulfils its "set up everything" promise
  // for users with pre-existing config too, not just brand-new machines.
  if (!options?.skipInstall) {
    console.log(chalk.bold("\nInstalling recommended skills + MCP servers...\n"));
    await install(undefined, { recommended: true });
  }

  if (!options?.skipSync) {
    await autoSync();
  }

  printInitSummary(result, options);
}

export async function init(options?: { skipInstall?: boolean; skipSync?: boolean }): Promise<void> {
  const existingState = loadState();
  if (existingState) {
    console.log(chalk.dim(`Refreshing agentbrew (state file: ${getStatePath()})...\n`));
  }

  // Always run detection + postInit. When state exists, previousState is passed
  // so user-added mcpServers, sources, skillSourceDirs, etc. are preserved.
  // `init` is idempotent — re-running it refreshes recommended install + sync
  // instead of exiting with the old "already initialized" message. Users who
  // want to force full re-initialisation (including organization flag re-detection)
  // can still use `agentbrew init --force`.
  const result = detectAndSave(existingState);
  if (!result) return;

  console.log(chalk.bold("\nDiscovered MCP servers:\n"));
  if (result.mcpServers.length > 0) {
    for (const server of result.mcpServers) {
      console.log(`  ${chalk.cyan(server.name)} — ${server.command} ${server.args.join(" ")}`);
    }
  } else {
    console.log("  (none found)");
  }

  console.log(chalk.bold("\nDiscovered skills:\n"));
  if (result.skills.size > 0) {
    for (const [name, skill] of result.skills) {
      console.log(`  ${chalk.cyan(name)} — from ${skill.source}`);
    }
  } else {
    console.log("  (none found)");
  }

  await postInit(result, options);
}

export async function initForce(options?: { skipInstall?: boolean; skipSync?: boolean }): Promise<void> {
  console.log(chalk.dim("Re-initializing agentbrew...\n"));

  const previousState = loadState();
  const result = detectAndSave(previousState);
  if (!result) return;

  await postInit(result, options);
}
