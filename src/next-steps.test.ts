import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// validateAgentbrewCommand builds the real program; keep the motd hook quiet.
vi.mock("./motd.js", () => ({ printMotd: vi.fn() }));

import { validateAgentbrewCommand } from "./docs/runnable-examples.js";
import { type DashboardFacts, planNextSteps, printNextSteps } from "./next-steps.js";

const healthy: DashboardFacts = {
  hasSkillsOrServers: true,
  syncErrors: 0,
  drift: [],
  autoRepair: "active",
  memoryServiceMissing: false,
  mcpNeedSetup: 0,
  mcpFailing: 0,
};

function commands(facts: Partial<DashboardFacts>): string[] {
  return planNextSteps({ ...healthy, ...facts }).map((s) => s.command);
}

describe("planNextSteps", () => {
  it("asks for nothing on a healthy machine", () => {
    expect(planNextSteps(healthy)).toEqual([]);
  });

  it("puts the recommended install first, then sync, then the repair job", () => {
    expect(commands({ hasSkillsOrServers: false, drift: ["rules", "hooks"], autoRepair: "not-installed" })).toEqual([
      "agentbrew install --recommended",
      "agentbrew sync",
      "agentbrew auto-sync install",
    ]);
  });

  it("names drift and sync errors in one sync step, with the dry-run preview", () => {
    const [step] = planNextSteps({ ...healthy, syncErrors: 1, drift: ["mcp", "skills", "instructions"] });
    expect(step.command).toBe("agentbrew sync");
    expect(step.why).toBe(
      "Retry the 1 error(s) from the last sync and repair 3 drift issue(s). Preview first: agentbrew sync --dry-run",
    );
  });

  it.each([
    "not-installed",
    "broken",
    "not-loaded",
    "stale",
  ] as const)("asks to install the repair job when it is %s", (autoRepair) => {
    expect(commands({ autoRepair })).toEqual(["agentbrew auto-sync install"]);
  });

  it.each([
    "never-run",
    "unverified",
    "failing",
    "active",
  ] as const)("does not reinstall when the job is %s", (state) => {
    expect(commands({ autoRepair: state })).toEqual([]);
  });

  it("gives the launchctl enable step when launchd disabled the job", () => {
    expect(commands({ autoRepair: "disabled" })[0]).toMatch(/^launchctl enable gui\/\$UID\/.+ && agentbrew auto-sync/);
  });

  it("proposes nothing when the user turned the repair job off (autoRepair off)", () => {
    expect(commands({ autoRepair: "off" })).toEqual([]);
  });

  it("proposes nothing on a platform with no scheduler", () => {
    expect(commands({ autoRepair: "unsupported" })).toEqual([]);
  });

  it("counts only drift that sync repairs in the sync step", () => {
    const steps = planNextSteps({ ...healthy, drift: ["instructions", "hooks", "mcp-env-vars"], mcpNeedSetup: 1 });
    expect(steps.map((s) => s.command)).toEqual(["agentbrew sync", "agentbrew setup"]);
    expect(steps[0].why).toMatch(/^Repair 2 drift issue\(s\)\./);
  });

  it("routes drift that sync cannot fix to its own fix, never to agentbrew sync", () => {
    expect(commands({ drift: ["mcp-env-vars", "mcp-env-vars", "env-hygiene"], mcpNeedSetup: 2 })).toEqual([
      "agentbrew setup",
      "eval $(agentbrew env sanitize)",
    ]);
    expect(commands({ drift: ["launchagent"] })).toEqual(["agentbrew status --fix"]);
    expect(commands({ drift: ["mcp-stale"], mcpFailing: 1 })).toEqual(["agentbrew mcp probe --deep"]);
  });

  it("covers memory, MCP setup, and failing MCP servers", () => {
    expect(commands({ memoryServiceMissing: true, mcpNeedSetup: 1, mcpFailing: 2 })).toEqual([
      "agentbrew memory fix",
      "agentbrew setup",
      "agentbrew mcp probe --deep",
    ]);
  });
});

describe("printNextSteps", () => {
  afterEach(() => vi.restoreAllMocks());

  function printed(steps: Parameters<typeof printNextSteps>[0]): string {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.join(" "));
    });
    printNextSteps(steps);
    return lines.join("\n");
  }

  it("prints one Next line, the rest under Then, and the settings pointer", () => {
    const out = printed(planNextSteps({ ...healthy, drift: ["commands"], autoRepair: "not-installed" }));
    expect(out).toMatch(/Next:.*agentbrew sync/);
    expect(out).toMatch(/Then:[\s\S]*agentbrew auto-sync install/);
    expect(out).toContain("agentbrew config set <key> <value>");
  });

  it("says nothing needs the user when the list is empty", () => {
    const out = printed([]);
    expect(out).toContain("Nothing needs you now.");
    expect(out).toContain("Quick actions");
    expect(out).not.toContain("Next:");
  });
});

describe("every possible next step", () => {
  const everything: DashboardFacts = {
    hasSkillsOrServers: false,
    syncErrors: 1,
    drift: ["mcp", "launchagent"],
    autoRepair: "not-installed",
    memoryServiceMissing: true,
    mcpNeedSetup: 1,
    mcpFailing: 1,
  };
  const agentbrewSteps = [...planNextSteps(everything), ...planNextSteps({ ...everything, autoRepair: "disabled" })]
    .map((s) => s.command)
    .filter((command) => command.startsWith("agentbrew "));

  it("is a real agentbrew command", async () => {
    for (const command of new Set(agentbrewSteps)) {
      expect(await validateAgentbrewCommand(command.split(" ")), command).toEqual({ ok: true });
    }
  });

  it("is explained in commands/agentbrew.md, so /agentbrew can walk the user through it", () => {
    const doc = readFileSync(join(import.meta.dirname, "..", "commands", "agentbrew.md"), "utf-8");
    expect(doc).toContain("Run `agentbrew` with no arguments");
    expect(doc).toContain("`agentbrew init`");
    expect(doc).toContain("`launchctl`");
    expect(doc).toContain("agentbrew config set <key> <value>");
    for (const command of agentbrewSteps) expect(doc, command).toContain(`\`${command}\``);
  });
});
