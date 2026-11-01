import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectEntrypoint } from "./mcp-git.js";

// This test-file module owns the fixture list; afterEach removes fixtures and clears it.
const repos: string[] = [];

function repo() {
  const path = mkdtempSync(join(homedir(), "entrypoint-files-"));
  repos.push(path);
  return path;
}

afterEach(() => {
  for (const path of repos.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("MCP entrypoint file types", () => {
  it.each([
    ["candidate", "dist/index.js", {}],
    ["package main", "lib/server.js", { main: "lib/server.js" }],
    ["package bin", "bin/server.js", { bin: "bin/server.js" }],
  ] as const)("rejects a directory used as %s", (_name, relative, fields) => {
    const root = repo();
    mkdirSync(join(root, relative), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify(fields));
    expect(detectEntrypoint(root)).toBeUndefined();
  });

  it("rejects a symlink to a directory", () => {
    const root = repo();
    mkdirSync(join(root, "output"));
    symlinkSync("output", join(root, "index.js"));
    expect(detectEntrypoint(root)).toBeUndefined();
  });

  it.each([
    ["candidate", "dist/index.js", {}],
    ["package main", "lib/server.js", { main: "lib/server.js" }],
    ["package bin", "bin/server.js", { bin: "bin/server.js" }],
  ] as const)("keeps a runnable Node directory used as %s", (_name, relative, fields) => {
    const root = repo();
    const entrypoint = join(root, relative);
    mkdirSync(entrypoint, { recursive: true });
    writeFileSync(join(entrypoint, "index.js"), "console.log('directory entrypoint');\n");
    writeFileSync(join(root, "package.json"), JSON.stringify(fields));
    expect(spawnSync(process.execPath, [entrypoint], { encoding: "utf8" })).toMatchObject({
      status: 0,
      stdout: "directory entrypoint\n",
    });
    expect(detectEntrypoint(root)).toEqual({ command: "node", args: [entrypoint] });
  });

  it("keeps a regular entrypoint file", () => {
    const root = repo();
    writeFileSync(join(root, "index.js"), "export {};\n");
    expect(detectEntrypoint(root)).toEqual({ command: "node", args: [join(root, "index.js")] });
  });

  it("keeps a symlink to a regular file", () => {
    const root = repo();
    writeFileSync(join(root, "server.js"), "export {};\n");
    symlinkSync("server.js", join(root, "index.js"));
    expect(detectEntrypoint(root)).toEqual({ command: "node", args: [join(root, "index.js")] });
  });
});
