/**
 * US24 one-step install: the real scripts/install.sh with the real agentbrew
 * CLI (init, status --fix, lint) in a scratch HOME.
 *
 * Fast mode (default): the CLI is this checkout's build (dist/cli.js, rebuilt
 * once per run; a build takes about a second, tsx startup costs seconds per call).
 * Cold mode (E2E_COLD=1): copy the working tree, then npm ci + build + link,
 * exactly as a new user's clone does.
 *
 * Two layers keep the real machine safe: PATH shims for launchctl/osascript,
 * and on macOS a sandbox-exec profile that denies the real launchctl and any
 * file write outside the scratch folder.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectInstalledCheckupRun } from "./checkup-run-installed.js";

const REPO = resolve(import.meta.dirname, "..", "..");
const COLD = process.env.E2E_COLD === "1";
const roots: string[] = [];

interface Scratch {
  root: string;
  home: string;
  prepare: (
    args: string[],
    extraEnv?: Record<string, string>,
  ) => {
    cmd: string;
    cmdArgs: string[];
    cwd: string;
    env: Record<string, string>;
  };
  run: (args: string[], extraEnv?: Record<string, string>) => ReturnType<typeof spawnSync>;
}

function scratch(): Scratch {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-us01-")));
  roots.push(root);
  const home = join(root, "home");
  const shims = join(root, "shims");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  mkdirSync(shims, { recursive: true });
  // An existing user setup that the install must back up and may change.
  writeFileSync(join(home, ".claude", "settings.json"), '{"mine":true}\n');
  writeFileSync(join(home, ".zshrc"), "# my zshrc\n");
  for (const tool of ["launchctl", "osascript", "open"]) {
    writeFileSync(join(shims, tool), `#!/bin/bash\necho "${tool} $*" >> "${root}/os-calls.log"\n`);
    chmodSync(join(shims, tool), 0o755);
  }

  let repoDir = REPO;
  if (COLD) {
    // A new user's clone of this working tree (uncommitted edits included).
    repoDir = join(root, "agentbrew");
    const copy = spawnSync(
      "bash",
      ["-c", `git ls-files -co --exclude-standard -z | rsync -a --from0 --files-from=- ./ "${repoDir}/"`],
      { cwd: REPO, encoding: "utf-8" },
    );
    expect(copy.status, copy.stderr).toBe(0);
  } else {
    writeFileSync(join(root, "agentbrew-cli"), `#!/bin/bash\nexec "${process.execPath}" "${REPO}/dist/cli.js" "$@"\n`);
    chmodSync(join(root, "agentbrew-cli"), 0o755);
  }

  const profile = join(root, "profile.sb");
  writeFileSync(
    profile,
    `(version 1)
(allow default)
(deny file-write* (subpath "/"))
(allow file-write* (subpath "${root}") (subpath "/dev") (subpath "/private/var/folders") (subpath "/var/folders")
  (subpath "${process.env.HOME}/.npm"))
(deny process-exec (literal "/bin/launchctl") (literal "/usr/bin/osascript") (literal "/usr/bin/open"))
`,
  );

  const prepare = (args: string[], extraEnv: Record<string, string> = {}) => {
    const env: Record<string, string> = {
      HOME: home,
      USER: process.env.USER ?? "e2e",
      SHELL: "/bin/zsh",
      TERM: "dumb",
      TMPDIR: join(root, "tmp"),
      PATH: `${shims}:${process.env.PATH}`,
      XDG_STATE_HOME: join(home, ".local", "state"),
      AGENTBREW_INSTALL_BIN_DIR: join(home, ".local", "bin"),
      // npm reuses the real download cache (read-mostly; the sandbox allows it).
      npm_config_cache: join(process.env.HOME ?? "", ".npm"),
      ...extraEnv,
    };
    if (!COLD) env.AGENTBREW_INSTALL_CLI = join(root, "agentbrew-cli");
    const script = join(repoDir, "scripts", "install.sh");
    const useSandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
    const [cmd, cmdArgs] = useSandbox
      ? ["/usr/bin/sandbox-exec", ["-f", profile, "bash", script, ...args]]
      : ["bash", [script, ...args]];
    return { cmd, cmdArgs, cwd: repoDir, env };
  };
  const run: Scratch["run"] = (args, extraEnv) => {
    const { cmd, cmdArgs, cwd, env } = prepare(args, extraEnv);
    return spawnSync(cmd, cmdArgs, { cwd, env, encoding: "utf8", timeout: COLD ? 600_000 : 120_000 });
  };
  return { root, home, prepare, run };
}

beforeAll(() => {
  if (COLD) return;
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8" });
  expect(build.status, build.stderr).toBe(0);
}, 120_000);

// Cold mode leaves a full node_modules in the scratch root. Deleting it can
// take longer than the 10 s default hook timeout on a loaded machine.
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}, 120_000);

describe.concurrent(`us01 one-step install (${COLD ? "cold: npm ci + build" : "fast: built CLI"})`, () => {
  it(
    "installs with the user's answers, heals, verifies, and keeps their settings",
    () => {
      const { home, root, run } = scratch();
      const result = run(["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"]);
      const out = `${result.stdout}${result.stderr}`;
      expect(result.status, out).toBe(0);
      for (const phase of ["1/7", "2/7", "3/7", "4/7", "5/7", "6/7", "7/7", "Done"]) expect(out).toContain(phase);
      // Real init wrote real state into the scratch HOME.
      expect(readFileSync(join(home, ".config", "agentbrew", "state.yaml"), "utf-8")).toContain("agents");
      // The user's own settings survive the merge.
      expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).mine).toBe(true);
      // Their answers were honoured: no shell hook, no background job.
      expect(readFileSync(join(home, ".zshrc"), "utf-8")).toBe("# my zshrc\n");
      expect(existsSync(join(home, "Library", "LaunchAgents", "com.agentbrew.check.plist"))).toBe(false);
      expect(existsSync(join(home, ".local", "bin", "agentbrew"))).toBe(true);
      if (COLD) expectInstalledCheckupRun(join(home, ".local", "bin", "agentbrew"), root);
      // One finished install leaves one `install` event: a duration and ok, nothing else.
      const log = readFileSync(join(home, ".local", "share", "agentbrew", "logs", "events.jsonl"), "utf-8");
      const written = log
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((e) => e.event === "install");
      expect(written).toHaveLength(1);
      expect(Object.keys(written[0]).sort()).toEqual(["event", "ms", "ok", "story", "ts"]);
      expect(typeof written[0].ms).toBe("number");
      // No answer was given (no terminal), so no state file exists yet. A state that starts at the
      // top of the log lets the dry run show what a yes would send.
      const state = join(root, "telemetry-state.json");
      writeFileSync(state, `${JSON.stringify({ installId: "0123456789abcdef0123456789abcdef", sent: 0 })}\n`);
      const dry = spawnSync(join(home, ".local", "bin", "agentbrew"), ["telemetry", "send", "--dry-run"], {
        env: {
          HOME: home,
          PATH: process.env.PATH ?? "",
          TMPDIR: join(root, "tmp"),
          AGENTBREW_TELEMETRY_STATE: state,
          AGENTBREW_TELEMETRY_ASK: "0",
        },
        encoding: "utf-8",
      });
      expect(dry.status, dry.stderr).toBe(0);
      const batch = (
        JSON.parse(dry.stdout.slice(dry.stdout.indexOf("{"))) as {
          body: { batch: { event: string; properties: Record<string, unknown> }[] };
        }
      ).body.batch;
      const installs = batch.filter((e) => e.event === "agentbrew.install");
      expect(installs).toHaveLength(1);
      expect(typeof installs[0].properties.duration_ms).toBe("number");
      expect(typeof installs[0].properties.ok).toBe("boolean");
      expect(out).toContain("agentbrew contribute");
      // "No" to the recommended set means no downloads and no skill installs.
      expect(out).not.toMatch(/Fetching /);
      expect(out).not.toContain("Installing skill");
      expect(
        existsSync(join(root, "os-calls.log")) ? readFileSync(join(root, "os-calls.log"), "utf-8") : "",
      ).not.toMatch(/launchctl (load|bootstrap)/);
    },
    COLD ? 600_000 : 120_000,
  );

  it.skipIf(COLD)(
    "--keep-claude-permissions leaves Claude Code permission prompts on",
    () => {
      const keep = scratch();
      const kept = keep.run([
        "run",
        "--yes",
        "--no-auto-repair",
        "--no-shell-hook",
        "--no-recommended",
        "--keep-claude-permissions",
      ]);
      expect(kept.status, `${kept.stdout}${kept.stderr}`).toBe(0);
      const keptSettings = JSON.parse(readFileSync(join(keep.home, ".claude", "settings.json"), "utf-8"));
      expect(keptSettings.permissions?.defaultMode).toBeUndefined();
      expect(keptSettings.mine).toBe(true);
      expect(readFileSync(join(keep.home, ".config", "agentbrew", "state.yaml"), "utf-8")).toContain(
        "claudePermissions: keep",
      );

      // Without the flag, the same install turns prompts off.
      const manage = scratch();
      const managed = manage.run(["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"]);
      expect(managed.status, `${managed.stdout}${managed.stderr}`).toBe(0);
      const managedSettings = JSON.parse(readFileSync(join(manage.home, ".claude", "settings.json"), "utf-8"));
      expect(managedSettings.permissions?.defaultMode).toBe("bypassPermissions");
    },
    240_000,
  );

  it.skipIf(COLD)(
    "a real setup failure restores the previous settings by itself",
    () => {
      const { home, run } = scratch();
      // ~/.config/agentbrew is a file, so the real init cannot write its state.
      mkdirSync(join(home, ".config"), { recursive: true });
      writeFileSync(join(home, ".config", "agentbrew"), "not a folder\n");
      const result = run(["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"]);
      const out = `${result.stdout}${result.stderr}`;
      expect(result.status, out).toBe(1);
      expect(out).toContain("Critical error during");
      expect(out).toContain("Restored your settings");
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).toBe('{"mine":true}\n');
      expect(readFileSync(join(home, ".config", "agentbrew"), "utf-8")).toBe("not a folder\n");
      expect(existsSync(join(home, ".local", "bin", "agentbrew"))).toBe(false);
    },
    120_000,
  );
});

const IN_PLACE = process.env.E2E_CHECKUP_IN_PLACE === "1";
const installArgs = ["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"];
const predecessorMarker = "n04-predecessor";
const fixtureId = "fixture";
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function treeManifest(dir: string, prefix = ""): unknown[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name): unknown[] => {
      const path = join(dir, name);
      const rel = prefix + name;
      const st = lstatSync(path);
      const mode = st.mode & 0o777;
      if (st.isDirectory()) return [{ rel, mode, kind: "dir" }, ...treeManifest(path, rel + "/")];
      if (st.isSymbolicLink()) return [{ rel, mode, target: readlinkSync(path) }];
      if (!st.isFile()) throw new Error("unexpected fixture leaf");
      return [{ rel, mode, sha256: digest(path) }];
    });
}

function fixtureReceipt(id: string, data: Record<string, unknown>): void {
  const out = process.env.CHECKUP_N04_EVIDENCE;
  if (!out) throw new Error("CHECKUP_N04_EVIDENCE required");
  writeFileSync(join(out, id + ".json"), JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function tool(command: string, args: string[], cwd: string, env: Record<string, string>): string {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 20_000 });
  if (result.status !== 0) throw new Error("fixture setup command failed: " + command + " " + args[0]);
  return result.stdout.trim();
}

const predecessorCommit = "6710ea9b633e27f34314029a92835fa84be5f68d";
const predecessorTree = "2eb81508225423081e44ff4ca95a6dd80fc1c260";

function checkPredecessorSource(commit: string, tree: string): void {
  if (commit !== predecessorCommit || tree !== predecessorTree) {
    throw new Error("predecessor-source-mismatch");
  }
}

function checkedBuildStamp(dist: string): void {
  const stamp: unknown = JSON.parse(readFileSync(join(dist, "build-info.json"), "utf8"));
  if (!stamp || typeof stamp !== "object" || !("commit" in stamp) || stamp.commit !== predecessorCommit) {
    throw new Error("predecessor-build-stamp-mismatch");
  }
}

function sealPredecessor(dist: string) {
  checkedBuildStamp(dist);
  const st = lstatSync(dist);
  if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o022) !== 0) {
    throw new Error("unsafe-predecessor-directory");
  }
  return { dev: st.dev, ino: st.ino, manifest: treeManifest(dist) };
}

function checkPredecessor(dist: string, seal: ReturnType<typeof sealPredecessor>): void {
  const observed = sealPredecessor(dist);
  if (JSON.stringify(observed) !== JSON.stringify(seal)) {
    throw new Error("predecessor-manifest-mismatch");
  }
}

function buildPredecessor() {
  const source = process.env.CHECKUP_N04_PUBLIC_SOURCE;
  const developer = process.env.CHECKUP_N04_DEVELOPER_DIR;
  if (
    !COLD ||
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    !source ||
    !developer ||
    !existsSync("/usr/bin/sandbox-exec")
  ) {
    throw new Error("unqualified public predecessor environment");
  }
  const fixture = scratch();
  const template = join(fixture.root, "empty-template");
  const repo = join(fixture.root, "pinned-predecessor");
  const dist = join(repo, "dist");
  const userConfig = join(fixture.root, "npm-user");
  const globalConfig = join(fixture.root, "npm-global");
  const state = join(fixture.root, "probe-state");
  mkdirSync(template, { mode: 0o700 });
  mkdirSync(state, { mode: 0o700 });
  writeFileSync(userConfig, "", { flag: "wx", mode: 0o600 });
  writeFileSync(globalConfig, "", { flag: "wx", mode: 0o600 });
  const port = fixture.prepare([], {
    PATH: [dirname(process.execPath), "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    DEVELOPER_DIR: realpathSync(developer),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: join(fixture.root, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    CARGO_BUILD_JOBS: "1",
    XDG_STATE_HOME: state,
    AGENTBREW_EVENTS: "0",
  });
  const profile = join(fixture.root, "predecessor.sb");
  writeFileSync(
    profile,
    [
      "(version 1)",
      "(allow default)",
      '(deny file-write* (subpath "/"))',
      "(allow file-write* (subpath " + JSON.stringify(fixture.root) + ') (literal "/dev/null"))',
      '(deny process-exec (literal "/bin/launchctl") (literal "/usr/bin/osascript") (literal "/usr/bin/open"))',
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  const fenceRoot = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-predecessor-fence-")));
  try {
    const marker = join(fixture.root, "fence-marker");
    const sentinel = join(fenceRoot, "outside-sentinel");
    writeFileSync(sentinel, "unchanged\n", { flag: "wx", mode: 0o600 });
    const check = spawnSync(
      port.cmd,
      [
        "-f",
        profile,
        "/bin/sh",
        "-c",
        'printf "%s\\n" allowed > "$1" || exit 72; if printf "%s\\n" denied >> "$2"; then exit 73; fi; exit 74',
        "_",
        marker,
        sentinel,
      ],
      { cwd: fixture.root, env: port.env, encoding: "utf8", timeout: 10_000 },
    );
    const inside = existsSync(marker) && readFileSync(marker, "utf8") === "allowed\n";
    const outsideUnchanged = readFileSync(sentinel, "utf8") === "unchanged\n";
    const denied = /Operation not permitted|Permission denied/.test(String(check.stderr));
    const qualified = !check.error && check.status === 74 && inside && outsideUnchanged && denied;
    fixtureReceipt("predecessor-write-fence", { qualified, inside, outsideUnchanged, denied, exit: check.status });
    if (!qualified) throw new Error("unqualified predecessor write fence");
  } finally {
    rmSync(fenceRoot, { recursive: true, force: true });
  }
  const run = (cwd: string, executable: string, args: string[], timeout = 20_000): string => {
    const result = spawnSync(port.cmd, ["-f", profile, executable, ...args], {
      cwd,
      env: port.env,
      encoding: "utf8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const out = process.env.CHECKUP_N04_EVIDENCE!;
      writeFileSync(join(out, "predecessor-setup.log"), String(result.stdout) + String(result.stderr), {
        flag: "wx",
        mode: 0o600,
      });
      throw new Error("public predecessor setup failed: " + executable + " " + args[0]);
    }
    return result.stdout.trim();
  };
  const git = (...args: string[]) => run(repo, "/usr/bin/git", args);
  run(
    fixture.root,
    "/usr/bin/git",
    ["clone", "--template=" + template, "--no-local", "--no-checkout", "--", realpathSync(source), repo],
    120_000,
  );
  git("checkout", "--detach", predecessorCommit);
  const sourceIdentity = () => ({ commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") });
  const locks = () => ({
    npm: digest(join(repo, "package-lock.json")),
    cargo: digest(join(repo, "rust/checkup-run/Cargo.lock")),
  });
  const before = sourceIdentity();
  checkPredecessorSource(before.commit, before.tree);
  expect(locks()).toEqual({
    npm: "562289924441cbdb80788049d13673da5419141f76f178b67a7da2993a5bd7b8",
    cargo: "f9144dc78733de9bfa2513ef4cd1bb1b3acc66cfd3d8d805604d1e7a80dfafeb",
  });
  expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
  expect(existsSync(dist)).toBe(false);
  const versions = {
    node: run(repo, process.execPath, ["--version"]),
    npm: run(repo, "npm", ["--version"]),
    cargo: run(repo, "cargo", ["--version"]),
    rustc: run(repo, "rustc", ["--version"]),
    sdk: run(repo, "/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-version"]),
    os: run(repo, "/usr/bin/sw_vers", ["-productVersion"]),
    target: "aarch64-apple-darwin",
  };
  expect(versions.node).toBe("v24.21.0");
  expect(versions.npm).toBe("12.2.1");
  expect(versions.cargo).toMatch(/^cargo 1\.99\.1 /);
  run(repo, "npm", ["ci", "--no-audit", "--no-fund"], 240_000);
  run(repo, "npm", ["run", "build"], 240_000);
  expect(sourceIdentity()).toEqual(before);
  expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
  const cli = join(dist, "cli.js");
  const native = join(dist, "native/darwin-arm64/checkup-run");
  expect(lstatSync(cli).isFile()).toBe(true);
  expect(lstatSync(native).isFile()).toBe(true);
  const bytes = readFileSync(native);
  expect(bytes.readUInt32LE(0)).toBe(0xfeedfacf);
  expect(bytes.readUInt32LE(4)).toBe(0x0100000c);
  expect(bytes.readUInt32LE(12)).toBe(2);
  const macho = run(repo, "/usr/bin/xcrun", ["vtool", "-show-build", native]);
  const deploymentTarget = /^\s*minos (\S+)$/m.exec(macho)?.[1];
  const linkedSdk = /^\s*sdk (\S+)$/m.exec(macho)?.[1];
  expect(deploymentTarget).toMatch(/^\d+(\.\d+)+$/);
  expect(linkedSdk).toMatch(/^\d+(\.\d+)+$/);
  const invoke = (...args: string[]) => run(repo, process.execPath, [cli, ...args]);
  expect(invoke("--version")).toBe("1.0.0");
  expect(JSON.parse(invoke("checkup-run", "show", fixtureId, "--json")).status).toBe("missing");
  invoke(
    "checkup-run",
    "record",
    fixtureId,
    "--finished-at",
    "2026-01-01T12:00:00Z",
    "--result",
    "green",
    "--commit",
    "fixture=abcdef0",
    "--json",
  );
  expect(JSON.parse(invoke("checkup-run", "show", fixtureId, "--json")).status).toBe("present");
  const seal = sealPredecessor(dist);
  const wrongSource = { commit: git("rev-parse", "HEAD^"), tree: git("rev-parse", "HEAD^^{tree}") };
  fixtureReceipt("predecessor", { ...before, locks: locks(), versions, deploymentTarget, linkedSdk, seal });
  roots.splice(roots.indexOf(fixture.root), 1);
  return { dist, seal, root: fixture.root, wrongSource };
}

let predecessorForRun: ReturnType<typeof buildPredecessor> | undefined;
function qualifiedPredecessor() {
  if (!predecessorForRun) throw new Error("public predecessor producer did not qualify");
  return predecessorForRun;
}

beforeAll(() => {
  if (IN_PLACE) predecessorForRun = buildPredecessor();
}, 650_000);

afterAll(() => {
  if (predecessorForRun) rmSync(predecessorForRun.root, { recursive: true, force: true });
}, 120_000);

describe.skipIf(!IN_PLACE).sequential("N04 in-place predecessor qualification", () => {
  it("P01 accepts the pinned public source build", () => {
    const f = qualifiedPredecessor();
    expect(() => checkPredecessor(f.dist, f.seal)).not.toThrow();
  });
  it("P02 refuses actual Git metadata from the wrong source", () => {
    const { wrongSource } = qualifiedPredecessor();
    expect(() => checkPredecessorSource(wrongSource.commit, wrongSource.tree)).toThrow("predecessor-source-mismatch");
  });
  it("P03 refuses an alternate build stamp in a valid-looking bundle", () => {
    const f = qualifiedPredecessor();
    const alternate = join(f.root, "alternate-dist");
    cpSync(f.dist, alternate, { recursive: true, errorOnExist: true, force: false });
    writeFileSync(join(alternate, "build-info.json"), JSON.stringify({ commit: f.wrongSource.commit }));
    expect(() => sealPredecessor(alternate)).toThrow("predecessor-build-stamp-mismatch");
  });
  it("P04 refuses byte drift with unchanged stamp and inode", () => {
    const f = qualifiedPredecessor();
    const alternate = join(f.root, "changed-dist");
    cpSync(f.dist, alternate, { recursive: true, errorOnExist: true, force: false });
    const seal = sealPredecessor(alternate);
    const cli = join(alternate, "cli.js");
    const ino = lstatSync(cli).ino;
    writeFileSync(cli, "\n", { flag: "a" });
    expect(lstatSync(cli).ino).toBe(ino);
    expect(() => checkPredecessor(alternate, seal)).toThrow("predecessor-manifest-mismatch");
  });
});

function makeInPlaceFixture() {
  if (!COLD || process.platform !== "darwin" || process.arch !== "arm64" || !existsSync("/usr/bin/sandbox-exec"))
    throw new Error("unqualified fixture platform");
  const predecessor = qualifiedPredecessor();

  const fixture = scratch();
  const { root, home } = fixture;
  const repo = join(root, "agentbrew");
  const dist = join(repo, "dist");
  const cli = join(dist, "cli.js");
  const launcher = join(home, ".local/bin/agentbrew");
  const state = join(home, ".local/state");
  const record = join(state, "checkups", fixtureId + ".json");
  const settings = join(home, ".claude/settings.json");
  const zshrc = join(home, ".zshrc");
  const npmUser = join(root, "npm-user");
  const npmGlobal = join(root, "npm-global");
  writeFileSync(npmUser, "", { flag: "wx", mode: 0o600 });
  writeFileSync(npmGlobal, "", { flag: "wx", mode: 0o600 });
  const env = {
    PATH: [
      join(root, "shims"),
      dirname(process.execPath),
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":"),
    npm_config_userconfig: npmUser,
    npm_config_globalconfig: npmGlobal,
    npm_config_registry: "https://registry.npmjs.org/",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    CARGO_BUILD_JOBS: "1",
  };
  const command = fixture.prepare(installArgs, env);
  if (command.env.AGENTBREW_INSTALL_CLI || command.cmd !== "/usr/bin/sandbox-exec") {
    throw new Error("real installer sandbox admission failed");
  }
  const toolpaths = tool(
    "/bin/bash",
    ["-c", "command -v node npm cargo launchctl osascript open"],
    repo,
    command.env,
  ).split("\n");
  expect(toolpaths.slice(3)).toEqual(["launchctl", "osascript", "open"].map((name) => join(root, "shims", name)));
  expect(realpathSync(toolpaths[0])).toBe(realpathSync(process.execPath));
  const versions = {
    node: tool(toolpaths[0], ["--version"], repo, command.env),
    npm: tool(toolpaths[1], ["--version"], repo, command.env),
    cargo: tool(toolpaths[2], ["--version"], repo, command.env),
  };
  const git = (...args: string[]) => tool("/usr/bin/git", args, repo, command.env);
  const emptyTemplate = join(root, "empty-git-template");
  mkdirSync(emptyTemplate);
  git("init", "-q", "--initial-branch=main", "--template=" + emptyTemplate);
  git("add", "--all");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "N04 frozen candidate",
  );
  const head = git("rev-parse", "HEAD");
  const identity = () => {
    const st = lstatSync(repo);
    return { dev: st.dev, ino: st.ino, head: git("rev-parse", "HEAD") };
  };
  const link = () => ({ target: readlinkSync(launcher), inode: lstatSync(launcher).ino });
  checkPredecessor(predecessor.dist, predecessor.seal);
  cpSync(predecessor.dist, dist, { recursive: true, errorOnExist: true, force: false });
  expect(treeManifest(dist)).toEqual(predecessor.seal.manifest);
  writeFileSync(join(dist, predecessorMarker), "qualified predecessor\n", { flag: "wx", mode: 0o600 });
  mkdirSync(dirname(launcher), { recursive: true });
  symlinkSync(cli, launcher);
  mkdirSync(state, { recursive: true });

  const invoke = (scheduled: boolean, ...args: string[]) => {
    const argv = scheduled ? [cli, ...args] : args;
    return tool(scheduled ? process.execPath : launcher, argv, repo, command.env);
  };
  invoke(
    false,
    "checkup-run",
    "record",
    fixtureId,
    "--finished-at",
    "2026-01-01T12:00:00Z",
    "--result",
    "green",
    "--commit",
    "fixture=abcdef0",
    "--json",
  );
  const probe = () =>
    [false, true].map((scheduled) => ({
      version: invoke(scheduled, "--version"),
      show: JSON.parse(invoke(scheduled, "checkup-run", "show", fixtureId, "--json")),
    }));
  const before = {
    checkout: identity(),
    link: link(),
    dist: treeManifest(dist),
    record: digest(record),
    settings: digest(settings),
    zshrc: digest(zshrc),
    responses: probe(),
  };
  return {
    fixture,
    root,
    repo,
    dist,
    cli,
    launcher,
    state,
    record,
    settings,
    zshrc,
    versions,
    command,
    before,
    head,
    identity,
    link,
    probe,
    env,
  };
}

type InPlace = ReturnType<typeof makeInPlaceFixture>;

function injectGuard(f: InPlace, mode: "fail" | "hold"): string {
  const guard = join(f.repo, "scripts/build-pipeline-guard.sh");
  const original = join(f.repo, "scripts/.n04-real-build-pipeline-guard.sh");
  const ready = join(f.root, "post-build.ready");
  renameSync(guard, original);
  writeFileSync(
    guard,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      "/bin/bash " + JSON.stringify(original) + ' "$@"',
      'if [[ "${1:-}" != --dist-only ]]; then exit 0; fi',
      "printf '%s\\n' complete > " + JSON.stringify(ready + ".tmp"),
      "/bin/mv " + JSON.stringify(ready + ".tmp") + " " + JSON.stringify(ready),
      ...(mode === "fail"
        ? ["exit 73"]
        : [
            "for ((i=0; i<30; i++)); do",
            "  [[ ! -e " + JSON.stringify(join(f.root, "release")) + " ]] || exit 74",
            "  /bin/sleep 1",
            "done",
            "exit 74",
          ]),
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o700 },
  );
  return ready;
}

function observed(f: InPlace) {
  let responses: unknown = null;
  try {
    responses = f.probe();
  } catch {
    /* Missing predecessor is measured below. */
  }
  return {
    checkout: f.identity(),
    link: existsSync(f.launcher) ? f.link() : null,
    dist: treeManifest(f.dist),
    record: existsSync(f.record) ? digest(f.record) : null,
    settings: existsSync(f.settings) ? digest(f.settings) : null,
    zshrc: existsSync(f.zshrc) ? digest(f.zshrc) : null,
    responses,
  };
}

async function waitFor(test: () => boolean, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (test()) return true;
    await sleep(50);
  }
  return test();
}

async function interruptInstaller(f: InPlace, ready: string) {
  const output = join(process.env.CHECKUP_N04_EVIDENCE!, "I02.install.log");
  const log = openSync(output, "wx", 0o600);
  const { cmd, cmdArgs, cwd, env } = f.command;
  const child = spawn(cmd, cmdArgs, { cwd, env, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  let terminal: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let launchFailed = false;
  child.once("error", () => {
    launchFailed = true;
  });
  child.once("exit", (code, signal) => {
    terminal = { code, signal };
  });
  const readyObserved =
    (await waitFor(() => existsSync(ready) || Boolean(terminal) || launchFailed, Date.now() + 550_000)) &&
    existsSync(ready);
  let delivered = false;
  let groupGone = false;
  let signalError: string | null = null;
  const pid = child.pid;
  if (readyObserved && pid && !terminal && !launchFailed) {
    try {
      const info = tool("/bin/ps", ["-o", "pid=,pgid=,uid=", "-p", String(pid)], cwd, env)
        .split(/\s+/)
        .map(Number);
      if (info.length !== 3 || info[0] !== pid || info[1] !== pid || info[2] !== process.getuid?.()) {
        throw new Error("unqualified group identity");
      }
      process.kill(-pid, 0);
      process.kill(-pid, "SIGTERM");
      delivered = true;
    } catch (error) {
      signalError = (error as NodeJS.ErrnoException).code ?? "identity";
    }
  }
  if (!delivered) writeFileSync(join(f.root, "release"), "stop\n", { flag: "wx", mode: 0o600 });
  await waitFor(() => Boolean(terminal) || launchFailed, Date.now() + 35_000);
  if (pid && terminal) {
    groupGone = await waitFor(() => {
      try {
        process.kill(-pid, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    }, Date.now() + 5_000);
  }
  if (!groupGone) {
    const index = roots.indexOf(f.root);
    if (index >= 0) roots.splice(index, 1);
    child.unref();
  }
  return { readyObserved, delivered, groupGone, signalError, terminal, launchFailed };
}

describe.skipIf(!IN_PLACE).sequential("N04 in-place source update", () => {
  it("I01 preserves the predecessor after actual post-build guard failure", () => {
    const f = makeInPlaceFixture();
    const ready = injectGuard(f, "fail");
    const result = f.fixture.run(installArgs, f.env);
    const after = observed(f);
    const log = String(result.stdout) + String(result.stderr);
    const out = process.env.CHECKUP_N04_EVIDENCE!;
    writeFileSync(join(out, "I01.install.log"), log, { flag: "wx", mode: 0o600 });
    const qualified = existsSync(ready) && result.status === 1 && log.includes("Critical error during the build");
    fixtureReceipt("I01", {
      qualified,
      exit: result.status,
      signal: result.signal,
      versions: f.versions,
      before: f.before,
      after,
    });
    expect(qualified, "inconclusive post-build failure injection").toBe(true);
    expect(after).toEqual(f.before);
  }, 600_000);

  it("I02 preserves the predecessor after a held installer interruption", async () => {
    const f = makeInPlaceFixture();
    const ready = injectGuard(f, "hold");
    const interrupt = await interruptInstaller(f, ready);
    const after = observed(f);
    const qualified =
      interrupt.readyObserved &&
      interrupt.delivered &&
      interrupt.groupGone &&
      (interrupt.terminal?.signal === "SIGTERM" || interrupt.terminal?.code === 143);
    fixtureReceipt("I02", { qualified, interrupt, versions: f.versions, before: f.before, after });
    expect(qualified, "inconclusive controlled interruption").toBe(true);
    expect(after).toEqual(f.before);
  }, 610_000);

  it("I03 publishes the candidate on a successful real source install", () => {
    const f = makeInPlaceFixture();
    const result = f.fixture.run(installArgs, f.env);
    const after = observed(f);
    const log = String(result.stdout) + String(result.stderr);
    const out = process.env.CHECKUP_N04_EVIDENCE!;
    writeFileSync(join(out, "I03.install.log"), log, { flag: "wx", mode: 0o600 });
    const buildInfo = existsSync(join(f.dist, "build-info.json"))
      ? JSON.parse(readFileSync(join(f.dist, "build-info.json"), "utf8"))
      : null;
    fixtureReceipt("I03", {
      exit: result.status,
      signal: result.signal,
      versions: f.versions,
      buildInfo,
      before: f.before,
      after,
    });
    expect(result.status, "real candidate installation failed").toBe(0);
    expect(buildInfo?.commit).toBe(f.head);
    expect(existsSync(join(f.dist, predecessorMarker))).toBe(false);
    expect(after.checkout).toEqual(f.before.checkout);
    expect(after.link?.target).toBe(f.before.link.target);
    expect(after.record).toBe(f.before.record);
    expect(after.zshrc).toBe(f.before.zshrc);
    expect(after.responses).toEqual(f.before.responses);
    expect(JSON.parse(readFileSync(f.settings, "utf8")).mine).toBe(true);
    expect(digest(join(f.dist, "native/darwin-arm64/checkup-run"))).toMatch(/^[a-f0-9]{64}$/);
  }, 600_000);
});

function publicationIdentity(path: string) {
  if (!existsSync(path)) return null;
  const st = lstatSync(path);
  return { dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode };
}

function preparePublication(f: InPlace, caseId: string): void {
  const { cmd, cmdArgs, cwd, env } = f.command;
  const result = spawnSync(
    cmd,
    [...cmdArgs.slice(0, 2), "/bin/bash", "-c", "npm ci --no-audit --no-fund && npm run prebuild"],
    { cwd, env, encoding: "utf8", timeout: 550_000 },
  );
  if (result.status !== 0) {
    const out = process.env.CHECKUP_N04_EVIDENCE!;
    writeFileSync(join(out, caseId + ".setup.log"), String(result.stdout) + String(result.stderr), {
      flag: "wx",
      mode: 0o600,
    });
    throw new Error("unqualified publication setup");
  }
  const guard = join(f.repo, "scripts/build-pipeline-guard.sh");
  const realGuard = join(f.repo, "scripts/.n04-publication-guard.sh");
  renameSync(guard, realGuard);
  writeFileSync(
    guard,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      "/bin/bash " + JSON.stringify(realGuard) + ' "$@"',
      '[[ "$1" = --dist-only && -d "$2" ]]',
      '[[ "$N04_BUILD" = A || "$N04_BUILD" = B ]]',
      'ready="$N04_CONTROL/$N04_BUILD.ready"',
      'release="$N04_CONTROL/$N04_BUILD.release"',
      'printf "%s\\n" "$2" > "$ready.tmp"',
      '/bin/mv "$ready.tmp" "$ready"',
      "for ((i=0; i<100; i++)); do",
      '  if [[ -f "$release" ]]; then exit 0; fi',
      "  /bin/sleep 0.1",
      "done",
      "exit 75",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o700 },
  );
}

function startPublication(f: InPlace, id: "A" | "B", caseId: string) {
  const { cmd, cmdArgs, cwd, env } = f.command;
  const out = process.env.CHECKUP_N04_EVIDENCE!;
  const log = openSync(join(out, caseId + "-" + id + ".build.log"), "wx", 0o600);
  const child = spawn(cmd, [...cmdArgs.slice(0, 2), "/bin/bash", "scripts/build-source.sh"], {
    cwd,
    env: {
      ...env,
      PATH: join(f.repo, "node_modules/.bin") + ":" + env.PATH,
      N04_CONTROL: f.root,
      N04_BUILD: id,
    },
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  let terminal: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let failed = false;
  child.once("error", () => {
    failed = true;
  });
  child.once("exit", (code, signal) => {
    terminal = { code, signal };
  });
  const ready = join(f.root, id + ".ready");
  const release = join(f.root, id + ".release");
  let released = false;
  const proceed = () => {
    if (!released) writeFileSync(release, "continue\n", { flag: "wx", mode: 0o600 });
    released = true;
  };
  const done = () => terminal !== undefined || failed;
  const groupGone = () => {
    if (!child.pid || !terminal) return false;
    try {
      process.kill(-child.pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  };
  return {
    ready: async (deadline: number) => {
      await waitFor(() => existsSync(ready) || done(), deadline);
      if (!existsSync(ready) || done()) throw new Error("guard readiness unqualified");
      const stageDist = readFileSync(ready, "utf8").trim();
      const stage = dirname(stageDist);
      if (
        dirname(stage) !== f.repo ||
        !/^\.agentbrew-build\.[a-zA-Z0-9]{8}$/.test(stage.slice(f.repo.length + 1)) ||
        stageDist !== join(stage, "dist") ||
        !publicationIdentity(stageDist)
      ) {
        throw new Error("unbound stage readiness");
      }
      return { stage, stageDist };
    },
    proceed,
    settle: async () => {
      if (
        !(await waitFor(done, Date.now() + 5_000)) ||
        !(await waitFor(groupGone, Date.now() + 1_000)) ||
        failed ||
        !terminal ||
        terminal.signal ||
        terminal.code === null
      ) {
        throw new Error("unqualified publication terminal state");
      }
      return terminal.code;
    },
    cleanup: async () => {
      if (!done() && child.pid) {
        try {
          const pid = child.pid;
          const info = tool("/bin/ps", ["-o", "pid=,pgid=,uid=", "-p", String(pid)], cwd, env)
            .split(/\s+/)
            .map(Number);
          if (!done() && info.length === 3 && info[0] === pid && info[1] === pid && info[2] === process.getuid?.()) {
            process.kill(-pid, "SIGTERM");
          }
        } catch {
          /* Do not signal an unqualified group. */
        }
      }
      if (!(await waitFor(groupGone, Date.now() + 5_000))) {
        const index = roots.indexOf(f.root);
        if (index >= 0) roots.splice(index, 1);
        child.unref();
        throw new Error("unqualified publication cleanup");
      }
    },
  };
}

function publicationTree(path: string) {
  return { identity: publicationIdentity(path), manifest: treeManifest(path) };
}

describe.skipIf(!IN_PLACE).sequential("N04 in-place publication identity", () => {
  it.each([
    ["R01a", "stage"],
    ["R01b", "dist"],
  ] as const)(
    "%s refuses the substituted %s and preserves both inputs",
    async (id, target) => {
      const deadline = Date.now() + 550_000;
      const f = makeInPlaceFixture();
      preparePublication(f, id);
      const build = startPublication(f, "A", id);
      try {
        const { stage, stageDist } = await build.ready(deadline);
        const leaf = target === "stage" ? stage : stageDist;
        const moved = join(f.root, "validated-aside");
        const replacement = join(f.root, "replacement");
        cpSync(leaf, replacement, { recursive: true, errorOnExist: true, force: false });
        writeFileSync(join(replacement, "n04-substitution-sentinel"), id + "\n", { flag: "wx", mode: 0o600 });
        const original = publicationTree(leaf);
        const foreign = publicationTree(replacement);
        expect(original.identity).not.toBeNull();
        expect(foreign.identity).not.toBeNull();
        expect(foreign.identity?.ino).not.toBe(original.identity?.ino);
        renameSync(leaf, moved);
        renameSync(replacement, leaf);
        expect(publicationTree(leaf)).toEqual(foreign);
        expect(publicationTree(moved)).toEqual(original);
        build.proceed();
        const exit = await build.settle();
        const predecessorSame = JSON.stringify(observed(f)) === JSON.stringify(f.before);
        const originalSame = JSON.stringify(publicationTree(moved)) === JSON.stringify(original);
        const replacementSame = JSON.stringify(publicationTree(leaf)) === JSON.stringify(foreign);
        fixtureReceipt(id, { qualified: true, exit, predecessorSame, originalSame, replacementSame });
        expect(exit).not.toBe(0);
        expect(predecessorSame).toBe(true);
        expect(originalSame).toBe(true);
        expect(replacementSame).toBe(true);
      } finally {
        await build.cleanup();
      }
    },
    610_000,
  );

  it("R02 publishes exactly one of two builds with the same predecessor", async () => {
    const deadline = Date.now() + 550_000;
    const f = makeInPlaceFixture();
    preparePublication(f, "R02");
    const predecessor = publicationTree(f.dist);
    const a = startPublication(f, "A", "R02");
    const b = startPublication(f, "B", "R02");
    try {
      const [left, right] = await Promise.all([a.ready(deadline), b.ready(deadline)]);
      const winner = publicationTree(left.stageDist);
      const loser = publicationTree(right.stageDist);
      expect(left.stage).not.toBe(right.stage);
      expect(winner.identity).not.toBeNull();
      expect(loser.identity).not.toBeNull();
      expect(winner.identity?.ino).not.toBe(loser.identity?.ino);
      expect(publicationTree(f.dist)).toEqual(predecessor);
      a.proceed();
      const first = await a.settle();
      const afterFirst = publicationTree(f.dist);
      b.proceed();
      const second = await b.settle();
      const afterSecond = publicationTree(f.dist);
      const exactWinner = JSON.stringify(afterFirst) === JSON.stringify(winner);
      const stalePreserved = JSON.stringify(afterSecond) === JSON.stringify(afterFirst);
      const launcherSame = JSON.stringify(f.link()) === JSON.stringify(f.before.link);
      const loserRetained = publicationIdentity(right.stage) !== null;
      const loserIntact = !loserRetained || JSON.stringify(publicationTree(right.stageDist)) === JSON.stringify(loser);
      fixtureReceipt("R02", {
        qualified: true,
        prepared: 2,
        first,
        second,
        exactWinner,
        stalePreserved,
        launcherSame,
        loserIntact,
      });
      expect(first).toBe(0);
      expect(second).not.toBe(0);
      expect(exactWinner).toBe(true);
      expect(stalePreserved).toBe(true);
      expect(launcherSame).toBe(true);
      expect(loserIntact).toBe(true);
    } finally {
      const results = await Promise.allSettled([a.cleanup(), b.cleanup()]);
      expect(
        results.every((result) => result.status === "fulfilled"),
        "unqualified concurrent cleanup",
      ).toBe(true);
    }
  }, 610_000);
});
