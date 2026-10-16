import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

function dependencyRows(): { tool: string; files: string[]; adapter: string }[] {
  const text = readFileSync(join(ROOT, "ARCHITECTURE.md"), "utf-8");
  const section = text.split("\n## External dependencies\n")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| (?!Tool \||---)(.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
    tool: m[1],
    files: [...m[2].matchAll(/`(src\/[\w./-]+)`/g)].map((f) => f[1]),
    adapter: m[3],
  }));
}

describe("ARCHITECTURE.md external dependency table", () => {
  it("lists the delegated tools", () => {
    const tools = dependencyRows().map((row) => row.tool);
    for (const name of ["MCP Registry", "Minsky rule lints", "skills CLI", "mcpm.sh", "ai-rules"]) {
      expect(
        tools.some((tool) => tool.startsWith(name)),
        name,
      ).toBe(true);
    }
  });

  it("points every row at files that exist", () => {
    const missing = dependencyRows().flatMap((row) => row.files.filter((file) => !existsSync(join(ROOT, file))));
    expect(missing).toEqual([]);
  });

  it("marks each row as an adapter under src/adapters/ or direct with a reason", () => {
    for (const row of dependencyRows()) {
      expect(row.files.length, row.tool).toBeGreaterThan(0);
      if (row.adapter === "adapter") {
        expect(
          row.files.every((file) => file.startsWith("src/adapters/")),
          row.tool,
        ).toBe(true);
      } else {
        expect(row.adapter, row.tool).toMatch(/^direct: \S/);
      }
    }
  });
});
