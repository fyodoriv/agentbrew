/** Scoped rules, step 7 of #208: repo host include/exclude, public hosts excluded by default. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRemote, repoAllowed, repoIdOf } from "./scope.js";

describe("normalizeRemote", () => {
  it.each([
    ["git@git.acme.example:team/app.git", "git.acme.example/team/app"],
    ["https://git.acme.example/team/app.git", "git.acme.example/team/app"],
    ["ssh://git@git.acme.example:7999/team/app", "git.acme.example/team/app"],
    ["https://user@GitHub.com/Org/Repo/", "github.com/org/repo"],
  ])("%s -> %s", (url, id) => {
    expect(normalizeRemote(url)).toBe(id);
  });
});

describe("repoAllowed", () => {
  const repos = { include: ["git.acme.example/**"], exclude: ["git.acme.example/public/**"] };

  it("matches include patterns", () => {
    expect(repoAllowed("git.acme.example/team/app", repos)).toBe(true);
  });

  it("honors exclude over include", () => {
    expect(repoAllowed("git.acme.example/public/site", repos)).toBe(false);
  });

  it("default is nowhere: no include means no repo", () => {
    expect(repoAllowed("git.acme.example/team/app", {})).toBe(false);
    expect(repoAllowed("git.acme.example/team/app", undefined)).toBe(false);
  });

  it("public hosts are excluded by default, even by a catch-all include", () => {
    for (const id of ["github.com/acme/app", "gitlab.com/acme/app", "bitbucket.org/acme/app"]) {
      expect(repoAllowed(id, { include: ["**"] })).toBe(false);
    }
  });

  it("a public host is allowed only when an include names that host explicitly", () => {
    expect(repoAllowed("github.com/acme/app", { include: ["github.com/acme/**"] })).toBe(true);
    expect(repoAllowed("github.com/other/app", { include: ["github.com/acme/**"] })).toBe(false);
  });

  it("no repo (not a git checkout) is never allowed", () => {
    expect(repoAllowed(undefined, { include: ["**"] })).toBe(false);
  });

  it("* does not cross a slash; ** does", () => {
    expect(repoAllowed("git.acme.example/team/app", { include: ["git.acme.example/*"] })).toBe(false);
    expect(repoAllowed("git.acme.example/team", { include: ["git.acme.example/*"] })).toBe(true);
  });
});

describe("repoIdOf", () => {
  it("reads the origin remote of a checkout, and is undefined elsewhere", () => {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    const dir = mkdtempSync(join(tmpdir(), "scope-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir, env });
    execFileSync("git", ["remote", "add", "origin", "git@git.acme.example:team/app.git"], { cwd: dir, env });
    expect(repoIdOf(dir)).toBe("git.acme.example/team/app");
    expect(repoIdOf(mkdtempSync(join(tmpdir(), "not-repo-")))).toBeUndefined();
  });
});

describe("agentbrew plugin rules", () => {
  it("prints nothing outside a git checkout", async () => {
    const { Command } = await import("commander");
    const { registerPluginCommands } = await import("./cli-plugin.js");
    const out: string[] = [];
    const log = console.log;
    console.log = (msg: string) => out.push(msg);
    try {
      const program = new Command().exitOverride();
      registerPluginCommands(program);
      await program.parseAsync(["node", "t", "plugin", "rules", "--cwd", mkdtempSync(join(tmpdir(), "nr-"))]);
    } finally {
      console.log = log;
    }
    expect(out).toEqual([]);
  });
});
