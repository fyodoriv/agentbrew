import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkClaudeDesktopMcpDrift, parseDesktopMcpFailures, readDesktopMcpFailures } from "./claude-desktop-mcp.js";

const OLD_START = "2026-01-01 08:00:00 [info] Starting app {";
const NEW_START = "2026-01-02 09:00:00 [info] Starting app {";
const INVALID = "2026-01-02 09:00:05 [error] Skipped invalid MCP server config entries: demo-a, demo-b";
const CONNECT =
  "2026-01-02 09:00:07 [error] [LocalMcpServerManager] Failed to connect to plugin:demo:Demo-Local: Connection closed { code: 'CONNECTION_CLOSED' }";

describe("parseDesktopMcpFailures", () => {
  it("lists invalid config entries and plugin connect failures with fix paths", () => {
    const failures = parseDesktopMcpFailures([NEW_START, INVALID, CONNECT].join("\n"));
    expect(failures).toEqual([
      expect.objectContaining({
        name: "demo-a",
        kind: "invalid-config",
        fix: expect.stringContaining("agentbrew sync"),
      }),
      expect.objectContaining({ name: "demo-b", kind: "invalid-config" }),
      expect.objectContaining({
        name: "plugin:demo:Demo-Local",
        kind: "connect-failed",
        fix: expect.stringContaining("Customize"),
      }),
    ]);
  });

  it("ignores failures logged before the latest app start", () => {
    expect(
      parseDesktopMcpFailures([OLD_START, INVALID, CONNECT, NEW_START, "2026-01-02 09:00:09 [info] ok"].join("\n")),
    ).toEqual([]);
  });

  it("reports nothing for a clean log", () => {
    expect(parseDesktopMcpFailures(`${NEW_START}\n2026-01-02 09:00:01 [info] Launching MCP Server: demo`)).toEqual([]);
  });

  it("de-duplicates repeated connect failures for one server", () => {
    expect(parseDesktopMcpFailures([NEW_START, CONNECT, CONNECT].join("\n"))).toHaveLength(1);
  });
});

describe("readDesktopMcpFailures", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "desktop-log-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns [] when the log does not exist", () => {
    expect(readDesktopMcpFailures(join(dir, "missing.log"))).toEqual([]);
    expect(checkClaudeDesktopMcpDrift(join(dir, "missing.log"))).toEqual([]);
  });

  it("reads only the bounded tail of a large log", () => {
    const filler = `${"x".repeat(100)}\n`.repeat(40_000);
    const path = join(dir, "main.log");
    writeFileSync(path, `${INVALID}\n${filler}${NEW_START}\n${CONNECT}\n`);
    const failures = readDesktopMcpFailures(path);
    expect(failures.map((f) => f.name)).toEqual(["plugin:demo:Demo-Local"]);
  });

  it("turns failures into claude-desktop-mcp drift items", () => {
    const path = join(dir, "main.log");
    writeFileSync(path, [NEW_START, INVALID, CONNECT].join("\n"));
    const items = checkClaudeDesktopMcpDrift(path);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ agent: "claude-desktop", type: "claude-desktop-mcp" });
    expect(items[0]?.detail).toContain("demo-a");
  });
});
