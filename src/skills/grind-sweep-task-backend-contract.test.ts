import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf-8");
}

describe.each(["grind", "sweep"])("%s honors the task-backend contract", (skill) => {
  const body = read(`skill-plugins/workflow/${skill}/SKILL.md`);
  const reference = read(`skill-plugins/workflow/${skill}/references/task-backend.md`);
  const evals = JSON.parse(read(`skill-plugins/workflow/${skill}/evals/evals.json`)) as {
    evals: { prompt: string; expectations: string[] }[];
  };

  it("detects the backend before it touches a task", () => {
    const step0 = body.indexOf("## Step 0: Detect the task backend");
    expect(step0).toBeGreaterThan(-1);
    expect(body).toContain("`detect-task-backend`");
    expect(body).toContain("references/task-backend.md");
    expect(step0).toBeLessThan(
      body.indexOf("## Parallel Safety Rules") > -1
        ? body.indexOf("## Parallel Safety Rules")
        : body.indexOf("## Execution Model"),
    );
  });

  it("uses GitHub issues and never TASKS.md for an issues-backed repo", () => {
    expect(body).toMatch(/never create or edit `TASKS\.md`/);
    expect(body).toContain("`github-issues`");
    expect(reference).toMatch(/Never create or edit `TASKS\.md`/);
    expect(reference).toContain("gh issue create");
    expect(reference).toContain("--add-assignee @me");
    expect(reference).toContain("Closes #N");
    expect(body).toMatch(/Do not fall back to `TASKS\.md`/);
  });

  it("has an eval for an issues-backed repo", () => {
    const issueEval = evals.evals.find((e) => e.prompt.includes("task_backend: github-issues"));
    expect(issueEval?.expectations.some((x) => /Never creates/.test(x))).toBe(true);
  });
});
