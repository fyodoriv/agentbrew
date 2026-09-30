import type { ContextBudgetSnapshot } from "./context-budget.js";

/** Warn agents when soft headroom drops below this (tokens to ~8k soft target). */
export const SOFT_HEADROOM_ALERT_THRESHOLD = 1_800;

export interface ContextBudgetAlert {
  severity: "warn" | "error";
  code: "low-soft-headroom" | "over-soft-threshold" | "over-hard-budget" | "lint-failed";
  message: string;
}

export function buildContextBudgetAlerts(snapshot: Pick<ContextBudgetSnapshot, "static">): ContextBudgetAlert[] {
  const { static: s } = snapshot;
  const alerts: ContextBudgetAlert[] = [];

  if (s.overHardBudget) {
    alerts.push({
      severity: "error",
      code: "over-hard-budget",
      message: `projected deployed rules ~${s.projectedDeployedTokens.toLocaleString()} tokens exceed hard char budget (${s.hardCharBudget.toLocaleString()} chars) — trim shared-rules or open TASKS.md trim task`,
    });
  } else if (s.overSoftThreshold) {
    alerts.push({
      severity: "warn",
      code: "over-soft-threshold",
      message: `projected deployed rules ~${s.projectedDeployedTokens.toLocaleString()} tokens over soft target (~${Math.round(s.softCharThreshold / 4).toLocaleString()} tokens) — run agentbrew lint and trim top sections`,
    });
  }

  if (s.softTokenHeadroom < SOFT_HEADROOM_ALERT_THRESHOLD) {
    const top = s.topSections[0];
    const topHint = top ? ` largest section "${top.heading}" ~${top.tokens.toLocaleString()} tokens` : "";
    alerts.push({
      severity: "warn",
      code: "low-soft-headroom",
      message: `only ~${s.softTokenHeadroom.toLocaleString()} tokens headroom to soft target (<${SOFT_HEADROOM_ALERT_THRESHOLD.toLocaleString()}) —${topHint}; start a new chat for the next task; load cursor-token-playbook + context-budget skills before adding rules/skills`,
    });
  }

  if (!s.lintPassed) {
    alerts.push({
      severity: "error",
      code: "lint-failed",
      message: `agentbrew lint failed (${s.lintErrors} errors, ${s.lintWarnings} warnings) — fix before growing shared-rules`,
    });
  }

  return alerts;
}

export function formatContextBudgetAlertLines(alerts: ContextBudgetAlert[]): string[] {
  return alerts.map((a) => `[context-budget ${a.code}] ${a.message}`);
}
