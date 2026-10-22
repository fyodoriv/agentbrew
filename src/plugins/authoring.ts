/**
 * Plugin authoring tools (issue #208, step 11): `plugin new` scaffolds a
 * plugin repo, `plugin test` runs the core's static checks on a checkout,
 * and `plugin migrate` drafts a manifest from a legacy team overlay. None of
 * them installs anything or runs plugin code.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import yaml from "js-yaml";
import { checkCapabilities } from "./capabilities.js";
import { leakPatternsIn } from "./leak-audit.js";
import { MANIFEST_FILE, type PluginManifest, readManifest, validateManifest } from "./manifest.js";
import { readPluginMcpServers, validateMcpServers } from "./mcp-launcher.js";

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function write(dir: string, rel: string, body: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

/** Create a new plugin repo layout in an empty (or missing) directory. */
export function scaffoldPlugin(dir: string, name: string): void {
  if (!NAME.test(name)) throw new Error(`Plugin name must match ${NAME} (got "${name}")`);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`);
  const manifest: PluginManifest = {
    schema: 1,
    name,
    version: "0.1.0",
    capabilities: { agents: ["claude"], repos: { include: [], exclude: [] }, commands_exec: false },
    contributes: { rules: "rules/", skills: "skills/", leak_patterns: "leak-patterns.yaml" },
  };
  write(dir, MANIFEST_FILE, yaml.dump(manifest));
  write(dir, "rules/example.md", "---\nagents: [claude]\n---\nReplace this with a company rule.\n");
  write(
    dir,
    "skills/example/SKILL.md",
    "---\nname: example\ndescription: Replace with a company skill.\n---\nSteps.\n",
  );
  write(dir, "leak-patterns.yaml", yaml.dump({ patterns: [] }));
  write(dir, ".gitignore", "node_modules/\n.DS_Store\n");
  write(
    dir,
    "README.md",
    [
      `# ${name}`,
      "",
      "An agentbrew company plugin.",
      "",
      "- Add repos where the rules apply to `capabilities.repos.include`.",
      "- Run `agentbrew plugin test .` before each release.",
      "- Release with an SSH-signed tag: `git tag -s v0.1.0 -m v0.1.0`.",
      "",
    ].join("\n"),
  );
}

/** Every problem the core would refuse in this plugin checkout. Empty means it passes. */
export function testPlugin(dir: string): string[] {
  let manifest: PluginManifest;
  try {
    const parsed = yaml.load(readFileSync(join(dir, MANIFEST_FILE), "utf-8"));
    const result = validateManifest(parsed);
    if (!result.ok) return result.errors.map((e) => `manifest ${e}`);
    manifest = readManifest(dir);
  } catch (e) {
    return [`manifest cannot be read: ${e instanceof Error ? e.message : String(e)}`];
  }
  const problems: string[] = [];
  const guard = (fn: () => string[]) => {
    try {
      problems.push(...fn());
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  };
  guard(() => checkCapabilities(dir, manifest));
  guard(() => validateMcpServers(readPluginMcpServers(dir, manifest)));
  guard(() => {
    leakPatternsIn(dir, manifest.name);
    return [];
  });
  return problems;
}

export interface MigrationDraft {
  manifest: PluginManifest;
  unmapped: string[];
}

function rel(path: string): string {
  return normalize(path).replace(/^\.\//, "").replace(/\/+$/, "");
}

function isLocal(path: string): boolean {
  return path.startsWith("./") || path.startsWith("../");
}

type Agentfile = Record<string, unknown>;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Local folders the overlay declares become `contributes` paths. */
function mapContributions(agentfile: Agentfile, unmapped: string[]): Record<string, unknown> {
  const contributes: Record<string, unknown> = {};
  const sources = strings(agentfile.sources);
  const local = sources.filter(isLocal);
  for (const s of sources.filter((x) => !isLocal(x))) {
    unmapped.push(`sources: ${s} (remote source; add it to the catalog instead)`);
  }
  if (local[0]) contributes.skills = rel(local[0]);
  for (const s of local.slice(1)) unmapped.push(`sources: ${s} (only one skills dir per plugin)`);
  const commands = strings(agentfile.commands);
  if (commands[0]) contributes.commands = rel(commands[0]);
  const packs = strings(agentfile.memoryPacks);
  if (packs[0]) contributes.memory_packs = rel(packs[0]);
  if (typeof agentfile.catalogOverlay === "string") contributes.catalog = rel(agentfile.catalogOverlay);
  return contributes;
}

/** Overlay features the contract does not carry over automatically. */
function listUnsupported(agentfile: Agentfile, mcpNames: string[], unmapped: string[]): void {
  for (const n of mcpNames) {
    unmapped.push(`mcp: ${n} (write mcp/servers.yaml with secret references and a pinned version)`);
  }
  for (const a of strings(agentfile.adapters)) {
    unmapped.push(`adapters: ${a} (executable adapters are not allowed; needs a declarative mapping)`);
  }
  if (typeof agentfile.detect === "string") {
    unmapped.push(`detect: ${agentfile.detect} (detect scripts are not run; use declarative signals)`);
  }
  for (const key of ["rules", "hooks", "agents", "bootstrap"]) {
    if (agentfile[key] !== undefined) unmapped.push(`${key}: (map by hand)`);
  }
}

/** Draft `agentbrew-plugin.yaml` from a legacy overlay's Agentfile. Writes nothing. */
export function migrateOverlay(overlayDir: string): MigrationDraft {
  const agentfile = (yaml.load(readFileSync(join(overlayDir, "Agentfile.yaml"), "utf-8")) ?? {}) as Agentfile;
  const unmapped: string[] = [];
  const contributes = mapContributions(agentfile, unmapped);
  const mcpNames = (Array.isArray(agentfile.mcp) ? agentfile.mcp : [])
    .map((m) => (m as { name?: unknown }).name)
    .filter((n): n is string => typeof n === "string");
  listUnsupported(agentfile, mcpNames, unmapped);
  const name = typeof agentfile.name === "string" && NAME.test(agentfile.name) ? agentfile.name : "company";
  const manifest: PluginManifest = {
    schema: 1,
    name,
    version: "0.1.0",
    capabilities: { agents: [], repos: { include: [] }, ...(mcpNames.length ? { mcp_servers: mcpNames } : {}) },
    contributes,
  };
  return { manifest, unmapped };
}
