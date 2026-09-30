import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../types.js";
import { discoverMcpServers } from "./mcp.js";

/**
 * Regression guard for the mcpFormat dispatch collapse (P0,
 * `collapse-mcpformat-dispatch-to-adapter`). Three hand-rolled if-chains used
 * to dispatch on `agent.mcpFormat`:
 *
 *   1. `src/import.ts`        — `readDiscoveredServers`     (agentbrew import)
 *   2. `src/mcp/mcp.ts`       — `readServersFromAgent`      (agentbrew init via discoverMcpServers)
 *   3. `src/mcp/adapters.ts`  — `getAdapter` factory        (agentbrew sync)
 *
 * (1) and (2) drifted from each other — the `fix-opencode-adapter-format`
 * patch added the `opencode` branch to (1) but missed (2), so a fresh
 * `agentbrew init` on a host that already has opencode 1.14+ configured
 * silently fell through to `extractServersFromJson` and discovered zero
 * servers (each entry's `command` is an array, not a scalar).
 *
 * These tests pin that exact bug as a regression so the dispatch can never
 * fall out of sync again — and lock the structural property that the only
 * remaining dispatch lives in `getAdapter`.
 */
describe("mcpFormat dispatch coverage", () => {
  describe("agentbrew init (discoverMcpServers) handles every mcpFormat", () => {
    let tmp: string;

    function setup(): string {
      tmp = mkdtempSync(join(tmpdir(), "dispatch-coverage-"));
      return tmp;
    }

    function cleanup(): void {
      rmSync(tmp, { recursive: true, force: true });
    }

    it("discovers opencode 1.14+ servers (regression: init missed opencode branch)", () => {
      // opencode 1.14+ shape: command is an array, env is `environment`. The
      // pre-collapse `readServersFromAgent` fell through to `extractServersFromJson`
      // which reads command as a scalar string — every server discovered as
      // {command: "", args: []}, an unusable shape that downstream filtered out.
      setup();
      try {
        const configPath = join(tmp, "opencode.json");
        writeFileSync(
          configPath,
          JSON.stringify({
            mcp: {
              "pg-mcp": {
                type: "local",
                command: ["npx", "-y", "@modelcontextprotocol/server-postgres"],
                environment: { DATABASE_URL: "postgres://localhost/x" },
              },
            },
          }),
        );

        const agents: AgentConfig[] = [
          {
            name: "opencode",
            detected: true,
            skillsDir: "x",
            mcpConfig: configPath,
            mcpFormat: "opencode",
            mcpKey: "mcp",
          },
        ];

        const servers = discoverMcpServers(agents);
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("pg-mcp");
        expect(servers[0].command).toBe("npx");
        expect(servers[0].args).toEqual(["-y", "@modelcontextprotocol/server-postgres"]);
        expect(servers[0].env).toEqual({ DATABASE_URL: "postgres://localhost/x" });
      } finally {
        cleanup();
      }
    });

    it("discovers goose yaml servers", () => {
      setup();
      try {
        const configPath = join(tmp, "goose.yaml");
        writeFileSync(
          configPath,
          ["extensions:", "  playwright:", "    type: stdio", "    cmd: npx @playwright/mcp@latest", ""].join("\n"),
        );

        const agents: AgentConfig[] = [
          {
            name: "goose",
            detected: true,
            skillsDir: "x",
            mcpConfig: configPath,
            mcpFormat: "yaml",
            mcpKey: "extensions",
          },
        ];

        const servers = discoverMcpServers(agents);
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("playwright");
        expect(servers[0].command).toBe("npx");
      } finally {
        cleanup();
      }
    });

    it("discovers codex toml servers", () => {
      setup();
      try {
        const configPath = join(tmp, "codex.toml");
        writeFileSync(configPath, '[mcpServers.toml-srv]\ncommand = "node"\nargs = ["server.js"]\n');

        const agents: AgentConfig[] = [
          {
            name: "codex",
            detected: true,
            skillsDir: "x",
            mcpConfig: configPath,
            mcpFormat: "toml",
          },
        ];

        const servers = discoverMcpServers(agents);
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("toml-srv");
        expect(servers[0].command).toBe("node");
      } finally {
        cleanup();
      }
    });

    it("discovers json servers (default branch)", () => {
      setup();
      try {
        const configPath = join(tmp, "cursor.json");
        writeFileSync(configPath, JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh-mcp"] } } }));

        const agents: AgentConfig[] = [{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: configPath }];

        const servers = discoverMcpServers(agents);
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe("gh");
      } finally {
        cleanup();
      }
    });
  });

  describe("structural: no hand-rolled mcpFormat dispatch outside getAdapter", () => {
    // The dispatch collapse is load-bearing — if a fourth `mcpFormat ===` chain
    // ever appears in `import.ts` or `mcp.ts`, the drift class returns. Lock
    // the structure by source-grep so even an honest "just one more branch" PR
    // fails CI.
    const here = dirname(fileURLToPath(import.meta.url));
    const repoSrc = join(here, "..");

    it("import.ts has no hand-rolled mcpFormat === dispatch", () => {
      const source = readFileSync(join(repoSrc, "import.ts"), "utf-8");
      expect(source).not.toMatch(/mcpFormat\s*===/);
    });

    it("mcp/mcp.ts has no hand-rolled mcpFormat === dispatch", () => {
      const source = readFileSync(join(repoSrc, "mcp", "mcp.ts"), "utf-8");
      expect(source).not.toMatch(/mcpFormat\s*===/);
    });
  });
});
