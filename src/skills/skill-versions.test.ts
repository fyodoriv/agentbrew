import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import type { Source } from "../types.js";
import { getGitHeadSha, recordSourceSha } from "./skill-versions.js";

const mockExecFileSync = vi.mocked(execFileSync);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    url: "user/repo",
    type: "github",
    skillsInstalled: ["my-skill"],
    availableItems: [],
    addedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getGitHeadSha", () => {
  it("gets SHA for local source via git rev-parse", () => {
    mockExecFileSync.mockReturnValue("abc123def456\n" as never);
    const source = makeSource({ type: "local", url: "/path/to/repo" });
    const sha = getGitHeadSha(source);
    expect(sha).toBe("abc123def456");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/path/to/repo" }),
    );
  });

  it("gets SHA for github source via ls-remote", () => {
    mockExecFileSync.mockReturnValue("abc123\tHEAD\n" as never);
    const source = makeSource({ type: "github", url: "user/repo" });
    const sha = getGitHeadSha(source);
    expect(sha).toBe("abc123");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "https://github.com/user/repo.git", "HEAD"],
      expect.anything(),
    );
  });

  it("gets SHA for url source via ls-remote", () => {
    mockExecFileSync.mockReturnValue("def456\tHEAD\n" as never);
    const source = makeSource({ type: "url", url: "https://example.com/repo.git" });
    const sha = getGitHeadSha(source);
    expect(sha).toBe("def456");
  });

  it("passes git@ SSH URLs through when misclassified as github", () => {
    mockExecFileSync.mockReturnValue("ghi789\tHEAD\n" as never);
    const url = "git@ghe.example.com:acme/example-skills.git";
    const source = makeSource({ type: "github", url });
    getGitHeadSha(source);
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["ls-remote", url, "HEAD"], expect.anything());
  });

  it("returns undefined on error", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fail");
    });
    const source = makeSource();
    expect(getGitHeadSha(source)).toBeUndefined();
  });
});

describe("recordSourceSha", () => {
  it("sets commitSha on source", () => {
    mockExecFileSync.mockReturnValue("abc123\tHEAD\n" as never);
    const source = makeSource();
    recordSourceSha(source);
    expect(source.commitSha).toBe("abc123");
  });

  it("does not set commitSha when git fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fail");
    });
    const source = makeSource();
    recordSourceSha(source);
    expect(source.commitSha).toBeUndefined();
  });
});
