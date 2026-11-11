import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedRules = readFileSync(join(process.cwd(), "docs", "shared-rules.md"), "utf-8");
const template = readFileSync(join(process.cwd(), "templates", "AGENTS.md"), "utf-8");
const gate = readFileSync(join(process.cwd(), "scripts", "verify-changed.sh"), "utf-8");

const FIELDS = ["Hypothesis", "Measurement", "Success", "Pivot", "Anchor"];

function rule(marker: string): string {
  const section = sharedRules.split("## Task queues")[1]?.split("\n## ")[0] ?? "";
  const line = section.split("\n").find((l) => l.includes(marker));
  if (!line) throw new Error(`missing ${marker} bullet in the Task queues section of docs/shared-rules.md`);
  return line;
}

describe("docs/shared-rules.md — measure every task", () => {
  it("asks for the five measurement fields on every task, at every priority", () => {
    const line = rule("**Measure every task (IRON LAW):**");
    for (const field of FIELDS) expect(line).toContain(`\`${field}\``);
    expect(line).toMatch(/at every priority/);
    expect(line).toContain("npx @tasks-md/lint --require-prereg TASKS.md");
  });

  it("asks for a number that shows the effect in use", () => {
    const line = rule("**Measure in use, not only in tests:**");
    expect(line).toMatch(/telemetry event, a dashboard tile, or a metrics command/);
    expect(line).toMatch(/the task adds it/);
    expect(line).toMatch(/reads the tile back/);
    expect(line).toMatch(/Never invent an event/);
  });

  it("is in the always-loaded AGENTS template, with a pointer to the full rule", () => {
    const line = template.split("\n").find((l) => l.startsWith("- Every task carries its measurement"));
    expect(line).toBeDefined();
    for (const field of FIELDS) expect(line).toContain(`\`${field}\``);
    expect(line).toContain("shared-rules **## Task queues**");
  });

  it("is enforced by this repo's gate on every task block", () => {
    expect(gate).toMatch(/@tasks-md\/lint@[0-9.]+ --require-prereg TASKS\.md/);
  });
});
