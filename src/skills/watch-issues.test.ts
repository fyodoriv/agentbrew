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

- [ ] Wait a week
  - **ID**: wait-a-week
  - **Blocked**: needs-time — measure later

- [ ] Someone has this (@claude)
  - **ID**: claimed-one

## P2

- [ ] Add a flag
  - **ID**: add-flag

- [ ] Needs the crash fix first
  - **ID**: after-crash
  - **Blocked by**: fix-sync-crash

- [ ] Task without an id

## P3

- [ ] Nice to have
  - **ID**: nice-to-have
`;

const ISSUES = [
  { number: 12, title: "sync crashes", author: { login: "someone" } },
  { number: 13, title: "my own bug", author: { login: "me" } },
];

const check = (conclusion: string) => ({ conclusion });
const PRS = [
  {
    number: 7,
    title: "red one",
    headRefName: "fix/a",
    isDraft: false,
    mergeable: "MERGEABLE",
    statusCheckRollup: [check("FAILURE")],
  },
  {
    number: 8,
    title: "clean one",
    headRefName: "fix/b",
    isDraft: false,
    mergeable: "MERGEABLE",
    statusCheckRollup: [check("SUCCESS")],
  },
  {
    number: 9,
    title: "merge me",
    headRefName: "fix/c",
    isDraft: false,
    mergeable: "CONFLICTING",
    statusCheckRollup: [],
  },
  {
    number: 10,
    title: "timed out",
    headRefName: "fix/d",
    isDraft: false,
    mergeable: "MERGEABLE",
    statusCheckRollup: [check("TIMED_OUT")],
  },
  {
    number: 11,
    title: "still running",
    headRefName: "fix/e",
    isDraft: false,
    mergeable: "MERGEABLE",
    statusCheckRollup: [{ state: "PENDING" }],
  },
  {
    number: 14,
    title: "draft red",
    headRefName: "fix/f",
    isDraft: true,
    mergeable: "MERGEABLE",
    statusCheckRollup: [check("FAILURE")],
  },
  {
    number: 15,
    title: "busy red",
    headRefName: "busy-branch",
    isDraft: false,
    mergeable: "MERGEABLE",
    statusCheckRollup: [{ state: "ERROR" }],
  },
];

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv(), stdio: "ignore" });
}

/** A clone whose origin/main has TASKS.md; origin then points at a GitHub URL whose fetch fails fast. */
function fixtureRepo(root: string, url = "git@github.com:acme/demo.git"): string {
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "TASKS.md"), TASKS);
  git(seed, "add", "TASKS.md");
  git(seed, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "seed");
  git(seed, "branch", "busy-branch");
  const bare = join(root, "origin.git");
  git(root, "clone", "-q", "--bare", seed, bare);
  const repo = join(root, "demo");
  git(root, "clone", "-q", bare, repo);
  git(repo, "worktree", "add", "-q", join(root, "busy"), "origin/busy-branch", "-b", "busy-branch");
  git(repo, "remote", "set-url", "origin", url);
  return repo;
}

/** A fake gh that prints raw JSON and applies the caller's --jq filter with the real jq. */
function fakeGh(root: string, issues: object[]): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "issues.json"), JSON.stringify(issues));
  writeFileSync(join(root, "prs.json"), JSON.stringify(PRS));
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
case "$1 $2" in
  "api user") echo me; exit 0 ;;
  "issue list") data="${root}/issues.json" ;;
  "pr list") data="${root}/prs.json" ;;
  *) exit 1 ;;
esac
filter=""
while [ "$#" -gt 0 ]; do [ "$1" = "--jq" ] && filter="$2"; shift; done
jq -r "$filter" "$data"
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

function pass(root: string, bin: string, args: string[], shell = "bash"): string {
  const env: NodeJS.ProcessEnv = {
    ...gitEnv(),
    PATH: `${bin}:${process.env.PATH}`,
    GIT_SSH_COMMAND: "false",
    HOME: root,
  };
  delete env.BASH_ENV;
  delete env.ENV;
  return execFileSync(shell, [SCRIPT, "--state-dir", join(root, "state"), ...args], { env, encoding: "utf-8" });
}

describe("watch-issues pass", () => {
  it("lists only ready tasks, tags issue authors, and keeps only red or conflicting PRs nobody is working on", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const out = pass(root, fakeGh(root, ISSUES), [repo]);
    expect(out).toContain("new   task  demo/fix-sync-crash: Fix the sync crash");
    expect(out).toContain("new   task  demo/add-flag: Add a flag");
    expect(out).toContain("new   task  demo/title:Task without an id: Task without an id");
    for (const hidden of ["wait-a-week", "claimed-one", "after-crash", "nice-to-have"])
      expect(out).not.toContain(hidden);
    expect(out).toContain("new   issue acme/demo#12 by someone (outside): sync crashes");
    expect(out).toContain("new   issue acme/demo#13 by me (owner): my own bug");
    expect(out).toContain("new   pr    acme/demo#7 red: red one");
    expect(out).toContain("new   pr    acme/demo#9 conflicting: merge me");
    expect(out).toContain("new   pr    acme/demo#10 red: timed out");
    for (const hidden of ["#8 ", "#11 ", "#14 ", "#15 "]) expect(out).not.toContain(hidden);
    expect(out).toContain("skip  demo: git fetch failed");
    expect(out.trim().split("\n").at(-1)).toBe("watch: 8 new, 0 open");
  });

  it("--include-p3 adds P3 tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, []), ["--include-p3", fixtureRepo(root)]);
    expect(out).toContain("new   task  demo/nice-to-have: Nice to have");
  });

  it("--done marks only handled items; everything else stays new", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const bin = fakeGh(root, ISSUES);
    expect(pass(root, bin, ["--done", "issue acme/demo#12", "--done", "task demo/add-flag"])).toContain("recorded 2");
    const out = pass(root, bin, [repo]);
    expect(out).toContain("open  issue acme/demo#12");
    expect(out).toContain("open  task  demo/add-flag");
    expect(out).toContain("new   issue acme/demo#13");
    expect(out).toContain("new   task  demo/fix-sync-crash");
    expect(out.trim().split("\n").at(-1)).toBe("watch: 6 new, 2 open");
  });

  it("reads a dotted repo name from an https origin", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root, "https://github.invalid.example/x");
    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/tasksmd/tasks.md.git"], {
      cwd: repo,
      env: gitEnv(),
    });
    const env = { GIT_TERMINAL_PROMPT: "0" };
    const out = pass(root, fakeGh(root, ISSUES), [repo]).replace(/\r/g, "");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(out).toContain("issue tasksmd/tasks.md#12");
    expect(out).not.toContain("not a GitHub repo");
  });

  it("works under macOS /bin/bash 3.2 with a comments-only repos file (falls back to the current repo)", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    mkdirSync(join(root, ".config", "watch-issues"), { recursive: true });
    writeFileSync(join(root, ".config", "watch-issues", "repos"), "# nothing watched yet\n   # still nothing\n");
    const out = pass(root, fakeGh(root, []), [], "/bin/bash");
    expect(out.trim().split("\n").at(-1)).toMatch(/^watch: \d+ new, \d+ open$/);
  });

  it("reads the repo list from the config file, trims spaces, expands ~, and skips a non-git folder", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    fixtureRepo(root);
    mkdirSync(join(root, "plain"));
    mkdirSync(join(root, ".config", "watch-issues"), { recursive: true });
    writeFileSync(join(root, ".config", "watch-issues", "repos"), "# watched\n  ~/demo  \n~/plain  # not a repo\n");
    const out = pass(root, fakeGh(root, []), []);
    expect(out).toContain("new   task  demo/fix-sync-crash");
    expect(out).toContain(`skip  ${join(root, "plain")}: not a git checkout`);
  });
});
