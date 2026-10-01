import { describe, expect, it } from "vitest";
import { detectSecretsInServers, type McpServerLike } from "./secret-detector.js";

// All record/args edge cases ride through `detectSecretsInServers` so the
// tests pin the public API surface that callers (src/lint.ts) actually use.
// Same shape as PR #919 (`stripJsonComments` migrated from a standalone
// describe block into the `parseJsonc` block) — the helpers stayed alive
// only because the tests imported them directly.

describe("detectSecretsInServers — env-record edge cases", () => {
  it("detects a GitHub PAT (classic) in env values", () => {
    const findings = detectSecretsInServers([
      { name: "my-server", env: { GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].location).toBe("my-server");
    expect(findings[0].field).toBe("env.GITHUB_TOKEN");
    expect(findings[0].pattern).toBe("GitHub PAT (classic)");
    expect(findings[0].preview).toContain("...");
  });

  it("detects a fine-grained GitHub PAT", () => {
    const findings = detectSecretsInServers([
      { name: "server", env: { TOKEN: "github_pat_11AAAAAA0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("GitHub PAT (fine-grained)");
  });

  it("detects a Slack bot token", () => {
    const findings = detectSecretsInServers([
      {
        name: "slack",
        env: { SLACK_BOT_TOKEN: ["xoxb", "123456789012", "1234567890123", "abcdefghijklmnopqrstuvwx"].join("-") },
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("Slack bot token");
  });

  it("detects a Slack user token", () => {
    const findings = detectSecretsInServers([
      {
        name: "slack",
        env: { SLACK_USER_TOKEN: ["xoxp", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-") },
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("Slack user token");
  });

  it("detects an OpenAI API key", () => {
    const findings = detectSecretsInServers([
      { name: "openai", env: { OPENAI_API_KEY: "sk-proj1234567890abcdefghij" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("OpenAI API key");
  });

  it("detects an Anthropic API key", () => {
    const findings = detectSecretsInServers([
      { name: "anthropic", env: { ANTHROPIC_API_KEY: "sk-ant-api03-xxxxxxxxxxxxxxxxxxxx" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("Anthropic API key");
  });

  it("detects an AWS access key", () => {
    const findings = detectSecretsInServers([{ name: "aws", env: { AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE" } }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("AWS access key");
  });

  it("detects an Atlassian API token", () => {
    const findings = detectSecretsInServers([
      { name: "jira", env: { JIRA_API_TOKEN: "ATATT3xFfGF0MjQ5NDc4OTY2MTIzOkFB" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("Atlassian API token");
  });

  it("detects an npm token", () => {
    const findings = detectSecretsInServers([
      { name: "npm", env: { NPM_TOKEN: "npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("npm token");
  });

  it("skips values that are ${VAR} placeholders", () => {
    const findings = detectSecretsInServers([{ name: "server", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } }]);
    expect(findings).toHaveLength(0);
  });

  it("skips values with embedded placeholders", () => {
    const findings = detectSecretsInServers([{ name: "server", env: { AUTH: "Bearer ${MY_TOKEN}" } }]);
    expect(findings).toHaveLength(0);
  });

  it("skips empty values", () => {
    const findings = detectSecretsInServers([{ name: "server", env: { GITHUB_TOKEN: "" } }]);
    expect(findings).toHaveLength(0);
  });

  it("skips non-secret values", () => {
    const findings = detectSecretsInServers([
      { name: "server", env: { NODE_ENV: "production", PORT: "3000", LOG_LEVEL: "debug" } },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("returns one finding per matching value (not per pattern)", () => {
    // OpenAI key matches "OpenAI API key" pattern — should only appear once
    const findings = detectSecretsInServers([{ name: "server", env: { KEY: "sk-proj1234567890abcdefghij" } }]);
    expect(findings).toHaveLength(1);
  });

  it("detects multiple secrets in the same record", () => {
    const findings = detectSecretsInServers([
      {
        name: "server",
        env: {
          GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
          OPENAI_API_KEY: "sk-proj1234567890abcdefghij",
        },
      },
    ]);
    expect(findings).toHaveLength(2);
  });

  it("truncates preview for long secrets", () => {
    const findings = detectSecretsInServers([
      { name: "server", env: { TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop" } },
    ]);
    expect(findings[0].preview).toContain("...");
    // Full secret should never appear in preview
    expect(findings[0].preview.length).toBeLessThan(20);
  });
});

describe("detectSecretsInServers — args edge cases", () => {
  it("detects secrets in command args", () => {
    const findings = detectSecretsInServers([
      { name: "server", args: ["--token", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe("args[1]");
    expect(findings[0].pattern).toBe("GitHub PAT (classic)");
  });

  it("skips placeholder args", () => {
    const findings = detectSecretsInServers([{ name: "server", args: ["--token", "${GITHUB_TOKEN}"] }]);
    expect(findings).toHaveLength(0);
  });

  it("skips non-secret args", () => {
    const findings = detectSecretsInServers([{ name: "server", args: ["--port", "3000", "--verbose"] }]);
    expect(findings).toHaveLength(0);
  });
});

describe("detectSecretsInServers", () => {
  it("scans env, args, url, and headers", () => {
    const servers: McpServerLike[] = [
      {
        name: "test-server",
        env: { GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
        args: ["--key", "sk-proj1234567890abcdefghij"],
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0" },
      },
    ];
    const findings = detectSecretsInServers(servers);
    expect(findings).toHaveLength(3);
    const fields = findings.map((f) => f.field);
    expect(fields).toContain("env.GITHUB_TOKEN");
    expect(fields).toContain("args[1]");
    expect(fields).toContain("headers.Authorization");
  });

  it("handles servers with no env/args/headers", () => {
    const servers: McpServerLike[] = [{ name: "minimal" }];
    const findings = detectSecretsInServers(servers);
    expect(findings).toHaveLength(0);
  });

  it("handles empty server list", () => {
    const findings = detectSecretsInServers([]);
    expect(findings).toHaveLength(0);
  });

  it("scans multiple servers", () => {
    const servers: McpServerLike[] = [
      { name: "server-a", env: { KEY: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" } },
      { name: "server-b", env: { KEY: "sk-proj1234567890abcdefghij" } },
    ];
    const findings = detectSecretsInServers(servers);
    expect(findings).toHaveLength(2);
    expect(findings[0].location).toBe("server-a");
    expect(findings[1].location).toBe("server-b");
  });

  it("reports clean when all values are placeholders", () => {
    const servers: McpServerLike[] = [
      {
        name: "clean-server",
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
        args: ["--token", "${MY_TOKEN}"],
        headers: { Authorization: "Bearer ${AUTH_TOKEN}" },
      },
    ];
    const findings = detectSecretsInServers(servers);
    expect(findings).toHaveLength(0);
  });

  it("skips url when it is a placeholder", () => {
    const servers: McpServerLike[] = [{ name: "server", url: "${SSE_URL}" }];
    const findings = detectSecretsInServers(servers);
    expect(findings).toHaveLength(0);
  });
});
