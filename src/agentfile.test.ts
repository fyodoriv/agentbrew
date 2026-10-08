import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./state.js", () => ({
  requireState: vi.fn(),
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("./catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({
    skills: [],
    mcp_servers: [
      {
        name: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
        env: {},
        description: "",
        category: "development",
        recommended: false,
      },
      {
        name: "playwright",
        command: "npx",
        args: ["-y", "@anthropic/mcp-playwright"],
        env: {},
        description: "",
        category: "development",
        recommended: false,
      },
      // http-transport entry — verifies the shorthand path carries `url`
      // through into state. Regression guard for the bug where
      // resolveMcpEntry dropped url on catalog shorthand.
      {
        name: "http-only-mcp",
        url: "http://localhost:9999/my-mcp",
        description: "",
        category: "observability",
        recommended: true,
      },
    ],
    rules: [],
  })),
}));

import {
  addSkillToAgentfile,
  addSourceToAgentfile,
  addToAgentfile,
  applyAgentfile,
  ensureAgentfile,
  generateAgentfile,
  installSkillToProject,
  loadAgentfile,
  loadAgentfileFromPath,
  mergeAgentfiles,
  parseAgentfile,
  removeFromAgentfile,
  resolveAgentfileMcp,
  resolveMcpEntry,
  validateAgentfileMcp,
} from "./agentfile.js";
import { loadCatalog } from "./catalog/types.js";
import { loadState, requireState, saveState } from "./state.js";

const mockLoadCatalog = vi.mocked(loadCatalog);
const mockRequireState = vi.mocked(requireState);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);

const tmpDir = `/tmp/agentfile-test-${Date.now()}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadCatalog.mockReturnValue({
    skills: [],
    mcp_servers: [
      {
        name: "context7",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
        env: {},
        description: "",
        category: "development",
        recommended: false,
      },
      {
        name: "playwright",
        command: "npx",
        args: ["-y", "@anthropic/mcp-playwright"],
        env: {},
        description: "",
        category: "development",
        recommended: false,
      },
      {
        name: "http-only-mcp",
        url: "http://localhost:9999/my-mcp",
        description: "",
        category: "observability",
        recommended: true,
      },
    ],
    rules: [],
  });
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseAgentfile", () => {
  it("parses a full Agentfile with all fields", () => {
    const result = parseAgentfile(`
mcp:
  - context7
  - name: my-server
    command: npx
    args: [tsx, ./server.ts]
    env:
      API_KEY: \${API_KEY}
skills:
  - debug
  - plan
sources:
  - vercel-labs/skills
rules: |
  Use conventional commits.
`);
    expect(result.mcp).toHaveLength(2);
    expect(result.skills).toEqual(["debug", "plan"]);
    expect(result.sources).toEqual(["vercel-labs/skills"]);
    expect(result.rules).toContain("conventional commits");
  });

  it("returns empty object for empty content", () => {
    expect(parseAgentfile("")).toEqual({});
    expect(parseAgentfile("---")).toEqual({});
  });

  it("handles mcp-only Agentfile", () => {
    const result = parseAgentfile("mcp:\n  - context7\n  - playwright");
    expect(result.mcp).toEqual(["context7", "playwright"]);
    expect(result.skills).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });

  it("handles rules-only Agentfile", () => {
    const result = parseAgentfile("rules: |\n  Be kind to users.");
    expect(result.rules).toContain("Be kind");
  });

  it("parses hooks entries from Agentfile", () => {
    const result = parseAgentfile(`
hooks:
  - event: PreToolUse
    matcher: Bash
    command: "echo pre"
  - event: Stop
    type: prompt
    prompt: "Review your changes"
`);
    expect(result.hooks).toHaveLength(2);
    expect(result.hooks?.[0].event).toBe("PreToolUse");
    expect(result.hooks?.[0].matcher).toBe("Bash");
    expect(result.hooks?.[0].command).toBe("echo pre");
    expect(result.hooks?.[1].event).toBe("Stop");
    expect(result.hooks?.[1].type).toBe("prompt");
    expect(result.hooks?.[1].prompt).toBe("Review your changes");
  });

  it("parses hooks with timeout", () => {
    const result = parseAgentfile(`
hooks:
  - event: PreToolUse
    command: "slow-check"
    timeout: 30000
`);
    expect(result.hooks?.[0].timeout).toBe(30000);
  });

  it("ignores invalid hook entries (missing event)", () => {
    const result = parseAgentfile(`
hooks:
  - command: "echo no-event"
  - event: PreToolUse
    command: "echo valid"
`);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks?.[0].event).toBe("PreToolUse");
  });

  it("ignores non-object hook entries", () => {
    const result = parseAgentfile(`
hooks:
  - "just a string"
  - event: PreToolUse
    command: "echo valid"
`);
    expect(result.hooks).toHaveLength(1);
  });

  it("returns undefined hooks when key missing", () => {
    const result = parseAgentfile("mcp:\n  - context7");
    expect(result.hooks).toBeUndefined();
  });
});

describe("mergeAgentfiles", () => {
  it("unions additive fields in file order and uses later scalar fields", () => {
    const basePath = join(tmpDir, "base.Agentfile.yaml");
    const overlayPath = join(tmpDir, "overlay.Agentfile.yaml");
    writeFileSync(
      basePath,
      `
mcp:
  - context7
  - name: local
    command: node
    args: [base.js]
skills:
  - debug
sources:
  - vercel-labs/skills
memory:
  enabled: true
memoryPacks:
  - ./packs/base
rules: |
  base rules
recommended: true
task_backend: tasks-md
`,
    );
    writeFileSync(
      overlayPath,
      `
mcp:
  - context7
  - name: local
    command: node
    args: [overlay.js]
  - playwright
skills:
  - debug
  - plan
sources:
  - acme/internal-skills
memoryPacks:
  - ./packs/overlay
rules: |
  overlay rules
task_backend: github-issues
repo: acme/project
project: 42
`,
    );

    const merged = parseAgentfile(mergeAgentfiles([basePath, overlayPath]));

    expect(merged.mcp).toEqual(["context7", { name: "local", command: "node", args: ["overlay.js"] }, "playwright"]);
    expect(merged.skills).toEqual(["debug", "plan"]);
    expect(merged.sources).toEqual(["vercel-labs/skills", "acme/internal-skills"]);
    expect(merged.rules).toBe("base rules\n\noverlay rules");
    expect(merged.recommended).toBe(true);
    expect(merged.task_backend).toBe("github-issues");
    expect(merged.repo).toBe("acme/project");
    expect(merged.project).toBe(42);
    expect(merged.memory).toEqual({ enabled: true });
    expect(merged.memoryPacks).toEqual([join(tmpDir, "packs/base"), join(tmpDir, "packs/overlay")]);
  });

  it("carries defaultModel through and merges modelOverrides per key", () => {
    const basePath = join(tmpDir, "base.Agentfile.yaml");
    const overlayPath = join(tmpDir, "overlay.Agentfile.yaml");
    writeFileSync(basePath, "defaultModel: claude-5-fable-max\nmodelOverrides:\n  codex: gpt-5.1-codex\n");
    writeFileSync(overlayPath, "modelOverrides:\n  claude-code: null\n");

    const merged = parseAgentfile(mergeAgentfiles([basePath, overlayPath]));

    expect(merged.defaultModel).toBe("claude-5-fable-max");
    expect(merged.modelOverrides).toEqual({ codex: "gpt-5.1-codex", "claude-code": null });
  });
});

describe("loadAgentfile", () => {
  it("loads Agentfile from directory", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const result = loadAgentfile(tmpDir);
    expect(result?.mcp).toEqual(["context7"]);
  });

  it("loads Agentfile.yaml variant", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "skills:\n  - debug\n");
    const result = loadAgentfile(tmpDir);
    expect(result?.skills).toEqual(["debug"]);
  });

  it("returns undefined when no Agentfile exists", () => {
    expect(loadAgentfile(tmpDir)).toBeUndefined();
  });

  it("prefers Agentfile.yaml over bare Agentfile", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - playwright\n");
    const result = loadAgentfile(tmpDir);
    expect(result?.mcp).toEqual(["playwright"]);
  });

  it("returns undefined and prints error for malformed YAML", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n  bad: [yaml: {unterminated");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = loadAgentfile(tmpDir);
    expect(result).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to parse Agentfile"));
  });
});

describe("resolveMcpEntry", () => {
  it("resolves catalog shorthand to full server definition", () => {
    const result = resolveMcpEntry("context7");
    expect(result).toBeDefined();
    expect(result?.name).toBe("context7");
    expect(result?.command).toBe("npx");
    expect(result?.source).toBe("agentfile");
  });

  it("returns undefined for unknown catalog name", () => {
    expect(resolveMcpEntry("nonexistent-server")).toBeUndefined();
  });

  it("passes through full spec entries", () => {
    const result = resolveMcpEntry({ name: "my-srv", command: "node", args: ["./server.js"], env: { KEY: "val" } });
    expect(result?.name).toBe("my-srv");
    expect(result?.command).toBe("node");
    expect(result?.args).toEqual(["./server.js"]);
    expect(result?.env).toEqual({ KEY: "val" });
  });

  it("passes through a URL-only full spec with headers", () => {
    const result = resolveMcpEntry({
      name: "shared-memory",
      url: "http://127.0.0.1:18765/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    });
    expect(result?.command).toBe("");
    expect(result?.url).toBe("http://127.0.0.1:18765/mcp");
    expect(result?.headers).toEqual({ Authorization: "Bearer ${TOKEN}" });
  });

  it("carries http-transport `url` through catalog shorthand", () => {
    // Regression — earlier the catalog-shorthand path only copied
    // command/args/env, dropping `url` for HTTP-transport entries.
    // That left any HTTP-only MCP with an empty command + no url in
    // state.yaml → unable to deploy.
    const result = resolveMcpEntry("http-only-mcp");
    expect(result).toBeDefined();
    expect(result?.name).toBe("http-only-mcp");
    expect(result?.url).toBe("http://localhost:9999/my-mcp");
    expect(result?.source).toBe("agentfile");
  });
});

describe("resolveAgentfileMcp", () => {
  it("resolves a mix of shorthand and full specs", () => {
    const servers = resolveAgentfileMcp({
      mcp: ["context7", { name: "custom", command: "npx", args: ["my-pkg"] }],
    });
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe("context7");
    expect(servers[1].name).toBe("custom");
  });

  it("returns empty array when no mcp field", () => {
    expect(resolveAgentfileMcp({})).toEqual([]);
  });

  it("skips unknown catalog entries", () => {
    const servers = resolveAgentfileMcp({ mcp: ["context7", "nonexistent"] });
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("context7");
  });
});

describe("generateAgentfile", () => {
  it("generates Agentfile from state with catalog shorthands", () => {
    mockRequireState.mockReturnValue({
      mcpServers: [
        { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "catalog" },
        { name: "my-custom", command: "node", args: ["./server.js"], env: { KEY: "val" }, source: "user" },
      ],
      sources: [{ url: "vercel-labs/skills", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" }],
      agents: [],
      catalogVersion: "0.1.0",
    });

    const result = generateAgentfile();
    expect(result).toBeDefined();
    expect(result).toContain("context7");
    expect(result).toContain("my-custom");
    expect(result).toContain("vercel-labs/skills");
  });

  it("preserves memory state and omits the managed HTTP server from mcp entries", () => {
    mockRequireState.mockReturnValue({
      mcpServers: [
        {
          name: "memory",
          command: "",
          args: [],
          env: {},
          source: "agentbrew-memory",
          url: "http://127.0.0.1:18765/mcp",
          addedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      memory: { enabled: true, packPaths: ["/tmp/memory-packs"] },
      sources: [],
      agents: [],
      catalogVersion: "0.1.0",
    });

    const result = generateAgentfile();
    expect(result).toContain("memory:");
    expect(result).toContain("memoryPacks:");
    expect(result).toContain("/tmp/memory-packs");
    expect(result).not.toContain("agentbrew-memory");
    expect(result).not.toContain("127.0.0.1:18765");
  });

  it("emits the recommended model defaults when state has no defaultModel", () => {
    mockRequireState.mockReturnValue({ mcpServers: [], sources: [], agents: [], catalogVersion: "0.1.0" });
    const parsed = parseAgentfile(generateAgentfile() ?? "");
    expect(parsed.defaultModel).toBe("claude-opus-5-5");
    expect(parsed.defaultEffort).toBe("xhigh");
    expect(parsed.modelOverrides).toEqual({ codex: null, devin: null });
  });

  it("emits the machine's own model choice instead of the recommended one", () => {
    mockRequireState.mockReturnValue({
      mcpServers: [],
      sources: [],
      agents: [],
      catalogVersion: "0.1.0",
      defaultModel: "claude-5-fable-max",
      modelOverrides: { codex: "gpt-5.1-codex" },
    });
    const parsed = parseAgentfile(generateAgentfile() ?? "");
    expect(parsed.defaultModel).toBe("claude-5-fable-max");
    expect(parsed.defaultEffort).toBeUndefined();
    expect(parsed.modelOverrides).toEqual({ codex: "gpt-5.1-codex" });
  });

  it("returns undefined when state has no data", () => {
    mockRequireState.mockReturnValue(undefined);
    expect(generateAgentfile()).toBeUndefined();
  });
});

describe("applyAgentfile", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns undefined when no Agentfile exists", () => {
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result).toBeUndefined();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("returns undefined when state is not initialized", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    mockLoadState.mockReturnValue(undefined);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result).toBeUndefined();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("warns when Agentfile exists but state is not initialized", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    mockLoadState.mockReturnValue(undefined);
    const result = applyAgentfile(tmpDir);
    expect(result).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not initialized"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("agentbrew init"));
  });

  it("adds MCP servers from Agentfile to state", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n  - playwright\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result).toBeDefined();
    expect(result?.serversAdded).toEqual(["context7", "playwright"]);
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServers: expect.arrayContaining([expect.objectContaining({ name: "context7" })]) }),
    );
  });

  it("does not duplicate existing servers", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "context7",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          env: {},
          source: "catalog" as const,
        },
      ],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.serversAdded).toEqual([]);
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("adds sources from Agentfile", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "sources:\n  - vercel-labs/skills\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.sourcesAdded).toEqual(["vercel-labs/skills"]);
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("logs summary when not quiet", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    applyAgentfile(tmpDir);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Agentfile applied"));
  });
});

describe("parseAgentfile — defaultModel/modelOverrides", () => {
  it("parses defaultModel and modelOverrides", () => {
    const result = parseAgentfile(`
defaultModel: claude-5-fable-max
modelOverrides:
  claude-code: null
  codex: gpt-5.1-codex
`);
    expect(result.defaultModel).toBe("claude-5-fable-max");
    expect(result.modelOverrides).toEqual({ "claude-code": null, codex: "gpt-5.1-codex" });
  });

  it("drops blank defaultModel and non-string override values", () => {
    const result = parseAgentfile(`
defaultModel: "  "
modelOverrides:
  cursor: 42
  devin: ""
`);
    expect(result.defaultModel).toBeUndefined();
    expect(result.modelOverrides).toBeUndefined();
  });

  it("parses defaultEffort and drops a blank value", () => {
    expect(parseAgentfile("defaultModel: claude-opus-5-5\ndefaultEffort: medium\n").defaultEffort).toBe("medium");
    expect(parseAgentfile('defaultEffort: "  "\n').defaultEffort).toBeUndefined();
  });
});

describe("applyAgentfile — defaultModel", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function freshState() {
    return { agents: [], sources: [], mcpServers: [], catalogVersion: "0.1.0" };
  }

  it("sets defaultModel and modelOverrides in state", () => {
    writeFileSync(
      join(tmpDir, "Agentfile"),
      "defaultModel: claude-5-fable-max\nmodelOverrides:\n  claude-code: null\n",
    );
    const state = freshState();
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.defaultModelUpdated).toBe(true);
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: "claude-5-fable-max", modelOverrides: { "claude-code": null } }),
    );
  });

  it("leaves an existing defaultModel untouched when the Agentfile omits the key", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const state = { ...freshState(), defaultModel: "claude-5-fable-max" };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.defaultModelUpdated).toBe(false);
    expect(state.defaultModel).toBe("claude-5-fable-max");
  });

  it("does not re-save when defaultModel already matches", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "defaultModel: claude-5-fable-max\n");
    const state = { ...freshState(), defaultModel: "claude-5-fable-max" };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.defaultModelUpdated).toBe(false);
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("sets defaultEffort in state", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "defaultModel: claude-opus-5-5\ndefaultEffort: medium\n");
    const state = { ...freshState(), defaultModel: "claude-opus-5-5", defaultEffort: "xhigh" };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.defaultModelUpdated).toBe(true);
    expect(state.defaultEffort).toBe("medium");
  });
});

describe("addToAgentfile", () => {
  it("returns false when no Agentfile exists", () => {
    const result = addToAgentfile("/nonexistent", { name: "srv", command: "npx", args: [], env: {}, source: "user" });
    expect(result).toBe(false);
  });

  it("adds a catalog server as shorthand", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - playwright\n");
    const result = addToAgentfile(tmpDir, {
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
      env: {},
      source: "catalog",
    });
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).toContain("context7");
    expect(content).toContain("playwright");
  });

  it("adds a custom server as full spec", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const result = addToAgentfile(tmpDir, {
      name: "my-srv",
      command: "node",
      args: ["server.js"],
      env: { KEY: "val" },
      source: "user",
    });
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).toContain("my-srv");
    expect(content).toContain("server.js");
  });

  it("skips duplicate servers", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const result = addToAgentfile(tmpDir, { name: "context7", command: "npx", args: [], env: {}, source: "catalog" });
    expect(result).toBe(false);
  });

  it("creates mcp array when none exists", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "rules: |\n  Use conventional commits.\n");
    const result = addToAgentfile(tmpDir, {
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
      env: {},
      source: "catalog",
    });
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).toContain("context7");
    expect(content).toContain("Use conventional commits");
  });
});

describe("removeFromAgentfile", () => {
  it("returns false when no Agentfile exists", () => {
    expect(removeFromAgentfile("/nonexistent", "srv")).toBe(false);
  });

  it("removes a shorthand server by name", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n  - playwright\n");
    const result = removeFromAgentfile(tmpDir, "context7");
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).not.toContain("context7");
    expect(content).toContain("playwright");
  });

  it("removes a full-spec server by name", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - name: my-srv\n    command: node\n");
    const result = removeFromAgentfile(tmpDir, "my-srv");
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).not.toContain("my-srv");
  });

  it("returns false when server not found", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    expect(removeFromAgentfile(tmpDir, "nonexistent")).toBe(false);
  });

  it("deletes empty mcp array", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\nrules: test\n");
    removeFromAgentfile(tmpDir, "context7");
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).not.toContain("mcp:");
    expect(content).toContain("rules:");
  });
});

describe("addSourceToAgentfile", () => {
  it("returns false when no Agentfile exists", () => {
    expect(addSourceToAgentfile("/nonexistent", "org/repo")).toBe(false);
  });

  it("adds a source", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const result = addSourceToAgentfile(tmpDir, "vercel-labs/skills");
    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile"), "utf-8");
    expect(content).toContain("vercel-labs/skills");
  });

  it("skips duplicate sources", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "sources:\n  - vercel-labs/skills\n");
    expect(addSourceToAgentfile(tmpDir, "vercel-labs/skills")).toBe(false);
  });
});

describe("ensureAgentfile", () => {
  it("returns existing Agentfile path when one exists", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n");
    const result = ensureAgentfile(tmpDir);
    expect(result).toBe(join(tmpDir, "Agentfile.yaml"));
  });

  it("creates Agentfile.yaml when none exists", () => {
    const subDir = join(tmpDir, "new-project");
    const result = ensureAgentfile(subDir);
    expect(result).toBe(join(subDir, "Agentfile.yaml"));
    expect(existsSync(result)).toBe(true);
    expect(readFileSync(result, "utf-8")).toContain("Agentfile");
  });
});

describe("addToAgentfile with create option", () => {
  it("creates Agentfile and adds server when create is true", () => {
    const subDir = join(tmpDir, "fresh");
    const result = addToAgentfile(
      subDir,
      { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp@latest"], env: {}, source: "catalog" },
      { create: true },
    );
    expect(result).toBe(true);
    const content = readFileSync(join(subDir, "Agentfile.yaml"), "utf-8");
    expect(content).toContain("context7");
  });

  it("still returns false without create option when no Agentfile", () => {
    const subDir = join(tmpDir, "empty");
    const result = addToAgentfile(subDir, { name: "context7", command: "npx", args: [], env: {}, source: "catalog" });
    expect(result).toBe(false);
  });
});

describe("parseAgentfile — new keys", () => {
  it("parses recommended: true", () => {
    const result = parseAgentfile("recommended: true\nmcp:\n  - context7\n");
    expect(result.recommended).toBe(true);
  });

  it("ignores recommended when not true", () => {
    expect(parseAgentfile("recommended: false").recommended).toBeUndefined();
    expect(parseAgentfile("mcp:\n  - context7").recommended).toBeUndefined();
  });
});

describe("loadAgentfileFromPath", () => {
  it("loads from an explicit file path", () => {
    const filePath = join(tmpDir, "custom-name.yaml");
    writeFileSync(filePath, "mcp:\n  - context7\n");
    const result = loadAgentfileFromPath(filePath);
    expect(result?.mcp).toEqual(["context7"]);
  });

  it("returns undefined for nonexistent path", () => {
    expect(loadAgentfileFromPath(join(tmpDir, "nope.yaml"))).toBeUndefined();
  });

  it("returns undefined and prints error for malformed YAML", () => {
    const filePath = join(tmpDir, "bad.yaml");
    writeFileSync(filePath, "mcp:\n  - context7\n  bad: [yaml: {unterminated");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = loadAgentfileFromPath(filePath);
    expect(result).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to parse Agentfile"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(filePath));
  });
});

describe("applyAgentfile — skills", () => {
  it("collects catalog skills into skillsToInstall", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "skills:\n  - task-command-center\n  - writing-plans\n");
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "task-command-center",
          description: "",
          source: "fyodoriv/agentbrew",
          category: "planning",
          recommended: false,
        },
        {
          name: "writing-plans",
          description: "",
          source: "fyodoriv/agentbrew",
          category: "planning",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
    });
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = applyAgentfile(tmpDir, { quiet: true });
    // Personal-source skills are catalog entries even when no source is installed yet.
    expect(result?.skillsToInstall).toEqual(["task-command-center", "writing-plans"]);
  });
});

describe("applyAgentfile — recommended", () => {
  it("flags recommendedRequested when recommended: true", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "recommended: true\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.recommendedRequested).toBe(true);
  });
});

describe("applyAgentfile — authoritative mode", () => {
  it("removes servers not in Agentfile when authoritative", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "context7",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          env: {},
          source: "agentfile" as const,
        },
        { name: "old-server", command: "node", args: [], env: {}, source: "user" as const },
      ],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = applyAgentfile(tmpDir, { quiet: true, authoritative: true });
    expect(result?.serversRemoved).toEqual(["old-server"]);
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.mcpServers).toHaveLength(1);
    expect((saved.mcpServers ?? [])[0].name).toBe("context7");
  });

  it("does not remove servers when not authoritative", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [
        {
          name: "context7",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          env: {},
          source: "agentfile" as const,
        },
        { name: "old-server", command: "node", args: [], env: {}, source: "user" as const },
      ],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.serversRemoved).toEqual([]);
  });
});

describe("applyAgentfile — rules as file path", () => {
  it("reads rules from a relative file path", () => {
    const rulesFile = join(tmpDir, "my-rules.md");
    writeFileSync(rulesFile, "Use conventional commits.");
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "rules: ./my-rules.md\n");
    // Point HOME to tmpDir so shared-rules.md is written under our control
    const origHome = process.env.HOME;
    const configDir = join(tmpDir, ".config", "agentbrew");
    mkdirSync(configDir, { recursive: true });
    process.env.HOME = tmpDir;
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = applyAgentfile(tmpDir, { quiet: true });
    process.env.HOME = origHome;
    expect(result?.rulesUpdated).toBe(true);
    const written = readFileSync(join(configDir, "shared-rules.md"), "utf-8");
    expect(written).toContain("Use conventional commits.");
  });
});

describe("applyAgentfile — commands field", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("adds command source dirs from Agentfile to state", () => {
    const cmdDir = join(tmpDir, "my-commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "commands:\n  - ./my-commands\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result).toBeDefined();
    expect(result?.commandDirsAdded).toHaveLength(1);
    expect(result?.commandDirsAdded[0]).toContain("my-commands");
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        commandSourceDirs: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("my-commands") }),
        ]),
      }),
    );
  });

  it("skips duplicate command dirs", () => {
    const cmdDir = join(tmpDir, "cmds");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "commands:\n  - ./cmds\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      commandSourceDirs: [{ label: "existing", path: join(tmpDir, "cmds") }],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.commandDirsAdded).toHaveLength(0);
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

describe("applyAgentfile — agents field", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("adds agent source dirs from Agentfile to state", () => {
    const agentDir = join(tmpDir, "my-agents");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "agents:\n  - ./my-agents\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result).toBeDefined();
    expect(result?.agentDirsAdded).toHaveLength(1);
    expect(result?.agentDirsAdded[0]).toContain("my-agents");
    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSourceDirs: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("my-agents") }),
        ]),
      }),
    );
  });

  it("skips duplicate agent dirs", () => {
    const agentDir = join(tmpDir, "agents");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "agents:\n  - ./agents\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      agentSourceDirs: [{ label: "existing", path: join(tmpDir, "agents") }],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.agentDirsAdded).toHaveLength(0);
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

describe("parseAgentfile — commands and agents", () => {
  it("parses commands and agents fields", () => {
    const result = parseAgentfile(`
commands:
  - ./.claude/commands
  - ./custom-commands
agents:
  - ./.claude/agents
`);
    expect(result.commands).toEqual(["./.claude/commands", "./custom-commands"]);
    expect(result.agents).toEqual(["./.claude/agents"]);
  });

  it("returns undefined for missing commands and agents fields", () => {
    const result = parseAgentfile("mcp:\n  - context7\n");
    expect(result.commands).toBeUndefined();
    expect(result.agents).toBeUndefined();
  });
});

describe("addSkillToAgentfile", () => {
  it("adds a skill to the Agentfile skills section", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n", "utf-8");
    const added = addSkillToAgentfile(tmpDir, "debug");
    expect(added).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile.yaml"), "utf-8");
    expect(content).toContain("skills:");
    expect(content).toContain("debug");
  });

  it("creates Agentfile if none exists", () => {
    const subDir = join(tmpDir, "no-agentfile");
    mkdirSync(subDir, { recursive: true });
    const added = addSkillToAgentfile(subDir, "plan");
    expect(added).toBe(true);
    expect(existsSync(join(subDir, "Agentfile.yaml"))).toBe(true);
    const content = readFileSync(join(subDir, "Agentfile.yaml"), "utf-8");
    expect(content).toContain("plan");
  });

  it("skips duplicate skills", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "skills:\n  - debug\n", "utf-8");
    const added = addSkillToAgentfile(tmpDir, "debug");
    expect(added).toBe(false);
  });

  it("appends to existing skills list", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "skills:\n  - debug\n", "utf-8");
    const added = addSkillToAgentfile(tmpDir, "plan");
    expect(added).toBe(true);
    const content = readFileSync(join(tmpDir, "Agentfile.yaml"), "utf-8");
    expect(content).toContain("debug");
    expect(content).toContain("plan");
  });
});

describe("installSkillToProject", () => {
  it("copies skill files to .agentbrew/skills/<name>/ and updates Agentfile", () => {
    // Create a fake skill source directory
    const sourceDir = join(tmpDir, "source-skill");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "# Test Skill\nContent here.", "utf-8");

    const projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    installSkillToProject(projectDir, "test-skill", sourceDir);

    // Verify skill files were copied
    const installedSkillPath = join(projectDir, ".agentbrew", "skills", "test-skill", "SKILL.md");
    expect(existsSync(installedSkillPath)).toBe(true);
    expect(readFileSync(installedSkillPath, "utf-8")).toContain("Test Skill");

    // Verify Agentfile was created with skills entry
    const agentfilePath = join(projectDir, "Agentfile.yaml");
    expect(existsSync(agentfilePath)).toBe(true);
    const content = readFileSync(agentfilePath, "utf-8");
    expect(content).toContain("test-skill");
  });

  it("overwrites stale skill directory on reinstall", () => {
    const sourceDir = join(tmpDir, "source-skill");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "# Updated Skill", "utf-8");

    const projectDir = join(tmpDir, "project2");
    const staleDir = join(projectDir, ".agentbrew", "skills", "my-skill");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "SKILL.md"), "# Old Skill", "utf-8");

    vi.spyOn(console, "log").mockImplementation(() => {});
    installSkillToProject(projectDir, "my-skill", sourceDir);

    const content = readFileSync(join(staleDir, "SKILL.md"), "utf-8");
    expect(content).toContain("Updated Skill");
  });
});

describe("applyAgentfile — hooks", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("adds hooks from Agentfile to state", () => {
    writeFileSync(
      join(tmpDir, "Agentfile.yaml"),
      `hooks:
  - event: PreToolUse
    matcher: Bash
    command: "echo pre"
`,
    );
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.hooksUpdated).toBe(true);
    expect(mockSaveState).toHaveBeenCalled();
    const savedState = mockSaveState.mock.calls[0][0] as { hooks?: unknown[] };
    expect(savedState.hooks).toHaveLength(1);
  });

  it("does not update state when hooks are unchanged", () => {
    writeFileSync(
      join(tmpDir, "Agentfile.yaml"),
      `hooks:
  - event: PreToolUse
    command: "echo x"
`,
    );
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      hooks: [{ event: "PreToolUse", type: "command" as const, command: "echo x", source: "agentfile" as const }],
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.hooksUpdated).toBe(false);
  });

  it("returns hooksUpdated false when no hooks in Agentfile", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [{ name: "context7", command: "npx", args: [], env: {}, source: "agentfile" as const }],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    const result = applyAgentfile(tmpDir, { quiet: true });
    expect(result?.hooksUpdated).toBe(false);
  });
});

describe("validateAgentfileMcp", () => {
  it("returns empty array when no mcp field", () => {
    expect(validateAgentfileMcp({})).toEqual([]);
  });

  it("returns empty array when all entries are valid catalog names", () => {
    expect(validateAgentfileMcp({ mcp: ["context7", "playwright"] })).toEqual([]);
  });

  it("warns about unknown catalog shorthand names", () => {
    const warnings = validateAgentfileMcp({ mcp: ["context7", "nonexistent-server"] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("unknown-server");
    expect(warnings[0].message).toContain("nonexistent-server");
    expect(warnings[0].message).toContain("not in catalog");
  });

  it("does not warn about full-spec entries (only catalog shorthands)", () => {
    const warnings = validateAgentfileMcp({
      mcp: [{ name: "custom-srv", command: "node", args: ["server.js"] }],
    });
    expect(warnings).toEqual([]);
  });

  it("reports multiple unknown servers", () => {
    const warnings = validateAgentfileMcp({ mcp: ["bad1", "bad2", "context7"] });
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain("bad1");
    expect(warnings[1].message).toContain("bad2");
  });
});

describe("applyAgentfile — validation warnings", () => {
  it("prints warnings for unknown catalog names when not quiet", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - context7\n  - nonexistent-server\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    applyAgentfile(tmpDir);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("nonexistent-server"));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not in catalog"));
  });

  it("does not print warnings when quiet", () => {
    writeFileSync(join(tmpDir, "Agentfile.yaml"), "mcp:\n  - nonexistent-server\n");
    const state = {
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    applyAgentfile(tmpDir, { quiet: true });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
