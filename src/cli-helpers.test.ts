import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("chalk", () => {
  const passthrough = (s: string) => s;
  return {
    default: {
      red: passthrough,
      yellow: passthrough,
      green: passthrough,
      cyan: passthrough,
      dim: passthrough,
      blue: passthrough,
      white: passthrough,
      bold: passthrough,
    },
  };
});

vi.mock("./core/cli-error.js", () => ({
  cliError: vi.fn(),
}));

import {
  filterSyncModules,
  formatGroupedCommandSections,
  formatHiddenCommands,
  formatUnlistedCommands,
  getHelpExamples,
  isLocalFolderPath,
  isNpxScopedPackage,
  isSourceRepoPath,
  shouldInstallAgentfileItems,
} from "./cli-helpers.js";
import { cliError } from "./core/cli-error.js";

// ── Helper factories ──────────────────────────────────────────────────────────

function makeCommand(name: string, description: string, hidden = false): Command {
  const cmd = new Command(name).description(description);
  if (hidden) (cmd as unknown as { _hidden: boolean })._hidden = true;
  return cmd;
}

function makeHelper() {
  return {
    styleSubcommandTerm: (s: string) => s,
    styleSubcommandDescription: (s: string) => s,
    subcommandTerm: (cmd: Command) => cmd.name(),
    subcommandDescription: (cmd: Command) => cmd.description(),
    styleTitle: (s: string) => s,
  } as unknown as ReturnType<Command["createHelp"]>;
}

function makeFmt() {
  return (term: string, desc: string) => `${term} — ${desc}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("formatGroupedCommandSections", () => {
  it("groups known commands under their title", () => {
    const cmds = [makeCommand("init", "Initialize"), makeCommand("status", "Show status")];
    const commandMap = new Map(cmds.map((c) => [c.name(), c]));
    const listed = new Set<string>();
    const groups = [{ title: "Core", names: ["init", "status"] }];

    const result = formatGroupedCommandSections(groups, commandMap, listed, makeHelper(), makeFmt());
    expect(result[0]).toContain("Core:");
    expect(result.some((l) => l.includes("init"))).toBe(true);
    expect(result.some((l) => l.includes("status"))).toBe(true);
    expect(listed.has("init")).toBe(true);
    expect(listed.has("status")).toBe(true);
  });

  it("skips missing command names", () => {
    const commandMap = new Map([["init", makeCommand("init", "Init")]]);
    const listed = new Set<string>();
    const groups = [{ title: "Core", names: ["init", "nonexistent"] }];

    const result = formatGroupedCommandSections(groups, commandMap, listed, makeHelper(), makeFmt());
    expect(result.some((l) => l.includes("init"))).toBe(true);
    expect(result.every((l) => !l.includes("nonexistent"))).toBe(true);
  });

  it("returns empty for a group with no matching commands", () => {
    const commandMap = new Map<string, Command>();
    const listed = new Set<string>();
    const groups = [{ title: "Empty", names: ["foo", "bar"] }];

    const result = formatGroupedCommandSections(groups, commandMap, listed, makeHelper(), makeFmt());
    expect(result).toEqual([]);
  });

  it("handles multiple groups", () => {
    const cmds = [makeCommand("init", "Init"), makeCommand("sync", "Sync"), makeCommand("install", "Install")];
    const commandMap = new Map(cmds.map((c) => [c.name(), c]));
    const listed = new Set<string>();
    const groups = [
      { title: "Core", names: ["init", "sync"] },
      { title: "Install", names: ["install"] },
    ];

    const result = formatGroupedCommandSections(groups, commandMap, listed, makeHelper(), makeFmt());
    expect(result.filter((l) => l.includes(":")).length).toBe(2);
  });
});

describe("formatUnlistedCommands", () => {
  it("returns commands not yet listed", () => {
    const visible = [makeCommand("init", "Init"), makeCommand("extra", "Extra")];
    const listed = new Set(["init"]);

    const result = formatUnlistedCommands(visible, listed, makeHelper(), makeFmt());
    expect(result.some((l) => l.includes("extra"))).toBe(true);
    expect(listed.has("extra")).toBe(true);
  });

  it("returns empty when all commands are listed", () => {
    const visible = [makeCommand("init", "Init")];
    const listed = new Set(["init"]);

    const result = formatUnlistedCommands(visible, listed, makeHelper(), makeFmt());
    expect(result).toEqual([]);
  });
});

describe("formatHiddenCommands", () => {
  it("includes hidden commands not yet listed", () => {
    const all = [makeCommand("visible", "Vis"), makeCommand("secret", "Secret", true)];
    const listed = new Set(["visible"]);

    const result = formatHiddenCommands(all, listed, makeHelper(), makeFmt());
    expect(result[0]).toContain("Internal:");
    expect(result.some((l) => l.includes("secret"))).toBe(true);
  });

  it("returns empty when no hidden commands exist", () => {
    const all = [makeCommand("visible", "Vis")];
    const listed = new Set<string>();

    const result = formatHiddenCommands(all, listed, makeHelper(), makeFmt());
    expect(result).toEqual([]);
  });

  it("skips hidden commands that are already listed", () => {
    const all = [makeCommand("secret", "Secret", true)];
    const listed = new Set(["secret"]);

    const result = formatHiddenCommands(all, listed, makeHelper(), makeFmt());
    expect(result).toEqual([]);
  });

  it("preserves the hidden skills compatibility description in the advanced section", () => {
    const all = [
      makeCommand(
        "skills",
        "Compatibility path for advanced skill maintenance; prefer install, catalog, top-level sync, and lint",
        true,
      ),
    ];
    const listed = new Set<string>();

    const result = formatHiddenCommands(all, listed, makeHelper(), makeFmt()).join("\n");
    expect(result).toContain("Internal:");
    expect(result).toContain("skills");
    expect(result).toContain("Compatibility path");
    expect(result).toContain("top-level sync");
  });
});

describe("filterSyncModules", () => {
  const modules = [
    { name: "mcp", fn: async () => {} },
    { name: "rules", fn: async () => {} },
    { name: "skills", fn: async () => {} },
  ] as unknown as ReturnType<typeof import("./sync-runner.js").buildSyncModules>;

  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters to requested modules", () => {
    const result = filterSyncModules(modules, "mcp,rules");
    expect(result).toHaveLength(2);
    expect(result?.map((m) => m.name)).toEqual(["mcp", "rules"]);
  });

  it("trims and lowercases module names", () => {
    const result = filterSyncModules(modules, " MCP , Rules ");
    expect(result).toHaveLength(2);
  });

  it("returns undefined for invalid module names", () => {
    const result = filterSyncModules(modules, "mcp,bogus");
    expect(result).toBeUndefined();
    expect(cliError).toHaveBeenCalled();
  });

  it("logs the filtered module list", () => {
    filterSyncModules(modules, "skills");
    expect(logs.some((l) => l.includes("Syncing: skills"))).toBe(true);
  });
});

describe("shouldInstallAgentfileItems", () => {
  it("installs Agentfile items when no --only filter is provided", () => {
    expect(shouldInstallAgentfileItems()).toBe(true);
  });

  it("installs Agentfile items when syncing skills", () => {
    expect(shouldInstallAgentfileItems("mcp,skills")).toBe(true);
    expect(shouldInstallAgentfileItems(" Skills ")).toBe(true);
  });

  it("skips Agentfile item installs when --only excludes skills", () => {
    expect(shouldInstallAgentfileItems("mcp")).toBe(false);
    expect(shouldInstallAgentfileItems("mcp,rules")).toBe(false);
  });
});

describe("getHelpExamples", () => {
  it("returns an array of strings", () => {
    const examples = getHelpExamples();
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThan(0);
  });

  it("starts with 'Examples:'", () => {
    const examples = getHelpExamples();
    expect(examples[0]).toBe("Examples:");
  });

  it("ends with an empty string", () => {
    const examples = getHelpExamples();
    expect(examples[examples.length - 1]).toBe("");
  });

  it("includes core commands in examples", () => {
    const joined = getHelpExamples().join("\n");
    expect(joined).toContain("agentbrew install");
    expect(joined).toContain("agentbrew sync");
    expect(joined).toContain("agentbrew status");
  });
});

describe("isNpxScopedPackage", () => {
  it("matches valid scoped packages", () => {
    expect(isNpxScopedPackage("@my/mcp-server")).toBe(true);
    expect(isNpxScopedPackage("@scope/pkg.v2")).toBe(true);
    expect(isNpxScopedPackage("@org-name/tool-1.0")).toBe(true);
  });

  it("rejects plain names", () => {
    expect(isNpxScopedPackage("debug")).toBe(false);
    expect(isNpxScopedPackage("my-tool")).toBe(false);
  });

  it("rejects partial scope patterns", () => {
    expect(isNpxScopedPackage("@scope")).toBe(false);
    expect(isNpxScopedPackage("scope/pkg")).toBe(false);
  });

  it("rejects paths", () => {
    expect(isNpxScopedPackage("./my-dir")).toBe(false);
    expect(isNpxScopedPackage("/abs/path")).toBe(false);
  });
});

describe("isSourceRepoPath", () => {
  it("matches GitHub shorthand", () => {
    expect(isSourceRepoPath("user/repo")).toBe(true);
    expect(isSourceRepoPath("org-name/repo.js")).toBe(true);
  });

  it("matches http/https URLs", () => {
    expect(isSourceRepoPath("https://github.com/org/repo")).toBe(true);
    expect(isSourceRepoPath("http://example.com/repo")).toBe(true);
  });

  it("matches git@ SSH URLs", () => {
    expect(isSourceRepoPath("git@github.com:org/repo.git")).toBe(true);
  });

  it("rejects plain names", () => {
    expect(isSourceRepoPath("debug")).toBe(false);
    expect(isSourceRepoPath("my-tool")).toBe(false);
  });

  it("rejects local paths", () => {
    expect(isSourceRepoPath("./local")).toBe(false);
    expect(isSourceRepoPath("/absolute")).toBe(false);
    expect(isSourceRepoPath("~/home")).toBe(false);
  });
});

describe("isLocalFolderPath", () => {
  it("matches relative paths", () => {
    expect(isLocalFolderPath("./skills")).toBe(true);
  });

  it("matches absolute paths", () => {
    expect(isLocalFolderPath("/usr/local/skills")).toBe(true);
  });

  it("matches home-relative paths", () => {
    expect(isLocalFolderPath("~/my-skills")).toBe(true);
  });

  it("rejects plain names", () => {
    expect(isLocalFolderPath("debug")).toBe(false);
    expect(isLocalFolderPath("my-tool")).toBe(false);
  });

  it("rejects GitHub shorthand", () => {
    expect(isLocalFolderPath("user/repo")).toBe(false);
  });

  it("rejects URLs", () => {
    expect(isLocalFolderPath("https://example.com")).toBe(false);
  });
});
