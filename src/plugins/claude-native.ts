/**
 * Native Claude Code output (issue #208, step 8).
 *
 * Each active plugin becomes a Claude Code plugin in a local marketplace at
 * `~/.local/share/agentbrew/claude-marketplace`. User settings get the
 * marketplace in `extraKnownMarketplaces` and the plugins in
 * `enabledPlugins`. This runs side by side with file rendering: skills and
 * commands still deploy as files, while the native plugin carries the
 * plugin's hooks and a SessionStart hook that loads repo-scoped rules via
 * `agentbrew plugin rules`. agentbrew never writes system policy; `plugin
 * policy` prints a managed-settings fragment for admins.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sync as writeFileSync } from "write-file-atomic";
import { type ActivePlugin, activePlugins } from "./contributions.js";

export const MARKETPLACE_NAME = "agentbrew-plugins";

export function marketplaceDir(): string {
  return join(homedir(), ".local", "share", "agentbrew", "claude-marketplace");
}

function claudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

const RULES_HOOK = {
  hooks: [{ type: "command", command: 'agentbrew plugin rules --agent claude-code --cwd "$CLAUDE_PROJECT_DIR"' }],
};

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Copy the plugin's hooks folder and add the rules SessionStart hook. */
function emitHooks(plugin: ActivePlugin, root: string): void {
  const rel = plugin.manifest.contributes?.hooks;
  let hooks: Record<string, unknown[]> = {};
  if (typeof rel === "string" && existsSync(join(plugin.dir, rel))) {
    cpSync(dirname(join(plugin.dir, rel)), join(root, "hooks"), { recursive: true });
    hooks =
      (JSON.parse(readFileSync(join(plugin.dir, rel), "utf-8")) as { hooks?: Record<string, unknown[]> }).hooks ?? {};
  }
  hooks.SessionStart = [...(hooks.SessionStart ?? []), RULES_HOOK];
  writeJson(join(root, "hooks", "hooks.json"), { hooks });
}

function emitPlugin(plugin: ActivePlugin): { name: string; source: string; version: string; description: string } {
  const { name } = plugin.entry;
  const root = join(marketplaceDir(), "plugins", name);
  rmSync(root, { recursive: true, force: true });
  const version = `${plugin.manifest.version}+${plugin.entry.commit.slice(0, 8)}`;
  const description = `Company plugin ${name}, managed by agentbrew`;
  writeJson(join(root, ".claude-plugin", "plugin.json"), { name, version, description });
  emitHooks(plugin, root);
  return { name, source: `./plugins/${name}`, version, description };
}

function readSettings(): Record<string, unknown> | undefined {
  const path = claudeSettingsPath();
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Set our marketplace and enabled plugins; drop stale entries we own. Other keys stay. */
function updateSettings(names: string[]): void {
  const current = readSettings();
  if (!current && names.length === 0) return;
  const settings = current ?? {};
  const markets = { ...((settings.extraKnownMarketplaces as Record<string, unknown>) ?? {}) };
  const enabled = { ...((settings.enabledPlugins as Record<string, boolean>) ?? {}) };
  for (const key of Object.keys(enabled)) if (key.endsWith(`@${MARKETPLACE_NAME}`)) delete enabled[key];
  delete markets[MARKETPLACE_NAME];
  if (names.length > 0) {
    markets[MARKETPLACE_NAME] = { source: { source: "directory", path: marketplaceDir() } };
    for (const name of names) enabled[`${name}@${MARKETPLACE_NAME}`] = true;
  }
  settings.extraKnownMarketplaces = markets;
  settings.enabledPlugins = enabled;
  if (Object.keys(markets).length === 0) delete settings.extraKnownMarketplaces;
  if (Object.keys(enabled).length === 0) delete settings.enabledPlugins;
  writeJson(claudeSettingsPath(), settings);
}

/** Regenerate the local marketplace and settings from the active plugins. */
export function emitClaudeNative(): void {
  const plugins = activePlugins();
  const entries = plugins.map(emitPlugin);
  const pluginsDir = join(marketplaceDir(), "plugins");
  if (existsSync(pluginsDir)) {
    const keep = new Set(entries.map((e) => e.name));
    for (const dir of readdirSync(pluginsDir))
      if (!keep.has(dir)) rmSync(join(pluginsDir, dir), { recursive: true, force: true });
  }
  if (entries.length > 0) {
    writeJson(join(marketplaceDir(), ".claude-plugin", "marketplace.json"), {
      name: MARKETPLACE_NAME,
      owner: { name: "agentbrew" },
      plugins: entries,
    });
  } else {
    rmSync(marketplaceDir(), { recursive: true, force: true });
  }
  updateSettings(entries.map((e) => e.name));
}

export interface PolicyFragment {
  extraKnownMarketplaces: Record<string, { source: { source: string; path: string } }>;
  enabledPlugins: Record<string, boolean>;
  strictKnownMarketplaces: Array<{ source: string; path: string }>;
  strictPluginOnlyCustomization?: true;
}

/**
 * A managed-settings fragment for admins. It always allowlists the
 * marketplace; `strict` adds `strictPluginOnlyCustomization`, which Claude
 * Code only makes safe together with that allowlist.
 */
export function policyFragment(name: string, options: { strict: boolean }): PolicyFragment {
  if (!activePlugins().some((p) => p.entry.name === name)) throw new Error(`Plugin "${name}" is not installed.`);
  const source = { source: "directory", path: marketplaceDir() };
  return {
    extraKnownMarketplaces: { [MARKETPLACE_NAME]: { source } },
    enabledPlugins: { [`${name}@${MARKETPLACE_NAME}`]: true },
    strictKnownMarketplaces: [source],
    ...(options.strict ? { strictPluginOnlyCustomization: true as const } : {}),
  };
}
