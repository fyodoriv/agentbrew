import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LockFile } from "./lock.js";
import type { Source } from "./types.js";

// Mock homedir to use temp directory
const testDir = join(tmpdir(), `agentbrew-lock-test-${Date.now()}`);
const lockDir = join(testDir, ".config", "agentbrew");
const lockFile = join(lockDir, "agentbrew.lock");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => testDir };
});

// Mock getGitHeadSha to avoid real git calls
vi.mock("./skills/skill-versions.js", () => ({
  getGitHeadSha: (source: Source) => {
    if (source.url === "test/repo") return "abc123def456789";
    if (source.url === "other/repo") return "999888777666555";
    return undefined;
  },
  recordSourceSha: () => {},
}));

let lockModule: typeof import("./lock.js");

describe("lock", () => {
  beforeEach(async () => {
    mkdirSync(lockDir, { recursive: true });
    // Re-import to pick up fresh mocks
    vi.resetModules();
    lockModule = await import("./lock.js");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("readLock", () => {
    it("returns empty lock when file does not exist", () => {
      const lock = lockModule.readLock();
      expect(lock.locked).toEqual([]);
    });

    it("reads existing lock file", () => {
      const content: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(lockFile, yaml.dump(content), "utf-8");

      const lock = lockModule.readLock();
      expect(lock.locked).toHaveLength(1);
      expect(lock.locked[0].source).toBe("test/repo");
      expect(lock.locked[0].sha).toBe("abc123");
      expect(lock.locked[0].skills).toEqual(["debug"]);
    });

    it("handles malformed lock file gracefully", () => {
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(lockFile, "not valid yaml: [", "utf-8");

      const lock = lockModule.readLock();
      expect(lock.locked).toEqual([]);
    });
  });

  describe("writeLock", () => {
    it("creates lock file with header", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: ["commit"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };

      lockModule.writeLock(lock);

      const content = readFileSync(lockFile, "utf-8");
      expect(content).toContain("# agentbrew.lock");
      expect(content).toContain("test/repo");
      expect(content).toContain("abc123");
    });
  });

  describe("lockSource", () => {
    it("creates new lock entry for a source", () => {
      const source: Source = {
        url: "test/repo",
        type: "github",
        skillsInstalled: ["debug", "commit"],
        availableItems: [],
        addedAt: "2025-01-01T00:00:00.000Z",
        commitSha: "abc123def456789",
      };

      const entry = lockModule.lockSource(source);
      expect(entry).toBeDefined();
      expect(entry?.sha).toBe("abc123def456789");
      expect(entry?.skills).toEqual(["debug", "commit"]);

      // Verify persisted
      const lock = lockModule.readLock();
      expect(lock.locked).toHaveLength(1);
      expect(lock.locked[0].source).toBe("test/repo");
    });

    it("updates existing lock entry", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "old-sha",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const source: Source = {
        url: "test/repo",
        type: "github",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2025-01-01T00:00:00.000Z",
        commitSha: "new-sha-12345",
      };

      const entry = lockModule.lockSource(source, ["commit"]);
      expect(entry?.sha).toBe("new-sha-12345");
      expect(entry?.skills).toEqual(["debug", "commit"]);
    });

    it("deduplicates skill names", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const source: Source = {
        url: "test/repo",
        type: "github",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2025-01-01T00:00:00.000Z",
        commitSha: "abc",
      };

      const entry = lockModule.lockSource(source, ["debug"]);
      expect(entry?.skills).toEqual(["debug"]);
    });

    it("returns undefined when SHA cannot be resolved", () => {
      const source: Source = {
        url: "unknown/repo",
        type: "github",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2025-01-01T00:00:00.000Z",
      };

      const entry = lockModule.lockSource(source);
      expect(entry).toBeUndefined();
    });
  });

  describe("updateLock", () => {
    it("updates SHA for locked sources", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "old-sha",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: ["debug"],
          availableItems: [],
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ];

      const results = lockModule.updateLock(sources);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("updated");
      expect(results[0].oldSha).toBe("old-sha");
      expect(results[0].sha).toBe("abc123def456789");

      // Verify persisted
      const updated = lockModule.readLock();
      expect(updated.locked[0].sha).toBe("abc123def456789");
    });

    it("reports up-to-date when SHA matches", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123def456789",
            skills: [],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ];

      const results = lockModule.updateLock(sources);
      expect(results[0].status).toBe("up-to-date");
    });

    it("filters by source URL when provided", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "old",
            skills: [],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
          {
            source: "other/repo",
            type: "github",
            sha: "old",
            skills: [],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        { url: "test/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" },
        { url: "other/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" },
      ];

      const results = lockModule.updateLock(sources, "test/repo");
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("test/repo");
    });

    it("prunes entries whose source is no longer installed on a full update", () => {
      const lock: LockFile = {
        locked: [
          { source: "test/repo", type: "github", sha: "abc123def456789", skills: [], lockedAt: "" },
          { source: "removed/repo", type: "github", sha: "old", skills: ["handoff"], lockedAt: "" },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        { url: "test/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" },
      ];

      const results = lockModule.updateLock(sources);
      expect(results.find((r) => r.source === "removed/repo")?.status).toBe("pruned");
      expect(lockModule.readLock().locked.map((entry) => entry.source)).toEqual(["test/repo"]);
    });

    it("keeps entries for other sources when filtering by source URL", () => {
      const lock: LockFile = {
        locked: [{ source: "removed/repo", type: "github", sha: "old", skills: [], lockedAt: "" }],
      };
      lockModule.writeLock(lock);

      lockModule.updateLock([], "test/repo");
      expect(lockModule.readLock().locked.map((entry) => entry.source)).toEqual(["removed/repo"]);
    });
  });

  describe("verifyLock", () => {
    it("reports match when SHAs are equal", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: ["debug"],
          availableItems: [],
          addedAt: "",
          commitSha: "abc123",
        },
      ];

      const results = lockModule.verifyLock(sources);
      expect(results).toHaveLength(1);
      expect(results[0].match).toBe(true);
    });

    it("reports mismatch when SHAs differ", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: [],
            lockedAt: "",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "",
          commitSha: "different-sha",
        },
      ];

      const results = lockModule.verifyLock(sources);
      expect(results[0].match).toBe(false);
      expect(results[0].currentSha).toBe("different-sha");
    });

    it("reports no match when source not found in state", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "missing/repo",
            type: "github",
            sha: "abc123",
            skills: [],
            lockedAt: "",
          },
        ],
      };
      lockModule.writeLock(lock);

      const results = lockModule.verifyLock([]);
      expect(results[0].match).toBe(false);
      expect(results[0].currentSha).toBeUndefined();
    });
  });

  describe("updateLock", () => {
    it("reports error status when SHA cannot be resolved for a locked source", () => {
      const lock: LockFile = {
        locked: [
          {
            source: "unknown-for-update/repo",
            type: "github",
            sha: "old-sha",
            skills: [],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "unknown-for-update/repo",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "",
        },
      ];

      const results = lockModule.updateLock(sources);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("error");
    });
  });

  describe("showLock", () => {
    it("shows empty message when lock file has no entries", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      lockModule.showLock();

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("No sources locked");
    });

    it("shows lock entries when sources are locked", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123def456789",
            skills: ["debug", "commit"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      lockModule.showLock();

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("test/repo");
      expect(calls).toContain("abc123de");
      expect(calls).toContain("debug");
    });
  });

  describe("showVerify", () => {
    it("shows empty message when lock file has no entries", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      lockModule.showVerify([]);

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("Nothing to verify");
    });

    it("shows success when all SHAs match", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: ["debug"],
            lockedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: ["debug"],
          availableItems: [],
          addedAt: "",
          commitSha: "abc123",
        },
      ];

      lockModule.showVerify(sources);

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("All sources match");
    });

    it("shows warning when source has no version tracked", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const lock: LockFile = {
        locked: [
          {
            source: "missing/repo",
            type: "github",
            sha: "abc123",
            skills: [],
            lockedAt: "",
          },
        ],
      };
      lockModule.writeLock(lock);

      lockModule.showVerify([]);

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("no version tracked");
      expect(calls).toContain("don't match");
    });

    it("shows mismatch when SHA differs", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const lock: LockFile = {
        locked: [
          {
            source: "test/repo",
            type: "github",
            sha: "abc123",
            skills: [],
            lockedAt: "",
          },
        ],
      };
      lockModule.writeLock(lock);

      const sources: Source[] = [
        {
          url: "test/repo",
          type: "github",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "",
          commitSha: "different-sha",
        },
      ];

      lockModule.showVerify(sources);

      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("SHA mismatch");
      expect(calls).toContain("don't match");
    });
  });
});
