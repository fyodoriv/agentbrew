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

  describe("resolveMcpCursorLauncher overlay discovery", () => {
    const ENV_KEYS = ["HOME", "DOTFILES_REPOS_DIR", "DOTFILES_OVERLAY_ROOT", "EXTRA_OVERLAY_ROOT"] as const;
    let savedEnv: Record<string, string | undefined>;

    function makeLauncher(root: string): string {
      const path = join(root, "bin/mcp-cursor-launch.sh");
      mkdirSync(join(root, "bin"), { recursive: true });
      writeFileSync(path, '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
      return path;
    }

    beforeEach(() => {
      savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
      process.env.HOME = join(tmp, "home");
      process.env.DOTFILES_REPOS_DIR = join(tmp, "repos");
      delete process.env.DOTFILES_OVERLAY_ROOT;
      delete process.env.EXTRA_OVERLAY_ROOT;
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it("discovers any dotfiles-* overlay that ships the launcher under the repos dir", () => {
      const expected = makeLauncher(join(tmp, "repos/tooling/dotfiles-exampleorg"));
      expect(resolveMcpCursorLauncher()).toBe(expected);
    });

    it("discovers an overlay cloned directly under ~/apps", () => {
      delete process.env.DOTFILES_REPOS_DIR;
      const expected = makeLauncher(join(tmp, "home/apps/dotfiles-exampleorg"));
      expect(resolveMcpCursorLauncher()).toBe(expected);
    });

    it("skips dotfiles-* checkouts without the launcher", () => {
      mkdirSync(join(tmp, "repos/tooling/dotfiles-feature/bin"), { recursive: true });
      mkdirSync(join(tmp, "repos/tooling/dotfiles"), { recursive: true });
      expect(resolveMcpCursorLauncher()).toBeNull();
    });

    it("uses EXTRA_OVERLAY_ROOT before discovery", () => {
      makeLauncher(join(tmp, "repos/tooling/dotfiles-exampleorg"));
      process.env.EXTRA_OVERLAY_ROOT = join(tmp, "custom-overlay");
      const expected = makeLauncher(process.env.EXTRA_OVERLAY_ROOT);
      expect(resolveMcpCursorLauncher()).toBe(expected);
    });

    it("keeps DOTFILES_OVERLAY_ROOT as the first choice", () => {
      process.env.EXTRA_OVERLAY_ROOT = join(tmp, "extra-overlay");
      makeLauncher(process.env.EXTRA_OVERLAY_ROOT);
      process.env.DOTFILES_OVERLAY_ROOT = join(tmp, "pinned-overlay");
      const expected = makeLauncher(process.env.DOTFILES_OVERLAY_ROOT);
      expect(resolveMcpCursorLauncher()).toBe(expected);
    });
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
