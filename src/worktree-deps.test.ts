import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "worktree-deps.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A main checkout with node_modules, a worktree, and an npm stub that logs its args. */
function setup(opts: { worktreeLock: string; mainModules?: boolean; env?: Record<string, string> }) {
  const root = mkdtempSync(join(tmpdir(), "worktree-deps-"));
  roots.push(root);
  const main = join(root, "main");
  const wt = join(root, "wt");
  mkdirSync(main);
  mkdirSync(wt);
  writeFileSync(join(main, "package-lock.json"), '{"lock":1}\n');
  writeFileSync(join(wt, "package-lock.json"), opts.worktreeLock);
  if (opts.mainModules !== false) {
    mkdirSync(join(main, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(main, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  }
  const log = join(root, "npm.log");
  const npm = join(root, "npm-stub");
  writeFileSync(npm, `#!/bin/sh\necho "$@" >> "${log}"\nmkdir -p node_modules && touch node_modules/from-npm-ci\n`);
  chmodSync(npm, 0o755);
  const runIn = (cwd: string) =>
    spawnSync("bash", [SCRIPT, main], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, WORKTREE_DEPS_NPM: npm, ...opts.env },
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
      const marker = join(wt, "node_modules", "kept.txt");
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
    const marker = join(wt, "node_modules", "stale.txt");
    writeFileSync(marker, "stale\n");
    writeFileSync(join(main, "package-lock.json"), '{"lock":3}\n');
    writeFileSync(join(wt, "package-lock.json"), '{"lock":3}\n');
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
    expect(existsSync(join(wt, "node_modules", "from-npm-ci"))).toBe(true);
    expect(existsSync(join(wt, "node_modules", "dep"))).toBe(false);
  });

  it("skips npm ci when the lockfile has not changed since the last npm ci", () => {
    const { run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    expect(run().status).toBe(0);
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("node_modules already matches package-lock.json");
    expect(npmCalls().trim().split("\n")).toHaveLength(1);
  });

  it("runs npm ci again when the lockfile changed since the last npm ci", () => {
    const { wt, run, npmCalls } = setup({ worktreeLock: '{"lock":2}\n' });
    expect(run().status).toBe(0);
    writeFileSync(join(wt, "package-lock.json"), '{"lock":4}\n');
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
      rmSync(join(fixture.main, "node_modules", "dep"), { recursive: true });
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
if(process.cwd()!==${JSON.stringify(fixture.wt)}||JSON.stringify(args)!==JSON.stringify(['ci','--prefer-offline','--no-audit','--no-fund']))process.exit(2);
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
      const cloneProven = selection === "clone" && fixture.npmCalls() === "" && independentTarget && donorUnchanged;
      const complete =
        !result.error &&
        typeof result.status === "number" &&
        donorBefore.inspected &&
        donorBefore.hiddenLockEqual &&
        donorBefore.stampEqual &&
        donorBefore.physicalLeafVersion === sample.donorVersion &&
        donorBefore.inputContentEqual &&
        donorUnchanged &&
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
      );
      const decisionComplete = complete && classification !== "inconclusive";
      const observation = {
        scenario: sample.scenario,
        boundary: "worktree-helper",
        actualExit: result.status,
        selection,
        npmCalls: fixture.npmCalls().trim().split("\n").filter(Boolean),
        donorPhysicalLeafVersion: donorBefore.physicalLeafVersion,
        inputHiddenLockEqual: sample.scenario === "N3" ? targetBefore.hiddenLockEqual : donorBefore.hiddenLockEqual,
        inputStampEqual: sample.scenario === "N3" ? targetBefore.stampEqual : donorBefore.stampEqual,
        independentTarget,
        donorUnchanged,
        cloneProven,
        ...target,
        complete: decisionComplete,
        setupFailure: result.status !== 0 ? "helper-exit-unqualified" : null,
        classification,
        meetsRequiredDecision:
          sample.scenario === "P2"
            ? classification === "supported"
            : classification === "supported" || classification === "refused",
      };
      console.info(`LOCKED_INSTALL_OBSERVATION ${JSON.stringify(observation)}`);
      expect(decisionComplete, `${sample.scenario} observation is incomplete; it is not zero unsafe permits`).toBe(
        true,
      );
    });
  });
});
