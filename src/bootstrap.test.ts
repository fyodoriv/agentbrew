import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("./catalog/index-source.js", () => ({
  getSourceCachePath: vi.fn(),
}));

vi.mock("./state.js", () => ({
  requireState: vi.fn(),
}));

import { bootstrapSource } from "./bootstrap.js";
import { getSourceCachePath } from "./catalog/index-source.js";
import { requireState } from "./state.js";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);
const mockRequireState = vi.mocked(requireState);

function source(url: string, bootstrapScript?: string) {
  return {
    url,
    type: "github" as const,
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01",
    ...(bootstrapScript ? { bootstrapScript } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("bootstrapSource", () => {
  it("executes a source bootstrap script from the source cache", () => {
    mockRequireState.mockReturnValue({
      agents: [],
      sources: [source("owner/repo", "scripts/bootstrap.sh")],
      catalogVersion: "0.1.0",
    });
    mockGetSourceCachePath.mockReturnValue("/cache/owner_repo");
    mockExistsSync.mockReturnValue(true);

    const ok = bootstrapSource("owner/repo");

    expect(ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith("bash", ["/cache/owner_repo/scripts/bootstrap.sh"], {
      cwd: "/cache/owner_repo",
      stdio: "inherit",
      timeout: 600_000,
    });
  });

  it("matches by source short name when it is unambiguous", () => {
    mockRequireState.mockReturnValue({
      agents: [],
      sources: [source("owner/repo", "/tmp/bootstrap.sh")],
      catalogVersion: "0.1.0",
    });
    mockGetSourceCachePath.mockReturnValue("/cache/owner_repo");
    mockExistsSync.mockReturnValue(true);

    const ok = bootstrapSource("repo");

    expect(ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith("bash", ["/tmp/bootstrap.sh"], expect.any(Object));
  });

  it("fails when the source has no bootstrap script", () => {
    mockRequireState.mockReturnValue({
      agents: [],
      sources: [source("owner/repo")],
      catalogVersion: "0.1.0",
    });

    const ok = bootstrapSource("owner/repo");

    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns false when the bootstrap script exits non-zero", () => {
    mockRequireState.mockReturnValue({
      agents: [],
      sources: [source("owner/repo", "scripts/bootstrap.sh")],
      catalogVersion: "0.1.0",
    });
    mockGetSourceCachePath.mockReturnValue("/cache/owner_repo");
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("exit 1");
    });

    const ok = bootstrapSource("owner/repo");

    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
