import { join } from "node:path";
import chalk from "chalk";
import { logSkipped } from "./core/logger.js";
import type { DriftItem } from "./drift.js";
import {
  checkAgentDefsDrift,
  checkBarePlaceholdersDrift,
  checkBrokenSymlinks,
  checkCommandsDrift,
  checkHooksDrift,
  checkInstructionsDrift,
  checkMcpDrift,
  checkMcpPermissionDrift,
  checkRulesDrift,
  checkSkillsDrift,
  collectDrift,
  formatDriftSummary,
} from "./drift.js";
import { checkLaunchAgentPathDrift } from "./drift-checks/launchagent-path.js";
import { runMcpHealCycle } from "./mcp/heal-cycle.js";
import { snapshotAgentConfigs } from "./ops.js";
import type { RepairAction } from "./repair-log.js";
import { saveRepairLog } from "./repair-log.js";
import { requireState } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { getLogDir, trimLogIfNeeded } from "./sync/auto-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncHooks } from "./sync/hooks-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { installLaunchAgent, repairAgentbrewLaunchAgentPaths } from "./sync/launchagent.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { dedupeSharedRulesFile, syncRules } from "./sync/rules-sync.js";
import { cleanBrokenSymlinksGlobally, syncSkills } from "./sync/skills-sync.js";
import { ICON_ERROR, ICON_SUCCESS } from "./ui/output.js";

/** Drift types whose only remediation is user action (sync can't help). */
const USER_ACTION_TYPES: ReadonlySet<DriftItem["type"]> = new Set(["mcp-env-vars", "skill-validity"]);

/** Return true when the drift item can only be resolved by user action,
 *  not by running sync. Used to (a) phrase the summary accurately and
 *  (b) avoid suggesting `agentbrew sync --only X` when sync was the thing
 *  that just ran and couldn't fix the issue. */
function isUserActionOnly(item: DriftItem): boolean {
  if (USER_ACTION_TYPES.has(item.type)) return true;
  // A missing commands directory can only be created by the user opening
  // the agent — sync has no way to materialize that directory.
  if (item.type === "commands" && item.detail.includes("commands directory missing")) return true;
  return false;
}

function reportRemainingDrift(remainingItems: DriftItem[]): void {
  if (remainingItems.length === 0) {
    console.log(ICON_SUCCESS + chalk.bold(" All drift resolved.\n"));
    return;
  }

  const userActionItems = remainingItems.filter(isUserActionOnly);
  const syncFailedItems = remainingItems.filter((d) => !isUserActionOnly(d));

  // Split the message: items fix() couldn't touch (user action only) vs
  // items that should have been repaired but weren't (a real agentbrew
  // bug when this happens). "N issue(s) remain after fix" lumped both
  // together and felt alarming when everything was just waiting on the
  // user.
  if (syncFailedItems.length > 0) {
    console.log(chalk.yellow(`${syncFailedItems.length} issue(s) remain after fix.\n`));
    for (const item of syncFailedItems) {
      console.error(`  ${ICON_ERROR} ${item.agent} [${item.type}] — ${item.detail}`);
    }
  }
  if (userActionItems.length > 0) {
    const verb = userActionItems.length === 1 ? "needs" : "need";
    console.log(chalk.yellow(`\n${userActionItems.length} issue(s) ${verb} your attention:\n`));
    for (const item of userActionItems) {
      console.error(`  ${ICON_ERROR} ${item.agent} [${item.type}] — ${item.detail}`);
    }
  }

  // Only suggest `agentbrew sync --only X` for drift types that sync can
  // actually fix. Suggesting sync for commands-dir-missing or env-var drift
  // just leads users in circles (fix() already ran sync).
  const syncFixableTypes = new Set(syncFailedItems.map((d) => d.type));
  const hasEnvVar = remainingItems.some((d) => d.type === "mcp-env-vars" || d.type === "mcp");
  console.log(chalk.dim("\n  Next steps:"));
  if (hasEnvVar) console.log(chalk.dim("    agentbrew setup      — configure MCP server env vars"));
  if (syncFixableTypes.has("rules-source"))
    console.log(chalk.dim("    agentbrew rules dedupe — remove duplicate shared-rules blocks"));
  if (syncFixableTypes.has("rules")) console.log(chalk.dim("    agentbrew sync --only rules — redeploy shared rules"));
  if (syncFixableTypes.has("skills")) console.log(chalk.dim("    agentbrew sync --only skills  — redeploy skills"));
  if (syncFixableTypes.has("commands"))
    console.log(chalk.dim("    agentbrew sync --only commands — redeploy commands"));
  if (syncFixableTypes.has("instructions"))
    console.log(chalk.dim("    agentbrew sync --only instructions — redeploy instructions"));
  console.log();
}
/**
 * Drift types that `fix()` actually addresses by running sync pipelines.
 * Used to filter out everything else (skill-validity, env hygiene, user-added
 * items, organization-overlay mismatches) before computing what was "repaired" —
 * otherwise we'd falsely claim credit for user-created skills that fix()
 * never touched. See `user-additions-not-drift` in git log.
 */
const AUTO_FIXABLE_TYPES: ReadonlySet<DriftItem["type"]> = new Set([
  "mcp",
  "mcp-bare-placeholder",
  "mcp-catalog-pin",
  "mcp-playwright-isolated",
  "mcp-permissions",
  "rules-source",
  "rules",
  "skills",
  "commands",
  "hooks",
  "instructions",
  "agents",
  "launchagent",
]);

export async function fix(): Promise<void> {
  const state = requireState();
  if (!state) return;

  // Trim cron.log to prevent unbounded growth — it has no rotation unlike auto-sync.log
  trimLogIfNeeded(join(getLogDir(), "cron.log"));
  // Trim launchagent logs — they accumulate every 30 minutes with no built-in rotation
  trimLogIfNeeded(join(getLogDir(), "launchagent.log"));
  trimLogIfNeeded(join(getLogDir(), "launchagent.err"));

  // Snapshot drift before repair so we can log what was fixed.
  // Only auto-fixable types count toward the repair delta — user-added skills,
  // skill-validity, env vars, and organization-overlay mismatches are not things
  // fix() changes, so they must not appear in the "Fixed N issue(s)" breakdown.
  const driftBefore = collectDrift().filter((d) => AUTO_FIXABLE_TYPES.has(d.type));

  // Snapshot agent config files before repair so rollback is possible
  try {
    snapshotAgentConfigs();
  } catch (e) {
    logSkipped("repair/snapshotAgentConfigs", e);
    /* non-fatal */
  }

  console.log(chalk.bold("\nFixing sync drift...\n"));

  await syncMcpServers();
  // syncInstructions must run before syncRules so the managed rules section
  // (appended by syncRules) is not overwritten by the raw AGENTS.md template.
  await syncInstructions({ quiet: true });
  dedupeSharedRulesFile();
  await syncRules();
  await syncCommands();
  await syncSkills({ quiet: true });
  // syncSkills now calls cleanBrokenSymlinksGlobally internally, but fix()
  // still invokes it explicitly as a belt-and-braces guarantee — a syncSkills
  // early-return (e.g. "no agents detected" before sweep) should not leave
  // broken symlinks around when the user explicitly asked for repair.
  cleanBrokenSymlinksGlobally();
  await syncAgentDefs({ quiet: true });
  // syncHooks is the only path that materializes hooks drift fixes — without
  // this call, hooks items in `driftBefore` would be falsely classified as
  // "fixed" by the diff below (same class of bug as the mcp-permissions one
  // pre-2026-04-27). See sync-idempotent-and-complete issue 4.
  await syncHooks({ quiet: true });
  if (process.platform === "darwin" && checkLaunchAgentPathDrift().length > 0) {
    try {
      await installLaunchAgent();
      await repairAgentbrewLaunchAgentPaths();
    } catch (e) {
      logSkipped("repair/installLaunchAgent", e);
    }
  }
  try {
    await runMcpHealCycle();
  } catch (e) {
    logSkipped("repair/runMcpHealCycle", e);
  }

  // Re-check only auto-fixable drift types (skill-validity requires manual fixes).
  // Every check that contributes to `driftBefore` (via `collectDrift`) and is in
  // `AUTO_FIXABLE_TYPES` must also appear here — otherwise the diff between
  // `driftBefore` and `remainingItems` falsely classifies the drift as "fixed"
  // even though sync didn't actually clear it. The mcp-permissions / hooks /
  // agents history: each was missing here at one point, so every `status --fix`
  // run reported "Fixed N issue(s)" for those types indefinitely.
  const mcpDrift = checkMcpDrift();
  const mcpBarePlaceholdersDrift = checkBarePlaceholdersDrift();
  const mcpPermissionsDrift = checkMcpPermissionDrift();
  const rulesDrift = checkRulesDrift();
  const skillsDrift = checkSkillsDrift();
  const brokenSymlinks = checkBrokenSymlinks();
  const commandsDrift = checkCommandsDrift();
  const instructionsDrift = checkInstructionsDrift();
  const hooksDrift = checkHooksDrift();
  const launchagentDrift = checkLaunchAgentPathDrift();
  const agentsDrift = checkAgentDefsDrift();
  const remainingItems = [
    ...mcpDrift,
    ...mcpBarePlaceholdersDrift,
    ...mcpPermissionsDrift,
    ...rulesDrift,
    ...skillsDrift,
    ...brokenSymlinks,
    ...commandsDrift,
    ...instructionsDrift,
    ...hooksDrift,
    ...launchagentDrift,
    ...agentsDrift,
  ];

  // Log what was repaired (drift that existed before but not after)
  const remainingKeys = new Set(remainingItems.map((d) => `${d.agent}:${d.type}:${d.detail}`));
  const repairedDrift = driftBefore.filter((d) => !remainingKeys.has(`${d.agent}:${d.type}:${d.detail}`));
  const repaired: RepairAction[] = repairedDrift.map((d) => ({ type: d.type, agent: d.agent, detail: d.detail }));
  saveRepairLog(repaired);

  // Report what was fixed
  if (repaired.length > 0) {
    const breakdown = formatDriftSummary(repairedDrift);
    console.log(chalk.green(`✓ Fixed ${repaired.length} issue(s) ${breakdown}\n`));
    for (const action of repaired) {
      console.log(`  ${ICON_SUCCESS} ${action.agent} [${action.type}] — ${action.detail}`);
    }
    console.log();
  }

  reportRemainingDrift(remainingItems);
}
