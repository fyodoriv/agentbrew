import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBatch, loadState, send, setEnabled, status } from "./telemetry.js";

const lines = [
  JSON.stringify({ ts: "2026-10-26T10:00:00.000Z", event: "sync", story: "US06", ok: true, ms: 900 }),
  JSON.stringify({ ts: "2026-10-26T11:00:00.000Z", event: "error", story: "US03", ok: false, code: "SYNC_ERROR" }),
];

describe("field telemetry", () => {
  const env = { ...process.env };
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "ab-tel-"));
    process.env.AGENTBREW_EVENTS_FILE = join(dir, "events.jsonl");
    process.env.AGENTBREW_TELEMETRY_STATE = join(dir, "telemetry.json");
    process.env.AGENTBREW_POSTHOG_KEY = "phc_test";
    delete process.env.DO_NOT_TRACK;
    writeFileSync(process.env.AGENTBREW_EVENTS_FILE, `${lines.join("\n")}\n`);
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("sends each event once, anonymously, with no person profile or GeoIP", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await send("1.0.0", { fetchImpl })).toEqual({ sent: 2 });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.batch[0]).toMatchObject({ event: "agentbrew.sync", distinct_id: loadState().installId });
    expect(body.batch[0].properties).toMatchObject({ ms: 900, $geoip_disable: true, $process_person_profile: false });
    expect(await send("1.0.0", { fetchImpl })).toEqual({ sent: 0, skipped: "nothing new" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends nothing with no key, DO_NOT_TRACK, or turned off", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    process.env.AGENTBREW_POSTHOG_KEY = "";
    expect((await send("1", { fetchImpl })).skipped).toBe("no key");
    process.env.AGENTBREW_POSTHOG_KEY = "phc_test";
    process.env.DO_NOT_TRACK = "1";
    expect((await send("1", { fetchImpl })).skipped).toBe("DO_NOT_TRACK");
    delete process.env.DO_NOT_TRACK;
    setEnabled(false);
    expect(status()).toMatchObject({ on: false, reason: "turned off", pending: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a dry run shows the body with the key hidden and sends nothing", async () => {
    const fetchImpl = vi.fn();
    const r = await send("1", { dryRun: true, fetchImpl });
    expect(JSON.stringify(r.body)).not.toContain("phc_test");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a failed send keeps the events for next time and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "network" });
    expect(status().pending).toBe(2);
  });
  it("canary: no content, path, or name leaves the machine, even from an edited log", () => {
    const canary = "CANARY-/Users/someone/secret-project";
    const tampered = [
      JSON.stringify({
        ts: "2026-10-26T12:00:00.000Z",
        event: "sync",
        story: canary,
        ok: true,
        ms: 5,
        path: canary,
        skill: canary,
        code: canary,
        module: canary,
        types: [canary, "skills"],
      }),
      JSON.stringify({ ts: canary, event: canary, ok: true }),
    ];
    const body = buildBatch(tampered, "<posthog_key>", "id", "1.0.0");
    expect(JSON.stringify(body)).not.toContain("CANARY");
    const batch = body.batch as { properties: Record<string, unknown> }[];
    expect(batch).toHaveLength(1);
    expect(Object.keys(batch[0].properties).sort()).toEqual(
      ["$geoip_disable", "$process_person_profile", "app_version", "ms", "ok", "story", "types"].sort(),
    );
  });
});
