import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { simulateDevinImport } from "./devin-import.simulator.js";

// Why these tests matter:
//
// `simulateDevinImport` is the test suite's stand-in for Devin's real
// strict-interpolation MCP loader. If the simulator's behavior drifts from
// Devin's actual behavior, every regression test that depends on it
// becomes silently wrong — green CI, broken users. These tests anchor the
// simulator's contract to the documented Devin behavior:
//
//   - Bare ${VAR} with unset env  →  crash
//   - Bare ${VAR} with set env    →  ok
//   - ${VAR:-anything}            →  always ok (even with unset env)
//   - Format: JSON and YAML peer configs both get parsed and walked
//
// The slow-tier workflow (`.github/workflows/devin-import-real.yml`)
// catches drift in Devin's actual behavior by running `devin mcp list`
// against the same fixtures.

describe("simulateDevinImport", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "devin-import-sim-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeJson(name: string, content: unknown): string {
    const fullPath = join(tmp, name);
    writeFileSync(fullPath, JSON.stringify(content, null, 2));
    return fullPath;
  }

  function writeYaml(name: string, content: unknown): string {
    const fullPath = join(tmp, name);
    writeFileSync(fullPath, yaml.dump(content));
    return fullPath;
  }

  // ── Pass-through cases ────────────────────────────────────────────────────

  it("returns ok=true when no config files exist", () => {
    const result = simulateDevinImport([join(tmp, "missing.json")], {});
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("returns ok=true when configs contain no placeholders at all", () => {
    const path = writeJson("clean.json", {
      mcpServers: { srv: { command: "npx", args: ["-y", "thing"] } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("returns ok=true when ${VAR:-} default is present even with unset env", () => {
    const path = writeJson("resilient.json", {
      mcpServers: { srv: { env: { TOKEN: "${TOKEN:-}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
  });

  it("returns ok=true when ${VAR:-fallback} has a non-empty default and env is unset", () => {
    const path = writeJson("with-fallback.json", {
      mcpServers: { srv: { env: { LEVEL: "${LOG_LEVEL:-info}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
  });

  it("returns ok=true when bare ${VAR} is resolved by processEnv", () => {
    const path = writeJson("bare-but-set.json", {
      mcpServers: { srv: { env: { TOKEN: "${GITHUB_TOKEN}" } } },
    });
    const result = simulateDevinImport([path], { GITHUB_TOKEN: "ghp_x" });
    expect(result.ok).toBe(true);
  });

  // ── Crash cases ───────────────────────────────────────────────────────────

  it("returns ok=false when bare ${VAR} is unset in processEnv (the documented Devin crash)", () => {
    const path = writeJson("crashy.json", {
      mcpServers: { github: { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      varName: "GITHUB_TOKEN",
      location: "mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN",
      value: "${GITHUB_TOKEN}",
    });
    expect(result.errorMessage).toContain("'GITHUB_TOKEN' not found and no default provided");
  });

  it("treats env vars set to empty string as unset (matches Devin's actual behavior)", () => {
    // Verified empirically — Devin treats GITHUB_TOKEN="" the same as unset because
    // the bash-equivalent `${TOKEN}` interpolation produces empty string either way.
    const path = writeJson("empty-string-env.json", {
      mcpServers: { srv: { env: { TOKEN: "${TOKEN}" } } },
    });
    const result = simulateDevinImport([path], { TOKEN: "" });
    expect(result.ok).toBe(false);
  });

  it("reports findings across multiple configs in one pass", () => {
    const cursorPath = writeJson("cursor.json", {
      mcpServers: { github: { env: { TOKEN: "${GITHUB_TOKEN}" } } },
    });
    const claudePath = writeJson("claude.json", {
      mcpServers: { slack: { env: { TOKEN: "${SLACK_BOT_TOKEN}" } } },
    });
    const result = simulateDevinImport([cursorPath, claudePath], {});
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.varName).sort()).toEqual(["GITHUB_TOKEN", "SLACK_BOT_TOKEN"]);
  });

  // ── Format coverage ────────────────────────────────────────────────────────

  it("walks YAML configs (goose extensions shape)", () => {
    const path = writeYaml("goose.yaml", {
      extensions: {
        github: {
          name: "github",
          type: "stdio",
          envs: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
        },
      },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({
      varName: "GITHUB_TOKEN",
      location: "extensions.github.envs.GITHUB_PERSONAL_ACCESS_TOKEN",
    });
  });

  it("walks into args arrays and url/headers fields (not just env blocks)", () => {
    // Devin interpolates EVERY string. A bare placeholder in args or url crashes too.
    const path = writeJson("everywhere.json", {
      mcpServers: {
        srv: {
          command: "npx",
          args: ["--key=${KEY}", "--region=${AWS_REGION:-us-east-1}"],
          url: "https://${HOST}/api",
          headers: { Authorization: "Bearer ${API_TOKEN:-}" },
        },
      },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(false);
    const varNames = result.findings.map((f) => f.varName).sort();
    // KEY and HOST are bare; AWS_REGION and API_TOKEN have defaults.
    expect(varNames).toEqual(["HOST", "KEY"]);
  });

  // ── Non-crash patterns ─────────────────────────────────────────────────────

  it("ignores opencode-style ${env:VAR} (different syntax, Devin doesn't interpolate it)", () => {
    const path = writeJson("opencode.json", {
      mcp: { srv: { environment: { TOKEN: "${env:OPENCODE_TOKEN}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
  });

  it("ignores codex-style {env:VAR} in TOML strings (different syntax)", () => {
    // Toml file read as JSON would fail to parse, but Devin doesn't import TOML
    // in the first place. Modeled here only to document the exclusion.
    const path = writeJson("with-env-prefix.json", {
      mcpServers: { srv: { env: { TOKEN: "{env:GITHUB_TOKEN}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
  });

  it("ignores lowercase ${var} (Devin's regex requires uppercase first char)", () => {
    const path = writeJson("lowercase.json", {
      mcpServers: { srv: { env: { TOKEN: "${github_token}" } } },
    });
    const result = simulateDevinImport([path], {});
    expect(result.ok).toBe(true);
  });
});
