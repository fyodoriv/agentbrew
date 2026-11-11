import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_FIXABLE_TYPES } from "../drift-fixes.js";
import { NUMBER_MAX, sanitizeEvent } from "./events.js";
import { gainLine, repairGain, SAVED_SECONDS, summarizeGains, syncGain, targetedAgentCount } from "./gains.js";
import { klmSeconds, lowestRepairSeconds, REPAIR_OPS, SYNC_PER_AGENT_OPS } from "./klm.js";
import { buildBatch } from "./telemetry.js";

const ID = "00000000-0000-4000-8000-000000000000";
const TS = "2026-11-09T12:00:00.000Z";

/** The request properties of one event, built the way a real send builds them. */
function sent(event: Parameters<typeof sanitizeEvent>[0]): Record<string, unknown> {
  const line = JSON.stringify(sanitizeEvent(event));
  return (buildBatch([line], "<posthog_key>", ID, "1.0.0").batch as { properties: Record<string, unknown> }[])[0]
    .properties;
}

describe("estimated time saved", () => {
  it("the estimate tables in the docs hold the values the code uses", () => {
    const root = join(import.meta.dirname, "..", "..");
    for (const doc of ["docs/observability.md", "README.md"]) {
      const text = readFileSync(join(root, doc), "utf-8");
      const seconds = (row: RegExp) => Number(text.match(row)?.[1]);
      expect(seconds(/^\| One sync that works \| (\d+) seconds for each agent/m), doc).toBe(SAVED_SECONDS.syncPerAgent);
      expect(seconds(/^\| One repair \| (\d+) seconds for each drift item/m), doc).toBe(SAVED_SECONDS.repairPerItem);
    }
  });

  it("a sync to N agents saves 3N seconds, in the log and in the request", () => {
    for (const n of [1, 4, 7]) {
      expect(syncGain(true, n)).toEqual({ agents: n, secondsSaved: 3 * n });
      expect(sent({ event: "sync", ok: true, ms: 5, ...syncGain(true, n) })).toMatchObject({
        agents: n,
        seconds_saved: 3 * n,
      });
    }
  });

  it("a failed sync saves 0", () => {
    expect(syncGain(false, 4)).toEqual({ agents: 4, secondsSaved: 0 });
    expect(sent({ event: "sync", ok: false, ...syncGain(false, 4) })).toMatchObject({ agents: 4, seconds_saved: 0 });
  });

  it("a repair of 2 fixed items saves 10 seconds, also when drift is left", () => {
    expect(repairGain(2)).toEqual({ secondsSaved: 10 });
    expect(sent({ event: "repair", ok: true, repaired: 2, ...repairGain(2) })).toMatchObject({
      repaired: 2,
      seconds_saved: 10,
    });
    // A repair that fixed 2 items and left 1 still did the 2 fixes.
    expect(sent({ event: "repair", ok: false, repaired: 2, remaining: 1, ...repairGain(2) })).toMatchObject({
      ok: false,
      seconds_saved: 10,
    });
    expect(repairGain(0)).toEqual({ secondsSaved: 0 });
  });

  it("a --only sync counts only the detected agents the named modules target", () => {
    // claude-code has every surface; augment has skills and a rules file only.
    const detected = new Set(["claude-code", "augment"]);
    expect(targetedAgentCount(detected)).toBe(2);
    expect(targetedAgentCount(detected, "skills")).toBe(2);
    expect(targetedAgentCount(detected, "rules")).toBe(2);
    expect(targetedAgentCount(detected, "mcp")).toBe(1);
    expect(targetedAgentCount(detected, "hooks, Commands")).toBe(1);
    // An agent in two named modules counts once.
    expect(targetedAgentCount(detected, "mcp,hooks")).toBe(1);
    expect(targetedAgentCount(new Set(["augment"]), "mcp")).toBe(0);
    // An undetected agent never counts.
    expect(targetedAgentCount(new Set(["augment"]), "skills")).toBe(1);
    expect(targetedAgentCount(detected, "not-a-module")).toBe(0);
  });

  it("a count that is not a positive number counts as 0", () => {
    expect(syncGain(true, -3)).toEqual({ agents: 0, secondsSaved: 0 });
    expect(syncGain(true, Number.NaN)).toEqual({ agents: 0, secondsSaved: 0 });
    expect(repairGain("2" as unknown as number)).toEqual({ secondsSaved: 0 });
  });

  it("sums the window's sync and repair events and skips old, other, and bad lines", () => {
    const since = Date.parse("2026-11-01T00:00:00.000Z");
    const lines = [
      JSON.stringify({ ts: TS, event: "sync", ok: true, agents: 4, secondsSaved: 12 }),
      JSON.stringify({ ts: TS, event: "repair", ok: true, repaired: 2, secondsSaved: 10 }),
      JSON.stringify({ ts: TS, event: "sync", ok: false, agents: 4, secondsSaved: 0 }),
      JSON.stringify({ ts: "2026-10-01T00:00:00.000Z", event: "sync", ok: true, secondsSaved: 300 }),
      JSON.stringify({ ts: TS, event: "command", command: "sync", ok: true, secondsSaved: 300 }),
      JSON.stringify({ ts: TS, event: "sync", ok: true, secondsSaved: "900" }),
      JSON.stringify({ ts: TS, event: "sync", ok: true, secondsSaved: -900 }),
      // Above the bound that sanitizeEvent applies: an edited line adds nothing.
      JSON.stringify({ ts: TS, event: "repair", ok: true, secondsSaved: (NUMBER_MAX.secondsSaved as number) + 1 }),
      "not json",
      "",
    ];
    expect(summarizeGains(lines, since)).toEqual({ available: true, secondsSaved: 22 });
    expect(summarizeGains(["not json"], since)).toEqual({ available: false, secondsSaved: 0 });
  });

  it("the metrics line names the window, the minutes, and both rates", () => {
    expect(gainLine({ available: true, secondsSaved: 132 }, 30)).toBe(
      "Estimated time saved, last 30 days: 2 min (sync: 3 s per agent; repair: 5 s per fixed item)",
    );
    // A sum under one minute prints seconds, never "0 min".
    expect(gainLine({ available: true, secondsSaved: 12 }, 7)).toBe(
      "Estimated time saved, last 7 days: 12 s (sync: 3 s per agent; repair: 5 s per fixed item)",
    );
    expect(gainLine({ available: true, secondsSaved: 0 }, 7)).toContain("last 7 days: 0 s (");
    expect(gainLine({ available: false, secondsSaved: 0 }, 30)).toContain("no data yet");
  });

  it("the KLM totals of the hand procedures are pinned", () => {
    expect(klmSeconds(SYNC_PER_AGENT_OPS)).toBe(5.2);
    expect(klmSeconds(["K", "P", "H", "M", "B", { R: 2 }])).toBe(5.15);
    const totals = Object.fromEntries(Object.entries(REPAIR_OPS).map(([type, ops]) => [type, klmSeconds(ops)]));
    expect(totals).toEqual({
      mcp: 5.2,
      "mcp-bare-placeholder": 5.2,
      "mcp-catalog-pin": 5.2,
      "mcp-playwright-isolated": 5.2,
      "mcp-permissions": 5.2,
      rules: 5.2,
      commands: 5.2,
      hooks: 5.2,
      instructions: 5.2,
      agents: 5.2,
      models: 5.2,
      "rules-source": 5.4,
      skills: 5.95,
      launchagent: 7.2,
    });
  });

  it("every drift type that repair fixes has a modelled procedure", () => {
    expect(Object.keys(REPAIR_OPS).sort()).toEqual([...AUTO_FIXABLE_TYPES].sort());
  });

  it("each table value is at or below its modelled seconds", () => {
    expect(SAVED_SECONDS.syncPerAgent).toBeLessThanOrEqual(klmSeconds(SYNC_PER_AGENT_OPS));
    expect(SAVED_SECONDS.repairPerItem).toBeLessThanOrEqual(lowestRepairSeconds());
    for (const ops of Object.values(REPAIR_OPS))
      expect(SAVED_SECONDS.repairPerItem).toBeLessThanOrEqual(klmSeconds(ops));
  });
});
