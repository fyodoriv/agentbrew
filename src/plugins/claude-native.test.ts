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
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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

import { readLock, writeLock } from "../lock.js";
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

describe("selected native publication write intent", () => {
  it.each(["cold", "warm"] as const)("records the complete %s file plan before writing", async (state) => {
    installFacetFixture();
    const files = nativeFacetPaths();
    if (state === "warm") emitClaudeNative({ modules: ["hooks"] });
    const owner = join(home, ".agentbrew-native-publication.lock");
    const targets =
      state === "cold"
        ? [files.hooks, files.script, files.envelope, nativeProofPath(), files.index]
        : [files.hooks, nativeProofPath()];
    const fileState = (path: string) =>
      existsSync(path)
        ? {
            digest: createHash("sha256").update(readFileSync(path)).digest("hex"),
            mode: statSync(path).mode & 0o777,
          }
        : null;
    const before = targets.map(fileState);
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    let record: unknown;
    vi.mocked(atomicWrite).mockImplementationOnce((...args) => {
      expect(statSync(owner).mode & 0o777).toBe(0o600);
      expect(targets.map(fileState)).toEqual(before);
      record = JSON.parse(readFileSync(owner, "utf8")).intent;
      atomic.sync(...args);
    });

    emitClaudeNative({ modules: state === "cold" ? ["hooks"] : ["rules"] });

    expect(record).toEqual(
      targets.map((path, index) => ({
        path: relative(home, path),
        before: before[index],
        after: fileState(path),
      })),
    );
    expect(JSON.stringify(record)).not.toContain(home);
    for (const path of targets) {
      expect(atomicWrite).toHaveBeenCalledWith(path, expect.any(Buffer), { mode: fileState(path)?.mode });
    }
    expect(existsSync(owner)).toBe(false);
    expect(existsSync(files.settings)).toBe(false);
  });
});

it("refuses special file permissions before warming a selected facet", () => {
  installFacetFixture();
  emitClaudeNative({ modules: ["hooks"] });
  const files = nativeFacetPaths();
  chmodSync(files.hooks, 0o1644);
  expect(statSync(files.hooks).mode & 0o7777).toBe(0o1644);
  const before = observeNativeFiles([files.hooks, nativeProofPath(), files.index]);
  expect(() => emitClaudeNative({ modules: ["rules"] })).toThrow(/native intent file mode is unknown/u);
  expect(observeNativeFiles([files.hooks, nativeProofPath(), files.index])).toEqual(before);
  expect(existsSync(join(home, ".agentbrew-native-publication.lock"))).toBe(false);
});

it("refuses an unbounded publication intent before leaving recovery state", () => {
  const owner = join(home, ".agentbrew-native-publication.lock");
  const row = { path: "fixture.json", before: null, after: { digest: "0".repeat(64), mode: 0o600 } };
  const plans = [[], Array.from({ length: 1025 }, () => row), [{ ...row, path: "x".repeat(256 * 1024) }]];
  for (const plan of plans) {
    expect(() => withNativePublicationLock((begin) => begin(plan))).toThrow(/outside its admitted bounds/u);
    expect(existsSync(owner)).toBe(false);
  }
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
      const record = JSON.parse(readFileSync(owner, "utf8"));
      expect(record.intent).toHaveLength(5);
      expect(record.intent[0]).toEqual({
        path: relative(home, files.hooks),
        before: null,
        after: {
          digest: createHash("sha256").update(readFileSync(files.hooks)).digest("hex"),
          mode: statSync(files.hooks).mode & 0o777,
        },
      });
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

  it.each(["script", "envelope"] as const)("refuses a later %s edit after the first native write", async (kind) => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const target = files[kind];
    const owner = join(home, ".agentbrew-native-publication.lock");
    const edit = "Synthetic owner edit.\n";
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    vi.mocked(atomicWrite).mockClear();
    vi.mocked(atomicWrite).mockImplementationOnce((...args) => {
      expect(args[0]).toBe(files.hooks);
      atomic.sync(...args);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, edit);
    });
    const publish = () => emitClaudeNative({ modules: ["hooks"] });
    try {
      expect(publish).toThrow(/a planned native destination changed after review/u);
      expect(readFileSync(target, "utf8")).toBe(edit);
      expect(statSync(owner).mode & 0o777).toBe(0o600);
      const record = JSON.parse(readFileSync(owner, "utf8"));
      expect(record.intent).toHaveLength(5);
      expect(record.intent).toContainEqual({
        path: relative(home, target),
        before: null,
        after: { digest: expect.any(String), mode: expect.any(Number) },
      });
      expect(existsSync(nativeProofPath())).toBe(false);
      expect(existsSync(files.index)).toBe(false);
      expect(atomicWrite).toHaveBeenCalledTimes(kind === "script" ? 1 : 2);
      const beforeRetry = observeNativeFiles([owner, target, files.hooks]);
      vi.mocked(atomicWrite).mockClear();
      expect(publish).toThrow(/native publication is busy/u);
      expect(atomicWrite).not.toHaveBeenCalled();
      expect(observeNativeFiles([owner, target, files.hooks])).toEqual(beforeRetry);
      expect(existsSync(files.index)).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it("keeps the intent when the last native file no longer matches it", async () => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const owner = join(home, ".agentbrew-native-publication.lock");
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    vi.mocked(atomicWrite).mockImplementation((...args) => {
      atomic.sync(...args);
      if (args[0] === files.index) writeFileSync(files.index, "Synthetic concurrent edit.\n");
    });
    try {
      expect(() => emitClaudeNative({ modules: ["hooks"] })).toThrow(/full native output bytes differ/u);
      const record = JSON.parse(readFileSync(owner, "utf8"));
      expect(record.intent).toHaveLength(5);
      expect(record.intent.at(-1).path).toBe(relative(home, files.index));
      expect(readFileSync(files.index, "utf8")).toBe("Synthetic concurrent edit.\n");
    } finally {
      vi.mocked(atomicWrite).mockImplementation(atomic.sync);
      rmSync(owner, { force: true });
    }
  });
});

describe("native publication process loss at output checkpoints", () => {
  const owner = join(home, ".agentbrew-native-publication.lock");

  function snapshot(path: string): unknown {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info) return null;
    if (info.isDirectory()) {
      return [
        info.mode,
        readdirSync(path)
          .sort()
          .map((name) => [name, snapshot(join(path, name))]),
      ];
    }
    if (info.isSymbolicLink()) return [info.mode, readlinkSync(path)];
    return [info.mode, createHash("sha256").update(readFileSync(path)).digest("hex")];
  }

  function publishFromChild(full: boolean, checkpoint?: string, mask = 0o022) {
    const moduleUrl = new URL("./claude-native.ts", import.meta.url).href;
    const source = `
      import { createRequire } from "node:module";
      process.umask(${mask});
      const atomic = createRequire(import.meta.url)("write-file-atomic");
      const write = atomic.sync;
      const checkpoint = ${JSON.stringify(checkpoint ?? null)};
      atomic.sync = (path, ...args) => {
        if (path === checkpoint) process.exit(77);
        return write(path, ...args);
      };
      const { emitClaudeNative } = await import(${JSON.stringify(moduleUrl)});
      try {
        emitClaudeNative(${JSON.stringify(full ? { certifyFullOutput: true } : { modules: ["hooks"] })});
        process.stdout.write("published");
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("publication is busy")) throw error;
        process.exitCode = 75;
      }
    `;
    return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, HOME: home, TSX_DISABLE_CACHE: "1" },
    });
  }

  it("refuses a busy signer before writing certified full output", () => {
    installFacetFixture();
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), 0o644);
    const paths = nativeFacetPaths();
    const roots = [marketplaceDir(), dirname(paths.launcher), dirname(paths.settings), owner];
    const before = roots.map(snapshot);
    try {
      withSignerCommitFence(allowedSignersPath(), () => {
        const busy = publishFromChild(true);
        expect(busy.status).toBe(1);
        expect(busy.stderr).toMatch(/signer registry is busy/u);
        expect(roots.map(snapshot)).toEqual(before);
      });
      expect(publishFromChild(true)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      expect(existsSync(paths.hooks)).toBe(true);
      expect(existsSync(paths.index)).toBe(true);
      expect(existsSync(paths.settings)).toBe(true);
      expect(existsSync(nativeProofPath())).toBe(true);
      expect(existsSync(owner)).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it.each([
    ["publisher mask", 0o077, 0o644],
    ["installed mode", 0o022, 0o600],
  ] as const)("checks the %s against native copy behavior", (_name, mask, mode) => {
    installFacetFixture();
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), mode);
    const paths = nativeFacetPaths();
    const roots = [marketplaceDir(), dirname(paths.launcher), dirname(paths.settings), owner];
    const before = roots.map(snapshot);
    try {
      const result = publishFromChild(true, undefined, mask);
      if (mask === 0o077) {
        expect(result).toMatchObject({ status: 0, stdout: "published", stderr: "" });
        const expectedMode = process.platform === "darwin" ? 0o600 : 0o644;
        expect(statSync(paths.script).mode & 0o777).toBe(expectedMode);
        const proof = JSON.parse(readFileSync(nativeProofPath(), "utf8"));
        expect(proof.files.find((file: { path: string }) => file.path.endsWith("/hooks/guard.sh")).mode).toBe(
          expectedMode,
        );
        expect(existsSync(paths.settings)).toBe(true);
        expect(existsSync(owner)).toBe(false);
        return;
      }
      expect(result.status).toBe(1);
      expect(roots.map(snapshot)).toEqual(before);
      expect(result.stderr).toMatch(/signed hook copy mode cannot be reproduced/u);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it.skipIf(process.platform !== "darwin")("keeps the certified private hook mode during a later repair", () => {
    installFacetFixture();
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), 0o644);
    const paths = nativeFacetPaths();
    try {
      expect(publishFromChild(true, undefined, 0o077)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      const fixed = [paths.hooks, paths.index, paths.settings, nativeProofPath()];
      const before = observeNativeFiles(fixed);
      expect(statSync(paths.script).mode & 0o777).toBe(0o600);
      rmSync(paths.script);
      expect(publishFromChild(false, undefined, 0o022)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      expect(statSync(paths.script).mode & 0o777).toBe(0o600);
      expect(readFileSync(paths.script, "utf8")).toBe("#!/bin/sh\nexit 0\n");
      expect(observeNativeFiles(fixed)).toEqual(before);
      expect(existsSync(owner)).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it.skipIf(process.platform !== "darwin")("keeps the private mode from a cold selected receipt", () => {
    installFacetFixture();
    const paths = nativeFacetPaths();
    try {
      expect(publishFromChild(false, undefined, 0o077)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      const proof = readFileSync(nativeProofPath(), "utf8");
      expect(JSON.parse(proof)).toMatchObject({ schema: 2, hookCopyMask: 0o055 });
      expect(statSync(paths.script).mode & 0o777).toBe(0o600);
      expect(existsSync(paths.settings)).toBe(false);
      rmSync(paths.script);
      expect(publishFromChild(false, undefined, 0o022)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      expect(statSync(paths.script).mode & 0o777).toBe(0o600);
      expect(readFileSync(nativeProofPath(), "utf8")).toBe(proof);
      expect(existsSync(paths.settings)).toBe(false);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it("refuses a receipt mask that would remove signed owner permissions", () => {
    installFacetFixture();
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), 0o644);
    const paths = nativeFacetPaths();
    try {
      expect(publishFromChild(true)).toMatchObject({ status: 0, stdout: "published", stderr: "" });
      const proof = JSON.parse(readFileSync(nativeProofPath(), "utf8"));
      expect(proof).not.toHaveProperty("hookCopyMask");
      writeFileSync(nativeProofPath(), JSON.stringify({ ...proof, hookCopyMask: 0o400 }));
      rmSync(paths.script);
      const roots = [marketplaceDir(), dirname(paths.launcher), dirname(paths.settings), owner];
      const before = roots.map(snapshot);
      const result = publishFromChild(false);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/invalid hook copy mask/u);
      expect(roots.map(snapshot)).toEqual(before);
    } finally {
      rmSync(owner, { force: true });
    }
  });

  it.each([
    ["payload", "hooks", false, 0],
    ["output receipt", "receipt", false, 3],
    ["marketplace index", "index", false, 4],
    ["activation settings", "settings", true, null],
  ] as const)("preserves the partial output before %s across a process restart", (_name, key, full, written) => {
    installFacetFixture();
    // The signed fixture uses 0644 even when the local queue applies umask 077.
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), 0o644);
    const paths = nativeFacetPaths();
    const receipt = nativeProofPath();
    const target = key === "receipt" ? receipt : paths[key];
    try {
      expect(publishFromChild(full, target)).toMatchObject({ status: 77, stdout: "", stderr: "" });
      expect(existsSync(target)).toBe(false);
      expect(existsSync(paths.hooks)).toBe(key !== "hooks");
      expect(existsSync(paths.script)).toBe(key !== "hooks");
      expect(existsSync(receipt)).toBe(key === "index" || full);
      expect(existsSync(paths.index)).toBe(full);
      expect(existsSync(paths.settings)).toBe(false);
      const ownerInfo = lstatSync(owner);
      expect(ownerInfo.isFile()).toBe(true);
      expect(ownerInfo.mode & 0o777).toBe(0o600);
      const record = JSON.parse(readFileSync(owner, "utf8"));
      expect(record).toMatchObject({ pid: expect.any(Number), token: expect.any(String) });
      if (written === null) {
        expect(record).not.toHaveProperty("intent");
      } else {
        const plannedPaths = [paths.hooks, paths.script, paths.envelope, receipt, paths.index];
        expect(record.intent).toEqual(
          plannedPaths.map((path, position) => {
            const observed = lstatSync(path, { throwIfNoEntry: false });
            if (position >= written) {
              expect(observed).toBeUndefined();
              return {
                path: relative(home, path),
                before: null,
                after: { digest: expect.stringMatching(/^[0-9a-f]{64}$/u), mode: path === receipt ? 0o600 : 0o644 },
              };
            }
            expect(observed?.isFile()).toBe(true);
            return {
              path: relative(home, path),
              before: null,
              after: {
                digest: createHash("sha256").update(readFileSync(path)).digest("hex"),
                mode: statSync(path).mode & 0o777,
              },
            };
          }),
        );
      }
      const roots = [marketplaceDir(), dirname(paths.launcher), dirname(paths.settings), owner];
      const before = roots.map(snapshot);
      expect(publishFromChild(full)).toMatchObject({ status: 75, stdout: "", stderr: "" });
      expect(roots.map(snapshot)).toEqual(before);
    } finally {
      rmSync(owner, { force: true });
    }
  });
});

describe("certified full native settings preflight", () => {
  it.each([
    ["malformed JSON", '{"broken"'],
    ["a null root", "null"],
    ["an array root", "[]"],
    ["a non-object marketplace map", '{"extraKnownMarketplaces":[]}'],
    ["a non-object enabled-plugin map", '{"enabledPlugins":"invalid"}'],
    [
      "invalid UTF-8 in a quoted setting",
      Buffer.concat([Buffer.from('{"theme":"'), Buffer.from([0xff]), Buffer.from('"}')]),
    ],
    ["a byte-order mark", Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])],
  ])("refuses %s before writing any native output", (_label, body) => {
    installFacetFixture();
    chmodSync(join(pluginDir("fixture-native"), "hooks", "guard.sh"), 0o644);
    const paths = nativeFacetPaths();
    const owner = join(home, ".agentbrew-native-publication.lock");
    mkdirSync(dirname(paths.settings), { recursive: true });
    writeFileSync(paths.settings, body, { mode: 0o600 });
    const before = observeNativeFiles([paths.settings]);
    vi.mocked(atomicWrite).mockClear();

    try {
      let failure: unknown;
      try {
        emitClaudeNative({ certifyFullOutput: true });
      } catch (error) {
        failure = error;
      }
      expect(atomicWrite).not.toHaveBeenCalled();
      expect(existsSync(marketplaceDir())).toBe(false);
      expect(existsSync(paths.launcher)).toBe(false);
      expect(existsSync(owner)).toBe(false);
      expect(observeNativeFiles([paths.settings])).toEqual(before);
      expect(failure).toMatchObject({ message: expect.stringMatching(/invalid native settings/u) });
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

describe("native signer descriptor checks at publication", () => {
  it.each([
    { name: "first selected", boundary: 1, full: false, payload: false },
    { name: "later selected", boundary: 2, full: false, payload: true },
    { name: "first full", boundary: 1, full: true, payload: false },
    { name: "full certification", boundary: 2, full: true, payload: true },
    { name: "full settings", boundary: 3, full: true, payload: true },
  ])("refuses at the $name boundary when the descriptor is lost", async ({ boundary, full, payload }) => {
    installFacetFixture();
    const files = nativeFacetPaths();
    const owner = join(home, ".agentbrew-native-publication.lock");
    const { withSignerCommitFence: acquire } =
      await vi.importActual<typeof import("./signer-commit-fence.js")>("./signer-commit-fence.js");
    let checked = 0;
    vi.mocked(withSignerCommitFence).mockImplementationOnce((registry, action) =>
      acquire(registry, (path, mode, assertLock) =>
        action(path, mode, () => {
          assertLock();
          checked += 1;
          if (checked === boundary) throw new Error("Synthetic signer descriptor was lost.");
        }),
      ),
    );

    try {
      const options = full ? { certifyFullOutput: true } : { modules: ["hooks"] as const };
      expect(() => emitClaudeNative(options)).toThrow(/Synthetic signer descriptor was lost/u);
      expect(checked).toBe(boundary);
      expect(existsSync(files.hooks)).toBe(payload);
      expect(existsSync(owner)).toBe(payload);
      expect(existsSync(files.index)).toBe(full && payload);
      expect(existsSync(files.settings)).toBe(false);
      expect(existsSync(nativeProofPath())).toBe(full && boundary === 3);
    } finally {
      rmSync(owner, { force: true });
    }
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

describe("certified native settings ownership", () => {
  const owner = join(home, ".agentbrew-native-publication.lock");

  it.each([
    ["symbolic", symlinkSync],
    ["hard", linkSync],
  ] as const)("refuses a %s link before touching native output", (_, link) => {
    installFacetFixture();
    const target = join(home, "owner-settings.json");
    mkdirSync(dirname(SETTINGS()), { recursive: true });
    writeFileSync(target, '{ "ownerSetting": ["keep"] }\n');
    link(target, SETTINGS());
    const original = observeNativeFiles([target, SETTINGS()]);
    try {
      expect(() => emitClaudeNative({ certifyFullOutput: true })).toThrow(/destination ownership or file type/u);
      expect(observeNativeFiles([target, SETTINGS()])).toEqual(original);
      expect(existsSync(owner)).toBe(false);
      expect(existsSync(marketplaceDir())).toBe(false);
    } finally {
      rmSync(target);
    }
  });

  it("keeps a later owner edit during the certified native write", async () => {
    installFacetFixture();
    mkdirSync(dirname(SETTINGS()), { recursive: true });
    writeFileSync(SETTINGS(), '{ "ownerSetting": ["before"] }\n');
    const edited = '{ "ownerSetting": ["after"] }\n';
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    vi.mocked(atomicWrite).mockImplementationOnce((...args) => {
      atomic.sync(...args);
      writeFileSync(SETTINGS(), edited);
    });

    try {
      expect(() => emitClaudeNative({ certifyFullOutput: true })).toThrow(/native destination changed/u);
      expect(readFileSync(SETTINGS(), "utf8")).toBe(edited);
      expect(existsSync(nativeFacetPaths().envelope)).toBe(true);
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

describe("empty-lock publication", () => {
  const lockPath = join(home, ".config", "agentbrew", "agentbrew.lock");

  function publishForSelection() {
    emitClaudeNative({ skipEmptyPublication: true });
  }

  function expectNativeCleanup() {
    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(nativeFacetPaths().launcher)).toBe(false);
    const current = settings();
    expect(current.enabledPlugins?.[`fixture-native@${MARKETPLACE_NAME}`]).toBeUndefined();
    expect(current.extraKnownMarketplaces?.[MARKETPLACE_NAME]).toBeUndefined();
  }

  it.each(["omitted", "explicit"] as const)("preserves native output with an %s empty plugin inventory", (form) => {
    installFacetFixture();
    emitClaudeNative();
    removePlugin("fixture-native");
    if (form === "explicit") {
      writeLock({
        locked: [
          {
            source: "fixture.example/source",
            type: "github",
            sha: "a".repeat(40),
            skills: ["fixture-skill"],
            lockedAt: "2026-11-20T00:00:00.000Z",
          },
        ],
        plugins: [],
      });
    }
    expect(readLock().plugins ?? []).toEqual([]);
    const paths = nativeFacetPaths();
    const before = observeNativeFiles([paths.index, paths.launcher, paths.settings]);

    publishForSelection();

    expect(observeNativeFiles([paths.index, paths.launcher, paths.settings])).toEqual(before);
    emitClaudeNative();
    expectNativeCleanup();
  });

  it.each([
    "missing",
    "unparseable",
    "malformed",
    "revoked",
  ] as const)("retains ordinary cleanup with a %s lock or signer", (kind) => {
    installFacetFixture();
    emitClaudeNative();
    if (kind === "missing") rmSync(lockPath);
    else if (kind === "unparseable") writeFileSync(lockPath, "locked: []\nplugins: invalid\n[");
    else if (kind === "malformed") writeFileSync(lockPath, "locked: [{}]\n");
    else revokeSigner("fixture-native", KEY.pub);

    publishForSelection();

    expectNativeCleanup();
  });

  it("still publishes for an active signed plugin", () => {
    installFacetFixture();

    publishForSelection();

    const paths = nativeFacetPaths();
    expect(existsSync(paths.index)).toBe(true);
    expect(existsSync(paths.launcher)).toBe(true);
    expect(settings().enabledPlugins?.[`fixture-native@${MARKETPLACE_NAME}`]).toBe(true);
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
