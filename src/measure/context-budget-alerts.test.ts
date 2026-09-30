import { describe, expect, it } from "vitest";
import { buildContextBudgetAlerts, SOFT_HEADROOM_ALERT_THRESHOLD } from "./context-budget-alerts.js";

describe("context-budget alerts", () => {
  const baseStatic = {
    sharedRulesBytes: 14000,
    sharedRulesLines: 200,
    projectedDeployedChars: 25000,
    projectedDeployedTokens: 6250,
    softCharThreshold: 32000,
    softTokenHeadroom: 1750,
    hardCharBudget: 40000,
    overSoftThreshold: false,
    overHardBudget: false,
    topSections: [{ heading: "Git and delivery", chars: 3885, tokens: 972 }],
    bloatFindingCount: 0,
    lintPassed: true,
    lintErrors: 0,
    lintWarnings: 0,
  };

  it("warns when soft headroom is below threshold", () => {
    const alerts = buildContextBudgetAlerts({
      static: { ...baseStatic, softTokenHeadroom: SOFT_HEADROOM_ALERT_THRESHOLD - 1 },
    });
    expect(alerts.some((a) => a.code === "low-soft-headroom")).toBe(true);
    const low = alerts.find((a) => a.code === "low-soft-headroom");
    expect(low?.message).toMatch(/start a new chat/i);
  });

  it("does not warn when headroom is healthy", () => {
    const alerts = buildContextBudgetAlerts({
      static: { ...baseStatic, softTokenHeadroom: SOFT_HEADROOM_ALERT_THRESHOLD + 500 },
    });
    expect(alerts.some((a) => a.code === "low-soft-headroom")).toBe(false);
  });

  it("errors on hard budget breach", () => {
    const alerts = buildContextBudgetAlerts({
      static: { ...baseStatic, overHardBudget: true, overSoftThreshold: true },
    });
    expect(alerts.some((a) => a.code === "over-hard-budget" && a.severity === "error")).toBe(true);
  });
});
