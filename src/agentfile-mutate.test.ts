import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("./agentfile.js", () => ({
  AGENTFILE_NAMES: ["Agentfile.yaml", "Agentfile.yml", "Agentfile"],
  loadAgentfile: vi.fn(),
}));

vi.mock("./catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({
    skills: [],
    mcp_servers: [{ name: "context7" }],
    rules: [],
  })),
}));

vi.mock("./core/logger.js", () => ({
  logSkipped: vi.fn(),
}));

vi.mock("./ui/output.js", () => ({
  ICON_SUCCESS: "✓",
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/test")),
}));

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { loadAgentfile } from "./agentfile.js";
import {
  addSkillToAgentfile,
  addSourceToAgentfile,
  addToAgentfile,
  ensureAgentfile,
  globalAgentfileDir,
  installSkillToProject,
  installToProject,
  removeFromAgentfile,
  removeFromProject,
  writeAgentfile,
} from "./agentfile-mutate.js";
import { loadCatalog } from "./catalog/types.js";
import type { McpServer } from "./types.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileAtomicSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockLoadAgentfile = vi.mocked(loadAgentfile);
const mockLoadCatalog = vi.mocked(loadCatalog);

function makeServer(name: string, overrides?: Partial<McpServer>): McpServer {
  return { name, command: "npx", args: [], env: {}, ...overrides } as McpServer;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("globalAgentfileDir", () => {
  it("returns expanded path under .config/agentbrew", () => {
    expect(globalAgentfileDir()).toBe("/home/test/.config/agentbrew");
  });
});

describe("writeAgentfile", () => {
  it("writes content to Agentfile.yaml in the given directory", () => {
    const path = writeAgentfile("/project", "mcp:\n  - context7\n");
    expect(path).toBe("/project/Agentfile.yaml");
    expect(mockWriteFileSync).toHaveBeenCalledWith("/project/Agentfile.yaml", "mcp:\n  - context7\n", "utf-8");
  });
});

describe("ensureAgentfile", () => {
  it("returns existing Agentfile path if found", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    const result = ensureAgentfile("/project");
    expect(result).toBe("/project/Agentfile.yaml");
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it("creates Agentfile.yaml if none exists", () => {
    mockExistsSync.mockReturnValue(false);
    const result = ensureAgentfile("/project");
    expect(result).toBe("/project/Agentfile.yaml");
    expect(mockMkdirSync).toHaveBeenCalledWith("/project", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

describe("addToAgentfile", () => {
  it("returns false when no Agentfile exists and create is not set", () => {
    mockExistsSync.mockReturnValue(false);
    expect(addToAgentfile("/project", makeServer("test"))).toBe(false);
  });

  it("creates Agentfile when create option is true", () => {
    // First existsSync calls for finding Agentfile return false
    // Then ensureAgentfile creates it, so subsequent calls return true
    let callCount = 0;
    mockExistsSync.mockImplementation(() => {
      callCount++;
      return callCount > 3; // first 3 calls (AGENTFILE_NAMES) return false, then true for ensureAgentfile
    });
    mockLoadAgentfile.mockReturnValue({ mcp: [] });
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    addToAgentfile("/project", makeServer("new-server"), { create: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("returns false when server already exists (string shorthand)", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockLoadAgentfile.mockReturnValue({ mcp: ["existing-server"] });
    mockReadFileSync.mockReturnValue("mcp:\n  - existing-server\n" as unknown as ReturnType<typeof readFileSync>);

    expect(addToAgentfile("/project", makeServer("existing-server"))).toBe(false);
  });

  it("returns false when server already exists (object entry)", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockLoadAgentfile.mockReturnValue({ mcp: [{ name: "existing-server", command: "npx" }] });
    mockReadFileSync.mockReturnValue("mcp:\n  - name: existing-server\n" as unknown as ReturnType<typeof readFileSync>);

    expect(addToAgentfile("/project", makeServer("existing-server"))).toBe(false);
  });

  it("adds catalog server as string shorthand", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockLoadAgentfile.mockReturnValue({ mcp: [] });
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [{ name: "context7" }],
      rules: [],
    } as unknown as ReturnType<typeof loadCatalog>);

    const result = addToAgentfile("/project", makeServer("context7"));
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("adds non-catalog server as full spec", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockLoadAgentfile.mockReturnValue({ mcp: [] });
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
    } as unknown as ReturnType<typeof loadCatalog>);

    const server = makeServer("custom", {
      args: ["--port", "3000"],
      env: { API_KEY: "test" },
    });
    const result = addToAgentfile("/project", server);
    expect(result).toBe(true);
  });
});

describe("removeFromAgentfile", () => {
  it("returns false when no Agentfile exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(removeFromAgentfile("/project", "test")).toBe(false);
  });

  it("returns false when mcp array is empty or missing", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("skills:\n  - debug\n" as unknown as ReturnType<typeof readFileSync>);

    expect(removeFromAgentfile("/project", "test")).toBe(false);
  });

  it("removes string entry from mcp list", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("mcp:\n  - context7\n  - other\n" as unknown as ReturnType<typeof readFileSync>);

    const result = removeFromAgentfile("/project", "context7");
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("removes object entry from mcp list by name", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue(
      "mcp:\n  - name: custom\n    command: npx\n  - other\n" as unknown as ReturnType<typeof readFileSync>,
    );

    const result = removeFromAgentfile("/project", "custom");
    expect(result).toBe(true);
  });

  it("deletes mcp key when last entry is removed", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("mcp:\n  - context7\n" as unknown as ReturnType<typeof readFileSync>);

    const result = removeFromAgentfile("/project", "context7");
    expect(result).toBe(true);
    // The written content should not have mcp key
    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(writtenContent).not.toContain("mcp:");
  });

  it("returns false when server name not found", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("mcp:\n  - context7\n" as unknown as ReturnType<typeof readFileSync>);

    expect(removeFromAgentfile("/project", "nonexistent")).toBe(false);
  });

  it("returns false when Agentfile YAML is corrupted", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("{{invalid yaml" as unknown as ReturnType<typeof readFileSync>);

    expect(removeFromAgentfile("/project", "test")).toBe(false);
  });
});

describe("addSkillToAgentfile", () => {
  it("creates Agentfile if none exists and adds skill", () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    const result = addSkillToAgentfile("/project", "debug");
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("returns false when skill already in list", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("skills:\n  - debug\n" as unknown as ReturnType<typeof readFileSync>);

    expect(addSkillToAgentfile("/project", "debug")).toBe(false);
  });

  it("appends skill to existing list", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("skills:\n  - debug\n" as unknown as ReturnType<typeof readFileSync>);

    const result = addSkillToAgentfile("/project", "refactor");
    expect(result).toBe(true);
    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("refactor");
  });

  it("treats corrupted YAML as empty and adds skill", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("{{invalid yaml" as unknown as ReturnType<typeof readFileSync>);

    const result = addSkillToAgentfile("/project", "debug");
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

describe("addSourceToAgentfile", () => {
  it("returns false when no Agentfile exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(addSourceToAgentfile("/project", "https://example.com")).toBe(false);
  });

  it("returns false when source already present", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue(
      "sources:\n  - https://example.com\n" as unknown as ReturnType<typeof readFileSync>,
    );

    expect(addSourceToAgentfile("/project", "https://example.com")).toBe(false);
  });

  it("adds new source to Agentfile", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    const result = addSourceToAgentfile("/project", "https://new-source.com");
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("treats corrupted YAML as empty and adds source", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("{{invalid yaml" as unknown as ReturnType<typeof readFileSync>);

    const result = addSourceToAgentfile("/project", "https://new-source.com");
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

describe("installToProject", () => {
  it("creates Agentfile and adds server", () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadAgentfile.mockReturnValue({ mcp: [] });
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    installToProject("/project", makeServer("test-server"));
    // Should create file and log success
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });
});

describe("installSkillToProject", () => {
  it("copies skill files and adds to Agentfile", () => {
    // No existing Agentfile
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    installSkillToProject("/project", "my-skill", "/source/skills/my-skill");

    expect(vi.mocked(mkdirSync)).toHaveBeenCalled();
    expect(vi.mocked(cpSync)).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });

  it("removes stale skill copy before refreshing", () => {
    mockExistsSync.mockImplementation((p) => {
      if (typeof p === "string" && p.includes(".agentbrew/skills/my-skill")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("" as unknown as ReturnType<typeof readFileSync>);

    installSkillToProject("/project", "my-skill", "/source/skills/my-skill");

    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(expect.stringContaining("my-skill"), {
      recursive: true,
      force: true,
    });
  });
});

describe("removeFromProject", () => {
  it("removes server and logs success", () => {
    mockExistsSync.mockImplementation((p) => typeof p === "string" && p.endsWith("Agentfile.yaml"));
    mockReadFileSync.mockReturnValue("mcp:\n  - context7\n" as unknown as ReturnType<typeof readFileSync>);

    const result = removeFromProject("/project", "context7");
    expect(result).toBe(true);
    expect(console.log).toHaveBeenCalled();
  });

  it("returns false when server not found", () => {
    mockExistsSync.mockReturnValue(false);
    expect(removeFromProject("/project", "nonexistent")).toBe(false);
  });
});
