import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ""),
  statSync: vi.fn(() => {
    throw new Error("ENOENT");
  }),
}));

vi.mock("./auto-sync.js", () => ({ activeBackend: vi.fn(() => "none") }));

vi.mock("./launchagent.js", () => ({
  LAUNCHAGENT_LABEL: "com.agentbrew.check",
  getLaunchAgentPlistPath: () => "/home/user/Library/LaunchAgents/com.agentbrew.check.plist",
}));

vi.mock("./scheduler-paths.js", () => ({
  AUTO_SYNC_INTERVAL_MINUTES: 30,
  AUTO_SYNC_INTERVAL_SECONDS: 1800,
  getLogDir: () => "/home/user/.local/share/agentbrew/logs",
}));

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  classifyAutoRepair,
  describeAutoRepair,
  extractPlistProgramArguments,
  parseLaunchctlPrint,
  parseSystemctlShow,
  probeAutoRepairHealth,
} from "./auto-repair-health.js";
import { activeBackend } from "./auto-sync.js";

const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockStatSync = vi.mocked(statSync);
const mockActiveBackend = vi.mocked(activeBackend);

const NOW = Date.parse("2026-09-25T12:00:00Z");
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentbrew.check</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/node/bin/node</string>
        <string>/home/user/apps/agentbrew/dist/cli.js</string>
        <string>fix</string>
    </array>
    <key>StandardOutPath</key>
    <string>/logs/launchagent.log</string>
    <key>StandardErrorPath</key>
    <string>/logs/launchagent.err</string>
</dict>
</plist>`;

function spawnResult(status: number | null, stdout = "", error?: Error): ReturnType<typeof spawnSync> {
  return { pid: 1, status, stdout, stderr: "", output: [], signal: null, error } as ReturnType<typeof spawnSync>;
}

function logMtimes(mtimes: Record<string, number>): void {
  mockStatSync.mockImplementation(((path: string) => {
    if (path in mtimes) return { mtimeMs: mtimes[path] };
    throw new Error("ENOENT");
  }) as unknown as typeof statSync);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue("");
  logMtimes({});
});

describe("classifyAutoRepair", () => {
  it("reports active only with a recent successful run", () => {
    const health = classifyAutoRepair(
      { backend: "launchagent", loaded: true, lastExitCode: 0, lastRunAt: minutesAgo(10) },
      NOW,
    );
    expect(health.state).toBe("active");
  });

  it("reports not-installed when no backend exists", () => {
    expect(classifyAutoRepair({ backend: "none" }, NOW).state).toBe("not-installed");
  });

  it("reports not-loaded when the plist exists but launchd has no job", () => {
    expect(classifyAutoRepair({ backend: "launchagent", loaded: false, lastRunAt: minutesAgo(5) }, NOW).state).toBe(
      "not-loaded",
    );
  });

  it("reports broken when the scheduled program is missing", () => {
    const health = classifyAutoRepair(
      { backend: "launchagent", loaded: true, missingProgram: "/gone/cli.js", lastRunAt: minutesAgo(5) },
      NOW,
    );
    expect(health.state).toBe("broken");
  });

  it("reports stale when the last run is older than three intervals", () => {
    expect(classifyAutoRepair({ backend: "launchagent", loaded: true, lastRunAt: minutesAgo(91) }, NOW).state).toBe(
      "stale",
    );
    expect(classifyAutoRepair({ backend: "launchagent", loaded: true, lastRunAt: minutesAgo(89) }, NOW).state).toBe(
      "active",
    );
  });

  it("reports failing on a nonzero exit code or an exit reason", () => {
    const base = { backend: "launchagent" as const, loaded: true, lastRunAt: minutesAgo(5) };
    expect(classifyAutoRepair({ ...base, lastExitCode: 1 }, NOW).state).toBe("failing");
    expect(classifyAutoRepair({ ...base, lastExitReason: "SIGKILL" }, NOW).state).toBe("failing");
  });

  it("reports disabled instead of not-loaded when launchd has the job disabled", () => {
    expect(classifyAutoRepair({ backend: "launchagent", loaded: false, disabled: true }, NOW).state).toBe("disabled");
    expect(classifyAutoRepair({ backend: "launchagent", loaded: false, disabled: false }, NOW).state).toBe(
      "not-loaded",
    );
  });

  it("separates never-run from unverifiable run history", () => {
    expect(classifyAutoRepair({ backend: "launchagent", loaded: true, neverRan: true }, NOW).state).toBe("never-run");
    expect(classifyAutoRepair({ backend: "taskscheduler" }, NOW).state).toBe("unverified");
  });
});

describe("describeAutoRepair", () => {
  it("does not offer auto-sync install as the fix for a disabled job", () => {
    const description = describeAutoRepair({
      backend: "launchagent",
      state: "disabled",
      loaded: false,
      disabled: true,
    });
    expect(description.summary).toBe("disabled");
    expect(description.detail).toContain("cannot load it");
    expect(description.detail).toContain("launchctl enable gui/$UID/com.agentbrew.check");
  });

  it("names the fix command for a scheduler that is not loaded", () => {
    const description = describeAutoRepair({ backend: "launchagent", state: "not-loaded", loaded: false });
    expect(description.tone).toBe("warn");
    expect(description.summary).toBe("not running");
    expect(description.detail).toContain("agentbrew auto-sync install");
  });

  it("includes the exit code and log path for a failing run", () => {
    const description = describeAutoRepair({
      backend: "launchagent",
      state: "failing",
      lastExitCode: 78,
      lastRunAt: new Date().toISOString(),
      logPath: "/logs/launchagent.err",
    });
    expect(description.detail).toContain("exit code 78");
    expect(description.detail).toContain("/logs/launchagent.err");
  });

  it("marks only the active state as ok", () => {
    const active = describeAutoRepair({ backend: "cron", state: "active", lastRunAt: new Date().toISOString() });
    expect(active.tone).toBe("ok");
    expect(active.detail).toContain("last ran just now");
    expect(describeAutoRepair({ backend: "launchagent", state: "broken", missingProgram: "/x" }).tone).toBe("error");
  });
});

describe("parsers", () => {
  it("parses launchctl print exit formats", () => {
    expect(parseLaunchctlPrint("\truns = 3\n\tlast exit code = 0\n")).toEqual({ lastExitCode: 0 });
    expect(parseLaunchctlPrint("\tlast exit code = 78: EX_CONFIG\n")).toEqual({ lastExitCode: 78 });
    expect(parseLaunchctlPrint("\tlast exit code = (never exited)\n")).toEqual({});
    expect(parseLaunchctlPrint("\tlast exit reason = JETSAM_REASON_MEMORY_IDLE_EXIT\n")).toEqual({
      lastExitReason: "JETSAM_REASON_MEMORY_IDLE_EXIT",
    });
  });

  it("extracts ProgramArguments from a plist", () => {
    expect(extractPlistProgramArguments(PLIST)).toEqual([
      "/opt/node/bin/node",
      "/home/user/apps/agentbrew/dist/cli.js",
      "fix",
    ]);
    expect(extractPlistProgramArguments("<plist/>")).toEqual([]);
  });

  it("parses systemctl show output", () => {
    expect(parseSystemctlShow("ExecMainExitTimestamp=@1790000000\nExecMainStatus=2\n")).toEqual({
      lastRunAt: new Date(1_790_000_000_000).toISOString(),
      lastExitCode: 2,
    });
    expect(parseSystemctlShow("ExecMainExitTimestamp=\nExecMainStatus=0\n")).toEqual({});
  });
});

describe("probeAutoRepairHealth — launchagent", () => {
  beforeEach(() => {
    mockActiveBackend.mockReturnValue("launchagent");
    mockReadFileSync.mockReturnValue(PLIST);
  });

  it("reports disabled when launchctl print-disabled lists the job as disabled", () => {
    mockSpawnSync.mockImplementation(((_cmd: string, args: string[]) =>
      args[0] === "print-disabled"
        ? spawnResult(0, '\t\t"com.agentbrew.mcp-memory" => enabled\n\t\t"com.agentbrew.check" => disabled\n')
        : spawnResult(113, 'Could not find service "com.agentbrew.check"')) as unknown as typeof spawnSync);

    const health = probeAutoRepairHealth(NOW);

    expect(health.state).toBe("disabled");
    expect(health.disabled).toBe(true);
  });

  it("reports not-loaded when launchctl cannot find the service", () => {
    mockSpawnSync.mockReturnValue(spawnResult(113, 'Could not find service "com.agentbrew.check"'));
    logMtimes({ "/logs/launchagent.log": NOW - 5 * 60_000 });

    const health = probeAutoRepairHealth(NOW);

    expect(health.state).toBe("not-loaded");
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "launchctl",
      ["print", expect.stringMatching(/^gui\/\d+\/com\.agentbrew\.check$/u)],
      expect.any(Object),
    );
  });

  it("reports stale when the job is loaded but its logs have not changed in months", () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, "\tlast exit code = 0\n"));
    logMtimes({ "/logs/launchagent.log": NOW - 60 * 24 * 60 * 60_000 });

    expect(probeAutoRepairHealth(NOW).state).toBe("stale");
  });

  it("reports active from a recent log write and a clean exit", () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, "\tlast exit code = 0\n"));
    logMtimes({ "/logs/launchagent.log": NOW - 20 * 60_000, "/logs/launchagent.err": NOW - 40 * 60_000 });

    const health = probeAutoRepairHealth(NOW);

    expect(health.state).toBe("active");
    expect(health.lastRunAt).toBe(minutesAgo(20));
  });

  it("reports broken when ProgramArguments points at a deleted cli.js", () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, "\tlast exit code = 0\n"));
    mockExistsSync.mockImplementation((path) => path !== "/home/user/apps/agentbrew/dist/cli.js");

    const health = probeAutoRepairHealth(NOW);

    expect(health.state).toBe("broken");
    expect(health.missingProgram).toBe("/home/user/apps/agentbrew/dist/cli.js");
  });

  it("does not claim not-loaded when launchctl itself could not run", () => {
    mockSpawnSync.mockReturnValue(spawnResult(null, "", new Error("ETIMEDOUT")));

    const health = probeAutoRepairHealth(NOW);

    expect(health.loaded).toBeUndefined();
    expect(health.state).toBe("unverified");
  });
});

describe("probeAutoRepairHealth — other backends", () => {
  it("reads systemd timer state and last service exit", () => {
    mockActiveBackend.mockReturnValue("systemd");
    mockSpawnSync.mockImplementation(((_cmd: string, args: string[]) =>
      args.includes("is-active")
        ? spawnResult(0, "active\n")
        : spawnResult(
            0,
            `ExecMainExitTimestamp=@${Math.floor((NOW - 10 * 60_000) / 1000)}\nExecMainStatus=0\n`,
          )) as unknown as typeof spawnSync);

    expect(probeAutoRepairHealth(NOW).state).toBe("active");
  });

  it("reports an inactive systemd timer as not-loaded", () => {
    mockActiveBackend.mockReturnValue("systemd");
    mockSpawnSync.mockReturnValue(spawnResult(3, "inactive\n"));

    expect(probeAutoRepairHealth(NOW).state).toBe("not-loaded");
  });

  it("uses cron.log age for cron", () => {
    mockActiveBackend.mockReturnValue("cron");
    logMtimes({ "/home/user/.local/share/agentbrew/logs/cron.log": NOW - 5 * 60_000 });

    expect(probeAutoRepairHealth(NOW).state).toBe("active");
  });

  it("reports Task Scheduler as unverified instead of active", () => {
    mockActiveBackend.mockReturnValue("taskscheduler");

    expect(probeAutoRepairHealth(NOW).state).toBe("unverified");
  });
});
