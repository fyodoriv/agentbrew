import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { getSkillSources } from "../sync/skills-sync.js";
import { pluginDir } from "./store.js";

type SkillSource = ReturnType<typeof getSkillSources>[number];

import { pluginSkillShadows, unknownPluginMessage } from "./update-guidance.js";

function source(label: string, names: string[], selected?: string[]): SkillSource {
  return {
    label,
    path: label === "plugin-acme" ? join(pluginDir("acme"), "skills") : `/fixture/${label}`,
    scanner: (root) => names.map((name) => `${root}/${name}`),
    installedSkillNames: selected ? new Set(selected) : undefined,
  };
}

describe("plugin update source warnings", () => {
  it("warns for a selected higher-priority duplicate without changing either source", () => {
    const sources = [source("legacy", ["greet", "other"], ["greet"]), source("plugin-acme", ["greet"])];
    const warnings = pluginSkillShadows("acme", sources);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("greet");
    expect(warnings[0]).toContain("legacy");
    expect(warnings[0]).toContain("source was not changed");
  });

  it("ignores unselected duplicates, lower priority sources and an absent plugin", () => {
    expect(
      pluginSkillShadows("acme", [
        source("legacy", ["greet"], []),
        source("plugin-acme", ["greet"]),
        source("later", ["greet"]),
      ]),
    ).toEqual([]);
    expect(pluginSkillShadows("missing", [source("legacy", ["greet"])])).toEqual([]);
  });

  it("does not guess a registered plugin when there is no close match", () => {
    expect(unknownPluginMessage("unknown", [])).toContain("agentbrew plugin list");
    expect(unknownPluginMessage("unknown", [])).not.toContain("Did you mean");
  });
});
