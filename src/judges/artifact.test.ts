import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_JUDGE_INPUT_BYTES, readCreateBody, readJudgeArtifact } from "./artifact.js";

describe("judge artifact bytes", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-artifact-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("preserves identical CRLF and final newline bytes for file and inline bodies", () => {
    const body = "First\r\nSecond\r\n\n";
    const bytes = Buffer.from(body);
    writeFileSync(join(root, "body file.md"), bytes);
    expect(readCreateBody({ event: "pr-create", bodyFile: "body file.md" }, root)).toEqual(bytes);
    expect(readCreateBody({ event: "pr-create", body }, root)).toEqual(bytes);
  });

  it("refuses a directory or symlink", () => {
    writeFileSync(join(root, "body.md"), "draft");
    symlinkSync("body.md", join(root, "alias.md"));
    expect(() => readJudgeArtifact(root)).toThrow(/regular file/);
    expect(() => readJudgeArtifact(join(root, "alias.md"))).toThrow(/regular file/);
  });

  it("refuses oversized local and inline artifacts", () => {
    const body = "x".repeat(MAX_JUDGE_INPUT_BYTES + 1);
    writeFileSync(join(root, "body.md"), body);
    expect(() => readJudgeArtifact(join(root, "body.md"))).toThrow(/size limit/);
    expect(() => readCreateBody({ event: "pr-create", body }, root)).toThrow(/size limit/);
  });
});
