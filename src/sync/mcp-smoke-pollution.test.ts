/**
 * Invariant: the smoke-test in mcp-delegate.test.ts MUST tear down its
 * pid-unique `agentbrew-test-smoke-<pid>` entry. Closes P0
 * `cleanup-mcpm-test-smoke-pollution`.
 *
 * Why this lives in a separate file (not inside mcp-delegate.test.ts):
 *   The mcp-delegate test SHOULD have already torn down by the time
 *   vitest spawns this file. Running this assertion in the same describe
 *   block as the smoke test would race against the afterAll hook.
 *
 *   By placing it in a separate test file that asserts `pgrep` of the
 *   user's mcpm config, we get a deterministic post-hoc check that
 *   catches the *next* failed teardown in CI / local verify — same
 *   shape as a CI-gate but expressed as a vitest case.
 *
 * What happens on a clean machine:
 *   - mcpm not on PATH → test is skipped (matches the smoke test's
 *     `describe.skipIf(!hasMcpm)` gate).
 *   - mcpm present + zero orphans → test passes.
 *   - mcpm present + ≥1 orphan → test fails with the orphan list, so
 *     CI surfaces "we leaked an entry" rather than silently accumulating.
 *
 * Cleanup path: `scripts/cleanup-mcpm-smoke-pollution.sh`.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const hasMcpm = (() => {
  try {
    execFileSync("mcpm", ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
})();

function listMcpmServerNames(): string[] {
  try {
    const out = execFileSync("mcpm", ["ls"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    // `mcpm ls` formats each entry as "<name> (no profiles)" or "<name> (profile: x)".
    // Extract the leading bare-word identifiers.
    return Array.from(out.matchAll(/^([a-zA-Z][a-zA-Z0-9._-]*)\s/gm), (m) => m[1]);
  } catch {
    return [];
  }
}

describe.skipIf(!hasMcpm)("mcpm smoke-test pollution invariant", () => {
  it("user mcpm registry has zero agentbrew-test-smoke-* entries", () => {
    const orphans = listMcpmServerNames().filter((name) => name.startsWith("agentbrew-test-smoke-"));
    expect(orphans, `Run \`scripts/cleanup-mcpm-smoke-pollution.sh\` to remediate.`).toEqual([]);
  });
});
