import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "../types.js";
import { finalizeCursorGuiMcpEntries, resolveMcpCursorLauncher, wrapCursorGuiStdioEntry } from "./cursor-gui-launch.js";

function makeServer(overrides?: Partial<McpServer>): McpServer {
  return {
    name: "test-server",
    command: "npx",
    args: ["-y", "@test/server"],
    env: {},
    source: "user",
    ...overrides,
  };
}

describe("cursor-gui-launch", () => {
  let tmp: string;
  let launcher: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cursor-gui-launch-"));
    launcher = join(tmp, "bin/mcp-cursor-launch.sh");
    mkdirSync(join(tmp, "bin"), { recursive: true });
    writeFileSync(launcher, '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolveMcpCursorLauncher returns null when overlay is absent", () => {
    const resolved = resolveMcpCursorLauncher();
    expect(resolved === null || resolved.endsWith("mcp-cursor-launch.sh")).toBe(true);
  });

  it("wraps npx stdio entries for cursor", () => {
    const server = makeServer();
    const entry = wrapCursorGuiStdioEntry(server, { command: "npx", args: ["-y", "@test/server"] }, "cursor");
    if (resolveMcpCursorLauncher()) {
      expect(entry.command).toContain("mcp-cursor-launch.sh");
      expect(entry.args).toEqual(["npx", "-y", "@test/server"]);
    } else {
      expect(entry.command).toBe("npx");
    }
  });

  it("does not wrap npx entries for non-cursor agents", () => {
    const server = makeServer();
    const entry = wrapCursorGuiStdioEntry(server, { command: "npx", args: ["-y", "@test/server"] }, "windsurf");
    expect(entry.command).toBe("npx");
  });

  it("injects HOME export into bash -lc overlay scripts without wrapper exec", () => {
    const script = 'overlay="${DOTFILES_OVERLAY_ROOT:?set DOTFILES_OVERLAY_ROOT}"; echo starting';
    const server = makeServer({ command: "/bin/bash", args: ["-lc", script] });
    const entry = wrapCursorGuiStdioEntry(server, { command: "/bin/bash", args: ["-lc", script] }, "cursor");
    const args = entry.args as string[];
    expect(args[1]).toContain('export HOME="${HOME:-/Users/$(/usr/bin/id -un)}";');
    expect(args[1]).toContain(script);
  });

  it("rewrites bash -lc overlay scripts to absolute wrapper paths for cursor", () => {
    const script =
      'overlay="${DOTFILES_OVERLAY_ROOT:-${DOTFILES_REPOS_DIR:-$HOME/apps}/tooling/dotfiles-acme}"; exec "$overlay/bin/jira-mcp-wrapper.sh"';
    const server = makeServer({ command: "/bin/bash", args: ["-lc", script] });
    const entry = wrapCursorGuiStdioEntry(server, { command: "/bin/bash", args: ["-lc", script] }, "cursor");
    if (resolveMcpCursorLauncher()) {
      expect(entry.command).toContain("mcp-cursor-launch.sh");
      expect(entry.args).toEqual([expect.stringContaining("jira-mcp-wrapper.sh")]);
    }
  });

  it("finalizeCursorGuiMcpEntries wraps bare npx entries", () => {
    const entries: Record<string, Record<string, unknown>> = {
      playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    };
    finalizeCursorGuiMcpEntries(entries);
    if (resolveMcpCursorLauncher()) {
      expect(entries.playwright?.command).toContain("mcp-cursor-launch.sh");
      expect(entries.playwright?.args).toEqual(["npx", "-y", "@playwright/mcp@latest"]);
    }
  });
});
