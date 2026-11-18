/**
 * Native Claude Code output, step 8 of #208: a local marketplace with one
 * plugin per company plugin, enabled in user settings, side by side with
 * file rendering. Plus `agentbrew plugin policy`.
 */
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "claude-native-home-"));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousHome: previous };
});

import { fixtureKey, pluginFixture } from "../test-utils/plugin-fixture.js";
import { emitClaudeNative, MARKETPLACE_NAME, marketplaceDir, policyFragment } from "./claude-native.js";
import { launcherPath } from "./mcp-launcher.js";
import { addPlugin, removePlugin } from "./store.js";

const KEY = fixtureKey();
const SETTINGS = () => join(home, ".claude", "settings.json");
const HOOKS = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh" }] }],
  },
});

function install(): void {
  const f = pluginFixture({
    schema: 1,
    name: "acme",
    version: "1.2.0",
    capabilities: { agents: ["claude"], hooks: ["PreToolUse:Bash"], repos: { include: ["git.acme.example/**"] } },
    contributes: { hooks: "hooks/hooks.json" },
  });
  f.release("v1", { "hooks/hooks.json": HOOKS, "hooks/guard.sh": "#!/bin/sh\nexit 0\n" });
  addPlugin(`${f.dir}@v1`, { yes: true, signer: KEY.pub });
}

function installFacetFixture(): void {
  const f = pluginFixture({
    schema: 1,
    name: "fixture-native",
    version: "1.0.0",
    capabilities: {
      agents: ["claude"],
      hooks: ["PreToolUse:Bash"],
      mcp_servers: ["fixture-server"],
      repos: { include: ["fixture.example/**"] },
    },
    contributes: { hooks: "hooks/hooks.json", mcp_servers: "mcp/servers.yaml", rules: "rules/" },
  });
  f.release("v1.0.0", {
    "hooks/hooks.json": HOOKS,
    "hooks/guard.sh": "#!/bin/sh\nexit 0\n",
    "mcp/servers.yaml": "- name: fixture-server\n  command: node\n  args: [server.mjs]\n",
    "mcp/server.mjs": "process.exitCode = 0;\n",
    "rules/fixture.md": "Synthetic rule.\n",
  });
  addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
}

function nativeFacetPaths() {
  const root = join(marketplaceDir(), "plugins", "fixture-native");
  return {
    hooks: join(root, "hooks", "hooks.json"),
    script: join(root, "hooks", "guard.sh"),
    mcp: join(root, ".mcp.json"),
    launcher: launcherPath("fixture-native", "fixture-server"),
    envelope: join(root, ".claude-plugin", "plugin.json"),
    index: join(marketplaceDir(), ".claude-plugin", "marketplace.json"),
    settings: SETTINGS(),
  };
}

function observeNativeFiles(paths: readonly string[]) {
  return paths.map((path) => {
    const info = statSync(path);
    return { path, bytes: readFileSync(path), mode: info.mode, modifiedAt: info.mtimeMs };
  });
}

function settings(): Record<string, any> {
  return JSON.parse(readFileSync(SETTINGS(), "utf-8"));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const d of [".config", ".local", ".claude"]) rmSync(join(home, d), { recursive: true, force: true });
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("scoped native facet publication", () => {
  const facets = ["hooks", "mcp", "rules"] as const;

  it.each(facets)("publishes only the requested cold %s facet", (facet) => {
    installFacetFixture();
    const paths = nativeFacetPaths();

    emitClaudeNative({ modules: [facet] });

    const hooks = existsSync(paths.hooks) ? JSON.parse(readFileSync(paths.hooks, "utf8")).hooks : {};
    expect(Boolean(hooks.PreToolUse)).toBe(facet === "hooks");
    expect(Boolean(hooks.SessionStart)).toBe(facet === "rules");
    expect(existsSync(paths.script)).toBe(facet === "hooks");
    expect(existsSync(paths.mcp)).toBe(facet === "mcp");
    expect(existsSync(paths.launcher)).toBe(facet === "mcp");
    expect(existsSync(paths.envelope)).toBe(true);
    expect(existsSync(paths.index)).toBe(true);
  });

  it.each(facets)("repairs the requested warm %s facet and preserves its neighbors", (facet) => {
    installFacetFixture();
    emitClaudeNative();
    const paths = nativeFacetPaths();
    const hooksBefore = JSON.parse(readFileSync(paths.hooks, "utf8")).hooks;
    const frozen = [paths.envelope, paths.index, paths.settings];
    if (facet === "hooks") {
      rmSync(paths.script);
      frozen.push(paths.hooks, paths.mcp, paths.launcher);
    } else if (facet === "mcp") {
      rmSync(paths.launcher);
      frozen.push(paths.hooks, paths.script);
    } else {
      writeFileSync(paths.hooks, JSON.stringify({ hooks: { PreToolUse: hooksBefore.PreToolUse } }));
      frozen.push(paths.script, paths.mcp, paths.launcher);
    }
    for (const path of frozen) utimesSync(path, 1, 1);
    const before = observeNativeFiles(frozen);

    emitClaudeNative({ modules: [facet] });

    expect(readFileSync(paths.script, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(JSON.parse(readFileSync(paths.hooks, "utf8")).hooks).toEqual(hooksBefore);
    expect(statSync(paths.launcher).mode & 0o777).toBe(0o755);
    expect(observeNativeFiles(frozen)).toEqual(before);
  });
});

describe("emitClaudeNative", () => {
  it("writes a local marketplace with one plugin, its hooks, and a session-start rules hook", () => {
    install();
    emitClaudeNative();

    const market = JSON.parse(readFileSync(join(marketplaceDir(), ".claude-plugin", "marketplace.json"), "utf-8"));
    expect(market.name).toBe(MARKETPLACE_NAME);
    expect(market.plugins).toEqual([expect.objectContaining({ name: "acme", source: "./plugins/acme" })]);

    const root = join(marketplaceDir(), "plugins", "acme");
    const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf-8"));
    expect(manifest).toMatchObject({ name: "acme" });
    expect(manifest.version).toMatch(/^1\.2\.0\+[0-9a-f]{8}$/);

    const hooks = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf-8")).hooks;
    expect(hooks.PreToolUse[0].matcher).toBe("Bash");
    expect(existsSync(join(root, "hooks", "guard.sh"))).toBe(true);
    expect(JSON.stringify(hooks.SessionStart)).toContain("agentbrew plugin rules --agent claude-code");
  });

  it("enables the plugin in user settings and keeps unrelated keys", () => {
    install();
    emitClaudeNative();
    const s1 = settings();
    s1.theme = "dark";
    writeFileSync(SETTINGS(), JSON.stringify(s1));

    emitClaudeNative();

    const s = settings();
    expect(s.theme).toBe("dark");
    expect(s.extraKnownMarketplaces[MARKETPLACE_NAME].source).toEqual({ source: "directory", path: marketplaceDir() });
    expect(s.enabledPlugins[`acme@${MARKETPLACE_NAME}`]).toBe(true);
  });

  it("removing the plugin removes its native plugin and settings entries on the next emit", () => {
    install();
    emitClaudeNative();
    removePlugin("acme");

    emitClaudeNative();

    expect(existsSync(join(marketplaceDir(), "plugins", "acme"))).toBe(false);
    const s = settings();
    expect(s.enabledPlugins?.[`acme@${MARKETPLACE_NAME}`]).toBeUndefined();
    expect(s.extraKnownMarketplaces?.[MARKETPLACE_NAME]).toBeUndefined();
  });

  it("does nothing (and creates no settings file) when no plugin is installed", () => {
    emitClaudeNative();
    expect(existsSync(SETTINGS())).toBe(false);
  });
});

describe("policyFragment", () => {
  it("allowlists the marketplace and enables the plugin; strict mode adds plugin-only customization", () => {
    install();
    const plain = policyFragment("acme", { strict: false });
    expect(plain.enabledPlugins).toEqual({ [`acme@${MARKETPLACE_NAME}`]: true });
    expect(plain.extraKnownMarketplaces[MARKETPLACE_NAME]).toBeDefined();
    expect(plain.strictKnownMarketplaces).toEqual([plain.extraKnownMarketplaces[MARKETPLACE_NAME].source]);
    expect(plain.strictPluginOnlyCustomization).toBeUndefined();

    const strict = policyFragment("acme", { strict: true });
    expect(strict.strictPluginOnlyCustomization).toBe(true);
    expect(strict.strictKnownMarketplaces).toHaveLength(1);
  });

  it("refuses an unknown plugin", () => {
    expect(() => policyFragment("nope", { strict: false })).toThrow(/not installed/);
  });
});
