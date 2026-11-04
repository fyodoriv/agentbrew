import { describe, expect, it } from "vitest";
import { parseJudgePrArguments } from "./pr-arguments.js";

describe("judge PR arguments", () => {
  it("keeps a literal body file path", () => {
    expect(
      parseJudgePrArguments(["gh", "pr", "create", "--draft", "-t", "Title", "--body-file=notes folder/body.md"]),
    ).toEqual({
      event: "pr-create",
      bodyFile: "notes folder/body.md",
    });
  });

  it("preserves inline content without normalizing escapes", () => {
    const body = "First\\nsecond\n";
    expect(parseJudgePrArguments(["gh", "pr", "create", "-t", "Title", "-b", body])).toEqual({
      event: "pr-create",
      body,
    });
    expect(parseJudgePrArguments(["gh", "pr", "create", "-t", "Title", "--body=---\nDraft"])).toEqual({
      event: "pr-create",
      body: "---\nDraft",
    });
  });

  it("resolves the explicit target for an authoritative ready-body read", () => {
    expect(parseJudgePrArguments(["gh", "pr", "ready", "42", "-R", "owner/repo"])).toEqual({
      event: "pr-ready",
      number: "42",
      repo: "owner/repo",
    });
  });

  it.each([
    ["repeated body inputs", ["create", "-t", "Title", "-b", "one", "-F", "two.md"]],
    ["stdin", ["create", "-t", "Title", "-F", "-"]],
    ["an implicit title", ["create", "-b", "draft"]],
    ["an implicit ready target", ["ready"]],
    ["an unknown create flag", ["create", "--fill", "-b", "draft"]],
    ["a flag in a separate value position", ["create", "-t", "--draft", "-b", "draft"]],
  ])("refuses %s", (_label, args) => {
    expect(() => parseJudgePrArguments(["gh", "pr", ...args])).toThrow(/exact PR input/);
  });
});
