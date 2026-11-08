import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM template without types
import { ClaudeHooks } from "../../templates/opencode/claude-hooks.js";

const dir = mkdtempSync(join(tmpdir(), "oc-hooks-"));
const log = join(dir, "events.log");

/** A hook that logs its event + tool and blocks `rm -rf` / prompts with "forbidden". */
const hookScript = join(dir, "hook.sh");
writeFileSync(
  hookScript,
  `#!/bin/bash
input=$(cat)
event=$(printf '%s' "$input" | jq -r .hook_event_name)
echo "$event $(printf '%s' "$input" | jq -r '.tool_name // ""') $(printf '%s' "$input" | jq -c '.tool_input // {}')" >> "${log}"
if printf '%s' "$input" | jq -e '.tool_input.command // "" | test("rm -rf")' >/dev/null; then echo "no rm -rf" >&2; exit 2; fi
if printf '%s' "$input" | jq -e '.prompt // "" | test("forbidden")' >/dev/null; then echo '{"decision":"block","reason":"bad prompt"}'; exit 0; fi
if [ "$event" = "UserPromptSubmit" ]; then echo '{"hookSpecificOutput":{"additionalContext":"CTX"}}'; fi
if [ "$event" = "Stop" ] && [ "$(printf '%s' "$input" | jq -r .stop_hook_active)" = "false" ]; then echo "write the retro" >&2; exit 2; fi
exit 0
`,
  { mode: 0o755 },
);

const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop", "SessionEnd"];
const settings = join(dir, "settings.json");
writeFileSync(
  settings,
  JSON.stringify({
    hooks: Object.fromEntries(
      EVENTS.map((e) => [
        e,
        [{ matcher: e.includes("Tool") ? "Bash|Edit" : "*", hooks: [{ type: "command", command: hookScript }] }],
      ]),
    ),
  }),
);

const prompts: unknown[] = [];
const client = { session: { prompt: async (req: unknown) => prompts.push(req) } };

async function plugin() {
  return ClaudeHooks({ client, directory: dir });
}

beforeEach(() => {
  process.env.CLAUDE_HOOKS_SETTINGS = settings;
  writeFileSync(log, "");
  prompts.length = 0;
});
afterEach(() => {
  delete process.env.CLAUDE_HOOKS_SETTINGS;
  delete process.env.OPENCODE_CLAUDE_HOOKS;
});

const read = async () => (await import("node:fs")).readFileSync(log, "utf-8");

describe("claude-hooks OpenCode adapter", () => {
  it("PreToolUse blocks with exit 2 and maps tool name + args", async () => {
    const p = await plugin();
    await expect(
      p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "rm -rf /" } }),
    ).rejects.toThrow(/no rm -rf/);
    await p["tool.execute.before"](
      { tool: "edit", sessionID: "s", callID: "c" },
      { args: { filePath: "/x", oldString: "a", newString: "b" } },
    );
    expect(await read()).toContain('PreToolUse Edit {"file_path":"/x","old_string":"a","new_string":"b"}');
  });

  it("matcher skips tools it does not name", async () => {
    const p = await plugin();
    await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c" }, { args: { filePath: "/x" } });
    expect(await read()).toBe("");
  });

  it("PostToolUse runs after the tool", async () => {
    const p = await plugin();
    const out = { title: "", output: "ok", metadata: {} };
    await p["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c", args: { command: "ls" } }, out);
    expect(await read()).toContain("PostToolUse Bash");
  });

  it("UserPromptSubmit adds context and blocks on a block decision", async () => {
    const p = await plugin();
    const parts = [{ type: "text", text: "hello" }];
    await p["chat.message"]({ sessionID: "s" }, { message: {}, parts });
    expect(parts[0]?.text).toContain("CTX");
    await expect(
      p["chat.message"]({ sessionID: "s" }, { message: {}, parts: [{ type: "text", text: "forbidden" }] }),
    ).rejects.toThrow(/bad prompt/);
  });

  it("session events map to SessionStart, Stop (block re-prompts once), SessionEnd", async () => {
    const p = await plugin();
    await p.event({ event: { type: "session.created", properties: { info: { id: "s" } } } });
    await p.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts[0])).toContain("write the retro");
    await p.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    expect(prompts).toHaveLength(1);
    await p.event({ event: { type: "session.deleted", properties: { info: { id: "s" } } } });
    const lines = await read();
    for (const e of ["SessionStart", "Stop", "SessionEnd"]) expect(lines).toContain(e);
  });

  it("covers 6 of 8 Claude hook events", async () => {
    const p = await plugin();
    await p.event({ event: { type: "session.created", properties: { info: { id: "m" } } } });
    await p["chat.message"]({ sessionID: "m" }, { message: {}, parts: [{ type: "text", text: "hi" }] });
    await p["tool.execute.before"]({ tool: "bash", sessionID: "m", callID: "c" }, { args: { command: "ls" } });
    await p["tool.execute.after"]({ tool: "bash", sessionID: "m", callID: "c", args: {} }, { output: "" });
    await p.event({ event: { type: "session.idle", properties: { sessionID: "m" } } });
    await p.event({ event: { type: "session.deleted", properties: { info: { id: "m" } } } });
    const fired = new Set(
      (await read())
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0]),
    );
    expect([...fired].sort()).toEqual([...EVENTS].sort());
  });

  it("OPENCODE_CLAUDE_HOOKS=0 turns it off", async () => {
    process.env.OPENCODE_CLAUDE_HOOKS = "0";
    const p = await plugin();
    await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "rm -rf /" } });
    expect(await read()).toBe("");
  });

  it("a crashing hook fails open", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "exit 7" }] }] } }),
    );
    process.env.CLAUDE_HOOKS_SETTINGS = bad;
    const p = await plugin();
    await expect(
      p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "ls" } }),
    ).resolves.toBeUndefined();
  });

  it("the plugin module exports only the plugin function", async () => {
    const mod = await import(resolve("templates/opencode/claude-hooks.js"));
    expect(Object.keys(mod)).toEqual(["ClaudeHooks"]);
  });
});
