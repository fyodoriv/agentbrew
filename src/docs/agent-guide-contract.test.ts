import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pins the docs contract in docs/agent-guide-baseline.md: a short, routed agent
// guide that Claude Code loads, a docs map with no orphan docs, and a README
// that opens with a quickstart and the map link.

const repoRoot = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf-8");

const AGENT_GUIDE_BUDGET_BYTES = 10_000;
const REQUIRED_HEADINGS = [
  "## Start here",
  "## Commands",
  "## Where to change what",
  "## Rules",
  "## Gotchas",
  "## Delivery",
  "## Docs upkeep",
];

function h2Headings(markdown: string): string[] {
  return markdown.split("\n").filter((line) => line.startsWith("## "));
}

/** Relative link targets in a markdown file, without anchors. */
function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((match) => match[1] ?? "")
    .filter((target) => target !== "" && !/^[a-z]+:/i.test(target));
}

describe("agent guide contract", () => {
  const guide = read("AGENTS.md");

  it("has the required sections in order", () => {
    expect(h2Headings(guide)).toEqual(REQUIRED_HEADINGS);
  });

  it("stays under the always-loaded byte budget", () => {
    expect(Buffer.byteLength(guide, "utf-8")).toBeLessThanOrEqual(AGENT_GUIDE_BUDGET_BYTES);
  });

  it("is what Claude Code loads through CLAUDE.md", () => {
    expect(realpathSync(join(repoRoot, "CLAUDE.md"))).toBe(realpathSync(join(repoRoot, "AGENTS.md")));
  });

  it("links only to files that exist", () => {
    for (const target of relativeLinks(guide)) {
      expect(existsSync(join(repoRoot, target)), `AGENTS.md links to missing ${target}`).toBe(true);
    }
  });
});

describe("docs map", () => {
  const map = read("docs/README.md");
  const linked = new Set(relativeLinks(map).map((target) => resolve(repoRoot, "docs", target)));

  it("lists every top-level doc", () => {
    const docs = readdirSync(join(repoRoot, "docs")).filter((name) => name.endsWith(".md") && name !== "README.md");
    const missing = docs.filter((name) => !linked.has(resolve(repoRoot, "docs", name)));
    expect(missing, "add a row to docs/README.md for each new doc").toEqual([]);
  });

  it("links only to files and folders that exist", () => {
    for (const target of linked) {
      expect(existsSync(target), `docs/README.md links to missing ${target}`).toBe(true);
    }
  });
});

describe("README opening", () => {
  const opening = read("README.md").split("\n").slice(0, 60).join("\n");

  it("starts with a quickstart code block and the docs map link", () => {
    expect(opening).toMatch(/```(bash|sh)\n/);
    expect(opening).toContain("(docs/README.md)");
  });
});

describe("relativeLinks", () => {
  it("keeps relative targets and drops anchors and URLs", () => {
    expect(relativeLinks("[a](docs/x.md#y) [b](https://x.dev) [c](../y/) [d](#z)")).toEqual(["docs/x.md", "../y/"]);
  });
});
