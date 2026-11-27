import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILD_INFO_FILE, BUILD_INPUTS, builtCliRoot, checkCliBuildDrift, rebuildCli } from "./cli-build-health.js";

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

function recordBuild(commit: string | null, destination = root): void {
  mkdirSync(join(destination, "dist"), { recursive: true });
  writeFileSync(join(destination, "dist", BUILD_INFO_FILE), JSON.stringify({ commit }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cli-build-health-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  git("remote", "add", "origin", "https://github.com/fyodoriv/agentbrew");
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

it.runIf(process.env.VERIFY_BUILT_CLI_STATUS === "1")(
  "reports one stale copied bundle and no fresh checkout warnings",
  () => {
    const checkout = fileURLToPath(new URL("..", import.meta.url));
    const build = JSON.parse(readFileSync(join(checkout, "dist", BUILD_INFO_FILE), "utf-8"));
    const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
    expect(build.commit).toBe(head);

    const home = join(root, "home");
    const config = join(home, ".config", "agentbrew");
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, "state.yaml"), "schemaVersion: 1\nagents: []\ncatalogVersion: 0.1.0\n");

    const copy = join(root, "snapshot");
    mkdirSync(copy);
    copyFileSync(join(checkout, "package.json"), join(copy, "package.json"));
    cpSync(join(checkout, "dist"), join(copy, "dist"), { recursive: true });
    symlinkSync(join(checkout, "node_modules"), join(copy, "node_modules"), "dir");
    recordBuild(null, copy);
    const checkStatus = (packageRoot: string) => {
      const output = execFileSync(process.execPath, [join(packageRoot, "dist", "cli.js"), "status"], {
        cwd: home,
        encoding: "utf-8",
        env: {
          HOME: home,
          PATH: process.env.PATH,
          AGENTBREW_NO_AUTO_INIT: "1",
          AGENTBREW_EVENTS: "0",
          DO_NOT_TRACK: "1",
          NO_COLOR: "1",
        },
        timeout: 2000,
      });
      expect(output).toContain("agentbrew status");
      return output.split("\n").filter((line) => line.trimStart().startsWith("CLI build:"));
    };

    const copiedWarnings = checkStatus(copy);
    expect(copiedWarnings).toHaveLength(1);
    expect(copiedWarnings[0]).toContain("no build commit");
    expect(Array.from({ length: 5 }, () => checkStatus(checkout))).toEqual([[], [], [], [], []]);
  },
);

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

  it("flags a standalone CLI copy with a null build commit", () => {
    const copy = join(root, "snapshot");
    recordBuild(null, copy);
    const drift = checkCliBuildDrift(copy, []);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.type).toBe("cli-build");
    expect(drift[0]?.detail).toContain("no build commit");
    expect(drift[0]?.detail).toContain("reinstall");
  });

  it("reports the exact source and origin revisions for a behind standalone copy", () => {
    git("remote", "set-url", "origin", "git@github.com:fyodoriv/agentbrew.git");
    const built = commitFile("src/cli.ts", "v1");
    const remote = commitFile("src/cli.ts", "v2");
    git("update-ref", "refs/remotes/origin/main", remote);
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    const drift = checkCliBuildDrift(copy, [root]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.detail).toContain(built.slice(0, 8));
    expect(drift[0]?.detail).toContain(remote.slice(0, 8));
    expect(drift[0]?.detail).toContain("origin/main");
  });

  it("ignores a fork with a shared build commit", () => {
    git("remote", "set-url", "origin", "https://github.com/example-org/agentbrew.git");
    const built = commitFile("src/cli.ts", "v1");
    git("update-ref", "refs/remotes/origin/main", commitFile("src/cli.ts", "fork change"));
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    expect(checkCliBuildDrift(copy, [root])).toEqual([]);
  });

  it("counts bundled command changes as build inputs", () => {
    const built = commitFile("commands/agentbrew.md", "v1");
    git("update-ref", "refs/remotes/origin/main", commitFile("commands/agentbrew.md", "v2"));
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    expect(checkCliBuildDrift(copy, [root])).toHaveLength(1);
  });

  it.each(["hooks/manifest.yaml", "hooks/checks/sample.sh"])("detects a packaged change to %s in a copy", (path) => {
    const built = commitFile(path, "old fixture");
    const remote = commitFile(path, "new fixture");
    git("update-ref", "refs/remotes/origin/main", remote);
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    recordBuild(built);
    const drift = checkCliBuildDrift(copy, [root]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.detail).toContain(built.slice(0, 8));
    expect(drift[0]?.detail).toContain(remote.slice(0, 8));
    expect(checkCliBuildDrift(root, [root])).toEqual([]);
  });

  it("ignores changes to hook test files excluded from the package", () => {
    const built = commitFile("hooks/checks/sample.sh", "runtime fixture");
    const remote = commitFile("hooks/checks/sample.test.sh", "unpublished test fixture");
    git("update-ref", "refs/remotes/origin/main", remote);
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    expect(checkCliBuildDrift(copy, [root])).toEqual([]);
  });

  it("keeps standalone copies clear when current, docs-only behind, or unqualified", () => {
    const built = commitFile("src/cli.ts", "v1");
    const remote = commitFile("docs/notes.md", "doc only");
    git("update-ref", "refs/remotes/origin/main", remote);
    const copy = join(root, "snapshot");
    recordBuild(built, copy);
    expect(checkCliBuildDrift(copy, [root])).toEqual([]);
    recordBuild(remote, copy);
    expect(checkCliBuildDrift(copy, [root])).toEqual([]);
    recordBuild("0123456789abcdef0123456789abcdef01234567", copy);
    expect(checkCliBuildDrift(copy, [root])).toEqual([]);
  });

  it("does not rebuild a standalone CLI copy", () => {
    const copy = join(root, "snapshot");
    recordBuild(null, copy);
    writeFileSync(
      join(copy, "package.json"),
      JSON.stringify({ scripts: { build: "node -e \"require('node:fs').writeFileSync('rebuilt', 'yes')\"" } }),
    );
    expect(rebuildCli(copy)).toBe(false);
    expect(existsSync(join(copy, "rebuilt"))).toBe(false);
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

describe("BUILD_INPUTS", () => {
  const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const dirs = (path: string) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  const covered = (path: string) => BUILD_INPUTS.some((input) => path === input || path.startsWith(`${input}/`));

  it("lists every shipped native crate and its prebuilt directory", () => {
    const shipped = dirs(join(repo, "native"));
    expect(shipped.length).toBeGreaterThan(0);
    for (const crate of shipped) {
      expect(BUILD_INPUTS).toContain(`native/${crate}`);
      expect(BUILD_INPUTS).toContain(`rust/${crate}`);
    }
  });

  it("covers every source input named in each native manifest", () => {
    for (const crate of dirs(join(repo, "native"))) {
      for (const platform of dirs(join(repo, "native", crate))) {
        const manifest = JSON.parse(readFileSync(join(repo, "native", crate, platform, "manifest.json"), "utf-8")) as {
          inputs: { path: string }[];
        };
        const missing = manifest.inputs.map((input) => input.path).filter((path) => !covered(path));
        expect(missing).toEqual([]);
      }
    }
  });
});
