import chalk from "chalk";
import { getConfigServers, getStateSources } from "./agentfile.js";
import { loadSyncErrors } from "./core/errors.js";
import { checkMcpEnvVarsDrift } from "./drift-checks/mcp.js";
import { loadMcpHealthSnapshot, unhealthyMcpEntries } from "./mcp/health-snapshot.js";
import { isMemoryEnabled } from "./memory/enable.js";
import { isMemoryLaunchAgentInstalled, memoryLaunchAgentSupported } from "./memory/launchagent.js";
import { type AutoRepairState, probeAutoRepairHealth } from "./sync/auto-repair-health.js";
import { LAUNCHAGENT_LABEL } from "./sync/launchagent.js";
import { AUTO_SYNC_INTERVAL_MINUTES } from "./sync/scheduler-paths.js";
import type { AgentBrewState } from "./types.js";

/** One thing the bare `agentbrew` dashboard asks the user to do, with the exact command. */
export interface NextStep {
  command: string;
  why: string;
}

/** What the dashboard knows about this machine. Read-only facts; collecting them writes nothing. */
export interface DashboardFacts {
  hasSkillsOrServers: boolean;
  syncErrors: number;
  repairableDrift: number;
  autoRepair: AutoRepairState;
  /** `AGENTBREW_NO_AUTO_SYNC=1`: the user chose no background repair job. */
  autoSyncOptedOut: boolean;
  memoryServiceMissing: boolean;
  mcpNeedSetup: number;
  mcpFailing: number;
}

/** Scheduler states that `agentbrew auto-sync install` fixes. */
const REINSTALL_STATES: ReadonlySet<AutoRepairState> = new Set(["not-installed", "broken", "not-loaded", "stale"]);

/** Collect the dashboard facts. Local reads only: no network, no writes. */
export function collectDashboardFacts(state: AgentBrewState, repairableDrift: number): DashboardFacts {
  return {
    hasSkillsOrServers: getStateSources(state).length > 0 || getConfigServers().length > 0,
    syncErrors: loadSyncErrors()?.errors.length ?? 0,
    repairableDrift,
    autoRepair: probeAutoRepairHealth().state,
    autoSyncOptedOut: process.env.AGENTBREW_NO_AUTO_SYNC === "1",
    memoryServiceMissing: isMemoryEnabled(state) && memoryLaunchAgentSupported() && !isMemoryLaunchAgentInstalled(),
    mcpNeedSetup: checkMcpEnvVarsDrift().length,
    mcpFailing: unhealthyMcpEntries(loadMcpHealthSnapshot()).length,
  };
}

function syncStep(facts: DashboardFacts): NextStep | undefined {
  const parts: string[] = [];
  if (facts.syncErrors > 0) parts.push(`retry the ${facts.syncErrors} error(s) from the last sync`);
  if (facts.repairableDrift > 0) parts.push(`repair ${facts.repairableDrift} drift issue(s)`);
  if (parts.length === 0) return undefined;
  const why = parts.join(" and ");
  return {
    command: "agentbrew sync",
    why: `${why[0].toUpperCase()}${why.slice(1)}. Preview first: agentbrew sync --dry-run`,
  };
}

function autoRepairStep(facts: DashboardFacts): NextStep | undefined {
  if (facts.autoSyncOptedOut) return undefined;
  if (REINSTALL_STATES.has(facts.autoRepair)) {
    return {
      command: "agentbrew auto-sync install",
      why: `Start the drift-repair job (it runs every ${AUTO_SYNC_INTERVAL_MINUTES} min)`,
    };
  }
  if (facts.autoRepair === "disabled") {
    return {
      command: `launchctl enable gui/$UID/${LAUNCHAGENT_LABEL} && agentbrew auto-sync install`,
      why: "launchd has the drift-repair job disabled. Skip this if you disabled it on purpose",
    };
  }
  return undefined;
}

/** Order what needs the user, most important first. An empty list means nothing needs them. */
export function planNextSteps(facts: DashboardFacts): NextStep[] {
  const steps: Array<NextStep | undefined> = [
    facts.hasSkillsOrServers
      ? undefined
      : { command: "agentbrew install --recommended", why: "Install the recommended skills and MCP servers" },
    syncStep(facts),
    autoRepairStep(facts),
    facts.memoryServiceMissing
      ? { command: "agentbrew memory fix", why: "Memory is on, but its background service is not installed" }
      : undefined,
    facts.mcpNeedSetup > 0
      ? { command: "agentbrew setup", why: `${facts.mcpNeedSetup} MCP server(s) need an API key or other setup` }
      : undefined,
    facts.mcpFailing > 0
      ? { command: "agentbrew mcp probe --deep", why: `${facts.mcpFailing} MCP server(s) fail their health check` }
      : undefined,
  ];
  return steps.filter((step): step is NextStep => step !== undefined);
}

/** Print the next action, the steps after it, and where the settings live. */
export function printNextSteps(steps: NextStep[]): void {
  const [first, ...rest] = steps;
  if (!first) {
    console.log(chalk.green("  Nothing needs you now.\n"));
    console.log(chalk.dim("  Quick actions:"));
    console.log(chalk.dim("    agentbrew install <name>      Add a skill or MCP server"));
    console.log(chalk.dim("    agentbrew catalog             Browse available items"));
    console.log(chalk.dim("    agentbrew status --verbose    Full details"));
  } else {
    console.log(`  ${chalk.cyan.bold("Next:")} ${chalk.cyan(first.command)}`);
    console.log(chalk.dim(`        ${first.why}`));
    if (rest.length > 0) {
      const width = Math.max(...rest.map((s) => s.command.length));
      console.log(chalk.dim("  Then:"));
      for (const step of rest) console.log(`    ${step.command.padEnd(width)}  ${chalk.dim(step.why)}`);
    }
  }
  console.log(chalk.dim("  Settings: agentbrew config (change one: agentbrew config set <key> <value>)\n"));
}
