import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog/types.js";
import {
  pinsFromCatalog,
  sweepOneJsonConfigForCatalogPins,
  sweepOneTomlConfigForCatalogPins,
  sweepOneYamlConfigForCatalogPins,
} from "./catalog-pin-sweep.js";

describe("pinsFromCatalog", () => {
  it("pins every npx server whose catalog args name an exact version", () => {
    const pins = pinsFromCatalog([
      {
        name: "tasks-mcp",
        description: "",
        category: "x",
        recommended: true,
        command: "npx",
        args: ["-y", "tasks-mcp@0.10.2"],
      },
      {
        name: "other",
        description: "",
        category: "x",
        recommended: false,
        command: "npx",
        args: ["-y", "@acme/other-mcp@1.2.3-beta.1"],
      },
      {
        name: "floating",
        description: "",
        category: "x",
        recommended: false,
        command: "npx",
        args: ["-y", "floating-mcp@latest"],
      },
      { name: "bare", description: "", category: "x", recommended: false, command: "npx", args: ["-y", "bare-mcp"] },
      { name: "remote", description: "", category: "x", recommended: false, url: "https://x.example.com/mcp" },
    ]);
    expect(pins.map((p) => [p.serverName, p.packageName])).toEqual([
      ["tasks-mcp", "tasks-mcp"],
      ["other", "@acme/other-mcp"],
    ]);
  });
});

/** A version newer than the catalog's tasks-mcp pin, whatever that pin is. */
const NEWER = (() => {
  const pin = pinsFromCatalog(loadCatalog().mcp_servers).find((p) => p.serverName === "tasks-mcp");
  const version = pin?.args.at(-1)?.split("@").pop() ?? "0.0.0";
  const [major = "0"] = version.split(".");
  return `${Number(major) + 1}.0.0`;
})();

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

  it("raises an exact pin older than the catalog's to the catalog version", () => {
    // tasks-mcp 0.5.0's list_tasks walks the whole home folder (11 s, 1.1 MB);
    // a stale exact pin kept it in VS Code settings forever.
    const path = write("old-pin.json", {
      mcpServers: { "tasks-mcp": { command: "npx", args: ["-y", "tasks-mcp@0.5.0"] } },
    });
    const result = sweepOneJsonConfigForCatalogPins(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    const after = read(path) as { mcpServers: { "tasks-mcp": { args: string[] } } };
    expect(after.mcpServers["tasks-mcp"].args).toEqual(["-y", "tasks-mcp@0.10.2"]);
  });

  it("keeps an exact pin newer than the catalog's", () => {
    // Read from the live catalog, so this case stays newer when the pin moves.
    const original = { mcpServers: { "tasks-mcp": { command: "npx", args: ["-y", `tasks-mcp@${NEWER}`] } } };
    const path = write("new-pin.json", original);
    expect(sweepOneJsonConfigForCatalogPins(path, "mcpServers", false)).toEqual({ fixedCount: 0, findings: [] });
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

  it("raises an old exact pin in codex toml", () => {
    const path = writeText(
      "old.toml",
      ["[mcpServers.tasks-mcp]", 'command = "npx"', 'args = ["-y", "tasks-mcp@0.5.0"]', ""].join("\n"),
    );
    const result = sweepOneTomlConfigForCatalogPins(path, "mcpServers", false);
    expect(result.fixedCount).toBe(1);
    expect(readFileSync(path, "utf-8")).toContain('"tasks-mcp@0.10.2"');
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
