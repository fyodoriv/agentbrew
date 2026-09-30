import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSkillStructure, estimateTokens, extractRelativeLinks } from "./skill-structural.js";

describe("extractRelativeLinks", () => {
  it("extracts relative file links", () => {
    expect(extractRelativeLinks("see [a](../docs/x.md) and [b](scripts/run.sh)")).toEqual([
      "../docs/x.md",
      "scripts/run.sh",
    ]);
  });

  it("skips external schemes, anchors, and absolute paths", () => {
    expect(extractRelativeLinks("[h](https://x.com) [m](mailto:a@b.com) [a](#sec) [abs](/etc/x)")).toEqual([]);
  });

  it("skips prose placeholders and bare words", () => {
    // `url`, `<NAME>.md`, the regex `[^/]+`, and `docs/<area>.md` are illustrative prose, not links.
    expect(extractRelativeLinks("[link](url) [t](<NAME>.md) [r]([^/]+) [c](docs/<area>.md)")).toEqual([]);
  });

  it("strips a trailing anchor from a file path", () => {
    expect(extractRelativeLinks("[s](../README.md#install)")).toEqual(["../README.md"]);
  });

  it("dedupes repeated targets", () => {
    expect(extractRelativeLinks("[a](x/y.md) [b](x/y.md)")).toEqual(["x/y.md"]);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

describe("checkSkillStructure", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skillstruct-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no issues for a clean skill", () => {
    writeFileSync(join(dir, "SKILL.md"), "# Skill\n\nNo links here.\n");
    expect(checkSkillStructure(dir)).toEqual([]);
  });

  it("warns (not errors) on a broken relative link", () => {
    writeFileSync(join(dir, "SKILL.md"), "# S\n\nSee [x](./missing/file.md).\n");
    const issues = checkSkillStructure(dir);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("Broken relative link: ./missing/file.md");
  });

  it("does not warn when the linked file exists", () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "ref.md"), "ref");
    writeFileSync(join(dir, "SKILL.md"), "# S\n\nSee [x](sub/ref.md).\n");
    expect(checkSkillStructure(dir)).toEqual([]);
  });

  it("errors when SKILL.md exceeds the token hard cap", () => {
    writeFileSync(join(dir, "SKILL.md"), `# S\n\n${"x".repeat(16001 * 4)}`);
    expect(checkSkillStructure(dir).some((i) => i.severity === "error" && i.message.includes("hard cap"))).toBe(true);
  });

  it("warns over the soft budget but under the hard cap", () => {
    writeFileSync(join(dir, "SKILL.md"), `# S\n\n${"x".repeat(6001 * 4)}`);
    expect(checkSkillStructure(dir).some((i) => i.severity === "warning" && i.message.includes("over budget"))).toBe(
      true,
    );
  });

  it("returns no issues when SKILL.md is absent", () => {
    expect(checkSkillStructure(dir)).toEqual([]);
  });
});

describe("built-in skills corpus gate", () => {
  it("no built-in skill trips an error-severity structural issue (token hard cap)", () => {
    const root = join(import.meta.dirname, "..", "..", "skill-plugins", "dev");
    const offenders: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const errors = checkSkillStructure(join(root, entry.name)).filter((issue) => issue.severity === "error");
      if (errors.length > 0) offenders.push(`${entry.name}: ${errors.map((e) => e.message).join("; ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
