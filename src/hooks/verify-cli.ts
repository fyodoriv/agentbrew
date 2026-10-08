/**
 * CLI glue for `agentbrew hooks verify` — compares deployed hook configs for
 * primary agents against the canonical manifest + state-managed hooks.
 */

import chalk from "chalk";
import { checkHooksDrift } from "../drift-checks/hooks.js";
import { loadState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { ICON_ERROR, ICON_SUCCESS } from "../ui/output.js";

const PRIMARY_HOOK_AGENTS = ["claude-code", "cursor"] as const;

export interface HooksVerifyOptions {
  agent?: string;
  json?: boolean;
}

function supportedAgents(): string[] {
  const state = loadState();
  const detected = new Set(state?.agents.filter((a) => a.detected).map((a) => a.name) ?? []);
  return AGENT_DEFINITIONS.filter((a) => a.hooksFile && detected.has(a.name)).map((a) => a.name);
}

export function runHooksVerify(options?: HooksVerifyOptions): number {
  const agents = supportedAgents();
  const target = options?.agent;
  if (target && !agents.includes(target)) {
    const known = PRIMARY_HOOK_AGENTS.filter((name) => agents.includes(name));
    console.error(chalk.red(`Unknown or undetected hooks agent: ${target}`));
    console.error(chalk.dim(`Detected hook agents: ${known.join(", ") || "(none)"}`));
    return 1;
  }

  const drift = checkHooksDrift().filter((item) => item.type === "hooks");
  const filtered = target ? drift.filter((item) => item.agent === target) : drift;

  if (options?.json) {
    console.log(JSON.stringify({ agents: target ? [target] : agents, drift: filtered }, null, 2));
    return filtered.length > 0 ? 1 : 0;
  }

  console.log(chalk.bold("\nHooks verify\n"));
  const scope = target ?? "all detected hook agents";
  console.log(chalk.dim(`  Scope: ${scope}`));

  if (filtered.length === 0) {
    console.log(`  ${ICON_SUCCESS} Deployed hooks match manifest for ${scope}`);
    console.log("");
    return 0;
  }

  for (const item of filtered) {
    console.log(`  ${ICON_ERROR} ${item.agent}: ${item.detail}`);
  }
  console.log(chalk.dim("\n  Run `agentbrew sync --only hooks` to repair.\n"));
  return 1;
}
