import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepOneJsonConfigForPlaywrightIsolated } from "./playwright-isolated-sweep.js";

// ── Why these tests focus on `sweepOneJsonConfigForPlaywrightIsolated`, not
//   the wrapper ───────────────────────────────────────────────────────────────
//
// Same rationale as resilient-sweep.test.ts: `sweepPlaywrightIsolated` walks
// AGENT_DEFINITIONS and expands `~/.…` paths. Testing the inner function
// against a tmpdir gives full read/transform/write coverage with zero mocks.

describe("sweepOneJsonConfigForPlaywrightIsolated", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "playwright-isolated-sweep-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(relativePath: string, content: unknown): string {
    const fullPath = join(tmp, relativePath);
    writeFileSync(fullPath, JSON.stringify(content, null, 2));
    return fullPath;
  }

  function read(fullPath: string): unknown {
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  }

  it("returns zero findings when the file doesn't exist", () => {
    const result = sweepOneJsonConfigForPlaywrightIsolated(join(tmp, "missing.json"), "mcpServers", false);
    expect(result).toEqual({ fixedCount: 0, findings: [] });
  });

  it("returns zero findings when there is no playwright entry", () => {
    const path = write("clean.json", {
      mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] } },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.findings).toHaveLength(0);
  });

  it("returns zero findings when playwright already has --isolated", () => {
    const original = {
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--isolated"] } },
    };
    const path = write("clean.json", original);
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.findings).toHaveLength(0);
    expect(read(path)).toEqual(original); // file unchanged
  });

  it("dryRun returns findings but does NOT write the file", () => {
    const original = { mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } } };
    const path = write("dirty.json", original);
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].path).toBe("mcpServers.playwright");
    expect(result.fixedCount).toBe(0);
    expect(read(path)).toEqual(original); // file unchanged
  });

  it("appends --isolated to a global playwright entry missing the flag", () => {
    const path = write("dirty.json", {
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(read(path)).toEqual({
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--isolated"] } },
    });
  });

  it("appends --isolated to per-project playwright entries", () => {
    const path = write("multi.json", {
      mcpServers: {},
      projects: {
        "/Users/alice/repo1": {
          mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
        },
        "/Users/alice/repo2": {
          mcpServers: {
            playwright: { command: "npx", args: ["@playwright/mcp@latest", "--headless", "--no-sandbox"] },
          },
        },
      },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.fixedCount).toBe(2);
    const written = read(path) as { projects: Record<string, { mcpServers: { playwright: { args: string[] } } }> };
    expect(written.projects["/Users/alice/repo1"].mcpServers.playwright.args).toContain("--isolated");
    expect(written.projects["/Users/alice/repo2"].mcpServers.playwright.args).toContain("--isolated");
    // Original args preserved
    expect(written.projects["/Users/alice/repo2"].mcpServers.playwright.args).toEqual([
      "@playwright/mcp@latest",
      "--headless",
      "--no-sandbox",
      "--isolated",
    ]);
  });

  it("is idempotent — re-running on a clean file is a no-op", () => {
    const path = write("dirty.json", {
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
    });
    sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    const firstResult = read(path);
    const secondRun = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(secondRun.fixedCount).toBe(0);
    expect(read(path)).toEqual(firstResult);
  });

  it("only fixes the entries that need fixing — leaves already-isolated entries alone", () => {
    const path = write("mixed.json", {
      mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--isolated"] } },
      projects: {
        "/Users/alice/repo1": {
          mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
        },
      },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].path).toBe("projects./Users/alice/repo1.mcpServers.playwright");
  });

  it("does NOT touch non-playwright npx MCP servers", () => {
    const original = {
      mcpServers: {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] },
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    };
    const path = write("clean.json", original);
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.findings).toHaveLength(0);
    expect(read(path)).toEqual(original);
  });

  it("ignores entries whose command is NOT npx (e.g. user-launched custom binaries)", () => {
    const original = {
      mcpServers: { playwright: { command: "/usr/local/bin/playwright-mcp", args: ["@playwright/mcp@latest"] } },
    };
    const path = write("custom.json", original);
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.findings).toHaveLength(0);
    expect(read(path)).toEqual(original);
  });

  it("handles entries under custom mcpKey (e.g. `servers` instead of `mcpServers`)", () => {
    const path = write("custom-key.json", {
      servers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "servers", false);
    expect(result.fixedCount).toBe(1);
    expect(read(path)).toEqual({
      servers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--isolated"] } },
    });
  });

  it("handles a server named anything (not just 'playwright') as long as args reference @playwright/mcp", () => {
    // The catalog uses 'playwright' as the name, but per-project entries might
    // have user-chosen names — match on args content, not the server key.
    const path = write("renamed.json", {
      mcpServers: { "browser-tools": { command: "npx", args: ["-y", "@playwright/mcp@latest"] } },
    });
    const result = sweepOneJsonConfigForPlaywrightIsolated(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(result.findings[0].path).toBe("mcpServers.browser-tools");
  });
});
