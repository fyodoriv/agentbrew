// claude-hooks: run Claude Code hooks inside OpenCode (CLI and Desktop).
//
// agentbrew deploys this file to ~/.config/opencode/plugin/claude-hooks.js.
// It reads the same hooks Claude Code runs (~/.claude/settings.json, plus the
// project's .claude/settings.json and .claude/settings.local.json) on every
// call, so the hook list has one source of truth.
//
// Event map (Claude -> OpenCode):
//   PreToolUse       -> tool.execute.before  (block = the tool does not run)
//   PostToolUse      -> tool.execute.after   (block/context = appended to the tool output)
//   UserPromptSubmit -> chat.message         (block = the message fails; context = appended)
//   SessionStart     -> event session.created
//   Stop             -> event session.idle   (block = the reason goes back as a prompt)
//   SessionEnd       -> event session.deleted
// PermissionDenied and PostToolUseFailure have no OpenCode event.
//
// Hooks get Claude-shaped JSON on stdin and the same result rules: exit 2 or
// a JSON "block"/"deny" decision blocks; any other failure fails open.
// Turn it off with OPENCODE_CLAUDE_HOOKS=0.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOOL_NAMES = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  read: "Read",
  grep: "Grep",
  glob: "Glob",
  list: "LS",
  task: "Task",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  patch: "MultiEdit",
  multiedit: "MultiEdit",
};

/** Max Stop blocks per session in a row, so a stuck hook cannot loop forever. */
const MAX_STOP_BLOCKS = 3;

function toolName(name) {
  return TOOL_NAMES[name] ?? name;
}

function snake(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function camel(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function mapKeys(value, fn) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), v]));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

/** Hook groups for one Claude event, from user + project settings (Claude merges them the same way). */
function hookGroups(event, directory) {
  const files = process.env.CLAUDE_HOOKS_SETTINGS
    ? process.env.CLAUDE_HOOKS_SETTINGS.split(":")
    : [
        join(homedir(), ".claude", "settings.json"),
        join(directory, ".claude", "settings.json"),
        join(directory, ".claude", "settings.local.json"),
      ];
  return files.flatMap((file) => readJson(file)?.hooks?.[event] ?? []);
}

function matches(matcher, name) {
  if (!matcher || matcher === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(name);
  } catch {
    return matcher === name;
  }
}

function runCommand(command, payload, directory, timeoutSec) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      cwd: directory,
      env: { ...process.env, CLAUDE_PROJECT_DIR: directory, CLAUDE_HOOKS_HOST: "opencode" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), (timeoutSec ?? 60) * 1000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Apply Claude's result rules to one hook run. */
function interpret({ code, stdout, stderr }) {
  if (code === 2) return { block: true, reason: stderr.trim() || "blocked by hook" };
  if (code !== 0) return {};
  let out;
  try {
    out = JSON.parse(stdout.trim());
  } catch {
    return {};
  }
  if (!out || typeof out !== "object") return {};
  const specific = out.hookSpecificOutput ?? {};
  const result = {};
  if (out.decision === "block" || specific.permissionDecision === "deny" || out.continue === false) {
    result.block = true;
    result.reason = out.reason || specific.permissionDecisionReason || out.stopReason || "blocked by hook";
  }
  if (specific.additionalContext) result.context = specific.additionalContext;
  if (specific.updatedInput && typeof specific.updatedInput === "object") result.updatedInput = specific.updatedInput;
  return result;
}

/** Run every matching hook for one event. Stops at the first block, like Claude. */
/** Command hooks for one event whose matcher fits the tool name (no name = every group). */
function matchingCommands(event, directory, name) {
  return hookGroups(event, directory)
    .filter((group) => name === undefined || matches(group.matcher, name))
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => hook.type === "command" && hook.command);
}

async function runEvent(event, payload, directory, name) {
  const merged = { context: [] };
  if (process.env.OPENCODE_CLAUDE_HOOKS === "0") return merged;
  for (const hook of matchingCommands(event, directory, name)) {
    const run = await runCommand(hook.command, { ...payload, hook_event_name: event }, directory, hook.timeout);
    const result = interpret(run);
    if (result.context) merged.context.push(result.context);
    if (result.updatedInput) merged.updatedInput = { ...merged.updatedInput, ...result.updatedInput };
    if (result.block) return { ...merged, block: true, reason: result.reason };
  }
  return merged;
}

function base(sessionID, directory) {
  return { session_id: sessionID, transcript_path: "", cwd: directory };
}

export const ClaudeHooks = async ({ client, directory }) => {
  const stopBlocks = new Map();
  return {
    "tool.execute.before": async (input, output) => {
      const name = toolName(input.tool);
      const result = await runEvent(
        "PreToolUse",
        { ...base(input.sessionID, directory), tool_name: name, tool_input: mapKeys(output.args, snake) },
        directory,
        name,
      );
      if (result.block) throw new Error(`Blocked by ${name} hook: ${result.reason}`);
      if (result.updatedInput) Object.assign(output.args, mapKeys(result.updatedInput, camel));
    },
    "tool.execute.after": async (input, output) => {
      const name = toolName(input.tool);
      const result = await runEvent(
        "PostToolUse",
        {
          ...base(input.sessionID, directory),
          tool_name: name,
          tool_input: mapKeys(input.args, snake),
          tool_response: { output: output.output },
        },
        directory,
        name,
      );
      const notes = [...result.context, ...(result.block ? [result.reason] : [])];
      if (notes.length > 0)
        output.output = `${output.output ?? ""}\n\n<hook-feedback>\n${notes.join("\n")}\n</hook-feedback>`;
    },
    "chat.message": async (input, output) => {
      const textPart = (output.parts ?? []).find((p) => p.type === "text" && !p.synthetic);
      if (!textPart) return;
      stopBlocks.delete(input.sessionID);
      const result = await runEvent(
        "UserPromptSubmit",
        { ...base(input.sessionID, directory), prompt: textPart.text },
        directory,
      );
      if (result.block) throw new Error(`Blocked by UserPromptSubmit hook: ${result.reason}`);
      if (result.context.length > 0)
        textPart.text = `${textPart.text}\n\n<system-reminder>\n${result.context.join("\n")}\n</system-reminder>`;
    },
    event: async ({ event }) => {
      const props = event?.properties ?? {};
      if (event?.type === "session.created") {
        await runEvent("SessionStart", { ...base(props.info?.id, directory), source: "startup" }, directory);
      } else if (event?.type === "session.deleted") {
        await runEvent("SessionEnd", { ...base(props.info?.id, directory), reason: "other" }, directory);
      } else if (event?.type === "session.idle") {
        const id = props.sessionID;
        const count = stopBlocks.get(id) ?? 0;
        if (count >= MAX_STOP_BLOCKS) return;
        const result = await runEvent("Stop", { ...base(id, directory), stop_hook_active: count > 0 }, directory);
        if (!result.block) {
          stopBlocks.delete(id);
          return;
        }
        stopBlocks.set(id, count + 1);
        await client?.session?.prompt?.({
          path: { id },
          body: { parts: [{ type: "text", text: `Stop hook feedback:\n${result.reason}` }] },
        });
      }
    },
  };
};

// Test seam; not a plugin export (OpenCode loads only exported functions).
ClaudeHooks.internals = { toolName, mapKeys, snake, camel, matches, interpret, runEvent };
