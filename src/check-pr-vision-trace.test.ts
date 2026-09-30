// Tests for ../scripts/check-pr-vision-trace.mjs.
//
// Pattern: deterministic gate over a PR-body convention (rule #10 of the
// minsky constitution, adopted into agentbrew's CI-gate set). Paired
// positive/negative fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

// @ts-expect-error — pure-ESM .mjs sibling; vitest resolves it via Node ESM.
import { checkPrVisionTrace } from "../scripts/check-pr-vision-trace.mjs";

type CheckResult = { ok: true; reason?: string } | { ok: false; errors: string[] };

const validBody = [
  "## Summary",
  "Some summary text.",
  "",
  "## Vision trace",
  "",
  '- **Vision goal**: G1 — Curator not host (VISION.md § "Strategy: delegate, contribute, absorb")',
  "- **User story**: US-04 — Switch profiles and customize",
  "- **Competitor prior art**: skills-cli ships `skills add`; we delegate to it (see docs/competition/vercel-skills-cli-vs-agentbrew.md)",
  "",
  "## Test plan",
  "- [x] tests pass",
  "",
].join("\n");

describe("checkPrVisionTrace", () => {
  test("valid PR body with all three fields → ok", () => {
    const result: CheckResult = checkPrVisionTrace(validBody);
    expect(result.ok).toBe(true);
  });

  test("missing header → fails (and reports each missing field too)", () => {
    const body = "## Summary\nNo vision-trace block here.\n";
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/missing.*Vision trace/);
  });

  test("missing one field (Competitor prior art) → fails with field name", () => {
    const body = validBody.replace(/^- \*\*Competitor prior art\*\*:.*$/m, "");
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Competitor prior art"))).toBe(true);
  });

  test("field value too short → fails with substantive-text complaint", () => {
    const body = validBody.replace(
      '- **Vision goal**: G1 — Curator not host (VISION.md § "Strategy: delegate, contribute, absorb")',
      "- **Vision goal**: G1",
    );
    // "G1" alone is 2 chars; min is 3. Should fail unless the field happens
    // to land at exactly the boundary.
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("too short"))).toBe(true);
  });

  test("N/A is allowed when followed by a reason ≥3 chars", () => {
    const body = validBody.replace(
      "- **User story**: US-04 — Switch profiles and customize",
      "- **User story**: N/A — pure refactor, no user-facing behavior change",
    );
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(true);
  });

  test("opt-out marker with valid reason → ok with reason", () => {
    const body = [
      "## Summary",
      "Auto-generated lockfile bump.",
      "",
      "<!-- vision-trace: not-applicable — dependabot lockfile bump, no behavior change -->",
    ].join("\n");
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reason).toMatch(/opt-out/);
    expect(result.reason).toMatch(/dependabot/);
  });

  test("opt-out marker with empty reason → fails", () => {
    const body = "<!-- vision-trace: not-applicable —  -->";
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("opt-out"))).toBe(true);
  });

  test("case-insensitive header matching — `## VISION TRACE` works", () => {
    const body = validBody.replace("## Vision trace", "## VISION TRACE");
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(true);
  });

  test("alternate field aliases — `Competitor check:` also matches", () => {
    const body = validBody.replace(
      "- **Competitor prior art**: skills-cli ships `skills add`; we delegate to it (see docs/competition/vercel-skills-cli-vs-agentbrew.md)",
      "- **Competitor check**: skills-cli already delegated to in M1",
    );
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(true);
  });

  test("all three fields can be N/A with reasons (pure-tooling PRs)", () => {
    const body = [
      "## Vision trace",
      "",
      "- **Vision goal**: N/A — tooling-internal change, no user-visible behavior",
      "- **User story**: N/A — applies to every story (CI gate)",
      "- **Competitor prior art**: N/A — internal CI plumbing, no competitor surface",
      "",
    ].join("\n");
    const result: CheckResult = checkPrVisionTrace(body);
    expect(result.ok).toBe(true);
  });
});
