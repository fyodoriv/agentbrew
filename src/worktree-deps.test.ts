import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "worktree-deps.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const packageFixture = { name: "fixture", version: "1.0.0", dependencies: { dep: "1.0.0" } };
const depFixture = { name: "dep", version: "1.0.0", dependencies: { leaf: "^1.0.0" } };
const leafFixture = { name: "leaf", version: "1.0.1" };

function lockBytes(marker: string): string {
  return JSON.stringify({
    name: packageFixture.name,
    version: packageFixture.version,
    lockfileVersion: 3,
    requires: true,
    fixtureMarker: JSON.parse(marker),
    packages: {
      "": packageFixture,
      "node_modules/dep": { version: depFixture.version, dependencies: depFixture.dependencies },
      "node_modules/leaf": { version: leafFixture.version },
    },
  });
}

function installFixture(root: string) {
  for (const manifest of [depFixture, leafFixture]) {
    const dir = join(root, "node_modules", manifest.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  }
}

/** A main checkout with node_modules, a worktree, and an npm stub that logs its args. */
function setup(opts: { worktreeLock: string; mainModules?: boolean; env?: Record<string, string> }) {
  const root = mkdtempSync(join(tmpdir(), "worktree-deps-"));
  roots.push(root);
  const main = join(root, "main");
  const wt = join(root, "wt");
  mkdirSync(main);
  mkdirSync(wt);
  for (const checkout of [main, wt]) writeFileSync(join(checkout, "package.json"), JSON.stringify(packageFixture));
  writeFileSync(join(main, "package-lock.json"), lockBytes('{"lock":1}'));
  writeFileSync(join(wt, "package-lock.json"), lockBytes(opts.worktreeLock));
  if (opts.mainModules !== false) {
    installFixture(main);
    writeFileSync(join(main, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  }
  const log = join(root, "npm.log");
  const npm = join(root, "npm-stub");
  writeFileSync(
    npm,
    `#!/bin/sh
if [ "$1" != ci ]; then
  if [ "${"$"}{CHANGE_LOCK_DURING_CHECK:-}" = 1 ] && [ "$6" = --package-lock-only=true ]; then
    npm "$@" || exit
    printf '\n' >> "$2/package-lock.json"
    exit
  fi
  exec npm "$@"
fi
echo "$@" >> "${log}"
mkdir -p node_modules/dep node_modules/leaf
printf '%s\\n' '${JSON.stringify(depFixture)}' > node_modules/dep/package.json
printf '%s\\n' '${JSON.stringify(leafFixture)}' > node_modules/leaf/package.json
touch node_modules/.from-npm-ci
if [ -n "${"$"}{LINK_STAMP_TO:-}" ]; then
  ln -s "$LINK_STAMP_TO" node_modules/.worktree-deps-lock.json
fi
`,
  );
  chmodSync(npm, 0o755);
  const runIn = (cwd: string, extra: Record<string, string> = {}) =>
    spawnSync("bash", [SCRIPT, main], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, WORKTREE_DEPS_NPM: npm, ...opts.env, ...extra },
    });
  const run = () => runIn(wt);
  const npmCalls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { main, wt, run, runIn, npmCalls };
}

describe("worktree-deps.sh", () => {
  it.runIf(process.platform === "darwin")("clones node_modules when the lockfiles match", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cloned node_modules");
    expect(readFileSync(join(wt, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(npmCalls()).toBe("");
  });

  it.runIf(process.platform === "darwin")("clones the whole tree with one clonefile(2) call on macOS", () => {
    const { run } = setup({ worktreeLock: '{"lock":1}\n' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cloned node_modules with clonefile(2)");
  });

  it.runIf(process.platform === "darwin")("falls back to cp -cR when the one-call clone is not available", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n', env: { WORKTREE_DEPS_PYTHON: "false" } });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cloned node_modules with cp -cR");
    expect(readFileSync(join(wt, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(npmCalls()).toBe("");
  });

  it.runIf(process.platform === "darwin")(
    "keeps a cloned node_modules when the lockfile has not changed since the clone",
    () => {
      const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n' });
      expect(run().status).toBe(0);
      const marker = join(wt, "node_modules", ".kept.txt");
      writeFileSync(marker, "still here\n");
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("node_modules already matches package-lock.json");
      expect(existsSync(marker)).toBe(true);
      expect(npmCalls()).toBe("");
    },
  );

  it.runIf(process.platform === "darwin")("clones again when the lockfile changed since the last clone", () => {
    const { main, wt, run } = setup({ worktreeLock: '{"lock":1}\n' });
    expect(run().status).toBe(0);
    const marker = join(wt, "node_modules", ".stale.txt");
    writeFileSync(marker, "stale\n");
    writeFileSync(join(main, "package-lock.json"), lockBytes('{"lock":3}'));
    writeFileSync(join(wt, "package-lock.json"), lockBytes('{"lock":3}'));
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("cloned node_modules");
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(wt, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
  });

  it("runs npm ci with --prefer-offline --no-audit --no-fund when the lockfiles differ", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("package-lock.json differs");
    expect(npmCalls().trim()).toBe("ci --prefer-offline --no-audit --no-fund");
    expect(existsSync(join(wt, "node_modules", ".from-npm-ci"))).toBe(true);
    expect(existsSync(join(wt, "node_modules", "dep", "index.js"))).toBe(false);
  });

  it("skips npm ci when the lockfile has not changed since the last npm ci", () => {
    const { run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    expect(run().status).toBe(0);
    const before = performance.now();
    const result = run();
    const elapsed = Math.round(performance.now() - before);
    console.info(`Healthy matching rerun: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(5000);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("node_modules already matches package-lock.json");
    expect(npmCalls().trim().split("\n")).toHaveLength(1);
  });

  it("runs npm ci again when the lockfile changed since the last npm ci", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    expect(run().status).toBe(0);
    writeFileSync(join(wt, "package-lock.json"), lockBytes('{"lock":4}'));
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("running npm ci");
    expect(npmCalls().trim().split("\n")).toHaveLength(2);
  });

  it("skips npm ci in the main checkout when the lockfile is unchanged", () => {
    const { main, runIn, npmCalls } = setup({ worktreeLock: '{"lock":1}\n', mainModules: false });
    expect(runIn(main).stdout).toContain("this is the main checkout");
    const result = runIn(main);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("node_modules already matches package-lock.json");
    expect(npmCalls().trim().split("\n")).toHaveLength(1);
  });

  it("runs npm ci when the main checkout has no node_modules", () => {
    const { run, npmCalls } = setup({ worktreeLock: '{"lock":1}\n', mainModules: false });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("main checkout has no node_modules");
    expect(npmCalls().trim()).toBe("ci --prefer-offline --no-audit --no-fund");
  });
});

describe("qualified worktree dependency reuse", () => {
  it("refuses a stale donor and installs the correct target versions", () => {
    const { main, wt, runIn, npmCalls } = setup({ worktreeLock: '{"lock":1}' });
    const donor = join(main, "node_modules", "leaf", "package.json");
    writeFileSync(donor, JSON.stringify({ ...leafFixture, version: "1.0.0" }));
    const clone = join(wt, "fixture-clone-called");
    const fakePython = join(wt, "fixture-clone");
    writeFileSync(
      fakePython,
      `#!/bin/sh
touch "${clone}"
cp -R -- "$4" "$5"
`,
      { mode: 0o700 },
    );
    const result = runIn(wt, { WORKTREE_DEPS_PYTHON: fakePython });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(clone)).toBe(false);
    expect(npmCalls().trim()).toBe("ci --prefer-offline --no-audit --no-fund");
    expect(JSON.parse(readFileSync(join(wt, "node_modules", "leaf", "package.json"), "utf8")).version).toBe("1.0.1");
    expect(JSON.parse(readFileSync(donor, "utf8")).version).toBe("1.0.0");
    expect(readFileSync(join(wt, "node_modules", ".worktree-deps-lock.json"), "utf8")).toBe(
      readFileSync(join(wt, "package-lock.json"), "utf8"),
    );
  });

  it("leaves no copied donor stamp when the resulting clone fails verification", () => {
    const { main, wt, runIn } = setup({ worktreeLock: '{"lock":1}' });
    writeFileSync(
      join(main, "node_modules", ".worktree-deps-lock.json"),
      readFileSync(join(main, "package-lock.json"), "utf8"),
    );
    const fakePython = join(wt, "fixture-clone");
    writeFileSync(
      fakePython,
      `#!/bin/sh
cp -R -- "$4" "$5" || exit
printf '%s\\n' '{"name":"leaf","version":"1.0.0"}' > "$5/leaf/package.json"
`,
      { mode: 0o700 },
    );
    const result = runIn(wt, { WORKTREE_DEPS_PYTHON: fakePython });
    expect(result.status).toBe(1);
    expect(existsSync(join(wt, "node_modules", ".worktree-deps-lock.json"))).toBe(false);
    expect(existsSync(join(main, "node_modules", ".worktree-deps-lock.json"))).toBe(true);
  });

  it("refuses a linked readiness stamp without changing its destination", () => {
    const { wt, run } = setup({ worktreeLock: '{"lock":2}' });
    const modules = join(wt, "node_modules");
    const destination = join(wt, "unrelated.txt");
    const stamp = join(modules, ".worktree-deps-lock.json");
    mkdirSync(modules);
    writeFileSync(destination, "preserve this file");
    symlinkSync(destination, stamp);
    const result = run();
    expect(result.status).toBe(1);
    expect(lstatSync(stamp).isSymbolicLink()).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("preserve this file");
  });

  it("refuses a linked readiness stamp created during installation", () => {
    const { wt, runIn } = setup({ worktreeLock: '{"lock":2}' });
    const destination = join(wt, "unrelated.txt");
    const stamp = join(wt, "node_modules", ".worktree-deps-lock.json");
    writeFileSync(destination, "preserve this file");
    const result = runIn(wt, { LINK_STAMP_TO: destination });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the worktree readiness stamp is not a regular file");
    expect(lstatSync(stamp).isSymbolicLink()).toBe(true);
    expect(readFileSync(destination, "utf8")).toBe("preserve this file");
  });

  it("refuses to stamp a lockfile that changes during verification", () => {
    const { wt, runIn } = setup({ worktreeLock: '{"lock":2}' });
    const lock = join(wt, "package-lock.json");
    const before = readFileSync(lock, "utf8");
    const result = runIn(wt, { CHANGE_LOCK_DURING_CHECK: "1" });
    expect(result.status).toBe(1);
    expect(readFileSync(lock, "utf8")).toBe(before + "\n");
    expect(existsSync(join(wt, "node_modules", ".worktree-deps-lock.json"))).toBe(false);
  });

  it("refuses a stale target even when its stamp still matches", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":2}' });
    expect(run().status).toBe(0);
    const leaf = join(wt, "node_modules", "leaf", "package.json");
    const stale = JSON.stringify({ ...leafFixture, version: "1.0.0" });
    writeFileSync(leaf, stale);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("already matches");
    expect(readFileSync(leaf, "utf8")).toBe(stale);
    expect(npmCalls().trim().split("\n")).toHaveLength(1);
  });
});

describe("locked-install helper observation calibration", () => {
  function classify(
    complete: boolean,
    actualExit: number | null,
    selected: boolean,
    exact: boolean,
    refusalProven = false,
  ) {
    if (!complete || actualExit === null) return "inconclusive";
    if (selected && !exact) return "unsafe-permit";
    if (actualExit !== 0) return refusalProven && !selected ? "refused" : "inconclusive";
    return selected && exact ? "supported" : "inconclusive";
  }

  it.each([
    { complete: true, actualExit: 0, selected: true, exact: false, expected: "unsafe-permit" },
    { complete: true, actualExit: 0, selected: true, exact: true, expected: "supported" },
    { complete: true, actualExit: 1, selected: false, exact: false, refusalProven: true, expected: "refused" },
    { complete: true, actualExit: 2, selected: false, exact: false, expected: "inconclusive" },
    { complete: true, actualExit: 1, selected: true, exact: false, expected: "unsafe-permit" },
    { complete: false, actualExit: 0, selected: true, exact: false, expected: "inconclusive" },
    { complete: true, actualExit: 0, selected: false, exact: false, expected: "inconclusive" },
  ])("preserves sealed helper decision $expected ($complete, $actualExit, $selected, $exact)", (sample) => {
    expect(
      classify(
        sample.complete,
        sample.actualExit,
        sample.selected,
        sample.exact,
        "refusalProven" in sample && sample.refusalProven === true,
      ),
    ).toBe(sample.expected);
  });

  describe.runIf(process.env.LOCKED_INSTALL_OBSERVATION === "1")("qualified helper boundaries", () => {
    const rootPackage = { name: "fixture", version: "1.0.0", dependencies: { "fixture-parent": "1.0.0" } };
    const parentPackage = { name: "fixture-parent", version: "1.0.0", dependencies: { "fixture-leaf": "^1.0.0" } };
    const lock = {
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": rootPackage,
        "node_modules/fixture-parent": { version: "1.0.0", dependencies: { "fixture-leaf": "^1.0.0" } },
        "node_modules/fixture-leaf": { version: "1.0.1" },
      },
    };
    const lockText = `${JSON.stringify(lock)}\n`;
    const hiddenText = `${JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: Object.fromEntries(Object.entries(lock.packages).filter(([key]) => key !== "")),
    })}\n`;
    const ownedFiles = [
      "fixture-parent/package.json",
      "fixture-leaf/package.json",
      "fixture-leaf/payload",
      ".package-lock.json",
      ".worktree-deps-lock.json",
    ];
    function ownedIdentity(root: string) {
      return ownedFiles.map((name) => {
        const file = join(root, "node_modules", name);
        const stat = lstatSync(file);
        return {
          name,
          regular: stat.isFile() && !stat.isSymbolicLink(),
          dev: stat.dev,
          ino: stat.ino,
          hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
        };
      });
    }

    function qualifiedNpmCli(root: string, env: NodeJS.ProcessEnv): string | null {
      const cli = process.env.LOCKED_INSTALL_OBSERVATION_NPM_CLI ?? process.env.npm_execpath;
      if (!cli || !isAbsolute(cli)) return null;
      try {
        const metadata = JSON.parse(readFileSync(join(dirname(dirname(cli)), "package.json"), "utf8"));
        if (!lstatSync(cli).isFile() || metadata.name !== "npm" || metadata.version !== "10.9.9") return null;
        const version = spawnSync(process.execPath, [cli, "--offline", "--version"], {
          cwd: root,
          env,
          encoding: "utf8",
          timeout: 10_000,
        });
        return version.status === 0 && version.stdout.trim() === "10.9.9" ? cli : null;
      } catch {
        return null;
      }
    }

    function writeTree(root: string, version: "1.0.0" | "1.0.1") {
      const modules = join(root, "node_modules");
      for (const [name, metadata] of [
        ["fixture-parent", parentPackage],
        ["fixture-leaf", { name: "fixture-leaf", version }],
      ] as const) {
        const dir = join(modules, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "package.json"), `${JSON.stringify(metadata)}\n`);
      }
      writeFileSync(join(modules, "fixture-leaf", "payload"), `fixture-leaf:${version}\n`);
      writeFileSync(join(modules, ".package-lock.json"), hiddenText);
      writeFileSync(join(modules, ".worktree-deps-lock.json"), lockText);
    }

    function inspectTree(root: string) {
      try {
        const modules = join(root, "node_modules");
        const metadata = JSON.parse(readFileSync(join(modules, "fixture-leaf", "package.json"), "utf8"));
        const parent = JSON.parse(readFileSync(join(modules, "fixture-parent", "package.json"), "utf8"));
        const payload = readFileSync(join(modules, "fixture-leaf", "payload"), "utf8");
        return {
          inspected: true,
          physicalLeafVersion: typeof metadata.version === "string" ? metadata.version : null,
          fixtureContentEqual:
            metadata.name === "fixture-leaf" &&
            metadata.version === "1.0.1" &&
            payload === "fixture-leaf:1.0.1\n" &&
            parent.name === "fixture-parent" &&
            parent.version === "1.0.0" &&
            parent.dependencies?.["fixture-leaf"] === "^1.0.0",
          inputContentEqual:
            metadata.name === "fixture-leaf" &&
            payload === `fixture-leaf:${metadata.version}\n` &&
            parent.name === "fixture-parent" &&
            parent.version === "1.0.0" &&
            parent.dependencies?.["fixture-leaf"] === "^1.0.0",
          hiddenLockEqual: readFileSync(join(modules, ".package-lock.json"), "utf8") === hiddenText,
          stampEqual: readFileSync(join(modules, ".worktree-deps-lock.json"), "utf8") === lockText,
        };
      } catch (error) {
        return {
          inspected: (error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError,
          physicalLeafVersion: null,
          fixtureContentEqual: false,
          inputContentEqual: false,
          hiddenLockEqual: false,
          stampEqual: false,
        };
      }
    }

    it.each([
      { scenario: "N2", donorVersion: "1.0.0", targetVersion: null },
      { scenario: "N3", donorVersion: "1.0.1", targetVersion: "1.0.0" },
      { scenario: "P2", donorVersion: "1.0.1", targetVersion: null },
    ] as const)("$scenario records physical content and the real helper decision", (sample) => {
      const fixture = setup({
        worktreeLock: lockText,
        env: {
          BASH_ENV: "",
          ENV: "",
          NODE_OPTIONS: "",
          NODE_PATH: "",
          WORKTREE_DEPS_PYTHON: "/usr/bin/python3",
          PATH: [
            process.execPath.slice(0, process.execPath.lastIndexOf("/")),
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
          ].join(":"),
        },
      });
      const npmEnv = {
        HOME: fixture.wt,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        npm_config_offline: "true",
        npm_config_ignore_scripts: "true",
        npm_config_update_notifier: "false",
        npm_config_cache: join(fixture.wt, ".observation-npm-cache"),
        npm_config_userconfig: join(fixture.wt, "observation-user.npmrc"),
        npm_config_globalconfig: join(fixture.wt, "observation-global.npmrc"),
      };
      writeFileSync(npmEnv.npm_config_userconfig, "");
      writeFileSync(npmEnv.npm_config_globalconfig, "");
      const npmCli = qualifiedNpmCli(fixture.wt, npmEnv);
      if (!npmCli) {
        console.info(
          `LOCKED_INSTALL_OBSERVATION ${JSON.stringify({
            scenario: sample.scenario,
            boundary: "worktree-helper",
            complete: false,
            classification: "inconclusive",
            setupFailure: "npm-tool-unqualified",
          })}`,
        );
        throw new Error("The frozen helper observation requires qualified npm 10.9.9");
      }
      for (const name of ["dep", "leaf"]) rmSync(join(fixture.main, "node_modules", name), { recursive: true });
      for (const root of [fixture.main, fixture.wt]) {
        writeFileSync(join(root, "package.json"), `${JSON.stringify(rootPackage)}\n`);
        writeFileSync(join(root, "package-lock.json"), lockText);
      }
      writeTree(fixture.main, sample.donorVersion);
      if (sample.targetVersion) writeTree(fixture.wt, sample.targetVersion);
      const npmPath = join(fixture.main, "..", "npm-stub");
      const npmLog = join(fixture.main, "..", "npm.log");
      writeFileSync(
        npmPath,
        `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);
const roots=${JSON.stringify([realpathSync(fixture.main), realpathSync(fixture.wt)])};
const comparisons=[
 ["ls","--depth=0","--loglevel=error","--package-lock-only=false","--json"],
 ["query","*","--package-lock-only=false","--json"],
 ["query","*","--package-lock-only=true","--json"]
];
if(args[0]==="--prefix" && roots.includes(args[1]) && args[2]==="--offline" &&
 comparisons.some((expected)=>JSON.stringify(expected)===JSON.stringify(args.slice(3)))){
 const result=require("node:child_process").spawnSync(process.execPath,[${JSON.stringify(npmCli)},...args],{env:${JSON.stringify(npmEnv)},stdio:"inherit",timeout:10000});
 process.exit(result.status??2);
}
if(process.cwd()!==${JSON.stringify(realpathSync(fixture.wt))}||JSON.stringify(args)!==JSON.stringify(['ci','--prefer-offline','--no-audit','--no-fund']))process.exit(2);
fs.appendFileSync(${JSON.stringify(npmLog)},args.join(' ')+'\\n');
for(const [name,metadata] of [['fixture-parent',${JSON.stringify(parentPackage)}],['fixture-leaf',{name:'fixture-leaf',version:'1.0.1'}]]){
 const dir=path.join('node_modules',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(metadata)+'\\n');
}
fs.writeFileSync('node_modules/fixture-leaf/payload','fixture-leaf:1.0.1\\n');
fs.writeFileSync('node_modules/.package-lock.json',${JSON.stringify(hiddenText)});\n`,
      );
      chmodSync(npmPath, 0o755);
      const donorBefore = inspectTree(fixture.main);
      const targetBefore = inspectTree(fixture.wt);
      const targetFilesBefore = sample.targetVersion ? ownedIdentity(fixture.wt) : [];
      const donorFilesBefore = ownedIdentity(fixture.main);
      const donorIdentityBefore = lstatSync(join(fixture.main, "node_modules"));
      const result = fixture.run();
      const target = inspectTree(fixture.wt);
      const selection = result.stdout.includes("cloned node_modules")
        ? "clone"
        : result.stdout.includes("node_modules already matches")
          ? "shortcut"
          : result.stdout.includes("running npm ci")
            ? "install"
            : null;
      const donorAfter = inspectTree(fixture.main);
      const donorFilesAfter = ownedIdentity(fixture.main);
      const donorIdentityAfter = lstatSync(join(fixture.main, "node_modules"));
      const targetFiles =
        target.inspected && ownedFiles.every((name) => existsSync(join(fixture.wt, "node_modules", name)))
          ? ownedIdentity(fixture.wt)
          : [];
      const independentTarget =
        existsSync(join(fixture.wt, "node_modules")) &&
        !lstatSync(join(fixture.wt, "node_modules")).isSymbolicLink() &&
        (lstatSync(join(fixture.wt, "node_modules")).dev !== donorIdentityBefore.dev ||
          lstatSync(join(fixture.wt, "node_modules")).ino !== donorIdentityBefore.ino) &&
        targetFiles.length === ownedFiles.length &&
        targetFiles.every(
          (file, index) =>
            file.regular && (file.dev !== donorFilesBefore[index].dev || file.ino !== donorFilesBefore[index].ino),
        );
      const donorUnchanged =
        JSON.stringify(donorAfter) === JSON.stringify(donorBefore) &&
        donorIdentityBefore.ino === donorIdentityAfter.ino &&
        donorIdentityBefore.dev === donorIdentityAfter.dev &&
        JSON.stringify(donorFilesBefore) === JSON.stringify(donorFilesAfter);
      const npmCalls = fixture.npmCalls().trim().split("\n").filter(Boolean);
      const cloneProven = selection === "clone" && npmCalls.length === 0 && independentTarget && donorUnchanged;
      const staleVersionReported = result.stderr.includes(
        "Build pipeline guard: an installed package differs from the selected lockfile version",
      );
      const refusalProven =
        sample.scenario === "N3" &&
        staleVersionReported &&
        result.status === 1 &&
        selection === null &&
        npmCalls.length === 0 &&
        result.stderr.includes("worktree-deps: stamped dependencies differ from the lock; run npm ci") &&
        JSON.stringify(targetBefore) === JSON.stringify(target) &&
        JSON.stringify(targetFilesBefore) === JSON.stringify(targetFiles);
      const complete =
        !result.error &&
        typeof result.status === "number" &&
        donorBefore.inspected &&
        donorBefore.hiddenLockEqual &&
        donorBefore.stampEqual &&
        donorBefore.physicalLeafVersion === sample.donorVersion &&
        donorBefore.inputContentEqual &&
        donorUnchanged &&
        [fixture.main, fixture.wt].every(
          (root) => readFileSync(join(root, "package-lock.json"), "utf8") === lockText,
        ) &&
        target.inspected &&
        (result.status !== 0 || selection !== null) &&
        (sample.scenario !== "N3" ||
          (targetBefore.hiddenLockEqual &&
            targetBefore.stampEqual &&
            targetBefore.physicalLeafVersion === "1.0.0" &&
            targetBefore.inputContentEqual)) &&
        (sample.scenario !== "P2" || cloneProven);
      const classification = classify(
        complete,
        result.status,
        selection === "clone" ||
          selection === "shortcut" ||
          (selection === "install" && result.status === 0 && target.stampEqual),
        target.fixtureContentEqual && target.stampEqual && target.hiddenLockEqual,
        refusalProven,
      );
      const decisionComplete = complete && classification !== "inconclusive";
      const observation = {
        scenario: sample.scenario,
        boundary: "worktree-helper",
        actualExit: result.status,
        selection,
        npmCalls,
        donorPhysicalLeafVersion: donorBefore.physicalLeafVersion,
        inputHiddenLockEqual: sample.scenario === "N3" ? targetBefore.hiddenLockEqual : donorBefore.hiddenLockEqual,
        inputStampEqual: sample.scenario === "N3" ? targetBefore.stampEqual : donorBefore.stampEqual,
        independentTarget,
        donorUnchanged,
        cloneProven,
        ...target,
        complete: decisionComplete,
        setupFailure: result.status !== 0 && !refusalProven ? "helper-exit-unqualified" : null,
        refusalProven,
        staleVersionReported,
        classification,
        meetsRequiredDecision: {
          N2:
            staleVersionReported &&
            classification === "supported" &&
            selection === "install" &&
            npmCalls.length === 1 &&
            independentTarget,
          N3: classification === "refused",
          P2: classification === "supported" && cloneProven,
        }[sample.scenario],
      };
      console.info(`LOCKED_INSTALL_OBSERVATION ${JSON.stringify(observation)}`);
      expect(decisionComplete, `${sample.scenario} observation is incomplete; it is not zero unsafe permits`).toBe(
        true,
      );
    });
  });
});
