import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveState } from "../state.js";
import { codexCommandSkillName } from "./codex-command-skills.js";
import { listCommands, syncCommands } from "./command-sync.js";

vi.mock("./builtin-commands.js", () => ({ builtinCommandsDir: () => undefined, builtinCommandNames: () => [] }));
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: () => new Map() }));

const body = "Synthetic command body must stay out of readiness JSON.\n";
let lines: string[];
beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => lines.push(args.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

function fixture(longName = false) {
  const dir = mkdtempSync(join(homedir(), "readiness-"));
  const filename = `${longName ? `MixedCase-${"long-".repeat(30)}` : basename(dir)}.md`;
  const source = join(dir, filename);
  writeFileSync(source, body);
  writeFileSync(join(dir, "unselected.md"), "Do not deploy this sibling.\n");
  mkdirSync(join(homedir(), ".claude/commands"), { recursive: true });
  mkdirSync(join(homedir(), ".codex/prompts"), { recursive: true });
  saveState({
    catalogVersion: "fixture",
    agents: [
      { name: "claude-code", detected: true, commandsDir: "~/.claude/commands", skillsDir: "~/.claude/skills" },
      { name: "codex", detected: true, commandsDir: "~/.codex/prompts", skillsDir: "~/.codex/skills" },
    ],
    commandSourceDirs: [{ label: "fixture", path: source }],
  });
  return {
    source,
    filename,
    claude: join(homedir(), ".claude/commands", filename),
    native: join(homedir(), ".codex/skills", codexCommandSkillName(filename)),
  };
}

async function report() {
  lines.length = 0;
  await Reflect.apply(listCommands, undefined, [{ json: true }]);
  return JSON.parse(lines.join("\n"));
}

describe("command deployment readiness JSON", () => {
  it("reports winning provenance and both real deployments without command payloads", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    const data = await report();
    expect(data.version).toBe(1);
    const command = data.commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.sourcePath).toBe(f.source);
    expect(command.targets).toHaveLength(2);
    expect(command.targets.every((target: { ready: boolean }) => target.ready)).toBe(true);
    expect(JSON.stringify(data)).not.toContain(body.trim());
    expect(data.commands.some((item: { filename: string }) => item.filename === "unselected.md")).toBe(false);
  });

  it("reports missing requested outputs before deployment", async () => {
    const f = fixture();
    const data = await report();
    const command = data.commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.targets).toHaveLength(2);
    expect(
      command.targets.every(
        (target: { ready: boolean; status: string }) => !target.ready && target.status === "missing",
      ),
    ).toBe(true);
  });

  it("reports kept owner changes on each host without changing them", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    writeFileSync(f.claude, "Owner Claude content.\n");
    const policy = join(f.native, "agents/openai.yaml");
    writeFileSync(policy, "policy: owner\n");
    const data = await report();
    const command = data.commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(
      command.targets.every((target: { ready: boolean; status: string }) => !target.ready && target.status === "kept"),
    ).toBe(true);
    expect(readFileSync(f.claude, "utf-8")).toBe("Owner Claude content.\n");
    expect(readFileSync(policy, "utf-8")).toBe("policy: owner\n");
  });

  it("uses generic native naming and verifies every leaf for long mixed-case command names", async () => {
    const f = fixture(true);
    await syncCommands({ quiet: true });
    let command = (await report()).commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.targets.find((target: { agent: string }) => target.agent === "codex").ready).toBe(true);
    writeFileSync(join(f.native, "references/command.md"), "Owner native reference.\n");
    command = (await report()).commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.targets.find((target: { agent: string }) => target.agent === "codex").ready).toBe(false);
  });

  it("reports a changed source as stale until both deployments are refreshed", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    writeFileSync(f.source, "A changed canonical body.\n");
    let command = (await report()).commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(
      command.targets.every((target: { ready: boolean; status: string }) => !target.ready && target.status === "stale"),
    ).toBe(true);
    await syncCommands({ quiet: true });
    command = (await report()).commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.targets.every((target: { ready: boolean }) => target.ready)).toBe(true);
  });

  it("reports the winning source so callers cannot mistake a filename collision for their deployment", async () => {
    const f = fixture();
    const other = mkdtempSync(join(homedir(), "winner-"));
    const winner = join(other, f.filename);
    writeFileSync(winner, "Another source wins.\n");
    const { loadState } = await import("../state.js");
    const state = loadState()!;
    state.commandSourceDirs!.push({ label: "winner", path: winner });
    saveState(state);
    await syncCommands({ quiet: true });
    const command = (await report()).commands.find((item: { filename: string }) => item.filename === f.filename);
    expect(command.sourcePath).toBe(winner);
    expect(command.sourcePath).not.toBe(f.source);
    expect(command.targets.every((target: { ready: boolean }) => target.ready)).toBe(true);
  });
});
