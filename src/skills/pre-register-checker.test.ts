import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../skill-plugins/workflow/pre-register/scripts/check-preregistration.mjs", import.meta.url),
);

const GOOD_FIELDS = {
  Hypothesis: "cold `sync --dry-run` drops from 9 s to under 5 s because the catalog read is cached.",
  Measurement: "`hyperfine --runs 10 'npm run dev -- sync --dry-run'` median.",
  Success: "median at or below 5 s.",
  Pivot: "median above 8 s.",
  Anchor: "Kohavi, Tang, Xu 2020 (Trustworthy Online Controlled Experiments).",
};

const GOOD_GRADE = {
  Predicted: "median at or below 5 s.",
  Observed: "median 4.2 s (baseline 9.1 s).",
  Match: "yes",
  Lesson: "the catalog read was the main cost.",
};

type Fields = Record<string, string | undefined>;

function body(fields: Fields): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `- **${name}**: ${value}`);
  return `## Summary\n\nCache the catalog read.\n\n## Hypothesis\n\n${lines.join("\n")}\n`;
}

function check(text: string, ...args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pre-register-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, text);
    const run = spawnSync(process.execPath, [script, file, ...args], { encoding: "utf8", timeout: 10_000 });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("pre-register checker", () => {
  it("passes a complete PR body", () => {
    const run = check(body(GOOD_FIELDS));
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("OK: 1 block(s) checked");
  });

  it.each([
    ["a missing field", { Anchor: undefined }, "Anchor: missing"],
    ["placeholder text", { Success: "TBD" }, "Success: placeholder"],
    ["a manual measurement", { Measurement: "check manually that it feels faster" }, "Measurement: manual"],
    ["a measurement with no command", { Measurement: "the median startup time" }, "Measurement: no runnable command"],
    ["an echo-only command", { Measurement: "`echo done`" }, "Measurement: the command does not read real output"],
    ["a success with no number", { Success: "faster than before" }, "Success: no numeric threshold"],
    ["a pivot equal to success", { Pivot: "median at or below 5 s." }, "Pivot: same as Success"],
    ["an anchor with no source", { Anchor: "common sense" }, "Anchor: no year"],
    ["a vanity hypothesis", { Hypothesis: "the number of commits per week goes up 2x" }, "Hypothesis: vanity metric"],
  ])("rejects %s", (_name, override, expected) => {
    const run = check(body({ ...GOOD_FIELDS, ...override }));
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain(expected);
  });

  it("allows angle-bracket arguments inside a command", () => {
    const run = check(body({ ...GOOD_FIELDS, Measurement: "`node scripts/check.mjs --pr <n>; echo exit=$?`" }));
    expect(run.status, run.out).toBe(0);
  });

  it("warns on a blog anchor without failing", () => {
    const run = check(body({ ...GOOD_FIELDS, Anchor: "a 2021 blog post on caching" }));
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("Anchor: warning");
  });

  it("reads heading-style fields", () => {
    const text = Object.entries(GOOD_FIELDS)
      .map(([name, value]) => `### ${name}\n\n${value}\n`)
      .join("\n");
    const run = check(text);
    expect(run.status, run.out).toBe(0);
  });

  it("requires every self-grade field with --self-grade", () => {
    const run = check(body({ ...GOOD_FIELDS, ...GOOD_GRADE, Lesson: undefined }), "--self-grade");
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain("Lesson: missing");
    expect(check(body({ ...GOOD_FIELDS, ...GOOD_GRADE }), "--self-grade").status).toBe(0);
  });

  it("rejects a Match value other than yes, partial or no", () => {
    const run = check(body({ ...GOOD_FIELDS, ...GOOD_GRADE, Match: "mostly" }), "--self-grade");
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain("Match: must start with yes, partial, or no");
    expect(
      check(body({ ...GOOD_FIELDS, ...GOOD_GRADE, Match: "**Partial** (p99 missed)" }), "--self-grade").status,
    ).toBe(0);
  });

  it("passes an exempt block", () => {
    const run = check("## Hypothesis\n\nExempt: typo fix; the markdown lint gate is the metric.\n");
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("exempt");
  });

  it("checks each task block on its own and names only the bad one", () => {
    const block = (id: string, fields: Fields) =>
      [`- [ ] Task ${id}`, `  - **ID**: ${id}`, ...Object.entries(fields).map(([k, v]) => `  - **${k}**: ${v}`)].join(
        "\n",
      );
    const text = `# Tasks\n\n## P1\n\n${block("good-task", GOOD_FIELDS)}\n\n${block("bad-task", { ...GOOD_FIELDS, Pivot: "worse" })}\n`;
    const run = check(text);
    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain("bad-task: Pivot: no numeric threshold");
    expect(run.out).not.toContain("good-task:");
  });

  it("reads stdin when the file is -", () => {
    const run = spawnSync(process.execPath, [script, "-"], { input: body(GOOD_FIELDS), encoding: "utf8" });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("exits 2 without an input file", () => {
    const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage:");
  });
});
