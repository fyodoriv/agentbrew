// `npm run proof:user-files`: prove that sync never changes user-made files.
// Seeds a scratch HOME with a user skill, command, agent definition, rule
// file, and MCP server, runs `agentbrew sync` three times, then counts the user items whose bytes (or MCP entry) changed.
// Appends one content-free line to .metrics/user-files.jsonl, which
// `npm run docs:proof` reads (user_files_changed). The scratch HOME is not
// the user's home, so launchd calls are skipped (src/core/launchctl.ts).
// Then it runs `agentbrew fix` once; its MCP follow-ups must not write any
// TASKS.md outside the scratch cwd (task fix-followups-write-repo-tasks).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { runScenarioCli, seedScenarioState } from "../src/real-e2e/scenario-fixture.js";

const repoRoot = resolve(import.meta.dirname, "..");
const SYNC_RUNS = 3;

/** User-made files, relative to HOME, with their content. */
const USER_FILES: Record<string, string> = {
  ".claude/skills/my-own-skill/SKILL.md": "---\nname: my-own-skill\ndescription: mine\n---\n\n# Mine\n",
  ".claude/skills/my-own-skill/notes.txt": "keep me\n",
  ".claude/commands/my-own-command.md": "# My command\n\nDo my thing.\n",
  ".claude/agents/my-own-agent.md": "---\nname: my-own-agent\ndescription: mine\n---\n\nHelp me.\n",
  ".claude/rules/my-own-rule.md": "# My rule\n\nAlways mine.\n",
  ".codex/prompts/my-own-prompt.md": "# My prompt\n",
};
const USER_MCP = { command: "my-own-mcp", args: ["--port", "1234"], env: { MY_FLAG: "1" } };

const sha = (path: string): string | undefined =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined;

function mcpEntry(home: string): string | undefined {
  try {
    const servers = JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8")).mcpServers ?? {};
    return JSON.stringify(servers["my-own-mcp"]);
  } catch {
    return undefined;
  }
}

export async function measure(): Promise<{ checked: number; changed: number; failedRuns: number }> {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-user-files-"));
  const home = join(root, "home");
  try {
    for (const dir of [".claude", ".codex", ".config/agentbrew"]) mkdirSync(join(home, dir), { recursive: true });
    for (const [rel, text] of Object.entries(USER_FILES)) {
      mkdirSync(dirname(join(home, rel)), { recursive: true });
      writeFileSync(join(home, rel), text);
    }
    writeFileSync(
      join(home, ".claude.json"),
      `${JSON.stringify({ mcpServers: { "my-own-mcp": USER_MCP } }, null, 2)}\n`,
    );
    await seedScenarioState(home, repoRoot);

    const before = Object.fromEntries(Object.keys(USER_FILES).map((rel) => [rel, sha(join(home, rel))]));
    const mcpBefore = mcpEntry(home);
    const extraEnv = { AGENTBREW_EVENTS: "0", NO_COLOR: "1" };
    let failedRuns = 0;
    for (const args of [...Array.from({ length: SYNC_RUNS }, () => ["sync"]), ["fix"]]) {
      try {
        await runScenarioCli({ repoRoot, homeDir: home, args, extraEnv });
      } catch {
        failedRuns++;
      }
    }
    let changed = Object.keys(USER_FILES).filter((rel) => sha(join(home, rel)) !== before[rel]).length;
    if (mcpEntry(home) !== mcpBefore) changed++;
    return { checked: Object.keys(USER_FILES).length + 1, changed, failedRuns };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = await measure();
  const metricsDir = process.env.AGENTBREW_METRICS_DIR ?? join(repoRoot, ".metrics");
  mkdirSync(metricsDir, { recursive: true });
  const line = { ts: new Date().toISOString(), event: "user_files", runs: SYNC_RUNS, ...result };
  appendFileSync(join(metricsDir, "user-files.jsonl"), `${JSON.stringify(line)}\n`);
  console.log(
    `user files changed: ${result.changed} of ${result.checked} (${line.runs} runs, ${result.failedRuns} failed)`,
  );
  if (result.changed > 0 || result.failedRuns > 0) process.exitCode = 1;
}
