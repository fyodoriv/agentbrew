import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sweepOneJsonConfigForCatalogPins,
  sweepOneTomlConfigForCatalogPins,
  sweepOneYamlConfigForCatalogPins,
} from "./catalog-pin-sweep.js";

describe("sweepOneJsonConfigForCatalogPins", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "catalog-pin-sweep-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(relativePath: string, content: unknown): string {
    const fullPath = join(tmp, relativePath);
    writeFileSync(fullPath, JSON.stringify(content, null, 2));
    return fullPath;
  }

  function writeText(relativePath: string, content: string): string {
    const fullPath = join(tmp, relativePath);
    writeFileSync(fullPath, content);
    return fullPath;
  }

  function read(fullPath: string): unknown {
    return JSON.parse(readFileSync(fullPath, "utf-8"));
  }

  it("pins per-project tasks-mcp entries that still use @latest", () => {
    const path = write("claude.json", {
      projects: {
        "/Users/alice/repo": {
          mcpServers: {
            "tasks-mcp": {
              command: "npx",
              args: ["-y", "tasks-mcp@latest"],
            },
          },
        },
      },
    });
    const result = sweepOneJsonConfigForCatalogPins(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(result.findings[0].path).toBe("projects./Users/alice/repo.mcpServers.tasks-mcp");
    const after = read(path) as {
      projects: Record<string, { mcpServers: { "tasks-mcp": { args: string[] } } }>;
    };
    expect(after.projects["/Users/alice/repo"].mcpServers["tasks-mcp"].args).toEqual(["-y", "tasks-mcp@0.10.2"]);
  });

  it("dryRun reports floating tasks-mcp entries without writing", () => {
    const original = {
      mcpServers: {
        "tasks-mcp": {
          command: "npx",
          args: ["-y", "tasks-mcp@latest"],
        },
      },
    };
    const path = write("dry-run.json", original);
    const result = sweepOneJsonConfigForCatalogPins(path, "mcpServers", true);
    expect(result.fixedCount).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(read(path)).toEqual(original);
  });

  it("leaves catalog-pinned tasks-mcp entries unchanged", () => {
    const original = {
      mcpServers: {
        "tasks-mcp": {
          command: "npx",
          args: ["-y", "tasks-mcp@0.10.2"],
        },
      },
    };
    const path = write("clean.json", original);
    const result = sweepOneJsonConfigForCatalogPins(path, "mcpServers", false);
    expect(result).toEqual({ fixedCount: 0, findings: [] });
    expect(read(path)).toEqual(original);
  });

  it("does not touch unrelated npx servers that use @latest", () => {
    const original = {
      mcpServers: {
        context7: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
        },
      },
    };
    const path = write("unrelated.json", original);
    const result = sweepOneJsonConfigForCatalogPins(path, "mcpServers", false);
    expect(result).toEqual({ fixedCount: 0, findings: [] });
    expect(read(path)).toEqual(original);
  });

  it("pins goose yaml tasks-mcp entries", () => {
    const path = writeText(
      "goose.yaml",
      [
        "extensions:",
        "  tasks-mcp:",
        "    name: tasks-mcp",
        "    type: stdio",
        "    cmd: npx",
        "    args:",
        "      - '-y'",
        "      - tasks-mcp@latest",
        "",
      ].join("\n"),
    );
    const result = sweepOneYamlConfigForCatalogPins(path, "extensions", false);
    expect(result.fixedCount).toBe(1);
    expect(readFileSync(path, "utf-8")).toContain("tasks-mcp@0.10.2");
  });

  it("pins codex toml tasks-mcp entries without rewriting other blocks", () => {
    const path = writeText(
      "config.toml",
      [
        "[mcpServers.tasks-mcp]",
        'command = "npx"',
        "args = [",
        '    "-y",',
        '    "tasks-mcp@latest",',
        "]",
        "",
        "[mcpServers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp@latest"]',
        "",
      ].join("\n"),
    );
    const result = sweepOneTomlConfigForCatalogPins(path, "mcpServers", false);
    const after = readFileSync(path, "utf-8");
    expect(result.fixedCount).toBe(1);
    expect(after).toContain('"tasks-mcp@0.10.2"');
    expect(after).toContain('"@upstash/context7-mcp@latest"');
  });
});
