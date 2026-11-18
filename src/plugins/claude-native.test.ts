/**
 * Native Claude Code output, step 8 of #208: a local marketplace with one
 * plugin per company plugin, enabled in user settings, side by side with
 * file rendering. Plus `agentbrew plugin policy`.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

vi.mock("./store.js", async (original) => {
  const store = await original<typeof import("./store.js")>();
  return { ...store, readPinnedPluginFiles: vi.fn(store.readPinnedPluginFiles) };
});

import { fixtureKey, pluginFixture } from "../test-utils/plugin-fixture.js";
import { emitClaudeNative, MARKETPLACE_NAME, marketplaceDir, policyFragment } from "./claude-native.js";
import { launcherPath } from "./mcp-launcher.js";
import { withNativePublicationLock } from "./native-publication-lock.js";
import { withSignerCommitFence } from "./signer-commit-fence.js";
import { allowedSignersPath, revokeSigner, signersFor } from "./signers.js";
import { addPlugin, pluginDir, readPinnedPluginFiles, removePlugin } from "./store.js";

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

function installFacetFixture(duplicateServer = false): void {
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
  const server = "- name: fixture-server\n  command: node\n  args: [server.mjs]\n";
  f.release("v1.0.0", {
    "hooks/hooks.json": HOOKS,
    "hooks/guard.sh": "#!/bin/sh\nexit 0\n",
    "mcp/servers.yaml": duplicateServer ? server.repeat(2) : server,
    "mcp/server.mjs": "process.exitCode = 0;\n",
    "rules/fixture.md": "Synthetic rule.\n",
  });
  addPlugin(`${f.dir}@v1.0.0`, { yes: true, signer: KEY.pub });
}

function installCustomHooks(auxiliaryPath: string): void {
  const f = pluginFixture({
    schema: 1,
    name: "fixture-native",
    version: "1.0.0",
    capabilities: { agents: ["claude"], hooks: ["PreToolUse:Bash"] },
    contributes: { hooks: "hooks/definition.json" },
  });
  f.release("v1", {
    "hooks/definition.json": HOOKS,
    "hooks/guard.sh": "#!/bin/sh\nexit 0\n",
    [auxiliaryPath]: "Synthetic helper note.\n",
  });
  addPlugin(`${f.dir}@v1`, { yes: true, signer: KEY.pub });
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

describe("native publisher admission", () => {
  const owner = join(home, ".agentbrew-native-publication.lock");

  it.each(["full", "selected"] as const)("refuses %s publication while an owner record exists", (mode) => {
    installFacetFixture();
    writeFileSync(owner, "Synthetic held record.\n", { mode: 0o600 });
    const before = observeNativeFiles([owner]);
    try {
      expect(() => emitClaudeNative(mode === "full" ? undefined : { modules: ["hooks"] })).toThrow(
        /native publication is busy/u,
      );
      expect(observeNativeFiles([owner])).toEqual(before);
      expect(existsSync(marketplaceDir())).toBe(false);
      expect(existsSync(SETTINGS())).toBe(false);
    } finally {
      rmSync(owner);
    }
  });

  function attemptPublication(interrupt = false) {
    const moduleUrl = new URL("./native-publication-lock.ts", import.meta.url).href;
    const source = `
      import { withNativePublicationLock } from ${JSON.stringify(moduleUrl)};
      try {
        withNativePublicationLock(() => {
          if (${interrupt}) process.exit(77);
          process.stdout.write("published");
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("publication is busy")) throw error;
        process.exitCode = 75;
      }
    `;
    return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, HOME: home, TSX_DISABLE_CACHE: "1" },
    });
  }

  it("refuses a separate process during ownership and admits it after release", () => {
    withNativePublicationLock(() => {
      const before = observeNativeFiles([owner]);
      expect(attemptPublication()).toMatchObject({ status: 75, stdout: "", stderr: "" });
      expect(observeNativeFiles([owner])).toEqual(before);
    });

    expect(attemptPublication()).toMatchObject({ status: 0, stdout: "published", stderr: "" });
    expect(existsSync(owner)).toBe(false);
  });

  it("retains an interrupted process's record and refuses entry", () => {
    expect(attemptPublication(true)).toMatchObject({ status: 77, stdout: "", stderr: "" });
    try {
      const before = observeNativeFiles([owner]);
      expect(attemptPublication()).toMatchObject({ status: 75, stdout: "", stderr: "" });
      expect(observeNativeFiles([owner])).toEqual(before);
    } finally {
      rmSync(owner);
    }
  });

  it("releases the acquired record after success and a plan refusal", () => {
    installFacetFixture();
    emitClaudeNative();
    expect(existsSync(owner)).toBe(false);

    const { hooks } = nativeFacetPaths();
    writeFileSync(hooks, JSON.stringify({ hooks: {}, ownerNote: "Synthetic note." }));
    expect(() => emitClaudeNative({ modules: ["rules"] })).toThrow(/unknown hook metadata/u);
    expect(existsSync(owner)).toBe(false);
  });
});

describe("selected native signer commit fence", () => {
  it("refuses selected publication while another signer write holds the fence", () => {
    installFacetFixture();
    withSignerCommitFence(allowedSignersPath(), () => {
      expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/registry is busy/u);
      expect(existsSync(marketplaceDir())).toBe(false);
      expect(existsSync(SETTINGS())).toBe(false);
    });
  });

  it("refuses a signer revoked after the first pinned read", async () => {
    installFacetFixture();
    const store = await vi.importActual<typeof import("./store.js")>("./store.js");
    vi.mocked(readPinnedPluginFiles).mockImplementationOnce((entry, path) => {
      const pinned = store.readPinnedPluginFiles(entry, path);
      revokeSigner("fixture-native", KEY.pub);
      return pinned;
    });

    expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/signer trust changed/u);
    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(SETTINGS())).toBe(false);
    expect(signersFor("fixture-native")).toEqual([]);
  });
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

  it.each(["mcp", "rules"] as const)("skips a cold plugin without the requested %s facet", (facet) => {
    install();

    emitClaudeNative({ modules: [facet] });

    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(launcherPath("acme", "fixture-server"))).toBe(false);
    expect(existsSync(SETTINGS())).toBe(false);
  });

  it("refuses duplicate launcher claims even when the existing file matches", () => {
    installFacetFixture(true);
    emitClaudeNative();
    const before = observeNativeFiles(Object.values(nativeFacetPaths()));

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/native output paths overlap/u);
    expect(observeNativeFiles(Object.values(nativeFacetPaths()))).toEqual(before);
  });

  it("refuses duplicate marketplace identities without changing existing files", () => {
    installFacetFixture();
    emitClaudeNative();
    const paths = nativeFacetPaths();
    const registry = JSON.parse(readFileSync(paths.index, "utf8"));
    registry.plugins.push(registry.plugins[0]);
    writeFileSync(paths.index, JSON.stringify(registry));
    const before = observeNativeFiles(Object.values(paths));

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/marketplace identities overlap/u);
    expect(observeNativeFiles(Object.values(paths))).toEqual(before);
  });

  it.each([true, false])("preserves a retained launcher reference (overlap: %s)", (overlap) => {
    installFacetFixture();
    emitClaudeNative();
    const paths = nativeFacetPaths();
    const retainedRoot = join(marketplaceDir(), "plugins", "fixture-retained");
    const retainedConfig = join(retainedRoot, ".mcp.json");
    const otherCommand = launcherPath("fixture-retained", "other");
    const command = overlap ? paths.launcher : otherCommand;
    mkdirSync(retainedRoot, { recursive: true });
    writeFileSync(retainedConfig, JSON.stringify({ mcpServers: { retained: { command, args: [] } } }));
    if (!overlap) writeFileSync(otherCommand, "Synthetic retained output.\n");
    const registry = JSON.parse(readFileSync(paths.index, "utf8"));
    registry.plugins.push({
      name: "fixture-retained",
      source: "./plugins/fixture-retained",
      version: "1.0.0+abcd1234",
      description: "Synthetic retained plugin",
    });
    writeFileSync(paths.index, JSON.stringify(registry));
    rmSync(paths.mcp);
    const frozen = [paths.index, paths.hooks, paths.script, paths.launcher, paths.settings, retainedConfig];
    if (!overlap) frozen.push(otherCommand);
    const before = observeNativeFiles(frozen);

    if (overlap) {
      expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/native output paths overlap/u);
      expect(existsSync(paths.mcp)).toBe(false);
    } else {
      emitClaudeNative({ modules: ["mcp"] });
      expect(existsSync(paths.mcp)).toBe(true);
    }
    expect(observeNativeFiles(frozen)).toEqual(before);
  });

  it.each(["hooks/Hooks.json", "hooks/HOOKS.JSON/note.md"])("refuses a hook alias at %s", (source) => {
    installCustomHooks(source);

    expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/native hook output paths overlap/u);
    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(SETTINGS())).toBe(false);
  });

  it("publishes a valid nested file under the signed hook directory", () => {
    installCustomHooks("hooks/helper/note.md");

    emitClaudeNative({ modules: ["hooks"] });

    const { hooks } = nativeFacetPaths();
    expect(readFileSync(join(hooks, "../helper/note.md"), "utf8")).toBe("Synthetic helper note.\n");
    expect(JSON.parse(readFileSync(hooks, "utf8")).hooks.PreToolUse).toBeDefined();
  });

  it("copies signed hook files and skips an ignored local text file", () => {
    installFacetFixture();
    const source = pluginDir("fixture-native");
    appendFileSync(join(source, ".git", "info", "exclude"), "\n/hooks/local-notes.txt\n");
    writeFileSync(join(source, "hooks", "local-notes.txt"), "Synthetic local note.\n");

    emitClaudeNative({ modules: ["hooks"] });

    const paths = nativeFacetPaths();
    expect(readFileSync(paths.script, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(existsSync(join(marketplaceDir(), "plugins", "fixture-native", "hooks", "local-notes.txt"))).toBe(false);
  });

  it("preserves unknown warm hook metadata on refusal", () => {
    installFacetFixture();
    emitClaudeNative();
    const paths = nativeFacetPaths();
    const { PreToolUse } = JSON.parse(readFileSync(paths.hooks, "utf8")).hooks;
    writeFileSync(paths.hooks, JSON.stringify({ hooks: { PreToolUse }, ownerNote: "Synthetic owner note." }));
    const before = observeNativeFiles(Object.values(paths));

    expect(() => emitClaudeNative({ modules: ["rules"] })).toThrow(/unknown hook metadata/u);
    expect(observeNativeFiles(Object.values(paths))).toEqual(before);
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
