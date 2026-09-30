import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => JSON.stringify({ version: "0.1.0" })),
}));

import { execFileSync } from "node:child_process";
import { upgrade } from "./upgrade.js";

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("upgrade", () => {
  it("reports already up to date when versions match", async () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "0.1.0\n" as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      return "" as never;
    });
    const result = await upgrade();
    expect(result.updateAvailable).toBe(false);
    expect(result.currentVersion).toBe("0.1.0");
    expect(result.latestVersion).toBe("0.1.0");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("detects available update with --check", async () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "1.0.0\n" as never;
      if (argStr.includes("view agentbrew versions")) return '["0.1.0","0.2.0","1.0.0"]' as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      return "" as never;
    });
    const result = await upgrade({ check: true });
    expect(result.updateAvailable).toBe(true);
    expect(result.upgraded).toBe(false);
    expect(result.latestVersion).toBe("1.0.0");
  });

  it("handles npm registry failure gracefully", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });
    const result = await upgrade();
    expect(result.latestVersion).toBeUndefined();
    expect(result.updateAvailable).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Could not reach"));
  });

  it("detects npx install method", async () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/home/user/.npm/_npx/abc123/node_modules/.bin/agentbrew";
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "2.0.0\n" as never;
      if (argStr.includes("view agentbrew versions")) return '["0.1.0","2.0.0"]' as never;
      return "" as never;
    });
    const result = await upgrade();
    expect(result.method).toBe("npx");
    expect(result.upgraded).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("npx"));
    process.argv[1] = origArgv1;
  });

  it("runs npm install -g for global installs", async () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/lib/node_modules/agentbrew/dist/cli.js";
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "2.0.0\n" as never;
      if (argStr.includes("view agentbrew versions")) return '["0.1.0","2.0.0"]' as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      if (argStr.includes("install -g")) return "" as never;
      return "" as never;
    });
    const result = await upgrade();
    expect(result.method).toBe("global");
    expect(result.upgraded).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Upgraded to"));
    process.argv[1] = origArgv1;
  });

  it("handles global install failure", async () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/lib/node_modules/agentbrew/dist/cli.js";
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "2.0.0\n" as never;
      if (argStr.includes("view agentbrew versions")) return '["0.1.0","2.0.0"]' as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      if (argStr.includes("install -g")) throw new Error("permission denied");
      return "" as never;
    });
    const result = await upgrade();
    expect(result.method).toBe("global");
    expect(result.upgraded).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failed"));
    process.argv[1] = origArgv1;
  });

  it("detects local install method", async () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "/home/user/projects/agentbrew/dist/cli.js";
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "2.0.0\n" as never;
      if (argStr.includes("view agentbrew versions")) return '["0.1.0","2.0.0"]' as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      return "" as never;
    });
    const result = await upgrade();
    expect(result.method).toBe("local");
    expect(result.upgraded).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("local install"));
    process.argv[1] = origArgv1;
  });

  it("handles older latest version (e.g. prerelease downgrade)", async () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("view agentbrew version")) return "0.0.9\n" as never;
      if (argStr.includes("prefix -g")) return "/usr/local" as never;
      return "" as never;
    });
    const result = await upgrade();
    expect(result.updateAvailable).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });
});
