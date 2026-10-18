import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pins real-e2e/SCENARIO_MAP.md against the scenario files and the user
// stories (new-project "user-stories" and "e2e" areas): every scenario is
// mapped once, its file name lists exactly the mapped stories, and every
// story names an outcome metric and the e2e scenarios that prove it.

const repoRoot = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf-8");

const scenarioFiles = readdirSync(join(repoRoot, "real-e2e/scenarios")).filter((f) => f.endsWith(".test.ts"));
const storyFiles = readdirSync(join(repoRoot, "docs/user-stories")).filter((f) => /^\d{2}-.*\.md$/.test(f));
const storyIds = new Set(storyFiles.map((f) => `US${f.slice(0, 2)}`));

/** `- \`file.test.ts\` -> US01, US02 (note)` lines from the map. */
function mapEntries(markdown: string): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  for (const match of markdown.matchAll(/^- `([a-z0-9-]+\.test\.ts)` -> (US\d{2}(?:, US\d{2})*)/gm)) {
    const [, file = "", stories = ""] = match;
    expect(entries.has(file), `${file} is mapped twice`).toBe(false);
    entries.set(file, stories.split(", "));
  }
  return entries;
}

/** Story IDs that a scenario file name starts with: us06-us21-hooks → US06, US21. */
function storiesInFileName(file: string): string[] {
  return [...file.matchAll(/(?:^|-)us(\d{2})(?=-)/g)].map((m) => `US${m[1]}`);
}

const metricNames = new Set([...read("docs/metrics.md").matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]));
const map = mapEntries(read("real-e2e/SCENARIO_MAP.md"));

describe("real-e2e/SCENARIO_MAP.md", () => {
  it("maps every scenario file, and only existing ones", () => {
    expect([...map.keys()].sort()).toEqual([...scenarioFiles].sort());
  });

  it("lists exactly the stories each file name starts with", () => {
    for (const [file, stories] of map) {
      expect(stories, file).toEqual(storiesInFileName(file));
    }
  });

  it("maps only stories that exist", () => {
    for (const [file, stories] of map) {
      for (const story of stories) expect(storyIds.has(story), `${file} -> ${story}`).toBe(true);
    }
  });
});

describe("user stories", () => {
  for (const file of storyFiles) {
    const id = `US${file.slice(0, 2)}`;
    const story = read(`docs/user-stories/${file}`);

    it(`${id} names an outcome metric from docs/metrics.md`, () => {
      const line = story.match(/^\*\*Metric\*\*: (.+)$/m)?.[1] ?? "";
      const name = line.match(/^`([a-z_]+)`/)?.[1] ?? "";
      expect(metricNames.has(name), `${file}: "${line}"`).toBe(true);
      // An outcome rate, not a count of passing tests.
      expect(line).not.toMatch(/\btests? pass/i);
    });

    it(`${id} names e2e scenarios that map back to it`, () => {
      const line = story.match(/^\*\*E2E\*\*: (.+)$/m)?.[1] ?? "";
      const named = [...line.matchAll(/`([a-z0-9-]+\.test\.ts)`/g)].map((m) => m[1] ?? "");
      expect(named.length, `${file} has no **E2E**: scenario`).toBeGreaterThan(0);
      for (const scenario of named) {
        expect(existsSync(join(repoRoot, "real-e2e/scenarios", scenario)), scenario).toBe(true);
        expect(map.get(scenario), `${scenario} does not map to ${id}`).toContain(id);
      }
    });
  }
});
