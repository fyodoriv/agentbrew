import { loadManifest } from "../manifest.js";
import { loadState } from "../state.js";
import { userStatusLine } from "../sync/statusline-sync.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Informational: the Claude Code statusLine is the user's own, so agentbrew keeps it. */
export function checkUserStatusLine(): DriftItem[] {
  const claude = AGENT_DEFINITIONS.find((agent) => agent.name === "claude-code");
  const detected = loadState()?.agents.some((agent) => agent.name === "claude-code" && agent.detected);
  if (!claude?.hooksFile || !detected) return [];
  const current = userStatusLine(expandHome(claude.hooksFile), loadManifest());
  if (current === null) return [];
  return [
    {
      agent: "claude-code",
      type: "statusline-user-added",
      detail: "statusLine is your own, so agentbrew keeps it (agent-perf.mjs statusline is not installed)",
    },
  ];
}
