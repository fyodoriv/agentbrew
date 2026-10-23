import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCacheOrigin, CacheRefusal, cacheGitEnv, checkoutPinnedRef, isLocalRepoPath } from "./git-ref.js";
import { cloneOrUpdateRepo, GIT_CACHE_DIR } from "./mcp-git.js";

// Real git against scratch source repos. The scratch HOME comes from
// vitest.isolated-home.ts; git reads an empty scratch global config and no
// system config, so the developer's git setup never changes a result.

const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "agentbrew test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "agentbrew test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

let root = "";
const savedEnv: Record<string, string | undefined> = {};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function commitFile(repo: string, text: string): string {
  writeFileSync(join(repo, "which.txt"), `${text}\n`);
  git(repo, "add", "which.txt");
  git(repo, "commit", "--quiet", "-m", text);
  return git(repo, "rev-parse", "HEAD");
}

interface ShadowRepo {
  repo: string;
  /** Commit of the annotated tag `v1.0.0`. */
  tag: string;
  /** Commit of the branch `v1.0.0`, which shadows the tag in `clone --branch`. */
  branch: string;
  /** Commit of the plain branch `feature` (no tag has that name). */
  feature: string;
}

/** A source repo where the tag `v1.0.0` and the branch `v1.0.0` point at different commits. */
function shadowRepo(name: string, format: "sha1" | "sha256" = "sha1"): ShadowRepo {
  const repo = join(root, name);
  git(root, "init", "--quiet", "-b", "main", `--object-format=${format}`, repo);
  const base = commitFile(repo, "base");
  git(repo, "checkout", "--quiet", "--detach", base);
  const tag = commitFile(repo, "tag");
  git(repo, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  git(repo, "checkout", "--quiet", "--detach", base);
  const branch = commitFile(repo, "branch");
  git(repo, "update-ref", "refs/heads/v1.0.0", branch);
  git(repo, "checkout", "--quiet", "--detach", base);
  const feature = commitFile(repo, "feature");
  git(repo, "update-ref", "refs/heads/feature", feature);
  git(repo, "checkout", "--quiet", "main");
  return { repo, tag, branch, feature };
}

function head(dir: string): string {
  return git(dir, "rev-parse", "HEAD");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-git-ref-"));
  const globalConfig = join(root, "empty.gitconfig");
  writeFileSync(globalConfig, "");
  // Drop GIT_DIR and friends (set inside git hooks), so git sees only the fixtures.
  for (const key of Object.keys(process.env).filter((name) => name.startsWith("GIT_"))) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...GIT_ENV, GIT_CONFIG_GLOBAL: globalConfig })) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(GIT_CACHE_DIR, { recursive: true, force: true });
});

describe("cloneOrUpdateRepo pins the exact ref (real git)", () => {
  it("installs the tag, not a branch with the same name, on a fresh clone", () => {
    const source = shadowRepo("fresh-shadow");
    const dir = cloneOrUpdateRepo(source.repo, "fresh-shadow", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
    expect(readFileSync(join(dir, "which.txt"), "utf-8")).toBe("tag\n");
  });

  it("installs the tag when the cached repo already has a local branch with that name", () => {
    const source = shadowRepo("cached-shadow");
    const dir = cloneOrUpdateRepo(source.repo, "cached-shadow");
    // An earlier `clone --branch v1.0.0` left this local branch behind.
    git(dir, "branch", "--quiet", "v1.0.0", "refs/remotes/origin/v1.0.0");
    cloneOrUpdateRepo(source.repo, "cached-shadow", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
  });

  it("installs a plain branch, and `mcp update` still pulls that branch", () => {
    const source = shadowRepo("plain-branch");
    const dir = cloneOrUpdateRepo(source.repo, "plain-branch", "feature");
    expect(head(dir)).toBe(source.feature);
    expect(git(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/feature");

    git(source.repo, "checkout", "--quiet", "feature");
    const next = commitFile(source.repo, "feature-2");
    git(source.repo, "checkout", "--quiet", "main");
    cloneOrUpdateRepo(source.repo, "plain-branch");
    expect(head(dir)).toBe(next);
  });

  it("moves a cached branch pin to the remote tip", () => {
    const source = shadowRepo("cached-branch");
    const dir = cloneOrUpdateRepo(source.repo, "cached-branch", "feature");
    git(source.repo, "checkout", "--quiet", "feature");
    const next = commitFile(source.repo, "feature-2");
    git(source.repo, "checkout", "--quiet", "main");
    cloneOrUpdateRepo(source.repo, "cached-branch", "feature");
    expect(head(dir)).toBe(next);
  });

  it("re-pins a cached tag that the remote moved", () => {
    const source = shadowRepo("moved-tag");
    const dir = cloneOrUpdateRepo(source.repo, "moved-tag", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
    git(source.repo, "tag", "--force", "-a", "v1.0.0", "-m", "v1.0.0 again", source.feature);
    cloneOrUpdateRepo(source.repo, "moved-tag", "v1.0.0");
    expect(head(dir)).toBe(source.feature);
  });

  it("installs a full commit ID, and a newer one on the cached repo", () => {
    const source = shadowRepo("commit-id");
    const dir = cloneOrUpdateRepo(source.repo, "commit-id", source.feature);
    expect(head(dir)).toBe(source.feature);
    git(source.repo, "checkout", "--quiet", "feature");
    const next = commitFile(source.repo, "feature-2");
    git(source.repo, "checkout", "--quiet", "main");
    cloneOrUpdateRepo(source.repo, "commit-id", next);
    expect(head(dir)).toBe(next);
  });

  it("fetches a full commit ID that no branch or tag reaches", () => {
    const source = shadowRepo("hidden-commit");
    git(source.repo, "checkout", "--quiet", "--detach", source.feature);
    const hidden = commitFile(source.repo, "hidden");
    git(source.repo, "update-ref", "refs/pull/1/head", hidden);
    git(source.repo, "checkout", "--quiet", "main");
    // file:// makes clone use the pack protocol, so only branches and tags come over.
    const dir = cloneOrUpdateRepo(`file://${source.repo}`, "hidden-commit", hidden);
    expect(head(dir)).toBe(hidden);
  });

  it("refuses a full commit ID the remote does not have, with git's reason", () => {
    const source = shadowRepo("missing-commit");
    expect(() => cloneOrUpdateRepo(source.repo, "missing-commit", "0".repeat(40))).toThrow(
      /is not a commit in the remote repo\. git fetch: /,
    );
    expect(existsSync(join(GIT_CACHE_DIR, "missing-commit"))).toBe(false);
  });

  it("installs a shadowed branch named refs/heads/<name>, and a tag named refs/tags/<name>", () => {
    const source = shadowRepo("explicit-ref");
    const dir = cloneOrUpdateRepo(source.repo, "explicit-ref", "refs/heads/v1.0.0");
    expect(head(dir)).toBe(source.branch);
    cloneOrUpdateRepo(source.repo, "explicit-ref", "refs/tags/v1.0.0");
    expect(head(dir)).toBe(source.tag);
  });

  it("refuses a ref that starts with '-' before git runs, on a fresh and a cached repo", () => {
    const source = shadowRepo("dash-ref");
    expect(() => cloneOrUpdateRepo(source.repo, "dash-ref", "--detach")).toThrow(/starts with "-"/);
    expect(existsSync(join(GIT_CACHE_DIR, "dash-ref"))).toBe(false);

    const dir = cloneOrUpdateRepo(source.repo, "dash-ref");
    expect(() => cloneOrUpdateRepo(source.repo, "dash-ref", "--detach")).toThrow(/starts with "-"/);
    expect(() => cloneOrUpdateRepo(source.repo, "dash-ref", "refs/heads/--orphan")).toThrow(/starts with "-"/);
    expect(git(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  it("never runs in a repo that encloses a cache dir without .git", () => {
    const outer = shadowRepo("outer");
    // An origin with `feature`, so unguarded code would really switch the outer repo.
    git(outer.repo, "remote", "add", "origin", shadowRepo("outer-origin").repo);
    git(outer.repo, "fetch", "--quiet", "origin");
    const before = git(outer.repo, "rev-parse", "refs/heads/main");
    const notAClone = join(outer.repo, "mcp-repos", "broken");
    mkdirSync(notAClone, { recursive: true });
    expect(() => checkoutPinnedRef(notAClone, "feature")).toThrow(/is not its own git clone/);
    expect(git(outer.repo, "rev-parse", "refs/heads/main")).toBe(before);
    expect(git(outer.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  it("never acts on the repo that an exported GIT_DIR names", () => {
    const victim = shadowRepo("victim");
    git(victim.repo, "remote", "add", "origin", shadowRepo("victim-origin").repo);
    git(victim.repo, "fetch", "--quiet", "origin");
    const unpushed = commitFile(victim.repo, "unpushed");
    const source = shadowRepo("gitdir-env");
    // git exports GIT_DIR to hooks; an agentbrew run from a hook inherits it.
    process.env.GIT_DIR = join(victim.repo, ".git");
    let dir = "";
    try {
      dir = cloneOrUpdateRepo(source.repo, "gitdir-env", "feature");
      cloneOrUpdateRepo(source.repo, "gitdir-env", "main");
      // No ref: `mcp update` runs fetch --tags and pull, which must stay in the cache too.
      cloneOrUpdateRepo(source.repo, "gitdir-env");
    } finally {
      delete process.env.GIT_DIR;
    }
    expect(head(dir)).toBe(git(source.repo, "rev-parse", "refs/heads/main"));
    expect(git(victim.repo, "rev-parse", "refs/heads/main")).toBe(unpushed);
    expect(git(victim.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  it("keeps git config set through the env, such as an insteadOf rewrite", () => {
    const source = shadowRepo("env-config");
    const alias = "https://mcp.example.invalid/env-config";
    const config = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${source.repo}.insteadOf`,
      GIT_CONFIG_VALUE_0: alias,
    };
    Object.assign(process.env, config);
    let dir = "";
    try {
      dir = cloneOrUpdateRepo(alias, "env-config", "v1.0.0");
    } finally {
      for (const key of Object.keys(config)) delete process.env[key];
    }
    expect(head(dir)).toBe(source.tag);
  });

  it("refuses an invalid ref name and leaves no cache dir", () => {
    const source = shadowRepo("bad-name");
    expect(() => cloneOrUpdateRepo(source.repo, "bad-name", "v1..0")).toThrow(/not a valid git ref name/);
    expect(existsSync(join(GIT_CACHE_DIR, "bad-name"))).toBe(false);
  });

  it("refuses a ref the remote does not have and leaves no cache dir", () => {
    const source = shadowRepo("missing-ref");
    expect(() => cloneOrUpdateRepo(source.repo, "missing-ref", "v9.9.9")).toThrow(
      /not a tag, branch, or full commit ID/,
    );
    expect(existsSync(join(GIT_CACHE_DIR, "missing-ref"))).toBe(false);
  });

  it("keeps SHA-256 repos working: the tag wins, and a 64-hex commit ID installs", () => {
    const source = shadowRepo("sha256-shadow", "sha256");
    expect(source.tag).toHaveLength(64);
    const dir = cloneOrUpdateRepo(source.repo, "sha256-shadow", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
    cloneOrUpdateRepo(source.repo, "sha256-shadow", source.feature);
    expect(head(dir)).toBe(source.feature);
    // 40 hex is only a prefix here, so it is not taken as a commit ID.
    expect(() => cloneOrUpdateRepo(source.repo, "sha256-shadow", source.tag.slice(0, 40))).toThrow(
      /not a full commit ID in this repo/,
    );
  });
});

describe("cloneOrUpdateRepo uses a cache dir only for the repo that made it (real git)", () => {
  /** A source repo whose tag `v1.0.0` points at a commit no other fixture has. */
  function uniqueRepo(name: string): { repo: string; tag: string } {
    const source = shadowRepo(name);
    const tag = commitFile(source.repo, `only-in-${name}`);
    git(source.repo, "tag", "--force", "-a", "v1.0.0", "-m", `v1.0.0 of ${name}`, tag);
    return { repo: source.repo, tag };
  }

  it("refuses a cached repo that another URL cloned under the same server name", () => {
    const first = uniqueRepo("same-name-a");
    const second = uniqueRepo("same-name-b");
    const dir = cloneOrUpdateRepo(first.repo, "same-name");
    const before = head(dir);
    expect(() => cloneOrUpdateRepo(second.repo, "same-name", "v1.0.0")).toThrow(/holds .*, not /);
    // A refusal is not wrapped as a failed update: a retry cannot pass.
    expect(() => cloneOrUpdateRepo(second.repo, "same-name")).toThrow(CacheRefusal);
    expect(() => cloneOrUpdateRepo(second.repo, "same-name")).not.toThrow(/Failed to update repo/);
    expect(head(dir)).toBe(before);
  });

  it("matches a relative local path, from any dir, to the absolute origin git stored", () => {
    const source = uniqueRepo("relative-src");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      const dir = cloneOrUpdateRepo("relative-src", "relative-src");
      process.chdir(source.repo);
      cloneOrUpdateRepo(".", "relative-src", "v1.0.0");
      expect(head(dir)).toBe(source.tag);
    } finally {
      process.chdir(cwd);
    }
  });

  it("compares URL forms: a trailing .git or / matches; ssh and https of one repo do not", () => {
    const source = uniqueRepo("url-forms");
    const dir = cloneOrUpdateRepo(source.repo, "url-forms");
    git(dir, "remote", "set-url", "origin", "https://example.invalid/org/repo.git");
    expect(() => assertCacheOrigin(dir, "https://example.invalid/org/repo/")).not.toThrow();
    expect(() => assertCacheOrigin(dir, "https://example.invalid/org/repo/.git")).not.toThrow();
    expect(() => assertCacheOrigin(dir, "git@example.invalid:org/repo.git")).toThrow(/holds .*, not /);
    expect(() => assertCacheOrigin(dir, "https://example.invalid/org/other")).toThrow(/install <other-name> --git/);
    // git fetches from the first URL, `config --get` reads the last: two URLs are refused.
    git(dir, "config", "--add", "remote.origin.url", "https://example.invalid/org/repo.git");
    expect(() => assertCacheOrigin(dir, "https://example.invalid/org/repo")).toThrow(/more than one origin URL/);
    // A relative path from before absolute paths were recorded gets the reinstall hint.
    git(dir, "config", "--unset-all", "remote.origin.url");
    git(dir, "config", "remote.origin.url", "https://example.invalid/org/repo.git");
    expect(() => assertCacheOrigin(dir, "../repo")).toThrow(/--git <absolute path>/);
  });

  it("still updates when the URL differs only by a trailing slash or /.git", () => {
    const source = uniqueRepo("same-url-forms");
    const dir = cloneOrUpdateRepo(source.repo, "same-url-forms");
    cloneOrUpdateRepo(`${source.repo}/`, "same-url-forms", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
    cloneOrUpdateRepo(join(source.repo, ".git"), "same-url-forms", "v1.0.0");
    expect(head(dir)).toBe(source.tag);
  });

  it("refuses a cached repo with no origin remote, even with a repo at ./origin in its checkout", () => {
    const source = uniqueRepo("no-origin");
    const evil = uniqueRepo("no-origin-evil");
    const dir = cloneOrUpdateRepo(source.repo, "no-origin");
    git(dir, "remote", "rename", "origin", "upstream");
    // Without an `origin` remote, git reads `origin` as this path.
    git(dir, "clone", "--quiet", "--bare", evil.repo, "origin");
    const before = head(dir);
    expect(() => cloneOrUpdateRepo(source.repo, "no-origin", "v1.0.0")).toThrow(/no origin remote/);
    expect(head(dir)).toBe(before);
    expect(head(dir)).not.toBe(evil.tag);
  });

  it("refuses a cache dir that is a linked worktree of another repo, and leaves its branch untouched", () => {
    const upstream = shadowRepo("worktree-upstream");
    const dev = shadowRepo("worktree-dev");
    git(dev.repo, "remote", "add", "origin", upstream.repo);
    git(dev.repo, "fetch", "--quiet", "origin");
    git(dev.repo, "checkout", "--quiet", "feature");
    const unpushed = commitFile(dev.repo, "unpushed-feature");
    git(dev.repo, "checkout", "--quiet", "main");
    mkdirSync(GIT_CACHE_DIR, { recursive: true });
    git(dev.repo, "worktree", "add", "--quiet", join(GIT_CACHE_DIR, "worktree-cache"), "feature");
    expect(() => cloneOrUpdateRepo(upstream.repo, "worktree-cache", "feature")).toThrow(/not its own git clone/);
    expect(() => cloneOrUpdateRepo(upstream.repo, "worktree-cache")).toThrow(/not its own git clone/);
    expect(git(dev.repo, "rev-parse", "refs/heads/feature")).toBe(unpushed);
  });

  it("refuses a cache whose .git shares another repo's refs through a commondir file", () => {
    const upstream = shadowRepo("commondir-upstream");
    const dev = shadowRepo("commondir-dev");
    git(dev.repo, "remote", "add", "origin", upstream.repo);
    git(dev.repo, "fetch", "--quiet", "origin");
    const unpushed = commitFile(dev.repo, "unpushed-main");
    const dir = cloneOrUpdateRepo(upstream.repo, "commondir-cache");
    writeFileSync(join(dir, ".git", "commondir"), `${join(dev.repo, ".git")}\n`);
    expect(() => cloneOrUpdateRepo(upstream.repo, "commondir-cache", "main")).toThrow(/not its own git clone/);
    expect(git(dev.repo, "rev-parse", "refs/heads/main")).toBe(unpushed);
  });

  it("refuses a cache dir that is a symlink, and leaves the link target untouched", () => {
    const upstream = shadowRepo("link-upstream");
    const target = shadowRepo("link-target");
    git(target.repo, "remote", "add", "origin", upstream.repo);
    git(target.repo, "fetch", "--quiet", "origin");
    const unpushed = commitFile(target.repo, "unpushed");
    mkdirSync(GIT_CACHE_DIR, { recursive: true });
    symlinkSync(target.repo, join(GIT_CACHE_DIR, "linked"));
    expect(() => cloneOrUpdateRepo(upstream.repo, "linked", "main")).toThrow(/is a symlink/);
    expect(() => cloneOrUpdateRepo(upstream.repo, "linked")).toThrow(/is a symlink/);
    expect(git(target.repo, "rev-parse", "refs/heads/main")).toBe(unpushed);
    expect(git(target.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });
});

describe("isLocalRepoPath", () => {
  it("tells local paths from remote URLs the way git does", () => {
    expect(isLocalRepoPath("../mcp")).toBe(true);
    expect(isLocalRepoPath("/abs/mcp")).toBe(true);
    expect(isLocalRepoPath("./dir:with-colon")).toBe(true);
    expect(isLocalRepoPath("./a://b")).toBe(true);
    expect(isLocalRepoPath("https://example.com/org/mcp.git")).toBe(false);
    expect(isLocalRepoPath("file:///abs/mcp")).toBe(false);
    expect(isLocalRepoPath("git@example.com:org/mcp.git")).toBe(false);
    expect(isLocalRepoPath("host:mcp")).toBe(false);
  });
});

describe("cacheGitEnv", () => {
  it("stops every git login prompt for an unattended run, and keeps them otherwise", () => {
    const unattended = cacheGitEnv({ unattended: true });
    expect(unattended.GIT_TERMINAL_PROMPT).toBe("0");
    // Empty GIT_ASKPASS: git then skips core.askPass and SSH_ASKPASS too.
    expect(unattended.GIT_ASKPASS).toBe("");
    expect(unattended.GCM_INTERACTIVE).toBe("never");
    const attended = cacheGitEnv();
    expect(attended.GIT_TERMINAL_PROMPT).toBe(process.env.GIT_TERMINAL_PROMPT);
    expect(attended.GIT_ASKPASS).toBe(process.env.GIT_ASKPASS);
  });
});
