import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutPinnedRef } from "./git-ref.js";
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
