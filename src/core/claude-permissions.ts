import type { AgentBrewState } from "../types.js";

/** True when state.yaml says `claudePermissions: keep`: leave Claude Code permission settings alone. */
export function keepsClaudePermissions(state: Pick<AgentBrewState, "claudePermissions"> | undefined): boolean {
  return state?.claudePermissions === "keep";
}
