import { mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import the module
import {
  _resetExecFileSyncImpl,
  _setExecFileSyncImpl,
  claimTask,
  closeTask,
  createTask,
  createTaskFromRepo,
  listOpenTasks,
  listTasksFromRepo,
  selfTest,
  setField,
} from "./gh-issues.js";

// Mock execFileSync using dependency injection
const mockExecSync = vi.fn();

describe("gh-issues helper", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/test-gh-issues-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
    mockExecSync.mockReset();
    _setExecFileSyncImpl(mockExecSync);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    _resetExecFileSyncImpl();
  });

  describe("listOpenTasks", () => {
    it("returns issues from gh issue list --json", () => {
      const mockIssues = [
        {
          number: 1,
          title: "Test issue",
          state: "open" as const,
          assignees: [],
          labels: [],
          body: null,
          html_url: "https://github.com/test/repo/issues/1",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ];
      mockExecSync.mockReturnValue(JSON.stringify(mockIssues));

      const result = listOpenTasks({
        repo: "owner/repo" as const,
        project: 123,
      });

      expect(result).toEqual(mockIssues);
      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "list", "--repo", "owner/repo", "--json", "state", "open", "--search", "project:123"],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("filters by priority when specified", () => {
      const mockIssues: unknown[] = [];
      mockExecSync.mockReturnValue(JSON.stringify(mockIssues));

      listOpenTasks({
        repo: "owner/repo" as const,
        project: 123,
        priority: "P0",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "list", "--repo", "owner/repo", "--json", "state", "open", "--search", "project:123", "priority:1"],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("filters by status when specified", () => {
      const mockIssues: unknown[] = [];
      mockExecSync.mockReturnValue(JSON.stringify(mockIssues));

      listOpenTasks({
        repo: "owner/repo" as const,
        project: 123,
        status: "In Progress",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "list",
          "--repo",
          "owner/repo",
          "--json",
          "state",
          "open",
          "--search",
          "project:123",
          "status:In Progress",
        ],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("filters to unassigned when specified", () => {
      const mockIssues: unknown[] = [];
      mockExecSync.mockReturnValue(JSON.stringify(mockIssues));

      listOpenTasks({
        repo: "owner/repo" as const,
        project: 123,
        unassigned: true,
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "list",
          "--repo",
          "owner/repo",
          "--json",
          "state",
          "open",
          "--search",
          "project:123",
          "--assignee",
          "*",
        ],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("throws when gh command fails", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("gh command failed");
      });

      expect(() =>
        listOpenTasks({
          repo: "owner/repo" as const,
          project: 123,
        }),
      ).toThrow("gh command failed: gh command failed");
    });
  });

  describe("createTask", () => {
    it("creates an issue with title", () => {
      const mockIssue = {
        number: 1,
        title: "Test task",
        state: "open" as const,
        assignees: [],
        labels: [{ name: "project:123" }],
        body: null,
        html_url: "https://github.com/test/repo/issues/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };
      mockExecSync.mockReturnValue(JSON.stringify(mockIssue));

      const result = createTask({
        repo: "owner/repo" as const,
        project: 123,
        title: "Test task",
      });

      expect(result).toEqual(mockIssue);
      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "create", "--repo", "owner/repo", "--title", "Test task", "--label", "project:123"],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("includes body when provided", () => {
      const mockIssue = {
        number: 1,
        title: "Test task",
        state: "open" as const,
        assignees: [],
        labels: [{ name: "project:123" }],
        body: "Task body",
        html_url: "https://github.com/test/repo/issues/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };
      mockExecSync.mockReturnValue(JSON.stringify(mockIssue));

      createTask({
        repo: "owner/repo" as const,
        project: 123,
        title: "Test task",
        body: "Task body",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          "owner/repo",
          "--title",
          "Test task",
          "--body",
          "Task body",
          "--label",
          "project:123",
        ],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("includes priority label when specified", () => {
      const mockIssue = {
        number: 1,
        title: "Test task",
        state: "open" as const,
        assignees: [],
        labels: [{ name: "project:123" }, { name: "priority:1" }],
        body: null,
        html_url: "https://github.com/test/repo/issues/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-2024-01-01T00:00:00Z",
      };
      mockExecSync.mockReturnValue(JSON.stringify(mockIssue));

      createTask({
        repo: "owner/repo" as const,
        project: 123,
        title: "Test task",
        priority: "P0",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          "owner/repo",
          "--title",
          "Test task",
          "--label",
          "priority:1",
          "--label",
          "project:123",
        ],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });

    it("includes tags when specified", () => {
      const mockIssue = {
        number: 1,
        title: "Test task",
        state: "open" as const,
        assignees: [],
        labels: [{ name: "project:123" }, { name: "tag1" }, { name: "tag2" }],
        body: null,
        html_url: "https://github.com/test/repo/issues/1",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };
      mockExecSync.mockReturnValue(JSON.stringify(mockIssue));

      createTask({
        repo: "owner/repo" as const,
        project: 123,
        title: "Test task",
        tags: ["tag1", "tag2"],
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          "owner/repo",
          "--title",
          "Test task",
          "--label",
          "tag1",
          "--label",
          "tag2",
          "--label",
          "project:123",
        ],
        { encoding: "utf-8", stdio: "pipe" },
      );
    });
  });

  describe("claimTask", () => {
    it("assigns a user to an issue", () => {
      mockExecSync.mockReturnValue("");

      claimTask({
        repo: "owner/repo" as const,
        issueNumber: 1,
        assignee: "testuser",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "edit", "1", "--repo", "owner/repo", "--add-assignee", "testuser"],
        {
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    });

    it("retries on rate-limit errors", () => {
      let attempts = 0;
      mockExecSync.mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          const error = new Error("HTTP 403: API rate limit exceeded");
          (error as any).message = "HTTP 403: API rate limit exceeded";
          throw error;
        }
        return "";
      });

      claimTask({
        repo: "owner/repo" as const,
        issueNumber: 1,
        assignee: "testuser",
      });

      expect(attempts).toBe(2);
    });

    it("throws after max retries on rate-limit errors", () => {
      mockExecSync.mockImplementation(() => {
        const error = new Error("HTTP 403: API rate limit exceeded");
        (error as any).message = "HTTP 403: API rate limit exceeded";
        throw error;
      });

      expect(() =>
        claimTask({
          repo: "owner/repo" as const,
          issueNumber: 1,
          assignee: "testuser",
        }),
      ).toThrow("Rate limit exceeded after 3 retries");
    });
  });

  describe("closeTask", () => {
    it("closes an issue", () => {
      mockExecSync.mockReturnValue("");

      closeTask({
        repo: "owner/repo" as const,
        issueNumber: 1,
      });

      expect(mockExecSync).toHaveBeenCalledWith("gh", ["issue", "close", "1", "--repo", "owner/repo"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
    });

    it("adds a comment when specified", () => {
      mockExecSync.mockReturnValue("");

      closeTask({
        repo: "owner/repo" as const,
        issueNumber: 1,
        comment: "Task completed",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "close", "1", "--repo", "owner/repo", "--comment", "Task completed"],
        {
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    });
  });

  describe("setField", () => {
    it("sets priority field via label", () => {
      mockExecSync.mockReturnValue("");

      setField({
        repo: "owner/repo" as const,
        project: 123,
        issueNumber: 1,
        field: "priority",
        value: "P0",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "edit", "1", "--repo", "owner/repo", "--add-label", "priority:P0"],
        {
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    });

    it("sets status field via label", () => {
      mockExecSync.mockReturnValue("");

      setField({
        repo: "owner/repo" as const,
        project: 123,
        issueNumber: 1,
        field: "status",
        value: "In Progress",
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        "gh",
        ["issue", "edit", "1", "--repo", "owner/repo", "--add-label", "status:In Progress"],
        {
          encoding: "utf-8",
          stdio: "pipe",
        },
      );
    });
  });

  describe("selfTest", () => {
    it("returns scope and project status when authenticated with correct scopes", () => {
      mockExecSync.mockImplementation((file: string, args: string[]) => {
        const cmd = [file, ...args].join(" ");
        if (cmd.startsWith("gh auth status")) {
          return JSON.stringify({ authenticated: true });
        }
        if (cmd.startsWith("gh issue list")) {
          return "[]";
        }
        if (cmd.startsWith("gh project list")) {
          return "[]";
        }
        return "";
      });

      const result = selfTest();

      expect(result.scopeCheck).toBe(true);
      expect(result.projectReachable).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("detects missing repo scope", () => {
      mockExecSync.mockImplementation((file: string, args: string[]) => {
        const cmd = [file, ...args].join(" ");
        // Auth check succeeds
        if (cmd.startsWith("gh auth status")) {
          return JSON.stringify({ authenticated: true });
        }
        // Issue list fails
        if (cmd.startsWith("gh issue list")) {
          const error = new Error("gh issue list failed");
          (error as any).message = "gh issue list failed";
          throw error;
        }
        // Project list shouldn't be called in this test
        const error = new Error("unexpected command");
        (error as any).message = "unexpected command";
        throw error;
      });

      const result = selfTest();

      expect(result.scopeCheck).toBe(false);
      expect(result.projectReachable).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("repo");
    });

    it("detects missing project scope", () => {
      mockExecSync.mockImplementation((file: string, args: string[]) => {
        const cmd = [file, ...args].join(" ");
        // Auth check succeeds
        if (cmd.startsWith("gh auth status")) {
          return JSON.stringify({ authenticated: true });
        }
        // Issue list succeeds
        if (cmd.startsWith("gh issue list")) {
          return "[]";
        }
        // Project list fails
        if (cmd.startsWith("gh project list")) {
          const error = new Error("gh project list failed");
          (error as any).message = "gh project list failed";
          throw error;
        }
        return "";
      });

      const result = selfTest();

      expect(result.scopeCheck).toBe(true);
      expect(result.projectReachable).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("project");
    });

    it("detects authentication failure", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("gh auth status check failed");
      });

      const result = selfTest();

      expect(result.scopeCheck).toBe(false);
      expect(result.projectReachable).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("auth");
    });
  });

  describe("listTasksFromRepo", () => {
    it("uses resolveTaskBackend to get repo/project config", () => {
      // This would require mocking resolveTaskBackend
      // For now, we'll test that it throws on non-github-issues backend
      expect(() => listTasksFromRepo(testDir)).toThrow("Repository does not use github-issues backend");
    });
  });

  describe("createTaskFromRepo", () => {
    it("uses resolveTaskBackend to get repo/project config", () => {
      expect(() => createTaskFromRepo(testDir, "Test")).toThrow("Repository does not use github-issues backend");
    });
  });
});
