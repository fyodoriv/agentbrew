import { execFileSync } from "node:child_process";
import { syncMcpServers } from "../sync/mcp-sync.js";
import type { ProbeResult, ProbeStatus } from "./probe.js";

export type ProbeStatusCategory = "auth" | "configurable" | "sync";

export interface HealActionResult {
  healed: boolean;
  action: string;
  followupTask?: string;
  error?: string;
}

export type HealAction = (result: ProbeResult) => Promise<HealActionResult>;

export const PROBE_STATUS_DISPOSITION: Record<ProbeStatus, { category?: ProbeStatusCategory; skip?: string }> = {
  ok: { skip: "healthy" },
  ok_deep_failed: { category: "auth" },
  launch_failed: { category: "sync" },
  init_timeout: { category: "sync" },
  init_error: { category: "sync" },
  tools_list_failed: { category: "sync" },
  tools_list_empty: { category: "sync" },
  tools_list_timeout: { category: "sync" },
  smoke_call_failed: { category: "auth" },
  skipped_no_command: { skip: "No stdio command configured" },
  skipped_local_app_offline: { skip: "Local app that serves this MCP is not running" },
};

export function categorizeProbeResult(result: ProbeResult): ProbeStatusCategory | undefined {
  const disposition = PROBE_STATUS_DISPOSITION[result.status];
  if (disposition.skip) return undefined;
  // A 401/403 is a credential problem at any handshake stage. Transport
  // failures otherwise default to the `sync` action, and re-running the sync
  // can never mint a token — it just hides the real remedy behind a retry loop.
  if (hasAuthErrorSignal(result)) return "auth";
  if (disposition.category === "auth" && !looksLikeAuthFailure(result)) return "configurable";
  return disposition.category;
}

/** An explicit rejected-credential signal in the transport error. */
function hasAuthErrorSignal(result: ProbeResult): boolean {
  return /\b(401|403)\b|Unauthorized|Forbidden/i.test(result.error ?? "");
}

function looksLikeAuthFailure(result: ProbeResult): boolean {
  return result.name.includes("github") || hasAuthErrorSignal(result);
}

async function runMcpSyncHeal(): Promise<HealActionResult> {
  await syncMcpServers();
  return { healed: true, action: "agentbrew-sync-mcp" };
}

async function rederiveAuth(result: ProbeResult): Promise<HealActionResult> {
  if (!result.name.includes("github")) {
    return {
      healed: false,
      action: "manual-auth-setup",
      followupTask: `Run agentbrew mcp setup ${result.name}`,
    };
  }
  try {
    const githubHost = process.env.AGENTBREW_GITHUB_HOST ?? process.env.GH_HOST;
    const args = githubHost ? ["auth", "token", "--hostname", githubHost] : ["auth", "token"];
    execFileSync("gh", args, { stdio: "pipe", timeout: 15_000 });
    return { healed: true, action: "gh-auth-token" };
  } catch (error) {
    return {
      healed: false,
      action: "gh-auth-token",
      followupTask: "Run gh auth login, then agentbrew mcp probe github --deep",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fileSetupFollowup(result: ProbeResult): Promise<HealActionResult> {
  return {
    healed: false,
    action: "manual-setup-followup",
    followupTask: `Run agentbrew mcp setup ${result.name}, then agentbrew mcp probe ${result.name} --deep`,
  };
}

export const HEAL_ACTIONS: ReadonlyMap<ProbeStatusCategory, HealAction> = new Map([
  ["auth", rederiveAuth],
  ["configurable", fileSetupFollowup],
  ["sync", runMcpSyncHeal],
]);

export function isProbeFailure(result: ProbeResult): boolean {
  return result.status !== "ok" && !PROBE_STATUS_DISPOSITION[result.status].skip;
}
