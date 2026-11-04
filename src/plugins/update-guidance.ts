import { execFileSync } from "node:child_process";
import { basename, isAbsolute, relative } from "node:path";
import type { PluginLockEntry } from "../lock.js";
import { cacheGitEnv } from "../mcp/git-ref.js";
import { findClosestMatches } from "../suggest.js";
import type { getSkillSources } from "../sync/skills-sync.js";
import { pluginDir, pluginsRoot } from "./store.js";

type SkillSource = ReturnType<typeof getSkillSources>[number];

/** The command's invocation-scoped deadline bounds all optional remote help probes. */
export function pluginUpdateChoices(plugins: PluginLockEntry[]): string {
  const deadline = Date.now() + 5000;
  const lines = ["Usage: agentbrew plugin update <name> <ref>", "Installed plugins (remote tags are unverified):"];
  for (const entry of plugins) {
    let latest = "unavailable (use the publisher's signed tag)";
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      try {
        const refs = execFileSync(
          "git",
          ["ls-remote", "--sort=-version:refname", "--tags", "--refs", "--end-of-options", entry.source],
          {
            cwd: pluginsRoot(),
            encoding: "utf-8",
            stdio: "pipe",
            timeout: Math.min(2000, remaining),
            maxBuffer: 1024 * 1024,
            env: cacheGitEnv({ unattended: true }),
          },
        );
        latest =
          refs
            .split("\n")
            .map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//, ""))
            .find(Boolean) ?? "no remote tags";
      } catch {
        // Optional help must still show installed names when offline.
      }
    }
    lines.push(`  ${entry.name}: installed ${entry.ref}; highest remote tag: ${latest}`);
  }
  if (plugins.length === 0) lines.push("  None. Run agentbrew plugin list.");
  return lines.join("\n");
}

export function unknownPluginMessage(name: string, plugins: PluginLockEntry[]): string {
  const aliases = plugins
    .filter((entry) => basename(entry.source.replace(/\.git\/?$/, "")) === name)
    .map((entry) => entry.name);
  const matches = [
    ...new Set([
      ...aliases,
      ...findClosestMatches(
        name,
        plugins.map((entry) => entry.name),
      ),
    ]),
  ];
  return `Plugin "${name}" is not installed.${matches.length ? ` Did you mean ${matches.join(" or ")}?` : ""} Run agentbrew plugin list for registered names.`;
}

/** Sources before the plugin win by existing sync precedence; never mutate their checkouts. */
export function pluginSkillShadows(name: string, sources: SkillSource[]): string[] {
  const ownIndex = sources.findIndex((source) => {
    const rel = relative(pluginDir(name), source.path);
    return source.label === `plugin-${name}` && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  });
  if (ownIndex < 0) return [];
  const own = sources[ownIndex];
  const names = new Set(own.scanner(own.path).map((path) => basename(path)));
  return sources.slice(0, ownIndex).flatMap((source) =>
    source
      .scanner(source.path)
      .map((path) => basename(path))
      .filter((skill) => names.has(skill) && (!source.installedSkillNames || source.installedSkillNames.has(skill)))
      .map(
        (skill) =>
          `Skill ${skill} still comes from higher-priority source ${source.label}, not updated plugin ${name}. Review its ownership with agentbrew status --verbose; this source was not changed.`,
      ),
  );
}
