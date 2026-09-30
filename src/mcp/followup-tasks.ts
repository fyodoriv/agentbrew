import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { logSkipped } from "../core/logger.js";
import { isProbeFailure } from "./heal-actions.js";
import type { McpHealAttempt } from "./health-snapshot.js";
import type { ProbeResult } from "./probe.js";

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function candidateTasksPaths(): string[] {
  const moduleTasks = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "TASKS.md");
  const cwdTasks = resolve(process.cwd(), "TASKS.md");
  return Array.from(new Set([moduleTasks, cwdTasks]));
}

function resolveTasksPath(): string | undefined {
  return candidateTasksPaths().find((path) => existsSync(path));
}

function attemptFor(result: ProbeResult, attempts: McpHealAttempt[]): McpHealAttempt | undefined {
  return attempts.find((attempt) => attempt.name === result.name && attempt.agent === result.agent);
}

function buildFollowupTask(result: ProbeResult, attempts: McpHealAttempt[]): { id: string; block: string } {
  const id = `mcp-health-${slug(result.agent)}-${slug(result.name)}`;
  const attempt = attemptFor(result, attempts);
  const detailLines = [
    `Cron MCP probe still reports \`${result.status}\` for \`${result.name}\` on \`${result.agent}\`.`,
    result.error ? `Last error: \`${result.error.slice(0, 240)}\`.` : undefined,
    attempt?.action ? `Heal attempted: \`${attempt.action}\` (healed=${String(attempt.healed)}).` : undefined,
    attempt?.followupTask ? `Suggested manual command: \`${attempt.followupTask}\`.` : undefined,
  ].filter((line): line is string => Boolean(line));
  return {
    id,
    block: [
      `- [ ] Repair MCP health failure for ${result.name} on ${result.agent}`,
      `  **ID**: ${id}`,
      "  **Tags**: mcp, health, auto-repair, P0",
      `  **Details**: ${detailLines.join(" ")}`,
      `  **Files**: src/mcp/heal-actions.ts, src/mcp/heal-cycle.ts, ~/.cache/agentbrew/mcp-health.json`,
      `  **Acceptance**: \`agentbrew mcp probe ${result.name} --agent ${result.agent} --deep\` returns ok and \`agentbrew status\` no longer reports this MCP as failing.`,
    ].join("\n"),
  };
}

export function appendMcpFollowupTasks(
  results: ProbeResult[],
  attempts: McpHealAttempt[],
  tasksPath = resolveTasksPath(),
): void {
  if (!tasksPath) return;
  const failures = results.filter(isProbeFailure);
  if (failures.length === 0) return;
  try {
    const content = readFileSync(tasksPath, "utf-8");
    const tasks = failures
      .map((result) => buildFollowupTask(result, attempts))
      .filter(({ id }) => !content.includes(`**ID**: ${id}`));
    if (tasks.length === 0) return;
    const insertion = `${tasks.map(({ block }) => block).join("\n\n")}\n\n`;
    const updated = content.includes("## P0\n")
      ? content.replace("## P0\n", `## P0\n\n${insertion}`)
      : `${content.trimEnd()}\n\n## P0\n\n${insertion}`;
    writeFileAtomicSync(tasksPath, updated, "utf-8");
  } catch (error) {
    logSkipped("mcp-followup-tasks/write", error);
  }
}
