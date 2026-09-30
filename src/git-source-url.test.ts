import { describe, expect, it } from "vitest";
import { detectSourceType, resolveGitCloneUrl } from "./git-source-url.js";

describe("detectSourceType", () => {
  it("detects git@ SSH URLs as url", () => {
    expect(detectSourceType("git@corp-ghe.example.com:acme/team-skills.git")).toBe("url");
  });

  it("detects user/repo shorthand as github", () => {
    expect(detectSourceType("vercel-labs/skills")).toBe("github");
  });
});

describe("resolveGitCloneUrl", () => {
  it("builds github.com URL for user/repo shorthand", () => {
    expect(resolveGitCloneUrl("vercel-labs/skills", "github")).toBe("https://github.com/vercel-labs/skills.git");
  });

  it("does not double-append .git for shorthand already ending in .git", () => {
    expect(resolveGitCloneUrl("user/repo.git", "github")).toBe("https://github.com/user/repo.git");
  });

  it("passes git@ GHE SSH URLs through even when misclassified as github", () => {
    const url = "git@corp-ghe.example.com:acme/team-skills.git";
    expect(resolveGitCloneUrl(url, "github")).toBe(url);
    expect(resolveGitCloneUrl(url, "url")).toBe(url);
  });

  it("passes https GHE URLs through", () => {
    const url = "https://corp-ghe.example.com/acme/team-skills.git";
    expect(resolveGitCloneUrl(url, "url")).toBe(url);
  });
});
