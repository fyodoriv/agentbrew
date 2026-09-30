import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdapterError,
  AgentBrewError,
  ConfigError,
  clearSyncErrors,
  errorMessage,
  loadSyncErrors,
  SyncError,
  SyncErrorCollector,
  saveSyncErrors,
} from "./errors.js";

describe("AgentBrewError", () => {
  it("sets code and message", () => {
    const error = new AgentBrewError("TEST_CODE", "something broke");
    expect(error.code).toBe("TEST_CODE");
    expect(error.message).toBe("something broke");
    expect(error.name).toBe("AgentBrewError");
    expect(error).toBeInstanceOf(Error);
  });

  it("supports cause via ErrorOptions", () => {
    const cause = new Error("root cause");
    const error = new AgentBrewError("X", "wrapper", { cause });
    expect(error.cause).toBe(cause);
  });
});

describe("SyncError", () => {
  it("includes module in message", () => {
    const error = new SyncError("mcp-sync", "timeout writing config");
    expect(error.code).toBe("SYNC_ERROR");
    expect(error.module).toBe("mcp-sync");
    expect(error.message).toContain("[mcp-sync]");
    expect(error.message).toContain("timeout writing config");
    expect(error.agent).toBeUndefined();
  });

  it("includes agent when provided", () => {
    const error = new SyncError("mcp-sync", "write failed", { agent: "cursor" });
    expect(error.agent).toBe("cursor");
  });

  it("preserves cause", () => {
    const cause = new Error("EACCES");
    const error = new SyncError("skills-sync", "deploy failed", { cause });
    expect(error.cause).toBe(cause);
  });
});

describe("ConfigError", () => {
  it("includes file path in message", () => {
    const error = new ConfigError("/home/.config/agentbrew/state.yaml", "parse failed");
    expect(error.code).toBe("CONFIG_ERROR");
    expect(error.filePath).toBe("/home/.config/agentbrew/state.yaml");
    expect(error.message).toContain("state.yaml");
    expect(error.message).toContain("parse failed");
  });
});

describe("AdapterError", () => {
  it("includes agent and format in message", () => {
    const error = new AdapterError("cursor", "json", "invalid JSON");
    expect(error.code).toBe("ADAPTER_ERROR");
    expect(error.agent).toBe("cursor");
    expect(error.format).toBe("json");
    expect(error.message).toContain("[cursor/json]");
  });
});

describe("SyncErrorCollector", () => {
  it("starts empty", () => {
    const collector = new SyncErrorCollector();
    expect(collector.hasErrors).toBe(false);
    expect(collector.count).toBe(0);
    expect(collector.summary()).toBe("No errors");
  });

  it("collects errors", () => {
    const collector = new SyncErrorCollector();
    collector.add(new SyncError("mcp", "failed A"));
    collector.add(new ConfigError("/path", "failed B"));

    expect(collector.hasErrors).toBe(true);
    expect(collector.count).toBe(2);
    expect(collector.errors[0]).toBeInstanceOf(SyncError);
    expect(collector.errors[1]).toBeInstanceOf(ConfigError);
  });

  it("formats summary with bullet points", () => {
    const collector = new SyncErrorCollector();
    collector.add(new SyncError("mcp", "timeout"));
    collector.add(new SyncError("rules", "permission denied"));

    const summary = collector.summary();
    expect(summary).toContain("• [mcp] timeout");
    expect(summary).toContain("• [rules] permission denied");
  });
});

describe("errorMessage", () => {
  it("extracts message from Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns string as-is", () => {
    expect(errorMessage("something")).toBe("something");
  });

  it("stringifies other types", () => {
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

describe("sync error persistence", () => {
  let tempDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agentbrew-errors-test-"));
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // cleanup best effort
    }
  });

  it("saveSyncErrors persists errors and loadSyncErrors reads them back", () => {
    const collector = new SyncErrorCollector();
    collector.add(new SyncError("mcp", "write failed", { agent: "cursor" }));
    collector.add(new ConfigError("/path/state.yaml", "parse error"));

    saveSyncErrors(collector);

    const log = loadSyncErrors();
    expect(log).toBeDefined();
    expect(log!.errors).toHaveLength(2);
    expect(log!.lastSyncAt).toBeTruthy();
    expect(log!.errors[0].code).toBe("SYNC_ERROR");
    expect(log!.errors[0].message).toContain("mcp");
    expect(log!.errors[0].module).toBe("mcp");
    expect(log!.errors[0].agent).toBe("cursor");
    expect(log!.errors[1].code).toBe("CONFIG_ERROR");
  });

  it("saveSyncErrors with empty collector writes empty errors array", () => {
    const collector = new SyncErrorCollector();
    saveSyncErrors(collector);

    const log = loadSyncErrors();
    expect(log).toBeDefined();
    expect(log!.errors).toHaveLength(0);
  });

  it("clearSyncErrors writes empty log", () => {
    const collector = new SyncErrorCollector();
    collector.add(new SyncError("skills", "deploy failed"));
    saveSyncErrors(collector);

    clearSyncErrors();

    const log = loadSyncErrors();
    expect(log).toBeDefined();
    expect(log!.errors).toHaveLength(0);
    expect(log!.lastSyncAt).toBeTruthy();
  });

  it("loadSyncErrors returns undefined when no file exists", () => {
    const log = loadSyncErrors();
    expect(log).toBeUndefined();
  });
});
