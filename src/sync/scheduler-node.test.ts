// #356: scheduler jobs must not pin the resolved, versioned Node path that
// `brew upgrade node` and `brew cleanup` delete. Real files in a scratch folder.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLaunchAgentFixArgs, getNodeBinDir, resolveSchedulerNode } from "./scheduler-paths.js";

let root: string;

/** A fake `node` that runs and prints a version, like the real one. */
function fakeNode(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/bin/sh\necho v24.0.0\n");
  chmodSync(path, 0o755);
  return path;
}

/** A Homebrew prefix with one keg: `<prefix>/Cellar/node/24.0.0` and its `opt` link. */
function homebrewPrefix(options: { optLink: boolean }): { prefix: string; cellarNode: string } {
  const prefix = join(root, "homebrew");
  const cellarNode = fakeNode(join(prefix, "Cellar", "node", "24.0.0", "bin", "node"));
  if (options.optLink) {
    mkdirSync(join(prefix, "opt"), { recursive: true });
    symlinkSync("../Cellar/node/24.0.0", join(prefix, "opt", "node"));
  }
  return { prefix, cellarNode };
}

beforeEach(() => {
  // Real path, like process.execPath (macOS tmpdir is a /var -> /private/var link).
  root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-scheduler-node-")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AGENTBREW_NODE_BIN;
});

describe("resolveSchedulerNode (#356)", () => {
  it("swaps a Homebrew Cellar path for the keg's opt link, which survives upgrades", () => {
    const { prefix, cellarNode } = homebrewPrefix({ optLink: true });

    const node = resolveSchedulerNode({ execPath: cellarNode, env: {}, stableLinks: [] });

    expect(node).toBe(join(prefix, "opt", "node", "bin", "node"));
  });

  it("swaps an fnm version folder for fnm's default alias when it points at the same Node (#456)", () => {
    const fnm = join(root, "fnm");
    const versioned = fakeNode(join(fnm, "node-versions", "v24.0.0", "installation", "bin", "node"));
    mkdirSync(join(fnm, "aliases"), { recursive: true });
    symlinkSync(join(fnm, "node-versions", "v24.0.0", "installation"), join(fnm, "aliases", "default"));

    expect(resolveSchedulerNode({ execPath: versioned, env: {}, stableLinks: [] })).toBe(
      join(fnm, "aliases", "default", "bin", "node"),
    );
  });

  it("keeps the fnm version folder when the default alias points at another Node", () => {
    const fnm = join(root, "fnm");
    const versioned = fakeNode(join(fnm, "node-versions", "v24.0.0", "installation", "bin", "node"));
    fakeNode(join(fnm, "node-versions", "v26.0.0", "installation", "bin", "node"));
    mkdirSync(join(fnm, "aliases"), { recursive: true });
    symlinkSync(join(fnm, "node-versions", "v26.0.0", "installation"), join(fnm, "aliases", "default"));

    expect(resolveSchedulerNode({ execPath: versioned, env: {}, stableLinks: [] })).toBe(versioned);
  });

  it("uses a stable bin link that points at the running Node", () => {
    const { prefix, cellarNode } = homebrewPrefix({ optLink: false });
    const binLink = join(prefix, "bin", "node");
    mkdirSync(dirname(binLink), { recursive: true });
    symlinkSync(cellarNode, binLink);

    expect(resolveSchedulerNode({ execPath: cellarNode, env: {}, stableLinks: [binLink] })).toBe(binLink);
  });

  it("ignores a stable link that points at another Node", () => {
    const { cellarNode } = homebrewPrefix({ optLink: false });
    const otherNode = fakeNode(join(root, "other", "bin", "node"));

    expect(resolveSchedulerNode({ execPath: cellarNode, env: {}, stableLinks: [otherNode] })).toBe(cellarNode);
  });

  it("keeps the running Node when no stable link exists", () => {
    const node = fakeNode(join(root, "fnm", "v24.0.0", "bin", "node"));

    expect(resolveSchedulerNode({ execPath: node, env: {}, stableLinks: [join(root, "missing")] })).toBe(node);
  });

  it("uses AGENTBREW_NODE_BIN verbatim, without resolving its links", () => {
    const { cellarNode } = homebrewPrefix({ optLink: true });
    const target = fakeNode(join(root, "allowed", "bin", "node"));
    const override = join(root, "links", "node");
    mkdirSync(dirname(override), { recursive: true });
    symlinkSync(target, override);

    const node = resolveSchedulerNode({ execPath: cellarNode, env: { AGENTBREW_NODE_BIN: override }, stableLinks: [] });

    expect(node).toBe(override);
  });

  it("falls back and warns when AGENTBREW_NODE_BIN does not run", () => {
    const { prefix, cellarNode } = homebrewPrefix({ optLink: true });
    const broken = join(root, "broken-node");
    writeFileSync(broken, "not a program");

    const node = resolveSchedulerNode({ execPath: cellarNode, env: { AGENTBREW_NODE_BIN: broken }, stableLinks: [] });

    expect(node).toBe(join(prefix, "opt", "node", "bin", "node"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("AGENTBREW_NODE_BIN"));
  });

  it("drives the LaunchAgent program and the node folder on PATH", () => {
    const override = fakeNode(join(root, "custom", "bin", "node"));
    process.env.AGENTBREW_NODE_BIN = override;

    expect(buildLaunchAgentFixArgs()[0]).toBe(override);
    expect(getNodeBinDir()).toBe(dirname(override));
  });
});
