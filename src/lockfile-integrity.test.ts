import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/check-lockfile-integrity.mjs");
const firstHash = "sha512-fixtureFirst";
const secondHash = "sha512-fixtureSecond";
const thirdHash = "sha512-fixtureThird";
const duplicatePath = "node_modules/tree/node_modules/example";
const path = "node_modules/example";
const scopedPath = "node_modules/@example/library";
const packageRecord = { version: "1.0.0", integrity: firstHash };
const baseline = {
  [path]: packageRecord,
  [duplicatePath]: { ...packageRecord, integrity: secondHash },
  [scopedPath]: packageRecord,
  "node_modules/removed": packageRecord,
  "node_modules/bundled": { version: "1.0.0" },
  "node_modules/local": { link: true, resolved: "stubs/local" },
  "stubs/local": { version: "1.0.0" },
};

describe("npm lockfile integrity gate", () => {
  let cwd: string;
  let commit: string;
  let env: NodeJS.ProcessEnv;

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
  }

  function writeLock(packages: object): void {
    writeFileSync(
      join(cwd, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }),
    );
  }

  function check(base = commit) {
    return spawnSync(process.execPath, [script, "--base", base], { cwd, encoding: "utf8", env, timeout: 5000 });
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "agentbrew-lockfile-integrity-"));
    env = {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    };
    git(["init", "-q", "-b", "main"]);
    writeLock(baseline);
    git(["add", "package-lock.json"]);
    git(["-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline lockfile"]);
    commit = git(["rev-parse", "HEAD"]);
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("refuses a new hash for a locked package version without printing the hashes", () => {
    writeLock({ ...baseline, [path]: { ...packageRecord, integrity: thirdHash } });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"example@1.0.0"');
    expect(result.stderr).not.toContain(firstHash);
    expect(result.stderr).not.toContain(secondHash);
    expect(result.stderr).not.toContain(thirdHash);
  });

  it("refuses swapping a hash with the known hash of another installation of the same version", () => {
    writeLock({ ...baseline, [path]: { ...packageRecord, integrity: secondHash } });
    expect(check()).toMatchObject({ status: 1, stderr: expect.stringContaining('"example@1.0.0"') });
  });

  it("matches a moved and aliased scoped package by its resolved name", () => {
    writeLock({
      [path]: packageRecord,
      "node_modules/tree/node_modules/alias": {
        name: "@example/library",
        version: "1.0.0",
        integrity: secondHash,
      },
    });
    expect(check()).toMatchObject({ status: 1, stderr: expect.stringContaining('"@example/library@1.0.0"') });
  });

  it("refuses removal of a hash from the same package location and version", () => {
    writeLock({ ...baseline, [path]: { version: "1.0.0" } });
    expect(check()).toMatchObject({ status: 1, stderr: expect.stringContaining('"example@1.0.0"') });
  });

  it("refuses replacing a hashed package with a local link at the same version", () => {
    writeLock({
      ...baseline,
      [path]: { link: true, resolved: "stubs/example" },
      "stubs/example": { name: "example", version: "1.0.0" },
    });
    expect(check()).toMatchObject({ status: 1, stderr: expect.stringContaining('"example@1.0.0"') });
  });

  it("allows ordinary moves, new versions, additions, removals and hashless local records", () => {
    writeLock({
      ...baseline,
      [path]: { version: "2.0.0", integrity: secondHash },
      [scopedPath]: undefined,
      "node_modules/removed": undefined,
      "node_modules/tree/node_modules/@example/library": packageRecord,
      "node_modules/new-dependency": { version: "1.0.0", integrity: secondHash },
    });
    expect(check()).toMatchObject({ status: 0, stderr: "" });
  });

  it("refuses an unreadable base and an incomplete candidate", () => {
    expect(check("no-such-base")).toMatchObject({ status: 2 });
    writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    expect(check()).toMatchObject({ status: 2 });
  });

  it("refuses malformed root records, unresolved links, and invalid UTF-8", () => {
    writeLock({ ...baseline, "": true });
    expect(check()).toMatchObject({ status: 2 });
    writeLock({ ...baseline, "node_modules/local": { link: true, resolved: "missing" } });
    expect(check()).toMatchObject({ status: 2 });
    const file = join(cwd, "package-lock.json");
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.from('{"lockfileVersion":3,"packages":{"":{"name":"'),
        Buffer.of(255),
        Buffer.from('"}}}'),
      ]),
    );
    expect(check()).toMatchObject({ status: 2 });
  });
});
