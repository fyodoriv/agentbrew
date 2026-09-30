import chalk from "chalk";
import { getConfigServers, getStateSources } from "./agentfile.js";
import { builtCliRoot, checkCliBuildDrift, rebuildCli } from "./cli-build-health.js";
import type { DriftItem } from "./drift.js";
import {
  checkAgentDefsDrift,
  checkBarePlaceholdersDrift,
  checkBrokenSymlinks,
  checkCommandsDrift,
  checkDevinPermissionDrift,
  checkEnvHygieneDrift,
  checkHooksDrift,
  checkInstructionsDrift,
  checkLaunchAgentPathDrift,
  checkMcpDrift,
  checkMcpEnvVarsDrift,
  checkRulesDrift,
  checkSkillsDrift,
  checkSkillsValidity,
  checkUserAddedMcpServers,
  checkUserCreatedCommands,
  checkUserCreatedSkills,
  formatDriftSummary,
} from "./drift.js";
import { fix } from "./repair.js";
import { requireState } from "./state.js";
import { probeAutoRepairHealth } from "./sync/auto-repair-health.js";
import type { AgentBrewState } from "./types.js";
import { ICON_ERROR, ICON_WARNING } from "./ui/output.js";

export { fix };

/** Output health check results as JSON. */
function outputHealthJson(state: AgentBrewState, allDrift: DriftItem[], userAdditions: DriftItem[]): void {
  const detectedAgents = state.agents.filter((a) => a.detected);
  const data = {
    agents: detectedAgents.length,
    mcpServers: getConfigServers().length,
    sources: getStateSources(state).length,
    driftCount: allDrift.length,
    status: allDrift.length === 0 ? "clean" : "drift",
    drift: allDrift,
    autoRepair: probeAutoRepairHealth(),
    // User-created skills/commands/MCP servers are NOT drift — they are
    // intentional additions agentbrew will never touch. Reported as a
    // separate field so JSON consumers can see them without inflating the
    // drift count. See `user-additions-not-drift` in git log for rationale.
    userAdditions,
  };
  console.log(JSON.stringify(data, null, 2));
  process.exitCode = allDrift.length > 0 ? 1 : 0;
}

/** Output health check results in CI-friendly format. */
function outputHealthCi(
  state: AgentBrewState,
  syncDrift: DriftItem[],
  allDrift: DriftItem[],
  userAdditions: DriftItem[],
): void {
  const detectedAgents = state.agents.filter((a) => a.detected);
  console.log(
    `agents=${detectedAgents.length} servers=${getConfigServers().length} sources=${getStateSources(state).length}`,
  );
  if (userAdditions.length > 0) {
    // Informational only — never fails CI, never counted as drift.
    console.log(`user-additions=${userAdditions.length}`);
  }
  if (allDrift.length === 0) {
    console.log("drift=0 status=clean");
    process.exitCode = 0;
  } else {
    console.error(`drift=${allDrift.length} status=failed`);
    for (const item of allDrift) {
      console.error(`  ${item.agent} [${item.type}] ${item.detail}`);
    }
    const repairHint =
      syncDrift.length === allDrift.length
        ? "fix: run `agentbrew sync` to repair drift"
        : "fix: inspect drift items above for repair commands";
    console.log(repairHint);
    process.exitCode = 1;
  }
}

/** Print human-readable health status header. */
function printHealthHeader(state: AgentBrewState): void {
  console.log(chalk.bold("\nHealth check\n"));
  const detectedAgents = state.agents.filter((a) => a.detected);
  console.log(`  Agents: ${detectedAgents.length} detected`);
  console.log(`  MCP servers: ${getConfigServers().length} registered`);
  console.log(`  Sources: ${getStateSources(state).length} tracked`);
}

/** Print warning drift items with a title. */
function printWarningSection(title: string, items: DriftItem[], showAgent: boolean): void {
  if (items.length === 0) return;
  console.log(chalk.bold(`\n${title}\n`));
  for (const item of items) {
    const prefix = showAgent ? `${item.agent} — ` : "";
    console.error(`  ${ICON_WARNING} ${prefix}${item.detail}`);
  }
}

/** Print the final drift status and optionally auto-repair. Returns true if handled (clean or auto-fixed). */
async function printDriftStatus(
  syncDrift: DriftItem[],
  allDrift: DriftItem[],
  userAddedDrift: DriftItem[],
  autoFix: boolean,
): Promise<boolean> {
  // User additions are not drift (see user-additions-not-drift in git log);
  // allDrift already excludes them. If user-added items are the ONLY thing
  // we noticed, still report clean but mention the informational section.
  if (allDrift.length === 0 && userAddedDrift.length > 0) {
    console.log(chalk.bold("\nDrift:"), chalk.green("clean ✓"), chalk.dim("(user additions are informational)"));
    console.log();
    process.exitCode = 0;
    return true;
  }

  if (allDrift.length === 0) {
    console.log(chalk.bold("\nDrift:"), chalk.green("clean ✓"));
    console.log();
    process.exitCode = 0;
    return true;
  }

  if (syncDrift.length > 0 && autoFix) {
    const breakdown = formatDriftSummary(syncDrift);
    console.log(
      chalk.bold(`\nDrift: ${chalk.yellow(`${syncDrift.length} issue(s)`)} ${breakdown} — auto-repairing...\n`),
    );
    for (const item of syncDrift) {
      console.error(`  ${ICON_WARNING} ${item.agent} [${item.type}] — ${item.detail}`);
    }
    await fix();
    return true;
  }

  return false;
}

interface DriftSections {
  syncDrift: DriftItem[];
  mcpEnvDrift: DriftItem[];
  envHygieneDrift: DriftItem[];
  skillValidity: DriftItem[];
  cliBuildDrift: DriftItem[];
  userAddedDrift: DriftItem[];
  allDrift: DriftItem[];
}

function printSkillValiditySection(skillValidity: DriftItem[]): void {
  if (skillValidity.length === 0) return;
  console.log(chalk.bold(`\nSkill validation: ${chalk.yellow(`${skillValidity.length} invalid skill(s)`)}\n`));
  for (const item of skillValidity) {
    console.error(`  ${ICON_WARNING} ${item.agent} — ${item.detail}`);
  }
  console.log(chalk.dim(`\n  Fix skill frontmatter manually, then run ${chalk.white("agentbrew skills validate")}.\n`));
}

function printCliBuildDriftSection(cliBuildDrift: DriftItem[]): void {
  if (cliBuildDrift.length === 0) return;
  console.log(chalk.bold(`\nCLI build: ${chalk.yellow("stale")}\n`));
  for (const item of cliBuildDrift) {
    console.error(`  ${ICON_WARNING} ${item.detail}`);
  }
}

function printUserAdditionsSection(userAddedDrift: DriftItem[], verbose: boolean): void {
  if (userAddedDrift.length === 0) return;
  console.log(chalk.bold(`\nUser additions: ${chalk.cyan(`${userAddedDrift.length} item(s)`)}\n`));
  if (verbose) {
    for (const item of userAddedDrift) {
      console.log(`  ${chalk.cyan("ℹ")} ${item.agent} — ${item.detail}`);
    }
  } else {
    const byType = new Map<string, Map<string, number>>();
    for (const item of userAddedDrift) {
      const type = item.type.replace(/-user-added$/, "") || item.type;
      const perAgent = byType.get(type) ?? new Map<string, number>();
      perAgent.set(item.agent, (perAgent.get(item.agent) ?? 0) + 1);
      byType.set(type, perAgent);
    }
    for (const [type, perAgent] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const total = [...perAgent.values()].reduce((sum, count) => sum + count, 0);
      const agentBits = [...perAgent.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([agent, count]) => (count > 1 ? `${agent} (${count})` : agent))
        .join(", ");
      console.log(`  ${chalk.cyan("ℹ")} ${type}: ${total} — ${agentBits}`);
    }
    console.log(chalk.dim(`  Run ${chalk.white("agentbrew status --fix --verbose")} to list every item.`));
  }
  console.log(
    chalk.dim(
      `\n  These are tracked but not managed by agentbrew. To share them across all your agents (optional), run ${chalk.white("agentbrew import")}.`,
    ),
  );
}

/** Display human-readable drift sections and set exit code. */
async function displayInteractiveDrift(sections: DriftSections, autoFix: boolean, verbose = false): Promise<void> {
  const { syncDrift, mcpEnvDrift, envHygieneDrift, skillValidity, cliBuildDrift, userAddedDrift, allDrift } = sections;
  // Show MCP env var warnings (not auto-fixable)
  printWarningSection(
    `MCP configuration: ${chalk.yellow(`${mcpEnvDrift.length} server(s) need setup`)}`,
    mcpEnvDrift,
    true,
  );
  if (mcpEnvDrift.length > 0) {
    console.log(chalk.dim(`\n  Run ${chalk.white("agentbrew setup")} to configure missing env vars.`));
  }

  // Show env hygiene warnings (not auto-fixable — user must unset env vars)
  printWarningSection(
    `Env hygiene: ${chalk.yellow(`${envHygieneDrift.length} var(s) could leak across agents`)}`,
    envHygieneDrift,
    false,
  );
  if (envHygieneDrift.length > 0) {
    console.log(chalk.dim(`\n  Run ${chalk.white("eval $(agentbrew env sanitize)")} to unset them.`));
  }

  printSkillValiditySection(skillValidity);
  printCliBuildDriftSection(cliBuildDrift);

  // Show user-added items (informational — never auto-repaired, never counted as drift)
  printUserAdditionsSection(userAddedDrift, verbose);

  const handled = await printDriftStatus(syncDrift, allDrift, userAddedDrift, autoFix);
  if (handled) return;

  if (syncDrift.length > 0) {
    const breakdown = formatDriftSummary(syncDrift);
    console.log(chalk.bold(`\nDrift: ${chalk.red(`${syncDrift.length} issue(s)`)} ${breakdown}\n`));
    for (const item of syncDrift) {
      console.error(`  ${ICON_ERROR} ${item.agent} [${item.type}] — ${item.detail}`);
    }
    const repairCommand = syncDrift.some((item) => item.type === "rules-source")
      ? "agentbrew rules dedupe && agentbrew sync"
      : "agentbrew sync";
    console.log(chalk.dim(`\n  Run ${chalk.white(repairCommand)} to repair.\n`));
  }

  process.exitCode = 1;
}

/**
 * Run the health check: collect all drift, display results, and optionally auto-repair.
 * The json and ci options bypass chalk output for machine consumption.
 */
export async function healthCheck(options?: {
  autoFix?: boolean;
  ci?: boolean;
  json?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const autoFix = options?.autoFix ?? false;
  const ci = options?.ci ?? false;

  const state = requireState();
  if (!state) {
    if (ci) console.log("drift=0 status=error reason=not-initialized");
    process.exitCode = 1;
    return;
  }

  const mcpDrift = checkMcpDrift();
  const mcpEnvDrift = checkMcpEnvVarsDrift();
  const mcpBarePlaceholdersDrift = checkBarePlaceholdersDrift();
  const envHygieneDrift = checkEnvHygieneDrift();
  const mcpPermissionDrift = checkDevinPermissionDrift();
  const rulesDrift = checkRulesDrift();
  const skillsDrift = checkSkillsDrift();
  const brokenSymlinks = checkBrokenSymlinks();
  const skillValidity = checkSkillsValidity();
  const commandsDrift = checkCommandsDrift();
  const hooksDrift = checkHooksDrift();
  const launchagentDrift = checkLaunchAgentPathDrift();
  const instructionsDrift = checkInstructionsDrift();
  const userAddedMcp = checkUserAddedMcpServers();
  const userCreatedSkills = checkUserCreatedSkills();
  const userCreatedCommands = checkUserCreatedCommands();
  const agentDefsDrift = checkAgentDefsDrift();
  let cliBuildDrift = checkCliBuildDrift();
  const cliRoot = builtCliRoot();
  if (autoFix && cliBuildDrift.length > 0 && cliRoot && rebuildCli(cliRoot)) {
    cliBuildDrift = checkCliBuildDrift();
  }
  // Sync drift = auto-fixable via `agentbrew sync`; skill-validity and env var drift = needs manual action
  const syncDrift = [
    ...mcpDrift,
    ...mcpBarePlaceholdersDrift,
    ...mcpPermissionDrift,
    ...rulesDrift,
    ...skillsDrift,
    ...brokenSymlinks,
    ...commandsDrift,
    ...hooksDrift,
    ...launchagentDrift,
    ...instructionsDrift,
    ...agentDefsDrift,
  ];
  // User-added items are informational — never auto-repaired, never counted as drift.
  // They surface in their own `User additions` section in the human-readable output
  // and as a separate `userAdditions` field in JSON/CI modes.
  const userAddedDrift = [...userAddedMcp, ...userCreatedSkills, ...userCreatedCommands];
  const allDrift = [...syncDrift, ...skillValidity, ...mcpEnvDrift, ...envHygieneDrift, ...cliBuildDrift];

  if (options?.json) {
    outputHealthJson(state, allDrift, userAddedDrift);
    return;
  }

  if (ci) {
    outputHealthCi(state, syncDrift, allDrift, userAddedDrift);
    return;
  }

  printHealthHeader(state);
  await displayInteractiveDrift(
    {
      syncDrift,
      mcpEnvDrift,
      envHygieneDrift,
      skillValidity,
      cliBuildDrift,
      userAddedDrift,
      allDrift,
    },
    autoFix,
    options?.verbose ?? false,
  );
}
