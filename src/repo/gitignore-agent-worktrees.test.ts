import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// An agent's worktree folder inside the checkout is a nested git repo. When git does not ignore it,
// Copier sees the template as dirty, commits it as a submodule with no URL, and its
// `git submodule update` fails: the new-project Copier tests failed in a checkout that had one.
// A global gitignore hid it on one machine only, so the repo's own .gitignore must cover it.
describe("repo .gitignore", () => {
  it.each([
    ".claude/worktrees/some-session/README.md",
  ])("ignores agent worktrees without a global gitignore: %s", (path) => {
    const out = execFileSync("git", ["check-ignore", "--no-index", "-v", path], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
      encoding: "utf-8",
    });
    expect(out).toMatch(/^\.gitignore:/);
  });
});
