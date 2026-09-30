import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectMcpEntrySlices,
  injectCaBundle,
  needsCorporateCaBundle,
  repairOneMcpConfig,
  resolveCorporateCaBundle,
  unresolvablePathsForEntry,
  usesPythonPackageRunner,
} from "./endpoint-repair.js";

// Same rationale as playwright-isolated-sweep.test.ts: the exported wrapper
// walks AGENT_DEFINITIONS and expands `~` paths, so the tests drive the inner
// per-file function against a tmpdir for full read/transform/write coverage
// with no mocks.

const CA = "/etc/ssl/corp-ca.pem";
const NO_STATE = new Set<string>();

describe("unresolvablePathsForEntry", () => {
  const exists = (path: string) => path.startsWith("/real");

  it("ignores bare commands resolved through PATH", () => {
    expect(unresolvablePathsForEntry({ command: "npx", args: ["-y", "pkg"] }, exists)).toEqual([]);
    expect(unresolvablePathsForEntry({ command: "uvx", args: ["mcp-atlassian"] }, exists)).toEqual([]);
  });

  it("ignores url-only entries", () => {
    expect(unresolvablePathsForEntry({ url: "http://127.0.0.1:8080/mcp" }, exists)).toEqual([]);
  });

  it("flags an absolute command that no longer exists", () => {
    expect(unresolvablePathsForEntry({ command: "/gone/bin/mcp-atlassian" }, exists)).toEqual([
      "/gone/bin/mcp-atlassian",
    ]);
  });

  it("keeps an absolute command that exists", () => {
    expect(unresolvablePathsForEntry({ command: "/real/bin/wrapper.sh" }, exists)).toEqual([]);
  });

  it("flags a missing --directory project path", () => {
    const entry = { command: "uv", args: ["run", "--directory", "/gone/project", "python", "run_server.py"] };
    expect(unresolvablePathsForEntry(entry, exists)).toEqual(["/gone/project"]);
  });

  it("flags a missing absolute script arg", () => {
    const entry = { command: "node", args: ["/gone/server/index.js"] };
    expect(unresolvablePathsForEntry(entry, exists)).toEqual(["/gone/server/index.js"]);
  });

  it("does not flag non-path args that merely look absolute", () => {
    const entry = { command: "npx", args: ["--registry", "https://registry.example.com/", "-y", "pkg"] };
    expect(unresolvablePathsForEntry(entry, exists)).toEqual([]);
  });
});

describe("corporate CA injection", () => {
  it("recognises python package runners only", () => {
    expect(usesPythonPackageRunner({ command: "uvx" })).toBe(true);
    expect(usesPythonPackageRunner({ command: "/opt/homebrew/bin/pipx" })).toBe(true);
    expect(usesPythonPackageRunner({ command: "npx" })).toBe(false);
    expect(usesPythonPackageRunner({ command: "/usr/local/bin/my-wrapper.sh" })).toBe(false);
  });

  it("adds the bundle plus native-tls opt-in", () => {
    const entry: Record<string, unknown> = { command: "uvx", args: ["mcp-atlassian"] };
    expect(injectCaBundle(entry, CA)).toBe(true);
    expect(entry.env).toEqual({ SSL_CERT_FILE: CA, REQUESTS_CA_BUNDLE: CA, UV_NATIVE_TLS: "1" });
  });

  it("preserves existing env values", () => {
    const entry: Record<string, unknown> = { command: "uvx", args: ["x"], env: { JIRA_URL: "${JIRA_URL:-}" } };
    injectCaBundle(entry, CA);
    expect(entry.env).toMatchObject({ JIRA_URL: "${JIRA_URL:-}", SSL_CERT_FILE: CA });
  });

  it("is idempotent once a bundle is present", () => {
    const entry: Record<string, unknown> = { command: "uvx", env: { SSL_CERT_FILE: "/other.pem" } };
    expect(injectCaBundle(entry, CA)).toBe(false);
    expect(entry.env).toEqual({ SSL_CERT_FILE: "/other.pem" });
  });

  it("leaves node runners alone", () => {
    const entry: Record<string, unknown> = { command: "npx", args: ["-y", "pkg"] };
    expect(injectCaBundle(entry, CA)).toBe(false);
    expect(entry.env).toBeUndefined();
  });

  // For a remote MCP, `mcpm run <name>` proxies the HTTPS call from Python
  // instead of spawning a server, so the handshake fails inside mcpm itself
  // with CERTIFICATE_VERIFY_FAILED. No child env can reach that call.
  it("treats mcpm as needing the bundle even though it is not a package runner", () => {
    expect(usesPythonPackageRunner({ command: "mcpm" })).toBe(false);
    expect(needsCorporateCaBundle({ command: "mcpm" })).toBe(true);
    expect(needsCorporateCaBundle({ command: "/opt/homebrew/bin/mcpm" })).toBe(true);
  });

  it("adds the bundle to an mcpm-proxied remote entry", () => {
    const entry: Record<string, unknown> = { command: "mcpm", args: ["run", "figma"] };

    expect(injectCaBundle(entry, CA)).toBe(true);
    expect(entry.env).toMatchObject({ SSL_CERT_FILE: CA, REQUESTS_CA_BUNDLE: CA });
  });

  it("still leaves non-python commands out of the bundle set", () => {
    expect(needsCorporateCaBundle({ command: "npx" })).toBe(false);
    expect(needsCorporateCaBundle({ command: "" })).toBe(false);
    expect(needsCorporateCaBundle({})).toBe(false);
  });

  it("prefers an explicit bundle override over the built-in candidates", () => {
    process.env.AGENTBREW_CA_BUNDLE = "/explicit/ca.pem";
    try {
      expect(resolveCorporateCaBundle(() => true)).toBe("/explicit/ca.pem");
    } finally {
      delete process.env.AGENTBREW_CA_BUNDLE;
    }
  });

  it("returns undefined when the machine has no corporate bundle", () => {
    const saved = { ca: process.env.AGENTBREW_CA_BUNDLE, node: process.env.NODE_EXTRA_CA_CERTS };
    delete process.env.AGENTBREW_CA_BUNDLE;
    delete process.env.NODE_EXTRA_CA_CERTS;
    try {
      expect(resolveCorporateCaBundle(() => false)).toBeUndefined();
    } finally {
      if (saved.ca) process.env.AGENTBREW_CA_BUNDLE = saved.ca;
      if (saved.node) process.env.NODE_EXTRA_CA_CERTS = saved.node;
    }
  });
});

describe("collectMcpEntrySlices", () => {
  it("walks the global block and every per-project block", () => {
    const config = {
      mcpServers: { global: { command: "npx" } },
      projects: {
        "/Users/me/app": { mcpServers: { scoped: { command: "npx" } } },
        "/Users/me/other": { mcpServers: { scoped: { command: "uvx" } } },
      },
    };
    expect(collectMcpEntrySlices(config, "mcpServers").map((s) => s.basePath)).toEqual([
      "mcpServers.global",
      "projects./Users/me/app.mcpServers.scoped",
      "projects./Users/me/other.mcpServers.scoped",
    ]);
  });

  it("tolerates a config with no projects key", () => {
    expect(collectMcpEntrySlices({ mcpServers: { a: { command: "npx" } } }, "mcpServers")).toHaveLength(1);
  });
});

describe("repairOneMcpConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "endpoint-repair-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(name: string, content: unknown): string {
    const full = join(tmp, name);
    writeFileSync(full, JSON.stringify(content, null, 2));
    return full;
  }

  function read(full: string): Record<string, unknown> {
    return JSON.parse(readFileSync(full, "utf-8")) as Record<string, unknown>;
  }

  const exists = (path: string) => path.startsWith(tmpdir()) || path.startsWith("/real");

  it("reports nothing for a missing file", () => {
    expect(
      repairOneMcpConfig(join(tmp, "nope.json"), "mcpServers", { dryRun: false, stateServerNames: NO_STATE }),
    ).toEqual({ fixedCount: 0, findings: [] });
  });

  it("leaves a clean config untouched", () => {
    const original = { mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } } };
    const path = write("clean.json", original);
    const result = repairOneMcpConfig(path, "mcpServers", { dryRun: false, stateServerNames: NO_STATE, exists });
    expect(result.findings).toEqual([]);
    expect(read(path)).toEqual(original);
  });

  // Regression: a deleted checkout left `atlassian` pointing at a missing
  // launcher in 26 per-project blocks, so every Claude Code session started in
  // one of those directories reported a failed Jira MCP connection.
  it("prunes an unresolvable command from a per-project block", () => {
    const path = write("claude.json", {
      mcpServers: { context7: { command: "npx", args: ["-y", "pkg"] } },
      projects: {
        "/Users/me/app": {
          mcpServers: {
            atlassian: { command: "/gone/bin/mcp-atlassian", args: [] },
            context7: { command: "npx", args: ["-y", "pkg"] },
          },
        },
      },
    });

    const result = repairOneMcpConfig(path, "mcpServers", { dryRun: false, stateServerNames: NO_STATE, exists });

    expect(result.fixedCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      path: "projects./Users/me/app.mcpServers.atlassian",
      server: "atlassian",
      kind: "prune-unresolvable-command",
    });
    const after = read(path) as { projects: Record<string, { mcpServers: Record<string, unknown> }> };
    expect(Object.keys(after.projects["/Users/me/app"].mcpServers)).toEqual(["context7"]);
  });

  it("never prunes a server agentbrew state owns", () => {
    const original = {
      mcpServers: { "jira-mcp": { command: "/gone/bin/jira-wrapper.sh", args: [] } },
    };
    const path = write("state-owned.json", original);
    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: false,
      stateServerNames: new Set(["jira-mcp"]),
      exists,
    });
    expect(result.findings).toEqual([]);
    expect(read(path)).toEqual(original);
  });

  it("injects the CA bundle into python-runner entries in both scopes", () => {
    const path = write("ca.json", {
      mcpServers: { atlassian: { command: "uvx", args: ["mcp-atlassian"] } },
      projects: { "/Users/me/app": { mcpServers: { helper: { command: "pipx", args: ["run", "some-mcp"] } } } },
    });

    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: false,
      stateServerNames: NO_STATE,
      caBundlePath: CA,
      exists,
    });

    expect(result.fixedCount).toBe(2);
    const after = read(path) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
      projects: Record<string, { mcpServers: Record<string, { env: Record<string, string> }> }>;
    };
    expect(after.mcpServers.atlassian.env).toMatchObject({ SSL_CERT_FILE: CA, UV_NATIVE_TLS: "1" });
    expect(after.projects["/Users/me/app"].mcpServers.helper.env).toMatchObject({ REQUESTS_CA_BUNDLE: CA });
  });

  it("skips the CA repair when the machine has no bundle", () => {
    const original = { mcpServers: { atlassian: { command: "uvx", args: ["mcp-atlassian"] } } };
    const path = write("no-ca.json", original);
    const result = repairOneMcpConfig(path, "mcpServers", { dryRun: false, stateServerNames: NO_STATE, exists });
    expect(result.findings).toEqual([]);
    expect(read(path)).toEqual(original);
  });

  it("dryRun reports findings without writing", () => {
    const original = {
      mcpServers: {
        dead: { command: "/gone/bin/x" },
        atlassian: { command: "uvx", args: ["mcp-atlassian"] },
      },
    };
    const path = write("dry.json", original);
    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: true,
      stateServerNames: NO_STATE,
      caBundlePath: CA,
      exists,
    });
    expect(result.findings).toHaveLength(2);
    expect(result.fixedCount).toBe(0);
    expect(read(path)).toEqual(original);
  });

  it("is idempotent — a second pass finds nothing", () => {
    const path = write("twice.json", {
      mcpServers: {
        dead: { command: "/gone/bin/x" },
        atlassian: { command: "uvx", args: ["mcp-atlassian"] },
      },
    });
    const opts = { dryRun: false, stateServerNames: NO_STATE, caBundlePath: CA, exists };
    expect(repairOneMcpConfig(path, "mcpServers", opts).fixedCount).toBe(2);
    expect(repairOneMcpConfig(path, "mcpServers", opts).findings).toEqual([]);
  });

  // A quarantined endpoint stays in state so its evidence survives, which means
  // the state guard above would otherwise protect it from every prune.
  it("prunes a quarantined server even though state owns it", () => {
    const path = write("quarantined.json", {
      mcpServers: {
        blocked: { url: "http://localhost:8098/blocked" },
        context7: { command: "npx", args: ["-y", "pkg"] },
      },
    });

    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: false,
      stateServerNames: new Set(["blocked", "context7"]),
      quarantinedEntryKeys: new Set(["blocked", "mcpm_blocked"]),
      exists,
    });

    expect(result.fixedCount).toBe(1);
    expect(result.findings[0]).toMatchObject({ server: "blocked", kind: "prune-quarantined-server" });
    expect(Object.keys((read(path) as { mcpServers: object }).mcpServers)).toEqual(["context7"]);
  });

  it("prunes the mcpm-prefixed copy and per-project copies of a quarantined server", () => {
    const path = write("quarantined-mcpm.json", {
      mcpServers: { mcpm_blocked: { url: "http://localhost:8098/blocked" } },
      projects: { "/Users/me/app": { mcpServers: { blocked: { url: "http://localhost:8098/blocked" } } } },
    });

    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: false,
      stateServerNames: new Set(["blocked"]),
      quarantinedEntryKeys: new Set(["blocked", "mcpm_blocked"]),
      exists,
    });

    expect(result.fixedCount).toBe(2);
    const after = read(path) as { mcpServers: object; projects: Record<string, { mcpServers: object }> };
    expect(after.mcpServers).toEqual({});
    expect(after.projects["/Users/me/app"].mcpServers).toEqual({});
  });

  it("leaves entries alone when nothing is quarantined", () => {
    const original = { mcpServers: { blocked: { url: "http://localhost:8098/blocked" } } };
    const path = write("not-quarantined.json", original);
    const result = repairOneMcpConfig(path, "mcpServers", {
      dryRun: false,
      stateServerNames: new Set(["blocked"]),
      quarantinedEntryKeys: new Set<string>(),
      exists,
    });
    expect(result.findings).toEqual([]);
    expect(read(path)).toEqual(original);
  });

  it("honours a non-default mcpKey", () => {
    const path = write("amp.json", { "amp.mcpServers": { dead: { command: "/gone/bin/x" } } });
    const result = repairOneMcpConfig(path, "amp.mcpServers", {
      dryRun: false,
      stateServerNames: NO_STATE,
      exists,
    });
    expect(result.fixedCount).toBe(1);
    expect(read(path)).toEqual({ "amp.mcpServers": {} });
  });
});
