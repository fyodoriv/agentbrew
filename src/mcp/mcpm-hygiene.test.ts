import { describe, expect, it } from "vitest";
import {
  BROKEN_MCPM_REGISTRY_SERVERS,
  collectHygieneRemovals,
  findBrokenMcpmOnlyKeys,
  findRedundantMcpmKeys,
  findRemovableStaleKeys,
  fixDeprecatedGithubEntry,
  fixDeprecatedMemoryServerArgs,
  fixMemoryEntry,
  isBlocklistedRegistryServer,
  isDeprecatedGithubEntry,
  resolveGithubLauncherPath,
  uninstallBrokenMcpmRegistryServers,
  uninstallQuarantinedMcpmServers,
  withExtraBrokenRegistryServers,
} from "./mcpm-hygiene.js";

describe("mcpm hygiene helpers", () => {
  it("finds redundant mcpm wrappers when bare entries exist", () => {
    expect(
      findRedundantMcpmKeys({
        playwright: { command: "npx" },
        mcpm_playwright: { command: "mcpm" },
        "mcpm_chrome-devtools": { command: "mcpm" },
        "chrome-devtools": { command: "npx" },
      }),
    ).toEqual(["mcpm_playwright", "mcpm_chrome-devtools"]);
  });

  it("finds broken mcpm-only wrappers", () => {
    expect(
      findBrokenMcpmOnlyKeys(
        {
          "mcpm_ask-human": { command: "mcpm" },
          "mcpm_jira-mcp": { command: "mcpm" },
        },
        new Set(),
      ),
    ).toEqual(["mcpm_ask-human", "mcpm_jira-mcp"]);
  });

  it("keeps a blocklisted wrapper when agentbrew state defines the server", () => {
    expect(
      findBrokenMcpmOnlyKeys(
        {
          "mcpm_ask-human": { command: "mcpm" },
          "mcpm_jira-mcp": { command: "mcpm" },
        },
        new Set(["jira-mcp"]),
      ),
    ).toEqual(["mcpm_ask-human"]);
  });

  it("removes stale jira-mcp when composio is managed", () => {
    expect(findRemovableStaleKeys({ "jira-mcp": {}, "ask-human": {} }, new Set(["composio"]))).toEqual([
      "jira-mcp",
      "ask-human",
    ]);
  });

  it("collectHygieneRemovals deduplicates keys", () => {
    expect(
      collectHygieneRemovals(
        {
          "chrome-devtools": { command: "npx" },
          "mcpm_chrome-devtools": { command: "mcpm" },
          "mcpm_ask-human": { command: "mcpm" },
        },
        new Set(["composio"]),
      ),
    ).toEqual(["mcpm_chrome-devtools", "mcpm_ask-human"]);
  });
});

describe("registry blocklist vs agentbrew state", () => {
  it("blocklists a registry server that state does not define", () => {
    expect(isBlocklistedRegistryServer("jira-mcp", new Set())).toBe(true);
    expect(isBlocklistedRegistryServer("ask-human", new Set(["context7"]))).toBe(true);
  });

  it("never blocklists a server agentbrew state defines", () => {
    for (const name of BROKEN_MCPM_REGISTRY_SERVERS) {
      expect(isBlocklistedRegistryServer(name, new Set([name]))).toBe(false);
      expect(isBlocklistedRegistryServer(name, new Set())).toBe(true);
    }
  });

  it("leaves unrelated servers alone", () => {
    expect(isBlocklistedRegistryServer("context7", new Set())).toBe(false);
  });

  // Regression: the unguarded blocklist uninstalled `jira-mcp` from every mcpm
  // intersection client on each sync, so Claude Code never received the working
  // Agentfile-defined wrapper and reported a failed Jira MCP connection.
  it("skips the mcpm uninstall entirely when state defines every blocklisted name", () => {
    const stateNames = new Set(BROKEN_MCPM_REGISTRY_SERVERS as readonly string[]);
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], true, stateNames)).toEqual([]);
  });

  it("still reports the unprotected blocklist entries on a dry run", () => {
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], true, new Set(["jira-mcp"]))).not.toContain("jira-mcp");
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], true, new Set(["jira-mcp"]))).toContain("ask-human");
  });

  it("does nothing when no intersection client is detected", () => {
    expect(uninstallBrokenMcpmRegistryServers(["cursor"], true, new Set())).toEqual([]);
  });
});

describe("broken registry names from a team overlay", () => {
  const withOverlay = withExtraBrokenRegistryServers(["example-remote"]);

  it("adds overlay names to the generic base list", () => {
    expect(withOverlay).toEqual([...BROKEN_MCPM_REGISTRY_SERVERS, "example-remote"]);
  });

  it("ignores non-string, blank, and duplicate overlay entries", () => {
    expect(withExtraBrokenRegistryServers(["jira-mcp", 42, " ", null])).toEqual([...BROKEN_MCPM_REGISTRY_SERVERS]);
    expect(withExtraBrokenRegistryServers("example-remote")).toEqual([...BROKEN_MCPM_REGISTRY_SERVERS]);
    expect(withExtraBrokenRegistryServers(undefined)).toEqual([...BROKEN_MCPM_REGISTRY_SERVERS]);
  });

  it("drops mcpm wrappers only for the names on the list", () => {
    const servers = { "mcpm_example-remote": { command: "mcpm" }, mcpm_context7: { command: "mcpm" } };
    expect(collectHygieneRemovals(servers, new Set(), withOverlay)).toEqual(["mcpm_example-remote"]);
    expect(collectHygieneRemovals(servers, new Set())).toEqual([]);
  });

  it("still lets agentbrew state protect an overlay-listed server", () => {
    expect(isBlocklistedRegistryServer("example-remote", new Set(), withOverlay)).toBe(true);
    expect(isBlocklistedRegistryServer("example-remote", new Set(["example-remote"]), withOverlay)).toBe(false);
  });

  it("uninstalls overlay-listed servers from mcpm", () => {
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], true, new Set(), withOverlay)).toContain(
      "example-remote",
    );
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], true, new Set())).not.toContain("example-remote");
  });
});

describe("uninstallQuarantinedMcpmServers", () => {
  // Quarantined servers are defined in state, so the state guard that protects
  // the blocklist would keep them installed. Quarantine has to override it.
  it("targets a quarantined server even though state defines it", () => {
    expect(uninstallQuarantinedMcpmServers(["claude-code"], ["blocked"], true)).toEqual(["blocked"]);
  });

  it("does nothing when nothing is quarantined", () => {
    expect(uninstallQuarantinedMcpmServers(["claude-code"], [], true)).toEqual([]);
  });

  it("does nothing when no intersection client is detected", () => {
    expect(uninstallQuarantinedMcpmServers(["cursor"], ["blocked"], true)).toEqual([]);
  });
});

describe("github launcher hygiene", () => {
  it("detects deprecated npm github entries", () => {
    expect(
      isDeprecatedGithubEntry({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github@latest"],
      }),
    ).toBe(true);
  });

  it("rewrites deprecated github entries to the launcher path", () => {
    const entry = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}" },
    };
    expect(fixDeprecatedGithubEntry(entry, "/tmp/organization-github-mcp")).toBe(true);
    expect(entry).toEqual({ command: "/tmp/organization-github-mcp" });
  });

  it("resolveGithubLauncherPath discovers alternate *-github-mcp launchers", () => {
    expect(
      resolveGithubLauncherPath(
        "/home/user",
        () => false,
        () => ["custom-org-github-mcp", "other-tool"],
      ),
    ).toBe("/home/user/.local/bin/custom-org-github-mcp");
  });
});

describe("memory server arg hygiene", () => {
  it("rewrites deprecated memory-server uvx arg to memory server", () => {
    const args = ["--from", "mcp-memory-service", "memory-server"];
    expect(fixDeprecatedMemoryServerArgs(args)).toBe(true);
    expect(args).toEqual(["--from", "mcp-memory-service", "memory", "server"]);
  });

  it("leaves unrelated args unchanged", () => {
    const args = ["-y", "@modelcontextprotocol/server-memory@latest"];
    expect(fixDeprecatedMemoryServerArgs(args)).toBe(false);
    expect(args).toEqual(["-y", "@modelcontextprotocol/server-memory@latest"]);
  });

  it("fixMemoryEntry updates deprecated syntax without replacing the configured server", () => {
    const entry = {
      command: "uvx",
      args: ["--from", "mcp-memory-service", "memory-server"],
    };
    expect(fixMemoryEntry(entry)).toBe(true);
    expect(entry.command).toBe("uvx");
    expect(entry.args).toEqual(["--from", "mcp-memory-service", "memory", "server"]);
  });

  it("fixMemoryEntry preserves a modern semantic memory configuration", () => {
    const entry = {
      command: "uvx",
      args: ["--system-certs", "--from", "mcp-memory-service[sqlite]", "memory", "server"],
    };
    expect(fixMemoryEntry(entry)).toBe(false);
    expect(entry.command).toBe("uvx");
    expect(entry.args).toEqual(["--system-certs", "--from", "mcp-memory-service[sqlite]", "memory", "server"]);
  });
});
