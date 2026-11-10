import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NUMBER_MAX, sanitizeEvent } from "./events.js";
import { gainLine, repairGain, SAVED_SECONDS, summarizeGains, syncGain } from "./gains.js";
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
      expect(seconds(/^\| One repair that leaves no drift \| (\d+) seconds for each drift item/m), doc).toBe(
        SAVED_SECONDS.repairPerItem,
      );
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

  it("a repair of 2 items saves 120 seconds; a failed repair saves 0", () => {
    expect(repairGain(true, 2)).toEqual({ secondsSaved: 120 });
    expect(sent({ event: "repair", ok: true, repaired: 2, ...repairGain(true, 2) })).toMatchObject({
      repaired: 2,
      seconds_saved: 120,
    });
    expect(repairGain(false, 2)).toEqual({ secondsSaved: 0 });
  });

  it("a count that is not a positive number counts as 0", () => {
    expect(syncGain(true, -3)).toEqual({ agents: 0, secondsSaved: 0 });
    expect(syncGain(true, Number.NaN)).toEqual({ agents: 0, secondsSaved: 0 });
    expect(repairGain(true, "2" as unknown as number)).toEqual({ secondsSaved: 0 });
  });

  it("sums the window's sync and repair events and skips old, other, and bad lines", () => {
    const since = Date.parse("2026-11-01T00:00:00.000Z");
    const lines = [
      JSON.stringify({ ts: TS, event: "sync", ok: true, agents: 4, secondsSaved: 12 }),
      JSON.stringify({ ts: TS, event: "repair", ok: true, repaired: 2, secondsSaved: 120 }),
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
    expect(summarizeGains(lines, since)).toEqual({ available: true, secondsSaved: 132 });
    expect(summarizeGains(["not json"], since)).toEqual({ available: false, secondsSaved: 0 });
  });

  it("the metrics line names the window, the minutes, and both rates", () => {
    expect(gainLine({ available: true, secondsSaved: 132 }, 30)).toBe(
      "Estimated time saved, last 30 days: 2 min (sync: 3 s per agent; repair: 60 s per fixed item)",
    );
    // A sum under one minute prints seconds, never "0 min".
    expect(gainLine({ available: true, secondsSaved: 12 }, 7)).toBe(
      "Estimated time saved, last 7 days: 12 s (sync: 3 s per agent; repair: 60 s per fixed item)",
    );
    expect(gainLine({ available: true, secondsSaved: 0 }, 7)).toContain("last 7 days: 0 s (");
    expect(gainLine({ available: false, secondsSaved: 0 }, 30)).toContain("no data yet");
  });
});
