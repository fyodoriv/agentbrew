import { existsSync, readFileSync, realpathSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { SHARED_RULES_PATH } from "../paths.js";
import { dedupeSharedRulesContent } from "../rules-hygiene.js";
import { loadState } from "../state.js";
import { compressSkillsListing, stripCursorRulesSection } from "../sync/instructions-content.js";
import {
  CANARY_DELEGATED_AGENTS,
  collectCanaryDelegation,
  extractManagedSection,
  loadSharedRules,
} from "../sync/rules-sync.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Check a single rules file for managed-section drift. */
function checkRulesDriftForTarget(
  target: { agent: string; path: string },
  freshRules: string | undefined,
  startMarker: string,
): DriftItem | undefined {
  const expanded = expandHome(target.path);
  if (!existsSync(expanded)) return undefined;

  try {
    const content = readFileSync(expanded, "utf-8");
    if (!content.includes(startMarker)) {
      return { agent: target.agent, type: "rules", detail: "no managed section — rules not deployed" };
    }

    if (freshRules) {
      const deployed = extractManagedSection(content);
      if (deployed !== undefined && deployed !== freshRules) {
        const deployedLines = deployed.trimEnd().split("\n").length;
        const sourceLines = freshRules.trimEnd().split("\n").length;
        const delta = sourceLines - deployedLines;
        const deltaStr = delta > 0 ? `+${delta}` : String(delta);
        return {
          agent: target.agent,
          type: "rules",
          detail: `managed section out of date (${deltaStr} lines) — Run: agentbrew sync`,
          diff: { deployedLines, sourceLines },
        };
      }
    }
  } catch (e) {
    logSkipped("drift/date", e);
    return { agent: target.agent, type: "rules", detail: "rules file unreadable" };
  }
  return undefined;
}

function checkSharedRulesSourceDrift(content: string): DriftItem[] {
  const dedupeResult = dedupeSharedRulesContent(content);
  if (dedupeResult.removedCount === 0) return [];
  return [
    {
      agent: "shared-rules.md",
      type: "rules-source",
      detail: `${dedupeResult.removedCount} duplicate block(s) in shared-rules.md — Run: agentbrew rules dedupe`,
      diff: { removed: dedupeResult.removed },
    },
  ];
}

/**
 * Detect rules drift: checks both marker presence and content staleness.
 * A managed section that exists but contains outdated content is flagged so
 * users know to re-sync without waiting for a full sync to discover changes.
 *
 * Slice 3a of `delegate-rules-to-ai-rules` (TASKS.md): for delegated agents
 * (claude-code, codex, gemini-cli, and the 8 others per
 * `CANARY_DELEGATED_AGENTS`), the deployed managed section is the
 * ai-rules-generated content rather than the native shared rules. Drift
 * must compare against the SAME content syncRules writes, otherwise it
 * reports false-positive drift right after a successful sync. We invoke
 * `collectCanaryDelegation` (same helper syncRules uses) to compute
 * per-target expected content.
 *
 * Slice 4: delegated agents whose delegation returns no content are
 * SKIPPED from drift detection (not compared against `freshRules`) —
 * mirroring syncRules' skip semantics. Otherwise drift would falsely
 * report all `CANARY_DELEGATED_AGENTS` as out-of-date whenever `ai-rules` is
 * missing (their deployed content came from a previous run with
 * ai-rules present). Carve-outs (windsurf, augment, devin) still
 * compare against `freshRules` via the native path.
 */
export function checkRulesDrift(): DriftItem[] {
  const START_MARKER = "<!-- agentbrew:start -->";

  // `sync-and-drift-honor-detected-agents` (TASKS.md): only check detected
  // agents. Mirrors `checkInstructionsDrift` (`drift-checks/instructions.ts`)
  // and matches `syncInstructions` (`sync/instructions-sync.ts`) which now
  // also filters by detection. Without this filter, drift reports false-
  // positive "no managed section — rules not deployed" items for every
  // undetected agent whose file happens to exist (e.g. an orphan from a
  // previous sync that wrote indiscriminately). Detection is the canonical
  // signal that the agent is in active use on this machine.
  const state = loadState();
  const detectedNames: ReadonlySet<string> = state
    ? new Set(state.agents.filter((a) => a.detected).map((a) => a.name))
    : new Set();

  const allTargets = AGENT_DEFINITIONS.filter((a) => a.rulesFile !== undefined && detectedNames.has(a.name)).map(
    (a) => ({
      agent: a.name,
      path: a.rulesFile ?? "",
    }),
  );

  // Deduplicate by resolved path — agents sharing the same rulesFile (e.g.
  // claude-code + claude-desktop, or devin + codex both symlinked to
  // ~/.config/agentbrew/AGENTS.md) should only produce one drift item.
  // When a carve-out shares a file with a delegated agent, the delegated
  // agent owns drift detection (ai-rules content wins over native carve-out).
  const byResolvedPath = new Map<string, { agent: string; path: string }>();
  for (const t of allTargets) {
    const expanded = expandHome(t.path);
    let resolved = expanded;
    try {
      if (existsSync(expanded)) resolved = realpathSync(expanded);
    } catch (e) {
      logSkipped("drift/rules/realpath", e);
    }
    const existing = byResolvedPath.get(resolved);
    if (!existing) {
      byResolvedPath.set(resolved, t);
      continue;
    }
    if (CANARY_DELEGATED_AGENTS.has(t.agent) && !CANARY_DELEGATED_AGENTS.has(existing.agent)) {
      byResolvedPath.set(resolved, t);
    }
  }
  const targets = [...byResolvedPath.values()];

  const sharedPath = expandHome(SHARED_RULES_PATH);
  if (!existsSync(sharedPath)) return [];

  // Build fresh shared rules for content comparison. Apply the same
  // transforms syncRules applies before writing (compressSkillsListing +
  // stripCursorRulesSection); otherwise drift compares deployed transformed
  // content against raw content and always reports false-positive drift.
  const userRules = loadSharedRules();
  const sourceDrift = userRules ? checkSharedRulesSourceDrift(userRules) : [];
  const freshRules = userRules ? stripCursorRulesSection(compressSkillsListing(userRules)) : undefined;

  // Invoke the same delegation path syncRules uses so drift compares
  // against the actual deployed content for canary agents.
  const delegated = collectCanaryDelegation(
    targets.map((t) => ({ agentName: t.agent })),
    freshRules,
  );

  const targetDrift = targets
    .map((t) => {
      const delegatedContent = delegated.get(t.agent);
      // Slice 4: delegated agents with no delegated content are skipped
      // — matches syncRules' skip behavior when ai-rules is missing.
      if (delegatedContent === undefined && CANARY_DELEGATED_AGENTS.has(t.agent)) return undefined;
      return checkRulesDriftForTarget(t, delegatedContent ?? freshRules, START_MARKER);
    })
    .filter((d): d is DriftItem => d !== undefined);
  return [...sourceDrift, ...targetDrift];
}
