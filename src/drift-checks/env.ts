import { checkEnvHygiene } from "../core/env-sanitize.js";
import type { DriftItem } from "./types.js";

/**
 * Detect env vars that could leak across agent boundaries (e.g. ANTHROPIC_MODEL
 * set in the parent shell overrides child agent sessions). These are not
 * auto-fixable — the user must unset them or use `eval $(agentbrew env sanitize)`.
 */
export function checkEnvHygieneDrift(): DriftItem[] {
  const warnings = checkEnvHygiene();
  return warnings.map((warning) => ({
    agent: "shell",
    type: "env-hygiene" as const,
    detail: `${warning.variable} is set — may leak into child agent sessions. Run: eval $(agentbrew env sanitize)`,
  }));
}
