/**
 * Every agentbrew action runs through the CLI and agents, from one list generated from the CLI
 * parser (shared rule "Every action through CLI, agent, and UI, with tests").
 *
 * agentbrew has no UI: no web app, desktop app, or browser view. So this test checks the two
 * paths that exist, the CLI (the Commander program) and agents (`agentbrew actions --json`, which
 * `/agentbrew` points at), and trips when a UI appears. It fails when a CLI command misses the
 * agent path without a written reason, when a note names a command that is gone, or when a
 * command that skips its own prompt does not ask first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Argument, Command, Option } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

// buildProgram() installs the motd hook; keep it quiet.
vi.mock("./motd.js", () => ({ printMotd: vi.fn() }));

import {
  type Action,
  AGENT_NOTES,
  actionCatalog,
  CONFIRM,
  isHidden,
  isRunnable,
  NOT_ACTIONS,
  TERMINAL_ONLY,
} from "./actions.js";
import { buildProgram } from "./cli.js";
import { validateAgentbrewCommand } from "./docs/runnable-examples.js";

const ROOT = join(import.meta.dirname, "..");

/** Every runnable CLI command (hidden ones too), walked here independently of `actionCatalog`. */
function cliCommands(): Array<{ name: string; hidden: boolean }> {
  const out: Array<{ name: string; hidden: boolean }> = [];
  const walk = (cmd: Command, path: string[], hiddenParent: boolean): void => {
    for (const sub of cmd.commands) {
      const subPath = [...path, sub.name()];
      const hidden = hiddenParent || isHidden(sub);
      if (isRunnable(sub)) out.push({ name: subPath.join("."), hidden });
      walk(sub, subPath, hidden);
    }
  };
  walk(buildProgram(), [], false);
  return out;
}

/** What an agent gets: `agentbrew actions --json`, run in-process through the real program. */
async function agentCatalog(): Promise<Action[]> {
  const printed: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    printed.push(parts.join(" "));
  });
  try {
    await buildProgram().parseAsync(["node", "agentbrew", "actions", "--json"]);
  } finally {
    log.mockRestore();
  }
  return JSON.parse(printed.join("\n")) as Action[];
}

const catalog = actionCatalog(buildProgram());
const byName = new Map(catalog.map((a) => [a.name, a]));

afterEach(() => vi.restoreAllMocks());

describe("action parity: CLI and agents (agentbrew has no UI)", () => {
  it("every CLI command is an agent action, or a hidden command with a written reason", () => {
    const cli = cliCommands();
    const missing = cli.filter((c) => !byName.has(c.name) && !(c.hidden && NOT_ACTIONS[c.name])).map((c) => c.name);
    expect(missing, "CLI commands with no agent path: add a reason to NOT_ACTIONS in src/actions.ts").toEqual([]);
    expect(catalog.map((a) => a.name)).toEqual(cli.filter((c) => !c.hidden).map((c) => c.name));
    expect(catalog.length).toBeGreaterThan(50);
  });

  it("agents get the same list from `agentbrew actions --json`", async () => {
    expect(await agentCatalog()).toEqual(JSON.parse(JSON.stringify(catalog)));
  });

  it("/agentbrew points agents at the catalog and its notes", () => {
    const doc = readFileSync(join(ROOT, "commands", "agentbrew.md"), "utf-8");
    for (const word of ["`agentbrew actions --json`", "`terminal_only`", "`confirm`", "`agent_note`"]) {
      expect(doc).toContain(word);
    }
  });

  it("marks every command that /agentbrew runs only after a yes", () => {
    const doc = readFileSync(join(ROOT, "commands", "agentbrew.md"), "utf-8");
    const asked = [...doc.matchAll(/^ {3}- `(agentbrew [^`]+)`/gmu)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(3);
    for (const command of asked) {
      const words = command.split(" ").slice(1);
      let cut = words.length;
      while (cut > 0 && !byName.has(words.slice(0, cut).join("."))) cut -= 1;
      const action = byName.get(words.slice(0, cut).join("."));
      expect(action, command).toBeDefined();
      const extra = words.slice(cut).join(" ");
      // A flag that adds the risk (`mcp probe --deep`) may be named in the agent note instead.
      const flagNoted = extra !== "" && action?.agent_note?.includes(extra);
      const marked = action?.confirm || action?.terminal_only || flagNoted;
      expect(marked, `${command}: add it to CONFIRM or TERMINAL_ONLY (or name the flag in AGENT_NOTES)`).toBeTruthy();
    }
  });

  it("every agent command parses with the real CLI parser", async () => {
    for (const action of catalog) {
      const argv = action.command.split(" ");
      for (const a of action.args.filter((x) => x.required)) argv.push(...(a.flag ? [a.flag, "x"] : ["x"]));
      expect(await validateAgentbrewCommand(argv), argv.join(" ")).toEqual({ ok: true });
    }
  });

  it("has no stale notes", () => {
    const hidden = new Set(cliCommands().flatMap((c) => (c.hidden ? [c.name] : [])));
    for (const map of [TERMINAL_ONLY, CONFIRM, AGENT_NOTES]) {
      expect(Object.keys(map).filter((name) => !byName.has(name))).toEqual([]);
    }
    expect(Object.keys(NOT_ACTIONS).filter((name) => !hidden.has(name))).toEqual([]);
  });

  it("gives a written note to every command that changes things (--yes, --confirm, --dry-run)", () => {
    const changes = catalog.filter((a) =>
      a.args.some((x) => ["--yes", "--confirm", "--dry-run"].includes(x.flag ?? "")),
    );
    expect(changes.length).toBeGreaterThan(5);
    const unmarked = changes.filter((a) => !a.confirm && !a.terminal_only && !a.agent_note).map((a) => a.name);
    expect(unmarked, "add each to CONFIRM, TERMINAL_ONLY, or AGENT_NOTES in src/actions.ts").toEqual([]);
    const skipsPrompt = changes.filter((a) => a.args.some((x) => x.flag === "--yes" || x.flag === "--confirm"));
    expect(skipsPrompt.filter((a) => !a.confirm && !a.terminal_only).map((a) => a.name)).toEqual([]);
  });

  it("hard-to-undo actions always ask first (this list may grow, never shrink)", () => {
    const must = ["sync", "install", "remove", "plugin.add", "plugin.remove", "memory.pack.uninstall", "report"];
    expect(must.filter((name) => !CONFIRM[name])).toEqual([]);
    expect(Object.keys(TERMINAL_ONLY)).toEqual(expect.arrayContaining(["setup", "mcp.setup"]));
  });

  it("mirrors the real parser's arguments: positionals, flags, values, and required options", () => {
    const arg = (action: string, name: string) => byName.get(action)?.args.find((a) => a.name === name);
    expect(arg("agentfile.merge", "paths")).toMatchObject({ flag: null, required: true, many: true });
    expect(arg("sync", "dryRun")).toMatchObject({ flag: "--dry-run", kind: "flag", required: false });
    expect(arg("sync", "prune")).toMatchObject({ flag: "--no-prune", kind: "flag", default: null });
    expect(arg("sync", "only")).toMatchObject({ flag: "--only", kind: "text", optional_value: false });
    expect(arg("plugin.new", "name")).toMatchObject({ flag: "--name", required: true });
    expect(arg("metrics", "days")).toMatchObject({ kind: "text", default: "7" });
    expect(arg("metrics", "share")).toMatchObject({ kind: "text", optional_value: true });
    expect(arg("mcp.add", "args")).toMatchObject({ flag: "--args", many: true });
  });

  it("maps what the real CLI does not use yet: choices, hidden options, hidden and group-only commands", () => {
    const program = new Command();
    const tool = program.command("tool").description("a group with no action of its own");
    tool
      .command("run <mode>")
      .description("run it")
      .addArgument(new Argument("[level]").choices(["low", "high"]))
      .addOption(new Option("--format <f>").choices(["json", "text"]))
      .addOption(new Option("--secret-knob").hideHelp())
      .action(() => {});
    program.command("old", { hidden: true }).action(() => {});
    const actions = actionCatalog(program);
    expect(actions.map((a) => a.name)).toEqual(["tool.run"]);
    expect(actions[0].args).toEqual([
      expect.objectContaining({ name: "mode", flag: null, kind: "text", required: true }),
      expect.objectContaining({ name: "level", kind: "choice", choices: ["low", "high"], required: false }),
      expect.objectContaining({ name: "format", flag: "--format", kind: "choice", choices: ["json", "text"] }),
    ]);
  });

  it("trips when agentbrew gets a UI of its own, so its path joins this test", () => {
    // A UI needs a server or a UI framework. When one lands, add a test that the UI lists every
    // action and runs the argument-free ones (careerbrew: tests/unit/test_action_parity.py).
    // A server that is not a UI (an OAuth loopback, a test fake) goes in NOT_A_UI with the reason.
    const NOT_A_UI: Record<string, string> = {};
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as Record<string, unknown>;
    const deps = Object.keys({ ...(pkg.dependencies as object), ...(pkg.devDependencies as object) });
    const uiFrameworks = ["express", "fastify", "koa", "hono", "next", "react", "vue", "svelte", "electron", "vite"];
    expect(deps.filter((d) => uiFrameworks.includes(d))).toEqual([]);
    const servers = sourceFiles(join(ROOT, "src"))
      .filter((file) => /\bcreateServer\(/u.test(readFileSync(file, "utf-8")))
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => !NOT_A_UI[file]);
    expect(servers, "a server in src/: add its UI path to this test, or add it to NOT_A_UI with why").toEqual([]);
  });
});

/** Non-test TypeScript files under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
}
