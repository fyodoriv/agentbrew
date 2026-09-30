/**
 * Regression tests for catalog probe suppression.
 *
 * The catalog keys `probeSuppression` by bare server name; the health snapshot
 * keys entries by `agent:name`. `agentbrew mcp probe` used to hand the catalog
 * map straight to `saveMcpHealthSnapshot`, so no lookup ever hit and every
 * declared suppression was dead — `agentbrew status` reported an expected,
 * unfixable failure as an error forever.
 */

import { describe, expect, it } from "vitest";
import type { CatalogMcpProbeSuppression } from "../catalog/types.js";
import {
  buildMcpHealthSnapshot,
  catalogServerName,
  isSuppressedFailure,
  resolveProbeSuppressions,
  suppressedMcpEntries,
  unhealthyMcpEntries,
} from "./health-snapshot.js";
import type { ProbeResult } from "./probe.js";

const FIGMA_SUPPRESSION: CatalogMcpProbeSuppression = {
  statuses: ["init_error"],
  reason: "per-client OAuth; agentbrew's probe is unauthenticated by design",
  retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
};

const byServer = new Map<string, CatalogMcpProbeSuppression>([["figma", FIGMA_SUPPRESSION]]);

function failure(name: string, agent: string, status: ProbeResult["status"] = "init_error"): ProbeResult {
  return { name, agent, status, latencyMs: 10, error: "HTTP 401: Unauthorized" };
}

describe("catalogServerName", () => {
  it("strips the mcpm wrapper prefix", () => {
    expect(catalogServerName("mcpm_figma")).toBe("figma");
  });

  it("leaves a bare name untouched", () => {
    expect(catalogServerName("figma")).toBe("figma");
  });
});

describe("resolveProbeSuppressions", () => {
  it("rekeys a name-keyed catalog map to agent:name", () => {
    const resolved = resolveProbeSuppressions([failure("figma", "cursor")], byServer);

    expect([...resolved.keys()]).toEqual(["cursor:figma"]);
    expect(resolved.get("cursor:figma")?.reason).toBe(FIGMA_SUPPRESSION.reason);
  });

  it("matches the mcpm-wrapped deployment of the same server", () => {
    const resolved = resolveProbeSuppressions([failure("mcpm_figma", "claude-code")], byServer);

    expect(resolved.has("claude-code:mcpm_figma")).toBe(true);
  });

  it("ignores a failure whose status the catalog did not declare", () => {
    const resolved = resolveProbeSuppressions([failure("figma", "cursor", "launch_failed")], byServer);

    expect(resolved.size).toBe(0);
  });

  it("never suppresses a passing probe", () => {
    const ok: ProbeResult = { name: "figma", agent: "cursor", status: "ok", latencyMs: 5 };

    expect(resolveProbeSuppressions([ok], byServer).size).toBe(0);
  });

  it("leaves servers with no catalog suppression alone", () => {
    const resolved = resolveProbeSuppressions([failure("github", "cursor")], byServer);

    expect(resolved.size).toBe(0);
  });
});

describe("unhealthyMcpEntries", () => {
  function snapshotFor(results: ProbeResult[]) {
    return buildMcpHealthSnapshot(
      undefined,
      results,
      [],
      "2026-08-31T00:00:00.000Z",
      resolveProbeSuppressions(results, byServer),
    );
  }

  it("does not count a suppressed failure as an error", () => {
    const snapshot = snapshotFor([failure("figma", "cursor")]);

    expect(unhealthyMcpEntries(snapshot)).toEqual([]);
  });

  it("still counts a genuine failure", () => {
    const snapshot = snapshotFor([failure("github", "cursor")]);

    expect(unhealthyMcpEntries(snapshot).map((e) => e.name)).toEqual(["github"]);
  });

  it("separates the suppressed entry from the actionable one", () => {
    const snapshot = snapshotFor([failure("figma", "cursor"), failure("github", "cursor")]);

    expect(unhealthyMcpEntries(snapshot).map((e) => e.name)).toEqual(["github"]);
    expect(suppressedMcpEntries(snapshot).map((e) => e.name)).toEqual(["figma"]);
  });

  it("records why the entry is suppressed so it stays discoverable", () => {
    const snapshot = snapshotFor([failure("mcpm_figma", "claude-code")]);

    expect(suppressedMcpEntries(snapshot)[0]?.suppression?.reason).toBe(FIGMA_SUPPRESSION.reason);
  });
});

describe("isSuppressedFailure", () => {
  it("tells the heal loop to skip a declared failure", () => {
    expect(isSuppressedFailure(failure("figma", "cursor"), byServer)).toBe(true);
  });

  it("covers the mcpm-wrapped name too, so heal does not retry it every tick", () => {
    expect(isSuppressedFailure(failure("mcpm_figma", "claude-code"), byServer)).toBe(true);
  });

  it("lets a real failure through to the heal loop", () => {
    expect(isSuppressedFailure(failure("github", "cursor"), byServer)).toBe(false);
  });
});
