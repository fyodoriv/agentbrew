import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  spawnSync: vi.fn(() => ({ stdout: "" })),
}));

import { execFile, execFileSync } from "node:child_process";
import type { Source } from "../types.js";
import { getGitHeadSha, recordSourceSha, recordSourceShas } from "./skill-versions.js";

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

describe("recordSourceShas", () => {
  it("looks up every source's SHA in parallel and returns only fresh ones", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      args: string[],
      _opts: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        const url = args[1] ?? "";
        if (url.includes("broken")) callback(new Error("offline"), "");
        else callback(null, `sha-${url.split("/").pop()}\tHEAD\n`);
      }, 20);
    }) as never);
    const names = ["a", "b", "c", "broken", ...Array.from({ length: 10 }, (_, i) => `extra${i}`)];
    const sources = names.map((name) => makeSource({ url: `user/${name}` }));

    const shas = await recordSourceShas(sources);

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(shas.size).toBe(sources.length - 1);
    expect(shas.get("user/a")).toBe("sha-a.git");
    expect(shas.has("user/broken")).toBe(false);
    expect(sources[0]?.commitSha).toBe("sha-a.git");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
