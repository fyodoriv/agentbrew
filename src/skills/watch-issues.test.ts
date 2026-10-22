import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "skill-plugins", "workflow", "watch-issues", "scripts", "watch-pass.sh");

const TASKS = `# Tasks

## P1

- [ ] Fix the sync crash
  - **ID**: fix-sync-crash
  - **Hypothesis**: x

- [ ] Wait a week
  - **ID**: wait-a-week
  - **Blocked**: needs-time — measure later

## P2

- [ ] Add a flag
  - **ID**: add-flag
`;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv(), stdio: "ignore" });
}

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

/** A clone whose origin/main has TASKS.md; origin then points at a GitHub URL whose fetch fails fast. */
function fixtureRepo(root: string): string {
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "TASKS.md"), TASKS);
  git(seed, "add", "TASKS.md");
  git(seed, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "seed");
  const bare = join(root, "origin.git");
  git(root, "clone", "-q", "--bare", seed, bare);
  const repo = join(root, "demo");
  git(root, "clone", "-q", bare, repo);
  git(repo, "remote", "set-url", "origin", "git@github.com:acme/demo.git");
  return repo;
}

function fakeGh(root: string, issues: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const prs = ["7\tred one\tred", "8\tclean one\t", "9\tmerge me\tconflicting"].join("\\n");
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\ncase "$1 $2" in\n  "issue list") printf '${issues}\\n' ;;\n  "pr list") printf '${prs}\\n' ;;\nesac\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

function pass(root: string, bin: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...gitEnv(),
    PATH: `${bin}:${process.env.PATH}`,
    GIT_SSH_COMMAND: "false",
    HOME: root,
  };
  delete env.BASH_ENV;
  delete env.ENV;
  return execFileSync("bash", [SCRIPT, "--state-dir", join(root, "state"), ...args], { env, encoding: "utf-8" });
}

describe("watch-issues pass", () => {
  it("lists unblocked tasks, open issues, and only red or conflicting PRs, all new on the first pass", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const out = pass(root, fakeGh(root, "12\\tsomeone\\tsync crashes"), [repo]);
    expect(out).toContain("new   task  demo/fix-sync-crash: Fix the sync crash");
    expect(out).toContain("new   task  demo/add-flag: Add a flag");
    expect(out).not.toContain("wait-a-week");
    expect(out).toContain("new   issue acme/demo#12 by someone: sync crashes");
    expect(out).toContain("new   pr    acme/demo#7 red: red one");
    expect(out).toContain("new   pr    acme/demo#9 conflicting: merge me");
    expect(out).not.toContain("#8");
    expect(out).toContain("skip  demo: git fetch failed");
    expect(out.trim().split("\n").at(-1)).toBe("watch: 5 new, 0 open");
  });

  it("after --record, the same items are open and only a newer issue is new", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    pass(root, fakeGh(root, "12\\tsomeone\\tsync crashes"), ["--record", repo]);
    const out = pass(root, fakeGh(root, "12\\tsomeone\\tsync crashes\\n13\\tfyodoriv\\tnew bug"), [repo]);
    expect(out).toContain("open  issue acme/demo#12");
    expect(out).toContain("new   issue acme/demo#13 by fyodoriv: new bug");
    expect(out).toContain("open  task  demo/fix-sync-crash");
    expect(out.trim().split("\n").at(-1)).toBe("watch: 1 new, 5 open");
  });

  it("reads the repo list from the config file and skips a folder that is not a git checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const notGit = join(root, "plain");
    mkdirSync(notGit);
    mkdirSync(join(root, ".config", "watch-issues"), { recursive: true });
    writeFileSync(join(root, ".config", "watch-issues", "repos"), `# watched\n${repo}\n${notGit}  # not a repo\n`);
    const out = pass(root, fakeGh(root, ""), []);
    expect(out).toContain("new   task  demo/fix-sync-crash");
    expect(out).toContain(`skip  ${notGit}: not a git checkout`);
  });
});
