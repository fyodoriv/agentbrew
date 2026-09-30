import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepOneJsonConfig, sweepOneYamlConfig } from "./resilient-sweep.js";

// ── Why these tests focus on `sweepOneJsonConfig`, not `sweepMcpConfigs` ────
//
// `sweepMcpConfigs` walks every entry in `AGENT_DEFINITIONS` and reads files at
// real `~/.…` paths via `expandHome`. Mocking AGENT_DEFINITIONS to point at a
// tmpdir would require either reimporting types.ts mid-test (yikes) or doing
// the identity-mock for `expandHome` that AGENTS.md rule #15 explicitly forbids.
//
// `sweepOneJsonConfig` takes an absolute path directly, so we can exercise the
// full read/transform/write loop against a tmpdir with no mocks at all. Better
// signal-to-noise than a heavily mocked test of the wrapper.

describe("sweepOneJsonConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "resilient-sweep-"));
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
    const result = sweepOneJsonConfig(join(tmp, "missing.json"), "mcpServers", false);
    expect(result).toEqual({ fixedCount: 0, findings: [] });
  });

  it("returns zero findings when the file is clean (no bare placeholders)", () => {
    const path = write("clean.json", { mcpServers: { srv: { env: { TOKEN: "${TOKEN:-}" } } } });
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.findings).toHaveLength(0);
    // Should not rewrite the file when clean
    expect(read(path)).toEqual({ mcpServers: { srv: { env: { TOKEN: "${TOKEN:-}" } } } });
  });

  it("dryRun returns findings but does NOT write the file", () => {
    const original = { mcpServers: { srv: { env: { TOKEN: "${TOKEN}" } } } };
    const path = write("dirty.json", original);
    const result = sweepOneJsonConfig(path, "mcpServers", true);
    expect(result.findings).toHaveLength(1);
    expect(result.fixedCount).toBe(0); // dryRun means no actual fixes written
    expect(read(path)).toEqual(original); // file unchanged
  });

  it("rewrites bare placeholders under the configured mcpKey", () => {
    const path = write("dirty.json", {
      mcpServers: {
        jenkins: { env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}", JENKINS_USER: "${JENKINS_USER}" } },
        github: { env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } },
      },
    });
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.fixedCount).toBe(3);
    expect(read(path)).toEqual({
      mcpServers: {
        jenkins: { env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN:-}", JENKINS_USER: "${JENKINS_USER:-}" } },
        github: { env: { GITHUB_TOKEN: "${GITHUB_TOKEN:-}" } },
      },
    });
  });

  it("walks projects.*.mcpServers (Claude per-project config shape)", () => {
    // .claude.json stores per-project MCP servers under projects.<absolute-path>.mcpServers.
    // Devin also imports project-specific configs, so leftovers here are equally crash-prone.
    const path = write("claude.json", {
      mcpServers: {},
      projects: {
        "/home/user/repo-a": {
          mcpServers: { slack: { env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" } } },
        },
        "/home/user/repo-b": {
          mcpServers: { jenkins: { env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}" } } },
        },
      },
    });
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.fixedCount).toBe(2);
    // `unknown` cast keeps tsc happy without bespoke type plumbing for nested test fixtures.
    const after = read(path) as {
      projects: Record<string, { mcpServers: Record<string, { env: Record<string, string> }> }>;
    };
    expect(after.projects["/home/user/repo-a"].mcpServers.slack.env.SLACK_BOT_TOKEN).toBe("${SLACK_BOT_TOKEN:-}");
    expect(after.projects["/home/user/repo-b"].mcpServers.jenkins.env.JENKINS_API_TOKEN).toBe("${JENKINS_API_TOKEN:-}");
  });

  it("does NOT touch fields outside the mcp-relevant slices (defensive scoping)", () => {
    // Non-MCP top-level fields in claude.json (numStartups, userID, cached* etc.) should be
    // untouched even if they somehow contain ${VAR}-looking strings. Scoping the sweep to
    // mcpServers + projects.*.mcpServers prevents collateral damage.
    const path = write("claude.json", {
      userID: "u-123",
      cachedSomething: "${ENV_VAR_LIKE_BUT_NOT_OURS}",
      mcpServers: { srv: { env: { TOKEN: "${TOKEN}" } } },
    });
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(read(path)).toEqual({
      userID: "u-123",
      cachedSomething: "${ENV_VAR_LIKE_BUT_NOT_OURS}",
      mcpServers: { srv: { env: { TOKEN: "${TOKEN:-}" } } },
    });
  });

  it("respects a custom mcpKey (amp uses amp.mcpServers, opencode uses mcp)", () => {
    // Anchors the contract that callers pass the agent's `mcpKey` from agents.yaml.
    const path = write("opencode.json", {
      mcp: { srv: { env: { TOKEN: "${TOKEN}" } } },
      // mcpServers entry should be ignored here since the configured key is "mcp"
      mcpServers: { ignored: { env: { OTHER: "${OTHER}" } } },
    });
    const result = sweepOneJsonConfig(path, "mcp", false);
    expect(result.fixedCount).toBe(1);
    const after = read(path) as {
      mcp: { srv: { env: { TOKEN: string } } };
      mcpServers: { ignored: { env: { OTHER: string } } };
    };
    expect(after.mcp.srv.env.TOKEN).toBe("${TOKEN:-}");
    // The wrong-key block stays untouched — sweep is scoped to the configured slice
    expect(after.mcpServers.ignored.env.OTHER).toBe("${OTHER}");
  });

  it("is idempotent — second invocation writes nothing further", () => {
    const path = write("dirty.json", { mcpServers: { srv: { env: { TOKEN: "${TOKEN}" } } } });
    sweepOneJsonConfig(path, "mcpServers", false);
    const after = readFileSync(path, "utf-8");
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.fixedCount).toBe(0);
    expect(readFileSync(path, "utf-8")).toBe(after);
  });

  it("handles placeholders inside args arrays and headers", () => {
    const path = write("dirty.json", {
      mcpServers: {
        srv: {
          command: "npx",
          args: ["--key=${KEY}", "--plain"],
          url: "https://${HOST}/api",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      },
    });
    const result = sweepOneJsonConfig(path, "mcpServers", false);
    expect(result.fixedCount).toBe(3);
    const after = read(path) as {
      mcpServers: { srv: { args: string[]; url: string; headers: { Authorization: string } } };
    };
    expect(after.mcpServers.srv.args).toEqual(["--key=${KEY:-}", "--plain"]);
    expect(after.mcpServers.srv.url).toBe("https://${HOST:-}/api");
    expect(after.mcpServers.srv.headers.Authorization).toBe("Bearer ${TOKEN:-}");
  });
});

// ── YAML sweep (goose) ──────────────────────────────────────────────────────
//
// Regression: before the fix, mcpm-managed goose configs kept bare
// `${GITHUB_TOKEN}` placeholders inside `extensions.<name>.envs.<KEY>` because
// `sweepMcpConfigs` skipped non-JSON formats outright. Devin's MCP loader
// imports goose's config and strict-interpolates every string — a bare
// placeholder with an unset env var aborts the entire MCP load (every tool,
// not just goose's github entry). The YAML sweep closes that hole.

describe("sweepOneYamlConfig (goose-style)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "resilient-sweep-yaml-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeYaml(relativePath: string, content: unknown): string {
    const fullPath = join(tmp, relativePath);
    writeFileSync(fullPath, yaml.dump(content));
    return fullPath;
  }

  function readYaml(fullPath: string): unknown {
    return yaml.load(readFileSync(fullPath, "utf-8"));
  }

  it("returns zero findings when the file doesn't exist", () => {
    const result = sweepOneYamlConfig(join(tmp, "missing.yaml"), "extensions", false);
    expect(result).toEqual({ fixedCount: 0, findings: [] });
  });

  it("rewrites bare placeholders under the configured mcpKey (extensions)", () => {
    // This is the exact shape mcpm writes for goose: extensions.<name>.envs.<KEY>.
    // Without the YAML sweep, the bare ${GITHUB_TOKEN} survives across every
    // `agentbrew sync` and crashes Devin's MCP loader on next launch.
    const path = writeYaml("config.yaml", {
      extensions: {
        github: {
          name: "github",
          type: "stdio",
          cmd: "npx",
          args: ["-y", "@modelcontextprotocol/server-github@latest"],
          envs: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
          },
          enabled: true,
          timeout: 300,
        },
      },
    });
    const result = sweepOneYamlConfig(path, "extensions", false);
    expect(result.fixedCount).toBe(1);
    const after = readYaml(path) as {
      extensions: { github: { envs: { GITHUB_PERSONAL_ACCESS_TOKEN: string } } };
    };
    expect(after.extensions.github.envs.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("${GITHUB_TOKEN:-}");
  });

  it("dryRun returns findings but does NOT write the file", () => {
    const path = writeYaml("dirty.yaml", {
      extensions: { srv: { envs: { TOKEN: "${TOKEN}" } } },
    });
    const beforeContent = readFileSync(path, "utf-8");
    const result = sweepOneYamlConfig(path, "extensions", true);
    expect(result.findings).toHaveLength(1);
    expect(result.fixedCount).toBe(0);
    expect(readFileSync(path, "utf-8")).toBe(beforeContent);
  });

  it("is idempotent — second invocation writes nothing further", () => {
    const path = writeYaml("dirty.yaml", {
      extensions: { srv: { envs: { TOKEN: "${TOKEN}" } } },
    });
    sweepOneYamlConfig(path, "extensions", false);
    const afterFirst = readFileSync(path, "utf-8");
    const result = sweepOneYamlConfig(path, "extensions", false);
    expect(result.fixedCount).toBe(0);
    expect(readFileSync(path, "utf-8")).toBe(afterFirst);
  });

  it("leaves resilient placeholders untouched", () => {
    const path = writeYaml("clean.yaml", {
      extensions: {
        srv: { envs: { TOKEN: "${TOKEN:-fallback}", OTHER: "${OTHER:-}" } },
      },
    });
    const beforeContent = readFileSync(path, "utf-8");
    const result = sweepOneYamlConfig(path, "extensions", false);
    expect(result.findings).toHaveLength(0);
    expect(readFileSync(path, "utf-8")).toBe(beforeContent);
  });

  it("does NOT touch fields outside the configured mcpKey slice", () => {
    // Goose configs have top-level keys (GOOSE_PROVIDER, GOOSE_MODE, …) that are
    // user-data. The sweep is scoped to `extensions:` so unrelated `${VAR}` strings
    // elsewhere stay untouched.
    const path = writeYaml("goose.yaml", {
      GOOSE_PROVIDER: "anthropic",
      SOME_USER_TEMPLATE: "${LEAVE_ME_ALONE}",
      extensions: { srv: { envs: { TOKEN: "${TOKEN}" } } },
    });
    const result = sweepOneYamlConfig(path, "extensions", false);
    expect(result.fixedCount).toBe(1);
    const after = readYaml(path) as {
      GOOSE_PROVIDER: string;
      SOME_USER_TEMPLATE: string;
      extensions: { srv: { envs: { TOKEN: string } } };
    };
    expect(after.GOOSE_PROVIDER).toBe("anthropic");
    expect(after.SOME_USER_TEMPLATE).toBe("${LEAVE_ME_ALONE}");
    expect(after.extensions.srv.envs.TOKEN).toBe("${TOKEN:-}");
  });
});
