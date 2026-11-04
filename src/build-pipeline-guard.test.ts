import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const guardScript = join(import.meta.dirname, "..", "scripts", "build-pipeline-guard.sh");

let testDir: string;

function writePackageFiles(): void {
  writeFileSync(
    join(testDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: {
        chalk: "5.6.2",
      },
    }),
  );
  writeFileSync(
    join(testDir, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture",
          version: "1.0.0",
          dependencies: {
            chalk: "5.6.2",
          },
        },
        "node_modules/chalk": {
          version: "5.6.2",
        },
      },
    }),
  );
}

function runGuard(mode: string): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTBREW_REPO_ROOT: testDir,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
  delete env.BASH_ENV;
  delete env.ENV;
  return spawnSync("bash", [guardScript, mode], {
    cwd: testDir,
    env,
    encoding: "utf8",
  });
}

beforeEach(() => {
  testDir = join(tmpdir(), `agentbrew-build-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("build-pipeline-guard.sh", () => {
  it("fails before build when node_modules is missing", () => {
    writePackageFiles();

    const result = runGuard("--deps-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deps out of sync");
    expect(result.stderr).toContain("run npm ci");
    expect(result.stderr).toContain("node_modules is missing");
  });

  it("fails when npm reports lockfile/node_modules drift", () => {
    writePackageFiles();
    mkdirSync(join(testDir, "node_modules"), { recursive: true });

    const result = runGuard("--deps-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deps out of sync");
    expect(result.stderr).toContain("run npm ci");
  }, 15_000);

  it("fails when dist/cli.js is missing after build", () => {
    const result = runGuard("--dist-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist/cli.js missing");
    expect(result.stderr).toContain("npm run build");
  });

  it("passes when dist/cli.js prints a version", () => {
    const distDir = join(testDir, "dist");
    const cliPath = join(distDir, "cli.js");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(cliPath, '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
    chmodSync(cliPath, 0o755);

    const result = runGuard("--dist-only");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dist/cli.js --version printed 1.2.3");
  });
});

type EvidenceState = "complete" | "failed" | "missing" | "malformed";
type ObservationDecision = "unsafe-permit" | "supported" | "refused" | "inconclusive";
type GuardScenario = "N1" | "N5" | "P1" | "P3" | "P4";
type ToolMode = "real" | "failed" | "missing" | "malformed";

interface GuardDecisionInput {
  observationComplete: boolean;
  exit: number | null;
  readiness: boolean | null;
  evidence: EvidenceState;
  fixtureMatches: boolean | null;
}

function classifyGuardObservation(input: GuardDecisionInput): ObservationDecision {
  if (!input.observationComplete || input.exit === null || input.readiness === null || input.fixtureMatches === null) {
    return "inconclusive";
  }
  if (!input.readiness) return "refused";
  if (input.exit !== 0 || input.evidence !== "complete" || !input.fixtureMatches) return "unsafe-permit";
  return "supported";
}

const sealedGuardSamples: ReadonlyArray<{ name: string; input: GuardDecisionInput; want: ObservationDecision }> = [
  {
    name: "stale content with a readiness receipt",
    input: { observationComplete: true, exit: 0, readiness: true, evidence: "complete", fixtureMatches: false },
    want: "unsafe-permit",
  },
  {
    name: "complete matching content",
    input: { observationComplete: true, exit: 0, readiness: true, evidence: "complete", fixtureMatches: true },
    want: "supported",
  },
  {
    name: "a real refusal",
    input: { observationComplete: true, exit: 1, readiness: false, evidence: "failed", fixtureMatches: false },
    want: "refused",
  },
  {
    name: "failed evidence with readiness",
    input: { observationComplete: true, exit: 1, readiness: true, evidence: "failed", fixtureMatches: true },
    want: "unsafe-permit",
  },
  {
    name: "missing evidence with readiness",
    input: { observationComplete: true, exit: 0, readiness: true, evidence: "missing", fixtureMatches: true },
    want: "unsafe-permit",
  },
  {
    name: "malformed evidence with readiness",
    input: { observationComplete: true, exit: 0, readiness: true, evidence: "malformed", fixtureMatches: true },
    want: "unsafe-permit",
  },
  {
    name: "missing observation",
    input: { observationComplete: false, exit: 0, readiness: true, evidence: "complete", fixtureMatches: true },
    want: "inconclusive",
  },
  {
    name: "missing exit",
    input: { observationComplete: true, exit: null, readiness: true, evidence: "complete", fixtureMatches: true },
    want: "inconclusive",
  },
  {
    name: "missing marker observation",
    input: { observationComplete: true, exit: 0, readiness: null, evidence: "complete", fixtureMatches: true },
    want: "inconclusive",
  },
  {
    name: "missing physical observation",
    input: { observationComplete: true, exit: 0, readiness: true, evidence: "complete", fixtureMatches: null },
    want: "inconclusive",
  },
  {
    name: "spawn failure cannot be a functional refusal",
    input: { observationComplete: false, exit: 1, readiness: false, evidence: "failed", fixtureMatches: true },
    want: "inconclusive",
  },
  {
    name: "failed capability cannot qualify an error JSON object",
    input: { observationComplete: false, exit: 0, readiness: true, evidence: "complete", fixtureMatches: true },
    want: "inconclusive",
  },
];

describe("locked-install guard recorder calibration", () => {
  it.each(sealedGuardSamples)("preserves $name", ({ input, want }) => {
    expect(classifyGuardObservation(input)).toBe(want);
  });
});

interface CommandObservation {
  exit: number | null;
  signal: string | null;
  error: "spawn-error" | null;
  stdout: string;
  stderr: string;
}

interface PackageObservation {
  name: string | null;
  version: string | null;
  manifestSha256: string | null;
  payloadSha256: string | null;
  link: string | null;
}

interface GuardFixture {
  scenario: GuardScenario;
  leafVersion: "1.0.0" | "1.0.1";
  lockBytes: string;
  hiddenBytes: string;
  manifestBytes: string;
  expectedStub: { manifest: string; payload: string } | null;
}

function observationHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function observationJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function observationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function observationEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENTBREW_REPO_ROOT: testDir };
  for (const name of Object.keys(env)) {
    if (/^npm_config_/iu.test(name)) delete env[name];
  }
  Object.assign(env, {
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_update_notifier: "false",
    npm_config_cache: join(testDir, ".npm-cache"),
    npm_config_userconfig: join(testDir, ".npmrc"),
    npm_config_globalconfig: join(testDir, "global.npmrc"),
  });
  for (const name of [
    "BASH_ENV",
    "ENV",
    "NODE_OPTIONS",
    "NODE_PATH",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
  ])
    delete env[name];
  return env;
}

function observeCommand(command: string, args: string[], env = observationEnv()): CommandObservation {
  const result = spawnSync(command, args, {
    cwd: testDir,
    env,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exit: result.status,
    signal: result.signal,
    error: result.error ? "spawn-error" : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function qualifyObservationNpm(): { cli: string | null; version: CommandObservation | null; reason: string } {
  const cli = process.env.LOCKED_INSTALL_OBSERVATION_NPM_CLI ?? process.env.npm_execpath;
  if (!cli || !isAbsolute(cli)) return { cli: null, version: null, reason: "npm-tool-missing" };
  try {
    const metadata = observationJson(readFileSync(join(dirname(dirname(cli)), "package.json"), "utf8"));
    if (
      !lstatSync(cli).isFile() ||
      !observationObject(metadata) ||
      metadata.name !== "npm" ||
      metadata.version !== "10.9.9"
    ) {
      return { cli: null, version: null, reason: "npm-tool-unqualified" };
    }
    const version = observeCommand(process.execPath, [cli, "--version"]);
    if (version.exit !== 0 || version.signal || version.error || version.stdout.trim() !== "10.9.9") {
      return { cli: null, version, reason: "npm-version-unqualified" };
    }
    return { cli, version, reason: "qualified" };
  } catch {
    return { cli: null, version: null, reason: "npm-tool-unreadable" };
  }
}

function createObservationFixture(scenario: GuardScenario): GuardFixture {
  const optional = scenario === "P3";
  const stub = scenario === "P4";
  const leafVersion = scenario === "N1" ? "1.0.0" : "1.0.1";
  const dependencies: Record<string, string> = { "fixture-parent": "1.0.0" };
  if (stub) dependencies["jks-js"] = "file:scripts/stubs/jks-js";
  const root = {
    name: "fixture-root",
    version: "1.0.0",
    dependencies,
    ...(optional ? { optionalDependencies: { "fixture-optional": "1.0.0" } } : {}),
  };
  const packages: Record<string, unknown> = {
    "": root,
    "node_modules/fixture-parent": { version: "1.0.0", dependencies: { "fixture-leaf": "^1.0.0" } },
    "node_modules/fixture-leaf": { version: "1.0.1" },
  };
  if (optional) {
    packages["node_modules/fixture-optional"] = {
      version: "1.0.0",
      optional: true,
      os: ["fixture-unsupported-platform"],
      cpu: ["fixture-unsupported-architecture"],
    };
  }
  let expectedStub: GuardFixture["expectedStub"] = null;
  if (stub) {
    const source = join(import.meta.dirname, "..", "scripts", "stubs", "jks-js");
    const target = join(testDir, "scripts", "stubs", "jks-js");
    expectedStub = {
      manifest: readFileSync(join(source, "package.json"), "utf8"),
      payload: readFileSync(join(source, "index.js"), "utf8"),
    };
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
    packages["node_modules/jks-js"] = { resolved: "scripts/stubs/jks-js", link: true };
    packages["scripts/stubs/jks-js"] = observationJson(expectedStub.manifest);
  }
  const manifestBytes = `${JSON.stringify(root, null, 2)}\n`;
  writeFileSync(join(testDir, "package.json"), manifestBytes);
  writeFileSync(join(testDir, ".npmrc"), "");
  writeFileSync(join(testDir, "global.npmrc"), "");
  for (const [name, metadata] of [
    ["fixture-parent", { name: "fixture-parent", version: "1.0.0", dependencies: { "fixture-leaf": "^1.0.0" } }],
    ["fixture-leaf", { name: "fixture-leaf", version: leafVersion }],
  ] as const) {
    const dir = join(testDir, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    writeFileSync(join(dir, "index.js"), `module.exports = ${JSON.stringify(name)};\n`);
  }
  if (stub) symlinkSync(join("..", "scripts", "stubs", "jks-js"), join(testDir, "node_modules", "jks-js"), "dir");
  const lockBytes = `${JSON.stringify({ name: "fixture-root", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`;
  const hiddenBytes = `${JSON.stringify({ name: "fixture-root", version: "1.0.0", lockfileVersion: 3, requires: true, packages: Object.fromEntries(Object.entries(packages).filter(([key]) => key !== "")) }, null, 2)}\n`;
  writeFileSync(join(testDir, "package-lock.json"), lockBytes);
  writeFileSync(join(testDir, "node_modules", ".package-lock.json"), hiddenBytes);
  writeFileSync(join(testDir, "node_modules", ".worktree-deps-lock.json"), lockBytes);
  return { scenario, leafVersion, lockBytes, hiddenBytes, manifestBytes, expectedStub };
}

function observePhysicalPackage(name: string): PackageObservation {
  const dir = join(testDir, "node_modules", name);
  try {
    const manifest = readFileSync(join(dir, "package.json"));
    const data = observationJson(manifest.toString("utf8"));
    return {
      name: observationObject(data) && typeof data.name === "string" ? data.name : null,
      version: observationObject(data) && typeof data.version === "string" ? data.version : null,
      manifestSha256: observationHash(manifest),
      payloadSha256: observationHash(readFileSync(join(dir, "index.js"))),
      link: lstatSync(dir).isSymbolicLink() ? readlinkSync(dir) : null,
    };
  } catch {
    return { name: null, version: null, manifestSha256: null, payloadSha256: null, link: null };
  }
}

function observationPathAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
  }
}

function observationFixtureState(fixture: GuardFixture) {
  const leaf = observePhysicalPackage("fixture-leaf");
  const parent = observePhysicalPackage("fixture-parent");
  const stub = fixture.expectedStub ? observePhysicalPackage("jks-js") : null;
  const manifestUnchanged = readFileSync(join(testDir, "package.json"), "utf8") === fixture.manifestBytes;
  const optionalAbsent = observationPathAbsent(join(testDir, "node_modules", "fixture-optional"));
  const lockUnchanged = readFileSync(join(testDir, "package-lock.json"), "utf8") === fixture.lockBytes;
  const hiddenUnchanged =
    readFileSync(join(testDir, "node_modules", ".package-lock.json"), "utf8") === fixture.hiddenBytes;
  const stampMatches =
    readFileSync(join(testDir, "node_modules", ".worktree-deps-lock.json"), "utf8") === fixture.lockBytes;
  const hiddenNewEnough =
    statSync(join(testDir, "node_modules", ".package-lock.json")).mtimeMs >=
    Math.max(
      statSync(join(testDir, "node_modules", "fixture-parent")).mtimeMs,
      statSync(join(testDir, "node_modules", "fixture-leaf")).mtimeMs,
    );
  const stubMatches =
    !fixture.expectedStub ||
    (!!stub &&
      stub.name === "jks-js" &&
      stub.version === "0.0.0-agentbrew-stub" &&
      stub.link === join("..", "scripts", "stubs", "jks-js") &&
      realpathSync(join(testDir, "node_modules", "jks-js")) ===
        realpathSync(join(testDir, "scripts", "stubs", "jks-js")) &&
      stub.manifestSha256 === observationHash(fixture.expectedStub.manifest) &&
      stub.payloadSha256 === observationHash(fixture.expectedStub.payload));
  const valid =
    leaf.name === "fixture-leaf" &&
    leaf.version === fixture.leafVersion &&
    leaf.payloadSha256 === observationHash('module.exports = "fixture-leaf";\n') &&
    parent.name === "fixture-parent" &&
    parent.version === "1.0.0" &&
    parent.manifestSha256 ===
      observationHash(
        `${JSON.stringify({ name: "fixture-parent", version: "1.0.0", dependencies: { "fixture-leaf": "^1.0.0" } }, null, 2)}\n`,
      ) &&
    parent.payloadSha256 === observationHash('module.exports = "fixture-parent";\n') &&
    manifestUnchanged &&
    optionalAbsent &&
    lockUnchanged &&
    hiddenUnchanged &&
    stampMatches &&
    hiddenNewEnough &&
    stubMatches;
  return {
    leaf,
    parent,
    stub,
    manifestUnchanged,
    optionalAbsent,
    lockUnchanged,
    hiddenUnchanged,
    stampMatches,
    hiddenNewEnough,
    stubMatches,
    valid,
    matchesLock: valid && leaf.version === "1.0.1",
  };
}

function writeObservationNpmPort(cli: string, mode: ToolMode): { bin: string; capture: string } {
  const bin = join(testDir, "observation-bin");
  const capture = join(testDir, "guard-npm-response.json");
  mkdirSync(bin);
  const finite =
    mode === "failed"
      ? { exit: 1, stdout: "", stderr: "synthetic comparison failure\n" }
      : mode === "missing"
        ? { exit: 0, stdout: '{"name":"fixture-root","version":"1.0.0"}\n', stderr: "" }
        : { exit: 0, stdout: "synthetic malformed JSON\n", stderr: "" };
  const body =
    mode === "real"
      ? `
const result = require("node:child_process").spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], {encoding:"utf8", timeout:10000, maxBuffer:1048576, stdio:["ignore","pipe","pipe"]});
const output = {exit:result.status, signal:result.signal, error:result.error ? "spawn-error" : null, stdout:result.stdout ?? "", stderr:result.stderr ?? ""};`
      : `const output = {...${JSON.stringify(finite)}, signal:null, error:null};`;
  writeFileSync(
    join(bin, "npm"),
    `#!${process.execPath}\n${body}\nrequire("node:fs").writeFileSync(${JSON.stringify(capture)}, JSON.stringify(output), {mode:0o600});\nprocess.stdout.write(output.stdout);\nprocess.stderr.write(output.stderr);\nprocess.exit(output.exit ?? 126);\n`,
    { mode: 0o755 },
  );
  return { bin, capture };
}

function readObservationCapture(path: string): CommandObservation | null {
  try {
    const value = observationJson(readFileSync(path, "utf8"));
    if (
      !observationObject(value) ||
      !(value.exit === null || Number.isInteger(value.exit)) ||
      !(value.signal === null || typeof value.signal === "string") ||
      !(value.error === null || value.error === "spawn-error") ||
      typeof value.stdout !== "string" ||
      typeof value.stderr !== "string"
    )
      return null;
    return value as unknown as CommandObservation;
  } catch {
    return null;
  }
}

function completeQueryRows(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return (
    value.some(
      (row: unknown) =>
        observationObject(row) && row.name === "fixture-root" && row.version === "1.0.0" && row.location === "",
    ) &&
    ["fixture-parent", "fixture-leaf"].every((name) =>
      value.some(
        (row: unknown) =>
          observationObject(row) &&
          row.name === name &&
          row.location === `node_modules/${name}` &&
          typeof row.version === "string" &&
          (name === "fixture-parent" ? row.version === "1.0.0" : /^1\.0\.[01]$/u.test(row.version)),
      ),
    )
  );
}

function completeLogicalTree(value: unknown): boolean {
  if (
    !observationObject(value) ||
    value.name !== "fixture-root" ||
    value.version !== "1.0.0" ||
    !observationObject(value.dependencies)
  )
    return false;
  const parent = value.dependencies["fixture-parent"];
  if (!observationObject(parent) || parent.version !== "1.0.0" || !observationObject(parent.dependencies)) return false;
  const leaf = parent.dependencies["fixture-leaf"];
  return observationObject(leaf) && typeof leaf.version === "string" && /^1\.0\.[01]$/u.test(leaf.version);
}

function guardEvidenceState(command: CommandObservation | null): EvidenceState {
  if (!command || command.error || command.signal || command.exit !== 0) return "failed";
  const data = observationJson(command.stdout);
  if (!data) return "malformed";
  if (!observationObject(data) || !observationObject(data.dependencies)) return "missing";
  const parent = data.dependencies["fixture-parent"];
  return observationObject(parent) && parent.version === "1.0.0" ? "complete" : "missing";
}

describe.skipIf(process.env.LOCKED_INSTALL_OBSERVATION !== "1")(
  "locked-install guard observations (qualification required)",
  () => {
    it.each([
      { scenario: "N1", mode: "real" },
      { scenario: "N5", mode: "failed" },
      { scenario: "N5", mode: "missing" },
      { scenario: "N5", mode: "malformed" },
      { scenario: "P1", mode: "real" },
      { scenario: "P3", mode: "real" },
      { scenario: "P4", mode: "real" },
    ] as const)("records $scenario/$mode without treating an unsafe baseline as repaired", ({ scenario, mode }) => {
      const fixture = createObservationFixture(scenario);
      const before = observationFixtureState(fixture);
      const tool = qualifyObservationNpm();
      if (!tool.cli) {
        const summary = {
          scenario,
          variant: mode,
          boundary: "guard",
          complete: false,
          classification: "inconclusive",
          reason: tool.reason,
        };
        console.info(
          "LOCKED_INSTALL_OBSERVATION",
          JSON.stringify({ ...summary, toolExit: tool.version?.exit ?? null, physical: before }),
        );
        expect(summary.complete, "qualified npm 10.9.9 evidence is required").toBe(true);
        return;
      }
      const port = writeObservationNpmPort(tool.cli, mode);
      const guard = observeCommand("bash", [guardScript, "--deps-only"], {
        ...observationEnv(),
        PATH: `${port.bin}:${process.env.PATH ?? ""}`,
      });
      const npmResponse = readObservationCapture(port.capture);
      const capability = {
        physicalQuery: observeCommand(process.execPath, [tool.cli, "query", "*", "--json"]),
        lockQuery: observeCommand(process.execPath, [tool.cli, "query", "*", "--package-lock-only", "--json"]),
        logicalTree: observeCommand(process.execPath, [
          tool.cli,
          "ls",
          "--all",
          "--long",
          "--include=optional",
          "--json",
        ]),
      };
      const after = observationFixtureState(fixture);
      const queryRows = observationJson(capability.physicalQuery.stdout);
      const lockRows = observationJson(capability.lockQuery.stdout);
      const tree = observationJson(capability.logicalTree.stdout);
      const capabilityComplete =
        Object.values(capability).every((item) => item.error === null && item.signal === null && item.exit === 0) &&
        completeQueryRows(queryRows) &&
        completeQueryRows(lockRows) &&
        completeLogicalTree(tree);
      const readiness = guard.stdout
        .split(/\r?\n/u)
        .includes("Build pipeline guard: npm dependencies match package-lock.json");
      const responseComplete =
        npmResponse !== null &&
        npmResponse.error === null &&
        npmResponse.signal === null &&
        Number.isInteger(npmResponse.exit) &&
        npmResponse.exit !== null &&
        npmResponse.exit >= 0 &&
        npmResponse.exit <= 255;
      const complete =
        before.valid &&
        after.valid &&
        !guard.error &&
        !guard.signal &&
        guard.exit !== null &&
        responseComplete &&
        capabilityComplete;
      const evidence = guardEvidenceState(npmResponse);
      const classification = classifyGuardObservation({
        observationComplete: complete,
        exit: guard.exit,
        readiness,
        evidence,
        fixtureMatches: after.matchesLock,
      });
      const summary = {
        scenario,
        variant: mode,
        boundary: "guard",
        guardExit: guard.exit,
        readiness,
        npmExit: npmResponse?.exit ?? null,
        physicalLeaf: after.leaf.version,
        hiddenLockUnchanged: after.hiddenUnchanged,
        stampMatches: after.stampMatches,
        comparisonEvidence: evidence,
        complete,
        classification,
        capabilityExits: Object.fromEntries(Object.entries(capability).map(([name, command]) => [name, command.exit])),
      };
      console.info(
        "LOCKED_INSTALL_OBSERVATION",
        JSON.stringify({
          ...summary,
          input: {
            leaf: "1.0.1",
            parentRange: "^1.0.0",
            sourceLockSha256: observationHash(fixture.lockBytes),
            hiddenLockSha256: observationHash(fixture.hiddenBytes),
          },
          before,
          after,
        }),
      );
      console.info(
        "LOCKED_INSTALL_CAPABILITY",
        JSON.stringify({
          scenario,
          variant: mode,
          boundary: "guard",
          toolVersion: tool.version,
          guard,
          npmResponse,
          capability,
        }),
      );
      expect(complete, "all registered scratch observations must be complete").toBe(true);
    }, 60_000);
  },
);
