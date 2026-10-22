import chalk from "chalk";
import { getConfigServers, getStateSources } from "./agentfile.js";
import { loadSyncErrors } from "./core/errors.js";
import { checkMcpEnvVarsDrift } from "./drift-checks/mcp.js";
import type { DriftItem } from "./drift-checks/types.js";
import { DRIFT_FIXES, syncRepairs } from "./drift-fixes.js";
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
  /** Type of each drift item, user-added items left out. */
  drift: ReadonlyArray<DriftItem["type"]>;
  /** Already "off" when the user said no to the job, "unsupported" with no scheduler. */
  autoRepair: AutoRepairState;
  memoryServiceMissing: boolean;
  mcpNeedSetup: number;
  mcpFailing: number;
}

/** Scheduler states that `agentbrew auto-sync install` fixes. */
const REINSTALL_STATES: ReadonlySet<AutoRepairState> = new Set(["not-installed", "broken", "not-loaded", "stale"]);

/** Collect the dashboard facts. Local reads only: no network, no writes. */
export function collectDashboardFacts(
  state: AgentBrewState,
  drift: ReadonlyArray<Pick<DriftItem, "type">>,
): DashboardFacts {
  return {
    hasSkillsOrServers: getStateSources(state).length > 0 || getConfigServers().length > 0,
    syncErrors: loadSyncErrors()?.errors.length ?? 0,
    drift: drift.map((item) => item.type),
    autoRepair: probeAutoRepairHealth().state,
    memoryServiceMissing: isMemoryEnabled(state) && memoryLaunchAgentSupported() && !isMemoryLaunchAgentInstalled(),
    mcpNeedSetup: checkMcpEnvVarsDrift().length,
    mcpFailing: unhealthyMcpEntries(loadMcpHealthSnapshot()).length,
  };
}

function syncStep(facts: DashboardFacts): NextStep | undefined {
  const parts: string[] = [];
  if (facts.syncErrors > 0) parts.push(`retry the ${facts.syncErrors} error(s) from the last sync`);
  const syncDrift = facts.drift.filter(syncRepairs).length;
  if (syncDrift > 0) parts.push(`repair ${syncDrift} drift issue(s)`);
  if (parts.length === 0) return undefined;
  const why = parts.join(" and ");
  return {
    command: "agentbrew sync",
    why: `${why[0].toUpperCase()}${why.slice(1)}. Preview first: agentbrew sync --dry-run`,
  };
}

/** One step per fix for drift that sync does not repair, named by DRIFT_FIXES; skips fixes already listed. */
function driftFixSteps(facts: DashboardFacts, listed: ReadonlySet<string>): NextStep[] {
  const byFix = new Map<string, Map<DriftItem["type"], number>>();
  for (const type of facts.drift) {
    if (syncRepairs(type)) continue;
    const counts = byFix.get(DRIFT_FIXES[type]) ?? new Map<DriftItem["type"], number>();
    counts.set(type, (counts.get(type) ?? 0) + 1);
    byFix.set(DRIFT_FIXES[type], counts);
  }
  return [...byFix]
    .filter(([fix]) => !listed.has(fix))
    .map(([fix, counts]) => ({
      command: fix,
      why: `Fix ${[...counts].map(([type, n]) => `${n} ${type} drift item(s)`).join(", ")}; sync does not repair these`,
    }));
}

function autoRepairStep(facts: DashboardFacts): NextStep | undefined {
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
  const listed = steps.filter((step): step is NextStep => step !== undefined);
  return [...listed, ...driftFixSteps(facts, new Set(listed.map((step) => step.command)))];
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
