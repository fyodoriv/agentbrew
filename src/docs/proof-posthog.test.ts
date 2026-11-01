import { describe, expect, it } from "vitest";

import { fieldTotals, machineKey } from "./proof-posthog.js";

const ok = (results: unknown[][]) =>
  (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;

describe("README Proof field totals from PostHog", () => {
  it("returns per-machine totals keyed by a salted hash, never the install id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ results: [["install-a", "2026-10-20", 12, 1, 3, 0, 5, 4]] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = await fieldTotals({
      key: "phx_test",
      project: "42",
      url: "https://ph.example.com",
      salt: "s",
      fetchImpl,
    });
    expect(calls[0].url).toBe("https://ph.example.com/api/projects/42/query/");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer phx_test");
    expect(r.note).toBeUndefined();
    const key = machineKey("s", "install-a");
    expect(key).toMatch(/^m-[0-9a-f]{10}$/);
    expect(JSON.stringify(r.machines)).not.toContain("install-a");
    expect(r.machines).toEqual({
      [key]: {
        date: "2026-10-20",
        syncs: 12,
        syncFailed: 1,
        repairs: 3,
        repairFailed: 0,
        driftSeen: 5,
        driftRepaired: 4,
      },
    });
  });

  it("with no key, returns no machines and one note", async () => {
    const r = await fieldTotals({ key: "", project: "42", salt: "s", fetchImpl: ok([]) });
    expect(r.machines).toEqual({});
    expect(r.note).toMatch(/no PostHog query key/);
  });

  it("on a network or HTTP failure, returns no machines and one note", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect((await fieldTotals({ key: "k", project: "42", salt: "s", fetchImpl: down })).note).toMatch(/network/);
    const denied = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect((await fieldTotals({ key: "k", project: "42", salt: "s", fetchImpl: denied })).note).toMatch(/http 401/);
  });
});
