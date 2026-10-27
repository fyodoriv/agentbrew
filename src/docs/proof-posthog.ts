// Per-machine field totals for the README Proof section, read from the
// PostHog EU query API (task proof-reads-posthog-totals). Telemetry sends
// events under a random install id (src/core/telemetry.ts); this module
// re-keys each install by a salted hash, so the README never shows the id.
// No key or no network: no machines and one note, and the caller keeps the
// local aggregate.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import type { MachineTotals } from "./proof.js";

export const DEFAULT_QUERY_URL = "https://eu.posthog.com";

const QUERY = `SELECT distinct_id,
  toString(max(toDate(timestamp))),
  countIf(event = 'agentbrew.sync'),
  countIf(event = 'agentbrew.sync' AND properties.ok = false),
  countIf(event = 'agentbrew.repair'),
  countIf(event = 'agentbrew.repair' AND properties.ok = false),
  sumIf(toFloat(properties.driftBefore), event = 'agentbrew.repair'),
  sumIf(toFloat(properties.repaired), event = 'agentbrew.repair')
FROM events WHERE event LIKE 'agentbrew.%' GROUP BY distinct_id`;

export interface FieldTotalsOptions {
  key: string;
  project: string;
  salt: string;
  url?: string;
  fetchImpl?: typeof fetch;
}

/** A salted hash of the install id, in the same shape as the local machine label. */
export function machineKey(salt: string, installId: string): string {
  return `m-${createHash("sha256").update(`${salt}:${installId}`).digest("hex").slice(0, 10)}`;
}

/** A personal setting from the env, else the macOS Keychain (service "agentbrew"); "" when unset. */
export function personalSetting(env: string, account: string): string {
  if (process.env[env] !== undefined) return process.env[env] ?? "";
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("security", ["find-generic-password", "-s", "agentbrew", "-a", account, "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Read per-install totals. Never throws. */
export async function fieldTotals(
  o: FieldTotalsOptions,
): Promise<{ machines: Record<string, MachineTotals>; note?: string }> {
  if (!o.key || !o.project) {
    return { machines: {}, note: "no PostHog query key or project id set; using the local event log" };
  }
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(
      `${(o.url ?? DEFAULT_QUERY_URL).replace(/\/$/, "")}/api/projects/${o.project}/query/`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${o.key}`, "content-type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query: QUERY } }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return { machines: {}, note: "PostHog query failed (network); using the local event log" };
  }
  if (!res.ok) return { machines: {}, note: `PostHog query failed (http ${res.status}); using the local event log` };
  let rows: unknown[][];
  try {
    rows = ((await res.json()) as { results?: unknown[][] }).results ?? [];
  } catch {
    return { machines: {}, note: "PostHog answer was not JSON; using the local event log" };
  }
  const machines: Record<string, MachineTotals> = {};
  for (const [id, date, syncs, syncFailed, repairs, repairFailed, driftSeen, driftRepaired] of rows) {
    if (typeof id !== "string" || !id) continue;
    machines[machineKey(o.salt, id)] = {
      date: String(date ?? ""),
      syncs: num(syncs),
      syncFailed: num(syncFailed),
      repairs: num(repairs),
      repairFailed: num(repairFailed),
      driftSeen: num(driftSeen),
      driftRepaired: num(driftRepaired),
    };
  }
  return { machines };
}
