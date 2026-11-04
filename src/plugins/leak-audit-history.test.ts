import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const target = "SYNTHETICMARKER564";
const tail = "SYNTHETICTAIL564";
const framePrefix = "synthetic scanner calibration\n";
const frameSuffix = "\n" + tail + "\n";
const frameLimit = 1024;
const outputLimit = 256 * 1024;
const stderrLimit = 4096;
const toolLimit = 64 * 1024 * 1024;
const scratchLimit = 8 * 1024 * 1024;
const config = `
title = "Synthetic scanner calibration"
[[rules]]
id = "fixture-marker"
description = "Synthetic marker"
regex = "${target}"
[[rules]]
id = "fixture-tail"
description = "Synthetic completion marker"
regex = "${tail}"
`;

type Outcome = { status: 0 | 1 | 2; scannerCalls: number };

function fixture(run: (owner: ReturnType<typeof fixtureOwner>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "history-calibration-"));
  try {
    run(fixtureOwner(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureOwner(dir: string) {
  const home = join(dir, "home");
  const source = join(dir, "source.git");
  const mirror = join(dir, "mirror.git");
  const configPath = join(dir, "scanner.toml");
  const ignorePath = join(dir, "empty.ignore");
  const inputPath = join(dir, "record");
  const reportPath = join(dir, "report.json");
  mkdirSync(home);
  writeFileSync(configPath, config, { mode: 0o600 });
  writeFileSync(ignorePath, "", { mode: 0o600 });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: dir,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "commit.gpgsign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z",
    LC_ALL: "C",
  };
  const deadline = performance.now() + 30_000;
  let scanner: string | undefined;
  let gitOutput = 0;
  let scannerCalls = 0;
  let scannerInput = 0;
  let reportBytes = 0;
  function child(program: string, args: string[], input?: Buffer, stdin?: number) {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw new Error("fixture deadline");
    const result = spawnSync(program, args, {
      cwd: dir,
      env,
      input,
      stdio: [stdin ?? "pipe", "pipe", "pipe"],
      timeout: Math.min(2000, remaining),
      killSignal: "SIGKILL",
      maxBuffer: stderrLimit + 1,
    });
    if (result.error || result.signal || result.stderr.length > stderrLimit) {
      throw new Error("fixture subprocess incomplete");
    }
    return result;
  }

  function gitResult(path: string | undefined, args: string[], input?: string) {
    const gitDir = path === undefined ? [] : ["--git-dir", path];
    const result = child(
      "git",
      [...gitDir, "-c", "protocol.allow=never", "-c", "protocol.file.allow=always", ...args],
      input === undefined ? undefined : Buffer.from(input),
    );
    gitOutput += result.stdout.length;
    if (gitOutput > outputLimit) throw new Error("fixture Git output limit");
    return result;
  }

  function git(path: string | undefined, args: string[], input?: string): Buffer {
    const result = gitResult(path, args, input);
    if (result.status !== 0) throw new Error("fixture Git setup incomplete");
    return result.stdout;
  }

  function commit(content: string, parents: string[] = []): string {
    const blob = git(source, ["hash-object", "-w", "--stdin"], content).toString().trim();
    const tree = git(source, ["mktree"], `100644 blob ${blob}\tfixture.txt\n`).toString().trim();
    return git(source, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", "fixture"])
      .toString()
      .trim();
  }

  function mirrorCommit(commitId: string): void {
    git(source, ["update-ref", "refs/heads/main", commitId]);
    git(source, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(undefined, ["clone", "--quiet", "--mirror", "--no-local", source, mirror]);
    if (git(mirror, ["rev-parse", "refs/heads/main"]).toString().trim() !== commitId) {
      throw new Error("fixture mirror mismatch");
    }
  }

  function patch(commitId: string, parent?: string) {
    return gitResult(mirror, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-p",
      "-U0",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      ...(parent ? [parent, commitId] : ["--root", commitId]),
      "--",
    ]);
  }

  function additions(patchBytes: Buffer): string {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(patchBytes);
    let inHunk = false;
    const lines: string[] = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("@@ ")) inHunk = true;
      if (inHunk && line.startsWith("+")) lines.push(line.slice(1));
    }
    return lines.join("\n");
  }

  function scannerPath(): string {
    for (const entry of env.PATH.split(":").filter((path) => path.startsWith("/"))) {
      const path = join(entry, "gitleaks");
      try {
        const stat = statSync(path);
        if (stat.isFile() && stat.size <= toolLimit && (stat.mode & 0o111) !== 0) return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("fixture scanner resolution");
      }
    }
    throw new Error("fixture Gitleaks prerequisite missing");
  }

  function scan(record: Buffer): Outcome {
    if (
      record.length > frameLimit ||
      record.includes(0) ||
      scannerCalls >= 64 ||
      scannerInput + record.length > 64 * 1024
    )
      return { status: 2, scannerCalls };
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(record);
    } catch {
      return { status: 2, scannerCalls };
    }
    if (scanner === undefined) {
      const candidate = scannerPath();
      const executableDigest = createHash("sha256").update(readFileSync(candidate)).digest("hex");
      const version = child(candidate, ["version"]);
      if (version.status !== 0 || version.stdout.toString().trim() !== "8.30.1") {
        throw new Error("fixture scanner version mismatch");
      }
      console.info(`fixture scanner 8.30.1 sha256 ${executableDigest}`);
      scanner = candidate;
    }
    scannerCalls++;
    scannerInput += record.length;
    writeFileSync(inputPath, record, { mode: 0o400 });
    const fd = openSync(inputPath, "r");
    let status: number | null;
    try {
      status = child(
        scanner,
        [
          "stdin",
          "--config",
          configPath,
          "--gitleaks-ignore-path",
          ignorePath,
          "--ignore-gitleaks-allow",
          "--redact=100",
          "--no-banner",
          "--no-color",
          "--timeout=2",
          "--exit-code=19",
          "--max-archive-depth=0",
          "--max-decode-depth=0",
          "--report-format=json",
          "--report-path",
          reportPath,
        ],
        undefined,
        fd,
      ).status;
    } finally {
      closeSync(fd);
      rmSync(inputPath);
    }
    if (status !== 19 && status !== 0) throw new Error("fixture scanner did not complete");
    reportBytes += statSync(reportPath).size;
    if (reportBytes > outputLimit || reportBytes + scannerInput > scratchLimit) throw new Error("fixture report limit");
    const findings: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    rmSync(reportPath);
    if (!Array.isArray(findings)) throw new Error("fixture report schema");
    const rules = findings.map((finding: { RuleID?: unknown }) => finding.RuleID);
    const tails = rules.filter((rule) => rule === "fixture-tail").length;
    const hits = rules.filter((rule) => rule === "fixture-marker").length;
    if (tails + hits !== rules.length) throw new Error("fixture report rule");
    return { status: status !== 19 || tails !== 1 ? 2 : hits === 0 ? 0 : 1, scannerCalls };
  }

  function scanProduced(result: { status: number | null; stdout: Buffer }): Outcome {
    if (result.status !== 0) return { status: 2, scannerCalls };
    return scan(frame(additions(result.stdout)));
  }

  function partialProducer() {
    const result = child(process.execPath, [
      "-e",
      "process.stdout.write('synthetic partial', () => { process.exitCode = 7 })",
    ]);
    if (result.status !== 7 || result.stdout.toString() !== "synthetic partial") {
      throw new Error("fixture producer injection invalid");
    }
    return result;
  }

  return {
    init: () => git(source, ["init", "--bare", "--quiet", "--template="]),
    commit,
    mirrorCommit,
    patch,
    additions,
    scan,
    scanProduced,
    partialProducer,
  };
}

function frame(content: string): Buffer {
  return Buffer.from(framePrefix + content + frameSuffix);
}

describe.skipIf(process.env.HISTORY_SCANNER_CALIBRATION !== "1")("564 scanner calibration", () => {
  it("accepts a clean framed record", () =>
    fixture(({ scan }) => {
      expect(scan(frame("synthetic clean"))).toEqual({ status: 0, scannerCalls: 1 });
    }));

  it("finds a planted marker", () =>
    fixture(({ scan }) => {
      expect(scan(frame(target))).toEqual({ status: 1, scannerCalls: 1 });
    }));

  it("finds a root addition", () =>
    fixture((owner) => {
      owner.init();
      const root = owner.commit(target + "\n");
      owner.mirrorCommit(root);
      expect(owner.scanProduced(owner.patch(root))).toEqual({ status: 1, scannerCalls: 1 });
    }));

  it("finds a merge-only addition absent from both parents", () =>
    fixture((owner) => {
      owner.init();
      const root = owner.commit("root\n");
      const left = owner.commit("left\n", [root]);
      const right = owner.commit("right\n", [root]);
      const merge = owner.commit(target + "\n", [left, right]);
      owner.mirrorCommit(merge);
      for (const parent of [left, right]) {
        const parentPatch = owner.patch(parent, root);
        expect(parentPatch.status).toBe(0);
        expect(owner.additions(parentPatch.stdout).includes(target)).toBe(false);
      }
      expect([left, right].map((parent) => owner.scanProduced(owner.patch(merge, parent)))).toEqual([
        { status: 1, scannerCalls: 1 },
        { status: 1, scannerCalls: 2 },
      ]);
    }));

  it("finds a marker at the end of the longest admitted frame", () =>
    fixture(({ scan }) => {
      const padding = frameLimit - Buffer.byteLength(framePrefix + target + frameSuffix);
      const record = frame("x".repeat(padding) + target);
      expect(record.length).toBe(frameLimit);
      expect(scan(record)).toEqual({ status: 1, scannerCalls: 1 });
    }));

  it("refuses a record without its tail canary", () =>
    fixture(({ scan }) => {
      expect(scan(Buffer.from(framePrefix + target))).toEqual({ status: 2, scannerCalls: 1 });
    }));

  it("refuses a non-text record before scanner dispatch", () =>
    fixture(({ scan }) => {
      const record = Buffer.concat([frame(target), Buffer.from([0, 255])]);
      expect(scan(record)).toEqual({ status: 2, scannerCalls: 0 });
    }));

  it("refuses producer failure after partial bytes", () =>
    fixture(({ scanProduced, partialProducer }) => {
      const partial = partialProducer();
      expect(partial.stdout.length).toBeGreaterThan(0);
      expect(scanProduced(partial)).toEqual({ status: 2, scannerCalls: 0 });
    }));
});
