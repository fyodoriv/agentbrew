import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncMcpServers } from "../sync/mcp-sync.js";
import { categorizeProbeResult, HEAL_ACTIONS, PROBE_STATUS_DISPOSITION } from "./heal-actions.js";
import type { ProbeResult, ProbeStatus } from "./probe.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../sync/mcp-sync.js", () => ({
  syncMcpServers: vi.fn(),
}));

const STATUSES: ProbeStatus[] = [
  "ok",
  "ok_deep_failed",
  "launch_failed",
  "init_timeout",
  "init_error",
  "tools_list_failed",
  "tools_list_empty",
  "tools_list_timeout",
  "smoke_call_failed",
  "skipped_no_command",
];

function result(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    name: "github",
    agent: "cursor",
    status: "smoke_call_failed",
    latencyMs: 10,
    ...overrides,
  };
}

describe("HEAL_ACTIONS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENTBREW_GITHUB_HOST;
    delete process.env.GH_HOST;
  });

  it("covers every probe status with a heal category or skip rationale", () => {
    for (const status of STATUSES) {
      const disposition = PROBE_STATUS_DISPOSITION[status];
      expect(disposition).toBeDefined();
      if (disposition.category) {
        expect(HEAL_ACTIONS.has(disposition.category)).toBe(true);
      } else {
        expect(disposition.skip).toBeTruthy();
      }
    }
  });

  it("categorizes github 401 smoke failures as auth repair", () => {
    expect(categorizeProbeResult(result({ error: "401 Unauthorized" }))).toBe("auth");
  });

  it("re-derives github auth without exposing the token", async () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("secret-token\n"));
    const action = HEAL_ACTIONS.get("auth");
    const healed = await action?.(result({ error: "401 Unauthorized" }));

    expect(execFileSync).toHaveBeenCalledWith("gh", ["auth", "token"], {
      stdio: "pipe",
      timeout: 15_000,
    });
    expect(healed?.healed).toBe(true);
    expect(JSON.stringify(healed)).not.toContain("secret-token");
  });

  it("uses an explicit GitHub host when configured", async () => {
    process.env.AGENTBREW_GITHUB_HOST = "github.example.com";
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("secret-token\n"));
    const action = HEAL_ACTIONS.get("auth");
    await action?.(result({ error: "401 Unauthorized" }));

    expect(execFileSync).toHaveBeenCalledWith("gh", ["auth", "token", "--hostname", "github.example.com"], {
      stdio: "pipe",
      timeout: 15_000,
    });
  });

  it("runs MCP sync for launcher/protocol repair", async () => {
    const action = HEAL_ACTIONS.get("sync");
    await action?.(result({ status: "launch_failed", error: "missing binary" }));
    expect(syncMcpServers).toHaveBeenCalledOnce();
  });

  // Regression: a remote MCP whose proxy rejects the stored credential failed
  // with `init_error` / `tools_list_failed`, both of which default to the sync
  // category. Auto-heal then re-ran the sync on every cycle and never told the
  // user the server actually needs a login.
  it.each([
    "init_error",
    "tools_list_failed",
    "init_timeout",
    "launch_failed",
  ] as const)("categorizes a 403 at the %s stage as auth, not sync", (status) => {
    const probe = result({ name: "remote-proxy", status, error: "MCP initialize returned HTTP 403" });
    expect(categorizeProbeResult(probe)).toBe("auth");
  });

  it("categorizes a 401 body the same way", () => {
    const probe = result({ name: "remote-proxy", status: "init_error", error: "Client error '401 Unauthorized'" });
    expect(categorizeProbeResult(probe)).toBe("auth");
  });

  it("still categorizes a genuine transport failure as sync", () => {
    const probe = result({ name: "some-server", status: "init_error", error: "spawn ENOENT" });
    expect(categorizeProbeResult(probe)).toBe("sync");
  });

  it("emits an actionable followup instead of silently retrying for a non-github auth failure", async () => {
    const action = HEAL_ACTIONS.get("auth");
    const outcome = await action?.(result({ name: "remote-proxy", status: "init_error", error: "HTTP 403" }));
    expect(outcome?.healed).toBe(false);
    expect(outcome?.followupTask).toContain("remote-proxy");
    expect(syncMcpServers).not.toHaveBeenCalled();
  });

  it("keeps healthy and skipped statuses uncategorized", () => {
    expect(categorizeProbeResult(result({ status: "ok", error: undefined }))).toBeUndefined();
    expect(categorizeProbeResult(result({ status: "skipped_no_command", error: undefined }))).toBeUndefined();
  });
});
