import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILD_INFO_FILE, builtCliRoot, checkCliBuildDrift } from "./cli-build-health.js";

let root: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf-8" }).trim();
}

function commitFile(path: string, content: string): string {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
  git("add", ".");
  git("commit", "-q", "-m", `chore: change ${path}`);
  return git("rev-parse", "HEAD");
}

function recordBuild(commit: string): void {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", BUILD_INFO_FILE), JSON.stringify({ commit }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-build-health-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("builtCliRoot", () => {
  it("returns the package root for a bundle in dist/", () => {
    expect(builtCliRoot(pathToFileURL("/opt/agentbrew/dist/cli.js").href)).toBe("/opt/agentbrew");
  });

  it("returns null when running from src/", () => {
    expect(builtCliRoot(pathToFileURL("/opt/agentbrew/src/cli-build-health.ts").href)).toBeNull();
  });
});

describe("checkCliBuildDrift", () => {
  it("is clean when no root is given", () => {
    expect(checkCliBuildDrift(null)).toEqual([]);
  });

  it("is clean when the root is not a git checkout", () => {
    const plain = mkdtempSync(join(tmpdir(), "cli-build-plain-"));
    try {
      expect(checkCliBuildDrift(plain)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("is clean when dist/ was built from HEAD", () => {
    recordBuild(commitFile("src/cli.ts", "v1"));
    expect(checkCliBuildDrift(root)).toEqual([]);
  });

  it("flags a checkout that moved past the build with source changes", () => {
    const built = commitFile("src/cli.ts", "v1");
    recordBuild(built);
    const head = commitFile("src/cli.ts", "v2");
    const drift = checkCliBuildDrift(root);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.type).toBe("cli-build");
    expect(drift[0]?.detail).toContain(`built from ${built.slice(0, 8)}`);
    expect(drift[0]?.detail).toContain(`at ${head.slice(0, 8)}`);
    expect(drift[0]?.detail).toContain("npm run build");
  });

  it("ignores commits that touch only non-build files", () => {
    recordBuild(commitFile("src/cli.ts", "v1"));
    commitFile("docs/notes.md", "doc only");
    expect(checkCliBuildDrift(root)).toEqual([]);
  });

  it("flags a build without a build record", () => {
    commitFile("src/cli.ts", "v1");
    const drift = checkCliBuildDrift(root);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.detail).toContain("no build record");
  });

  it("flags a build record that names an unknown commit", () => {
    commitFile("src/cli.ts", "v1");
    recordBuild("0123456789abcdef0123456789abcdef01234567");
    const drift = checkCliBuildDrift(root);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.detail).toContain("unknown commit 01234567");
  });
});
