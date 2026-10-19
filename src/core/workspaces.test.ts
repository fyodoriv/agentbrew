import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverWorkspaces,
  findWorkspaceCollisions,
  formatCollision,
  loadTasksMdWorkspaces,
  prepareWorkspaceAgentfile,
  resolveWorkspaceRoots,
  writeWorkspaceAgentfile,
} from "./workspaces.js";

let scratch: string;

function writeRepo(workspace: string, repo: string, content: string): string {
  const dir = join(scratch, workspace, repo);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "Agentfile.yaml");
  writeFileSync(path, content);
  return path;
}

function readYaml(path: string): Record<string, unknown> {
  return yaml.load(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "agentbrew-workspaces-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("resolveWorkspaceRoots", () => {
  const named = [{ name: "tooling", root: "/w/tooling" }];

  it("is off when nothing declares workspaces (single-Agentfile behaviour unchanged)", () => {
    expect(resolveWorkspaceRoots({}, undefined, named)).toBeUndefined();
    expect(resolveWorkspaceRoots({}, { skills: ["a"] }, named)).toBeUndefined();
  });

  it("takes --workspaces paths and tasks workspace names", () => {
    expect(resolveWorkspaceRoots({ workspaces: "tooling, /w/acme" }, undefined, named)).toEqual([
      { name: "tooling", root: "/w/tooling" },
      { name: "acme", root: "/w/acme" },
    ]);
  });

  it("looks up --workspace-name and rejects an unknown one", () => {
    expect(resolveWorkspaceRoots({ workspaceName: "tooling" }, undefined, named)).toEqual([named[0]]);
    expect(() => resolveWorkspaceRoots({ workspaceName: "nope" }, undefined, named)).toThrow(/Unknown workspace/);
  });

  it("falls back to workspaceRoots in the base Agentfile", () => {
    expect(resolveWorkspaceRoots({}, { workspaceRoots: ["tooling"] }, named)).toEqual([named[0]]);
  });

  it("flags win over workspaceRoots", () => {
    expect(resolveWorkspaceRoots({ workspaces: "/w/acme" }, { workspaceRoots: ["tooling"] }, named)).toEqual([
      { name: "acme", root: "/w/acme" },
    ]);
  });
});

describe("loadTasksMdWorkspaces", () => {
  it("reads the tasks CLI workspaces.json and ignores a malformed one", () => {
    const path = join(scratch, "workspaces.json");
    writeFileSync(path, JSON.stringify({ workspaces: [{ name: "acme", root: "/w/acme" }, { bad: true }] }));
    expect(loadTasksMdWorkspaces(path)).toEqual([{ name: "acme", root: "/w/acme" }]);
    writeFileSync(path, "{not json");
    expect(loadTasksMdWorkspaces(path)).toEqual([]);
    expect(loadTasksMdWorkspaces(join(scratch, "missing.json"))).toEqual([]);
  });
});

describe("discoverWorkspaces", () => {
  it("finds direct-child repos with an Agentfile, namespaced <workspace>::<repo>", () => {
    writeRepo("tooling", "b-repo", "skills: [b]\n");
    writeRepo("tooling", "a-repo", "skills: [a]\n");
    mkdirSync(join(scratch, "tooling", "no-agentfile"), { recursive: true });
    writeRepo("tooling", ".hidden", "skills: [h]\n");
    const [workspace] = discoverWorkspaces([{ name: "tooling", root: join(scratch, "tooling") }]);
    expect(workspace.repos.map((repo) => repo.id)).toEqual(["tooling::a-repo", "tooling::b-repo"]);
  });

  it("reports an empty workspace for a missing folder", () => {
    const [workspace] = discoverWorkspaces([{ name: "gone", root: join(scratch, "gone") }]);
    expect(workspace.repos).toEqual([]);
  });
});

describe("cross-workspace merge conflicts", () => {
  function twoWorkspaces() {
    writeRepo("tooling", "api", "mcp:\n  - name: db\n    command: db-v1\ndefaultModel: model-a\nskills: [shared]\n");
    writeRepo("acme", "web", "mcp:\n  - name: db\n    command: db-v2\ndefaultModel: model-b\nskills: [shared, web]\n");
    return discoverWorkspaces([
      { name: "tooling", root: join(scratch, "tooling") },
      { name: "acme", root: join(scratch, "acme") },
    ]);
  }

  it("names both sides of each collision and the winner", () => {
    const collisions = findWorkspaceCollisions(twoWorkspaces());
    expect(collisions).toEqual([
      { kind: "mcp", name: "db", owners: ["tooling::api", "acme::web"], winner: "acme::web" },
      { kind: "defaultModel", name: "defaultModel", owners: ["tooling::api", "acme::web"], winner: "acme::web" },
    ]);
    expect(formatCollision(collisions[0])).toContain("tooling::api and acme::web; using acme::web");
  });

  it("does not report identical declarations as collisions", () => {
    writeRepo("tooling", "a", "mcp: [github]\n");
    writeRepo("acme", "b", "mcp: [github]\n");
    const workspaces = discoverWorkspaces([
      { name: "tooling", root: join(scratch, "tooling") },
      { name: "acme", root: join(scratch, "acme") },
    ]);
    expect(findWorkspaceCollisions(workspaces)).toEqual([]);
  });

  it("merges every repo, keeps the last repo's value, and lets the base Agentfile win", () => {
    const workspaces = twoWorkspaces();
    const out = join(scratch, "out", "Agentfile.yaml");

    writeWorkspaceAgentfile(undefined, workspaces, out);
    let merged = readYaml(out);
    expect(merged.skills).toEqual(["shared", "web"]);
    expect(merged.mcp).toEqual([{ name: "db", command: "db-v2" }]);

    const base = join(scratch, "Agentfile.yaml");
    writeFileSync(base, "defaultModel: model-base\nmcp:\n  - name: db\n    command: db-base\n");
    writeWorkspaceAgentfile(base, workspaces, out);
    merged = readYaml(out);
    expect(merged.defaultModel).toBe("model-base");
    expect(merged.mcp).toEqual([{ name: "db", command: "db-base" }]);
  });

  it("keeps repo-scoped task backend fields out unless the base sets them", () => {
    writeRepo("tooling", "api", "task_backend: github-issues\nrepo: o/api\nproject: 3\nskills: [x]\n");
    const workspaces = discoverWorkspaces([{ name: "tooling", root: join(scratch, "tooling") }]);
    const out = join(scratch, "out.yaml");
    writeWorkspaceAgentfile(undefined, workspaces, out);
    const merged = readYaml(out);
    expect(merged).toEqual({ skills: ["x"] });
  });
});

describe("prepareWorkspaceAgentfile", () => {
  it("returns undefined with no workspaces declared", () => {
    const base = join(scratch, "Agentfile.yaml");
    writeFileSync(base, "skills: [a]\n");
    expect(prepareWorkspaceAgentfile({ agentfile: base })).toBeUndefined();
  });

  it("writes a merged Agentfile for --workspaces and warns on collisions", () => {
    writeRepo("tooling", "api", "mcp:\n  - name: db\n    command: v1\n");
    writeRepo("acme", "web", "mcp:\n  - name: db\n    command: v2\n");
    const path = prepareWorkspaceAgentfile({
      workspaces: `${join(scratch, "tooling")},${join(scratch, "acme")}`,
    });
    expect(path).toBeDefined();
    expect(readYaml(path as string).mcp).toEqual([{ name: "db", command: "v2" }]);
    expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).toContain("tooling::api and acme::web");
  });
});
