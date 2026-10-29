import { execFileSync, spawnSync } from "node:child_process";
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

const OLD = "2020-01-01T00:00:00Z";
interface Pr {
  number: number;
  title: string;
  headRefName: string;
  headRefOid?: string;
  isDraft?: boolean;
  mergeable?: string;
  statusCheckRollup?: object[];
  updatedAt?: string;
}
const pr = (p: Pr) => ({
  headRefOid: "abcdef1234",
  isDraft: false,
  mergeable: "MERGEABLE",
  statusCheckRollup: [],
  updatedAt: OLD,
  ...p,
});
const PRS = [
  pr({ number: 7, title: "red one", headRefName: "fix/a", statusCheckRollup: [{ conclusion: "FAILURE" }] }),
  pr({ number: 8, title: "clean one", headRefName: "fix/b", statusCheckRollup: [{ conclusion: "SUCCESS" }] }),
  pr({ number: 9, title: "merge me", headRefName: "fix/c", mergeable: "CONFLICTING" }),
  pr({ number: 10, title: "timed out", headRefName: "fix/d", statusCheckRollup: [{ conclusion: "TIMED_OUT" }] }),
  pr({ number: 11, title: "still running", headRefName: "fix/e", statusCheckRollup: [{ state: "PENDING" }] }),
  pr({
    number: 14,
    title: "draft red",
    headRefName: "fix/f",
    isDraft: true,
    statusCheckRollup: [{ conclusion: "FAILURE" }],
  }),
  pr({ number: 15, title: "busy red", headRefName: "busy-branch", statusCheckRollup: [{ conclusion: "FAILURE" }] }),
  pr({ number: 16, title: "status error", headRefName: "fix/g", statusCheckRollup: [{ state: "ERROR" }] }),
  pr({
    number: 17,
    title: "just pushed",
    headRefName: "fix/h",
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    mergeable: "CONFLICTING",
  }),
];

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv(), stdio: "ignore" });
}

/** A clone whose origin/main has TASKS.md. Its origin is a GitHub URL rewritten to the local bare repo, so nothing touches the network. */
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
  git(repo, "config", `url.${bare}.insteadOf`, url);
  return repo;
}

/** A fake gh that prints raw JSON and applies the caller's --jq filter with the real jq. */
function fakeGh(root: string, issues: object[], prs: object[] = PRS): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "issues.json"), JSON.stringify(issues));
  writeFileSync(join(root, "prs.json"), JSON.stringify(prs));
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

function run(root: string, bin: string, args: string[], opts: { shell?: string; cwd?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...gitEnv(), PATH: `${bin}:${process.env.PATH}`, HOME: root };
  delete env.BASH_ENV;
  delete env.ENV;
  return spawnSync(opts.shell ?? "bash", [SCRIPT, "--state-dir", join(root, "state"), ...args], {
    env,
    cwd: opts.cwd,
    encoding: "utf-8",
  });
}

function pass(root: string, bin: string, args: string[], opts: { shell?: string; cwd?: string } = {}): string {
  const result = run(root, bin, args, opts);
  expect(result.status).toBe(0);
  return result.stdout;
}

const line = (key: string, text: string) => `new\t${key}\t${text}`;
const lastLine = (out: string) => out.trim().split("\n").at(-1);

describe("watch-issues pass", () => {
  it("lists ready tasks, tagged issues, and broken PRs nobody is on, each with its exact --done key", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, ISSUES), ["--limit", "50", fixtureRepo(root)]);
    expect(out).toContain(line("task demo/fix-sync-crash", "Fix the sync crash"));
    expect(out).toContain(line("task demo/add-flag", "Add a flag"));
    expect(out).toContain(line("task demo/title:Task without an id", "Task without an id"));
    for (const hidden of ["wait-a-week", "claimed-one", "after-crash", "nice-to-have"])
      expect(out).not.toContain(hidden);
    expect(out).toContain(line("issue acme/demo#12", "by someone (outside): sync crashes"));
    expect(out).toContain(line("issue acme/demo#13", "by me (owner): my own bug"));
    expect(out).toContain(line("pr acme/demo#7 red abcdef1", "red one"));
    expect(out).toContain(line("pr acme/demo#9 conflicting abcdef1", "merge me"));
    expect(out).toContain(line("pr acme/demo#10 red abcdef1", "timed out"));
    expect(out).toContain(line("pr acme/demo#16 red abcdef1", "status error"));
    for (const hidden of ["#8 ", "#11 ", "#14 ", "#15 ", "#17 "]) expect(out).not.toContain(hidden);
    expect(out).not.toContain("skip");
    expect(lastLine(out)).toBe("watch: 9 new (showing 9), 0 handled");
  });

  it("shows at most --limit items: broken PRs, then own issues, then tasks, then outside issues", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, ISSUES, [PRS[0]]), ["--limit", "4", fixtureRepo(root)]);
    const keys = out
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("new\t"))
      .map((l) => l.split("\t")[1]);
    expect(keys).toEqual([
      "pr acme/demo#7 red abcdef1",
      "issue acme/demo#13",
      "task demo/fix-sync-crash",
      "issue acme/demo#12",
    ]);
    expect(lastLine(out)).toBe("watch: 6 new (showing 4), 0 handled");
  });

  it("--done hides a handled item, but a PR that breaks again comes back as new", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    let bin = fakeGh(root, ISSUES, [PRS[0]]);
    expect(pass(root, bin, ["--done", "pr acme/demo#7 red abcdef1", "--done", "issue acme/demo#12"])).toContain(
      "recorded 2",
    );
    let out = pass(root, bin, ["--limit", "50", repo]);
    expect(out).not.toContain("acme/demo#7");
    expect(out).not.toContain("acme/demo#12");
    expect(lastLine(out)).toBe("watch: 4 new (showing 4), 2 handled");
    bin = fakeGh(root, ISSUES, [{ ...PRS[0], headRefOid: "9999999aaa", mergeable: "CONFLICTING" }]);
    out = pass(root, bin, ["--limit", "50", repo]);
    expect(out).toContain(line("pr acme/demo#7 conflicting 9999999", "red one"));
  });

  it("--done rejects a malformed key, a pasted line with a tab, and a wrong-shaped PR key", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const bin = fakeGh(root, []);
    for (const bad of [
      "acme/demo#12",
      "issue acme/demo#21\tby me (owner): needs sudo",
      "pr acme/demo#7 red",
      "issue acme/demo#12 ",
    ]) {
      const result = run(root, bin, ["--done", bad]);
      expect(result.status, bad).toBe(1);
      expect(result.stderr).toContain("not an item key");
    }
  });

  it("--done fails when it cannot write the seen list, instead of saying it recorded the item", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const bin = fakeGh(root, []);
    mkdirSync(join(root, "state"));
    writeFileSync(join(root, "state", "seen"), "");
    chmodSync(join(root, "state", "seen"), 0o444);
    const result = run(root, bin, ["--done", "issue acme/demo#12"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot write");
    expect(result.stdout).not.toContain("recorded");
  });

  it("keeps one slot for an outside issue even behind a long queue", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, ISSUES, [PRS[0]]), ["--limit", "3", fixtureRepo(root)]);
    const keys = out
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("new\t"))
      .map((l) => l.split("\t")[1]);
    expect(keys).toEqual(["pr acme/demo#7 red abcdef1", "issue acme/demo#13", "issue acme/demo#12"]);
  });

  it("--include-p3 adds P3 tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, [], []), ["--include-p3", "--limit", "50", fixtureRepo(root)]);
    expect(out).toContain(line("task demo/nice-to-have", "Nice to have"));
  });

  it("reads a dotted repo name from an https origin, without the network", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const out = pass(root, fakeGh(root, ISSUES, []), [
      "--limit",
      "50",
      fixtureRepo(root, "https://github.com/tasksmd/tasks.md.git"),
    ]);
    expect(out).toContain(line("issue tasksmd/tasks.md#12", "by someone (outside): sync crashes"));
    expect(out).not.toContain("skip");
  });

  it("works under macOS /bin/bash 3.2 with a comments-only repos file (falls back to the current repo)", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    mkdirSync(join(root, ".config", "watch-issues"), { recursive: true });
    writeFileSync(join(root, ".config", "watch-issues", "repos"), "# nothing watched yet\n   # still nothing\n");
    const out = pass(root, fakeGh(root, [], []), ["--limit", "50"], { shell: "/bin/bash", cwd: repo });
    expect(out).toContain(line("task demo/fix-sync-crash", "Fix the sync crash"));
  });

  it("reads the repo list from the config file, trims spaces, expands ~, and skips a non-git folder", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    fixtureRepo(root);
    mkdirSync(join(root, "plain"));
    mkdirSync(join(root, ".config", "watch-issues"), { recursive: true });
    writeFileSync(join(root, ".config", "watch-issues", "repos"), "# watched\n  ~/demo  \n~/plain  # not a repo\n");
    const out = pass(root, fakeGh(root, [], []), ["--limit", "50"]);
    expect(out).toContain(line("task demo/fix-sync-crash", "Fix the sync crash"));
    expect(out).toContain(`skip  ${join(root, "plain")}: not a git checkout`);
  });

  it("skips issues assigned to someone else or labelled blocked", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const issues = [
      { number: 20, title: "free", author: { login: "someone" }, assignees: [], labels: [] },
      { number: 21, title: "mine", author: { login: "someone" }, assignees: [{ login: "me" }], labels: [] },
      { number: 22, title: "taken", author: { login: "someone" }, assignees: [{ login: "other" }], labels: [] },
      { number: 23, title: "parked", author: { login: "me" }, assignees: [], labels: [{ name: "blocked: owner" }] },
    ];
    const out = pass(root, fakeGh(root, issues, []), ["--limit", "50", fixtureRepo(root)]);
    expect(out).toContain("issue acme/demo#20");
    expect(out).toContain("issue acme/demo#21");
    expect(out).not.toContain("#22");
    expect(out).not.toContain("#23");
  });

  it("--wait polls until a new item appears, then prints the pass and exits", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const bin = fakeGh(root, [], []);
    for (const k of ["fix-sync-crash", "add-flag", "title:Task without an id"])
      pass(root, bin, ["--done", `task demo/${k}`]);
    // An issue arrives 6 s after the wait starts.
    writeFileSync(
      join(root, "arrive.sh"),
      `sleep 6; printf '%s' '${JSON.stringify([{ number: 30, title: "new one", author: { login: "me" }, assignees: [], labels: [] }])}' > ${join(root, "issues.json")}`,
    );
    const bg = spawnSync("sh", ["-c", `sh ${join(root, "arrive.sh")} >/dev/null 2>&1 &`]);
    expect(bg.status).toBe(0);
    const started = Date.now();
    const out = pass(root, bin, ["--wait", "30", "--interval", "1", repo]);
    expect(Date.now() - started).toBeLessThan(20000);
    expect(Date.now() - started).toBeGreaterThan(5000);
    expect(out).toContain(line("issue acme/demo#30", "by me (owner): new one"));
  });

  it("--wait ends with only the summary line when nothing new arrives in time", () => {
    const root = mkdtempSync(join(tmpdir(), "watch-pass-"));
    const repo = fixtureRepo(root);
    const bin = fakeGh(root, [], []);
    for (const k of ["fix-sync-crash", "add-flag", "title:Task without an id"])
      pass(root, bin, ["--done", `task demo/${k}`]);
    const started = Date.now();
    const out = pass(root, bin, ["--wait", "3", "--interval", "1", repo]);
    expect(Date.now() - started).toBeLessThan(15000);
    expect(out.trim().split("\n")).toEqual(["watch: 0 new (showing 0), 3 handled"]);
  });
});
