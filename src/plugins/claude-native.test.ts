/**
 * Native Claude Code output, step 8 of #208: a local marketplace with one
 * plugin per company plugin, enabled in user settings, side by side with
 * file rendering. Plus `agentbrew plugin policy`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sync as atomicWrite } from "write-file-atomic";

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

vi.mock("./signer-commit-fence.js", async (original) => {
  const signers = await original<typeof import("./signer-commit-fence.js")>();
  return { ...signers, withSignerCommitFence: vi.fn(signers.withSignerCommitFence) };
});

vi.mock("write-file-atomic", async (original) => {
  const atomic = await original<typeof import("write-file-atomic")>();
  return { ...atomic, sync: vi.fn(atomic.sync) };
});

import { readLock } from "../lock.js";
import { fixtureGit, fixtureKey, pluginFixture } from "../test-utils/plugin-fixture.js";
import { emitClaudeNative, MARKETPLACE_NAME, marketplaceDir, policyFragment } from "./claude-native.js";
import { launcherPath } from "./mcp-launcher.js";
import { withNativePublicationLock } from "./native-publication-lock.js";
import { SignerCommitBusyError, withSignerCommitFence } from "./signer-commit-fence.js";
import { allowedSignersPath, revokeSigner, signersFor } from "./signers.js";
import { pluginSourceIdentity } from "./source-identity.js";
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

function installFacetFixture(options: { duplicateServer?: boolean; executableHook?: boolean } = {}): void {
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
    "mcp/servers.yaml": options.duplicateServer ? server.repeat(2) : server,
    "mcp/server.mjs": "process.exitCode = 0;\n",
    "rules/fixture.md": "Synthetic rule.\n",
  });
  const ref = options.executableHook ? "executable-fixture" : "v1.0.0";
  if (options.executableHook) {
    fixtureGit(f.dir, "config", "core.filemode", "true");
    chmodSync(join(f.dir, "hooks", "guard.sh"), 0o755);
    f.release(ref, { "hooks/guard.sh": "#!/bin/sh\nexit 0\n" });
  }
  addPlugin(`${f.dir}@${ref}`, { yes: true, signer: KEY.pub });
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

function nativeProofPath(): string {
  return join(marketplaceDir(), "plugins", "fixture-native", ".agentbrew-native-receipt.json");
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
      expect(() => emitClaudeNative(mode === "full" ? { certifyFullOutput: true } : { modules: ["hooks"] })).toThrow(
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

describe("selected native publication interruption", () => {
  it("preserves the owner record when an error follows a real write", async () => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const owner = join(home, ".agentbrew-native-publication.lock");
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    vi.mocked(atomicWrite).mockImplementationOnce((...args) => {
      atomic.sync(...args);
      throw new Error("Synthetic partial publication failure.");
    });
    try {
      expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/Synthetic partial publication failure/u);
      const previous = observeNativeFiles([files.hooks, owner]);
      expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/native publication is busy/u);
      expect(observeNativeFiles([files.hooks, owner])).toEqual(previous);
      expect(existsSync(files.script)).toBe(false);
      expect(existsSync(files.index)).toBe(false);
      expect(existsSync(files.settings)).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
  });
});

describe("certified full native publication interruption", () => {
  it("preserves the owner and envelope after the first full write fails", async () => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const owner = join(home, ".agentbrew-native-publication.lock");
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    vi.mocked(atomicWrite).mockImplementationOnce((...args) => {
      atomic.sync(...args);
      throw new Error("Synthetic full publication failure.");
    });
    const publish = () => emitClaudeNative({ certifyFullOutput: true });
    try {
      expect(publish).toThrow(/Synthetic full publication failure/u);
      expect(existsSync(files.envelope)).toBe(true);
      expect(existsSync(owner)).toBe(true);
      const previous = observeNativeFiles([files.envelope, owner]);
      expect(publish).toThrow(/native publication is busy/u);
      expect(observeNativeFiles([files.envelope, owner])).toEqual(previous);
      expect(existsSync(files.hooks)).toBe(false);
      expect(existsSync(files.settings)).toBe(false);
      expect(existsSync(nativeProofPath())).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
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

describe("selected native destination commit observation", () => {
  it.each(["script", "index"] as const)("refuses when a planned %s appears before the first write", async (target) => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const actual = await vi.importActual<typeof import("./signer-commit-fence.js")>("./signer-commit-fence.js");
    const planted = "Synthetic file created after planning.\n";
    vi.mocked(withSignerCommitFence).mockImplementationOnce((registry, commit) => {
      mkdirSync(dirname(files[target]), { recursive: true });
      writeFileSync(files[target], planted);
      return actual.withSignerCommitFence(registry, commit);
    });

    expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/destination changed/u);
    expect(readFileSync(files[target], "utf8")).toBe(planted);
    expect(existsSync(files.envelope)).toBe(false);
    expect(existsSync(files.settings)).toBe(false);
    expect(existsSync(files.hooks)).toBe(false);
  });
});

describe("warm retained native commit observation", () => {
  it.each(["mcp", "index"] as const)("refuses when retained $target changes before writes", async (target) => {
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const files = nativeFacetPaths();
    rmSync(files.script);
    const frozen = [files.envelope, files.hooks, files.launcher, files.settings, nativeProofPath()];
    const previous = observeNativeFiles(frozen);
    const actual = await vi.importActual<typeof import("./signer-commit-fence.js")>("./signer-commit-fence.js");
    const changed = "Synthetic retained file changed after planning.\n";
    vi.mocked(withSignerCommitFence).mockImplementationOnce((registry, commit) => {
      writeFileSync(files[target], changed);
      return actual.withSignerCommitFence(registry, commit);
    });

    expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/destination changed/u);
    expect(readFileSync(files[target], "utf8")).toBe(changed);
    expect(existsSync(files.script)).toBe(false);
    expect(observeNativeFiles(frozen)).toEqual(previous);
  });
});

describe("full native output proof", () => {
  const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

  it("records the pinned identity and five independently verified output files", () => {
    installFacetFixture();
    const pin = readLock().plugins?.[0];
    if (!pin) throw new Error("signed fixture pin is missing");

    emitClaudeNative({ certifyFullOutput: true });

    const receipt = JSON.parse(readFileSync(nativeProofPath(), "utf8"));
    const { envelope, hooks, script, mcp, launcher } = nativeFacetPaths();
    const targets = [envelope, hooks, script, mcp, launcher].sort();
    expect(receipt).toEqual({
      schema: 1,
      sourceDigest: digest(JSON.stringify(pluginSourceIdentity(pin))),
      files: targets.map((path) => ({
        path: relative(home, path),
        mode: statSync(path).mode & 0o777,
        digest: digest(readFileSync(path)),
      })),
    });
    expect(statSync(nativeProofPath()).mode & 0o777).toBe(0o600);
    expect(settings().enabledPlugins).toEqual({ "fixture-native@agentbrew-plugins": true });
  });

  it("preserves an explicitly disabled plugin during full certification", () => {
    installFacetFixture();
    const existing = {
      enabledPlugins: { "fixture-native@agentbrew-plugins": false, "other@owner": true },
      extraKnownMarketplaces: { owner: { source: { source: "directory", path: "fixture-owner" } } },
      ownerSetting: ["keep"],
    };
    mkdirSync(dirname(SETTINGS()), { recursive: true });
    writeFileSync(SETTINGS(), JSON.stringify(existing));

    emitClaudeNative({ certifyFullOutput: true });

    expect(settings()).toEqual({
      ...existing,
      extraKnownMarketplaces: {
        ...existing.extraKnownMarketplaces,
        "agentbrew-plugins": { source: { source: "directory", path: marketplaceDir() } },
      },
    });
    expect(existsSync(nativeProofPath())).toBe(true);
  });

  it("holds the signer lock during the certified settings write", async () => {
    installFacetFixture();
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    const statuses: number[] = [];
    const registryAvailable = () => withSignerCommitFence(allowedSignersPath(), () => 0);
    vi.mocked(atomicWrite).mockImplementation((...args) => {
      if (args[0] === SETTINGS()) {
        try {
          statuses.push(registryAvailable());
        } catch (error) {
          if (!(error instanceof SignerCommitBusyError)) throw error;
          statuses.push(error.exitCode);
        }
      }
      return atomic.sync(...args);
    });

    try {
      emitClaudeNative({ certifyFullOutput: true });
      expect(statuses).toEqual([75]);
      expect(registryAvailable()).toBe(0);
      expect(existsSync(nativeProofPath())).toBe(true);
    } finally {
      vi.mocked(atomicWrite).mockImplementation(atomic.sync);
    }
  });

  it("leaves the ordinary full writer on its current output path", () => {
    installFacetFixture();

    emitClaudeNative();

    expect(existsSync(nativeFacetPaths().hooks)).toBe(true);
    expect(existsSync(nativeProofPath())).toBe(false);
  });

  it("refuses to certify an extra native file from the working copy", () => {
    installFacetFixture();
    const source = pluginDir("fixture-native");
    appendFileSync(join(source, ".git", "info", "exclude"), "\n/hooks/certification-note.txt\n");
    writeFileSync(join(source, "hooks", "certification-note.txt"), "Synthetic local note.\n");
    mkdirSync(dirname(SETTINGS()), { recursive: true });
    const previousSettings = '{ "ownerSetting": ["keep"] }\n';
    writeFileSync(SETTINGS(), previousSettings);

    const owner = join(home, ".agentbrew-native-publication.lock");
    try {
      expect(() => emitClaudeNative({ certifyFullOutput: true })).toThrow(/full native output inventory differs/u);
      expect(readFileSync(SETTINGS(), "utf8")).toBe(previousSettings);
      expect(existsSync(nativeProofPath())).toBe(false);
      expect(existsSync(owner)).toBe(true);
    } finally {
      rmSync(owner, { force: true });
    }
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
    emitClaudeNative({ certifyFullOutput: true });
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
    installFacetFixture({ duplicateServer: true });
    emitClaudeNative();
    const before = observeNativeFiles(Object.values(nativeFacetPaths()));

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/native output paths overlap/u);
    expect(observeNativeFiles(Object.values(nativeFacetPaths()))).toEqual(before);
  });

  it("refuses duplicate marketplace identities without changing existing files", () => {
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const paths = nativeFacetPaths();
    const registry = JSON.parse(readFileSync(paths.index, "utf8"));
    registry.plugins.push(registry.plugins[0]);
    writeFileSync(paths.index, JSON.stringify(registry));
    const before = observeNativeFiles(Object.values(paths));

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/marketplace identities overlap/u);
    expect(observeNativeFiles(Object.values(paths))).toEqual(before);
  });

  it.each(["direct", "physical-alias", "unrelated"] as const)("preserves a retained launcher reference: %s", (kind) => {
    const overlap = kind !== "unrelated";
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const paths = nativeFacetPaths();
    const retainedRoot = join(marketplaceDir(), "plugins", "fixture-retained");
    const retainedConfig = join(retainedRoot, ".mcp.json");
    const otherCommand = launcherPath("fixture-retained", "other");
    let command = overlap ? paths.launcher : otherCommand;
    mkdirSync(retainedRoot, { recursive: true });
    if (kind === "physical-alias") {
      const alias = join(retainedRoot, "launcher-directory");
      symlinkSync(dirname(paths.launcher), alias, "dir");
      command = join(alias, basename(paths.launcher));
    }
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

  it("leaves a differently spelled warm hook file unchanged", () => {
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const paths = nativeFacetPaths();
    const folder = dirname(paths.hooks);
    const intermediate = join(folder, "fixture-intermediate.json");
    const alternate = join(folder, "HOOKS.JSON");
    renameSync(paths.hooks, intermediate);
    renameSync(intermediate, alternate);
    const before = observeNativeFiles([alternate, paths.script, paths.mcp, paths.index, paths.settings]);

    expect(() => emitClaudeNative({ modules: ["rules"] })).toThrow(/destination spelling is unknown/u);
    expect(readdirSync(folder).sort()).toEqual(["HOOKS.JSON", "guard.sh"]);
    expect(observeNativeFiles([alternate, paths.script, paths.mcp, paths.index, paths.settings])).toEqual(before);
  });

  it("preserves unknown warm hook metadata on refusal", () => {
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const paths = nativeFacetPaths();
    const { PreToolUse } = JSON.parse(readFileSync(paths.hooks, "utf8")).hooks;
    writeFileSync(paths.hooks, JSON.stringify({ hooks: { PreToolUse }, ownerNote: "Synthetic owner note." }));
    const before = observeNativeFiles(Object.values(paths));

    expect(() => emitClaudeNative({ modules: ["rules"] })).toThrow(/unknown hook metadata/u);
    expect(observeNativeFiles(Object.values(paths))).toEqual(before);
  });
});

describe("cold native receipt coverage", () => {
  const selections = [
    { facets: ["hooks"], files: ["hooks", "script"] },
    { facets: ["mcp"], files: ["mcp", "launcher"] },
    { facets: ["rules"], files: ["hooks"] },
    { facets: ["hooks", "rules"], files: ["hooks", "script"] },
  ] as const;

  it.each(selections)("records only the selected cold $facets files", ({ facets, files }) => {
    installFacetFixture();
    const paths = nativeFacetPaths();

    emitClaudeNative({ modules: facets });

    const receipt = nativeProofPath();
    const entry = readLock().plugins?.[0];
    if (!entry) throw new Error("Synthetic source pin is missing");
    const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
    expect(statSync(receipt).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
      schema: 2,
      facets,
      sourceDigest: digest(JSON.stringify(pluginSourceIdentity(entry))),
      files: (["envelope", ...files] as const)
        .map((name) => paths[name])
        .sort()
        .map((path) => ({
          path: relative(home, path),
          mode: statSync(path).mode & 0o777,
          digest: digest(readFileSync(path)),
        })),
    });
    expect(existsSync(paths.settings)).toBe(false);
  });
});

describe("cold native launcher ownership", () => {
  it("refuses to certify a matching launcher with no verified native owner", () => {
    installFacetFixture();
    const paths = nativeFacetPaths();
    emitClaudeNative({ modules: ["mcp"] });
    rmSync(marketplaceDir(), { recursive: true, force: true });
    const previous = observeNativeFiles([paths.launcher]);

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/native receipt.*selected output plan/u);
    expect(observeNativeFiles([paths.launcher])).toEqual(previous);
    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(paths.settings)).toBe(false);
  });
});

describe("partial native receipt progression", () => {
  const sequences = [
    { first: "hooks", next: "mcp", retained: ["hooks", "script"] },
    { first: "mcp", next: "hooks", retained: ["mcp", "launcher"] },
    { first: "hooks", next: "rules", retained: ["script"] },
  ] as const;

  it.each(sequences)("extends $first coverage with $next", ({ first, next, retained }) => {
    installFacetFixture();
    const paths = nativeFacetPaths();
    emitClaudeNative({ modules: [first] });
    const receipt = nativeProofPath();
    const original = JSON.parse(readFileSync(receipt, "utf8"));
    const frozen = [paths.envelope, paths.index, ...retained.map((name) => paths[name])];
    for (const path of frozen) utimesSync(path, 1, 1);
    const previous = observeNativeFiles(frozen);

    emitClaudeNative({ modules: [next] });

    const updated = JSON.parse(readFileSync(receipt, "utf8"));
    expect(updated).toMatchObject({ schema: 2, facets: [first, next].sort(), sourceDigest: original.sourceDigest });
    expect(observeNativeFiles(frozen)).toEqual(previous);
    const slotted =
      next === "rules" ? [paths.hooks, paths.script] : [paths.hooks, paths.script, paths.mcp, paths.launcher];
    const expected = [paths.envelope, ...slotted].map((path) => relative(home, path)).sort();
    expect(updated.files.map(({ path }: { path: string }) => path)).toEqual(expected);
    expect(existsSync(paths.settings)).toBe(false);
  });

  it("refuses to extend coverage when an unselected signed payload changed", () => {
    installFacetFixture();
    const paths = nativeFacetPaths();
    emitClaudeNative({ modules: ["hooks"] });
    const receipt = nativeProofPath();
    writeFileSync(paths.script, "Synthetic edited retained payload.\n");
    const previous = observeNativeFiles([paths.hooks, paths.script, paths.envelope, paths.index, receipt]);

    expect(() => emitClaudeNative({ modules: ["mcp"] })).toThrow(/native receipt/u);
    expect(observeNativeFiles([paths.hooks, paths.script, paths.envelope, paths.index, receipt])).toEqual(previous);
    expect(existsSync(paths.launcher)).toBe(false);
    expect(existsSync(paths.settings)).toBe(false);
  });
});

describe("partial native receipt repair", () => {
  const repairs = [
    { facet: "hooks", asset: "script" },
    { facet: "mcp", asset: "launcher" },
    { facet: "rules", asset: "hooks" },
  ] as const;

  it.each(repairs)("restores a missing $asset without changing the $facet receipt", ({ facet, asset }) => {
    installFacetFixture();
    const paths = nativeFacetPaths();
    emitClaudeNative({ modules: [facet] });
    const frozen = [paths.index, paths.envelope, nativeProofPath()];
    const previous = observeNativeFiles(frozen);
    const missing = paths[asset];
    const content = readFileSync(missing);
    const mode = statSync(missing).mode;
    rmSync(missing);

    emitClaudeNative({ modules: [facet] });

    expect(readFileSync(missing)).toEqual(content);
    expect(statSync(missing).mode).toBe(mode);
    expect(observeNativeFiles(frozen)).toEqual(previous);
    expect(existsSync(paths.settings)).toBe(false);
  });
});

describe("signed native executable mode", () => {
  it("keeps a signed executable hook mode through partial receipt repair", () => {
    installFacetFixture({ executableHook: true });
    const entry = readLock().plugins?.[0];
    if (!entry) throw new Error("Synthetic source pin is missing");
    expect(fixtureGit(pluginDir("fixture-native"), "ls-tree", entry.commit, "hooks/guard.sh")).toMatch(/^100755 /u);
    const { script } = nativeFacetPaths();
    const receipt = nativeProofPath();

    emitClaudeNative({ modules: ["hooks"] });
    const proof = observeNativeFiles([receipt]);
    expect(statSync(script).mode & 0o777).toBe(0o755);
    rmSync(script);
    emitClaudeNative({ modules: ["hooks"] });

    expect(statSync(script).mode & 0o777).toBe(0o755);
    expect(observeNativeFiles([receipt])).toEqual(proof);
  });
});

describe("warm native receipt admission", () => {
  it.each([
    "missing",
    "wrong-source",
    "edited-unselected",
    "omitted-launcher",
  ] as const)("refuses a %s receipt condition", (condition) => {
    installFacetFixture();
    emitClaudeNative({ certifyFullOutput: true });
    const files = nativeFacetPaths();
    const receipt = nativeProofPath();
    rmSync(files.script);
    if (condition === "missing") {
      rmSync(receipt);
    } else if (condition === "wrong-source") {
      const body = JSON.parse(readFileSync(receipt, "utf8"));
      body.sourceDigest = "0".repeat(64);
      writeFileSync(receipt, JSON.stringify(body), { mode: 0o600 });
    } else if (condition === "omitted-launcher") {
      const body = JSON.parse(readFileSync(receipt, "utf8"));
      body.files = body.files.filter(({ path }: { path: string }) => path !== relative(home, files.launcher));
      writeFileSync(receipt, JSON.stringify(body), { mode: 0o600 });
      rmSync(files.launcher);
    } else {
      writeFileSync(files.mcp, "Synthetic changed unselected bytes.\n");
    }
    const frozen = [
      files.hooks,
      files.envelope,
      files.mcp,
      files.launcher,
      files.index,
      files.settings,
      receipt,
    ].filter(existsSync);
    const before = observeNativeFiles(frozen);

    expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/native receipt/u);
    expect(existsSync(files.script)).toBe(false);
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
