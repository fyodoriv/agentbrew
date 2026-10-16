import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SKILL_PLUGINS = join(REPO_ROOT, "skill-plugins");

// Routing targets that no skill in skill-plugins/ or src/catalog.yaml provides
// yet. Task `skills-route-dangling-skill-names` removes them. Do not add names.
const KNOWN_DANGLING = new Set([
  "clarify",
  "design-review",
  "doc-check",
  "pipeline-ops",
  "readme-audit",
  "refactor",
  "rfc-iterate",
  "rfc-review",
  "taste",
]);

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

function knownSkills(): Set<string> {
  const names = new Set<string>();
  for (const plugin of readdirSync(SKILL_PLUGINS)) {
    const pluginDir = join(SKILL_PLUGINS, plugin);
    if (!statSync(pluginDir).isDirectory()) continue;
    if (existsSync(join(pluginDir, "SKILL.md"))) names.add(plugin);
    for (const skill of readdirSync(pluginDir)) {
      if (existsSync(join(pluginDir, skill, "SKILL.md"))) names.add(skill);
    }
  }
  const catalog = yaml.load(readFileSync(join(REPO_ROOT, "src", "catalog.yaml"), "utf-8")) as {
    skills?: { name: string }[];
  };
  for (const skill of catalog.skills ?? []) names.add(skill.name);
  return names;
}

/** Skill names in "(use a)", "(use `a` or b)", "(use a, b)", "(use a / b …)" routing hints. */
function routingTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(/\(use ([^)]*)\)/g)) {
    for (const part of match[1].split(/\s+or\s+|,|\//)) {
      const name = part.trim().replace(/^`|`$/g, "");
      if (/^[a-z][a-z0-9-]*$/.test(name)) targets.push(name);
    }
  }
  return targets;
}

describe("skill routing hints", () => {
  it("parses the routing hint forms", () => {
    expect(routingTargets("x (use `review`), y (use plan or spec), z (use a / b / two words)")).toEqual([
      "review",
      "plan",
      "spec",
      "a",
      "b",
    ]);
  });

  it("route only to skills that exist in skill-plugins/ or the catalog", () => {
    const known = knownSkills();
    const dangling = markdownFiles(SKILL_PLUGINS).flatMap((file) =>
      routingTargets(readFileSync(file, "utf-8"))
        .filter((name) => !known.has(name) && !KNOWN_DANGLING.has(name))
        .map((name) => `${relative(REPO_ROOT, file)}: ${name}`),
    );
    expect(dangling).toEqual([]);
  });

  it("keeps the dangling allowlist free of names that now resolve", () => {
    const known = knownSkills();
    expect([...KNOWN_DANGLING].filter((name) => known.has(name))).toEqual([]);
  });
});
