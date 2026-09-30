import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  checkGitAvailable,
  checkPathConflicts,
  expandHome,
  parseJsonc,
  parseKeyValuePairs,
  vscodeExtConfigPath,
} from "./utils.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe("vscodeExtConfigPath", () => {
  it("returns macOS path on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    const result = vscodeExtConfigPath("saoudrizwan.claude-dev", "cline_mcp_settings.json");
    expect(result).toBe(
      "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    );
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns Linux path on linux", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    const result = vscodeExtConfigPath("rooveterinaryinc.roo-cline", "cline_mcp_settings.json");
    expect(result).toBe(
      "~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json",
    );
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
});

describe("expandHome", () => {
  it("replaces leading ~ with home directory", () => {
    const result = expandHome("~/foo/bar");
    expect(result).toBe(`${homedir()}/foo/bar`);
  });

  it("does not replace ~ in the middle of path", () => {
    const result = expandHome("/foo/~/bar");
    expect(result).toBe("/foo/~/bar");
  });

  it("returns absolute paths unchanged", () => {
    const result = expandHome("/usr/local/bin");
    expect(result).toBe("/usr/local/bin");
  });

  it("handles bare ~", () => {
    const result = expandHome("~");
    expect(result).toBe(homedir());
  });
});

describe("parseJsonc", () => {
  it("parses JSONC with comments", () => {
    const input = `{
  // MCP servers config
  "mcpServers": {
    /* main server */
    "test": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}`;
    const result = parseJsonc<{ mcpServers: Record<string, unknown> }>(input);
    expect(result.mcpServers.test).toEqual({ command: "node", args: ["server.js"] });
  });

  it("parses plain JSON", () => {
    const result = parseJsonc<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonc("{invalid}")).toThrow();
  });

  // Edge cases that exercise the private stripJsonComments path through the
  // public parseJsonc API. Previously asserted against the unexported helper
  // directly; consolidated here so the comment-stripping invariants ride on
  // the API surface that callers actually use.
  it("preserves slashes inside strings", () => {
    expect(parseJsonc<{ url: string }>('{"url": "https://example.com"}')).toEqual({ url: "https://example.com" });
  });

  it("preserves escaped quotes inside strings", () => {
    expect(parseJsonc<{ msg: string }>('{"msg": "say \\"hello\\""}')).toEqual({ msg: 'say "hello"' });
  });

  it("handles inline comments after values", () => {
    const input = `{
  "a": 1, // inline comment
  "b": 2
}`;
    expect(parseJsonc<{ a: number; b: number }>(input)).toEqual({ a: 1, b: 2 });
  });

  it("preserves comment-like content inside strings", () => {
    const input = `{"path": "// not a comment", "val": "/* also not */"}`;
    expect(parseJsonc<{ path: string; val: string }>(input)).toEqual({
      path: "// not a comment",
      val: "/* also not */",
    });
  });
});

describe("parseKeyValuePairs", () => {
  it("parses simple KEY=VALUE pairs", () => {
    expect(parseKeyValuePairs(["FOO=bar", "BAZ=qux"])).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles values containing equals signs", () => {
    expect(parseKeyValuePairs(["URL=https://host?a=1&b=2"])).toEqual({ URL: "https://host?a=1&b=2" });
  });

  it("returns empty object for empty input", () => {
    expect(parseKeyValuePairs([])).toEqual({});
  });
});

describe("checkGitAvailable", () => {
  it("returns true when git is available", () => {
    vi.mocked(spawnSync).mockRestore();
    // git is available in the test environment
    expect(checkGitAvailable()).toBe(true);
  });
});

describe("checkPathConflicts", () => {
  it("returns empty array when which fails (agentbrew not in PATH)", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: new Error("not found"),
      status: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    expect(checkPathConflicts()).toEqual([]);
  });

  it("returns empty array when all binaries are Node.js scripts", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: Buffer.from("/usr/local/bin/agentbrew\n"),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    vi.mocked(readFileSync).mockReturnValueOnce("#!/usr/bin/env node\nimport { cli } from './cli.js';");
    expect(checkPathConflicts()).toEqual([]);
  });

  it("detects bash scripts as conflicts", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: Buffer.from("/home/user/.local/bin/agentbrew\n/usr/local/bin/agentbrew\n"),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    // First binary: bash script (conflict)
    vi.mocked(readFileSync).mockReturnValueOnce("#!/bin/bash\necho 'legacy agentbrew'");
    // Second binary: Node.js (not a conflict)
    vi.mocked(readFileSync).mockReturnValueOnce("#!/usr/bin/env node\nimport { cli } from './cli.js';");
    expect(checkPathConflicts()).toEqual(["/home/user/.local/bin/agentbrew"]);
  });

  it("detects scripts with direct node path as non-conflicting", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: Buffer.from("/usr/local/bin/agentbrew\n"),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    vi.mocked(readFileSync).mockReturnValueOnce("#!/usr/local/bin/node\nconst x = 1;");
    expect(checkPathConflicts()).toEqual([]);
  });

  it("skips unreadable binaries (compiled executables)", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: Buffer.from("/usr/local/bin/agentbrew\n"),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("EISDIR or binary");
    });
    expect(checkPathConflicts()).toEqual([]);
  });

  it("ignores empty lines in which output", () => {
    vi.mocked(readFileSync).mockClear();
    vi.mocked(spawnSync).mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: Buffer.from("/usr/local/bin/agentbrew\n\n\n"),
      stderr: Buffer.from(""),
      pid: 0,
      output: [],
      signal: null,
    });
    vi.mocked(readFileSync).mockReturnValueOnce("#!/usr/bin/env node\n");
    expect(checkPathConflicts()).toEqual([]);
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});
