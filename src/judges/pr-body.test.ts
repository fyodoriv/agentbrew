import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JUDGE_INPUT_BYTES } from "./artifact.js";
import { parseJudgePrArguments } from "./pr-arguments.js";
import { readJudgePrBody } from "./pr-body.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const target = parseJudgePrArguments(["gh", "pr", "ready", "42", "-R", "example/project"]);

function reply(status: number, payload: unknown): void {
  const stdout = JSON.stringify(payload);
  vi.mocked(spawnSync).mockReturnValue({
    status,
    stdout,
    stderr: "",
    pid: 1,
    output: [null, stdout, ""],
    signal: null,
  });
}

describe("judge PR ready body", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads the exact current body of the requested PR without a shell", () => {
    const body = "Draft\r\n\n";
    reply(0, { number: 42, body });
    expect(readJudgePrBody(target, "/fixture")).toEqual(Buffer.from(body));
    expect(spawnSync).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "42", "--json", "number,body", "--repo", "example/project"],
      expect.objectContaining({ cwd: "/fixture", shell: false, timeout: 5000 }),
    );
  });

  it.each([
    ["a mismatched PR number", 0, { number: 43, body: "fixture" }],
    ["a failed command", 1, { number: 42, body: "fixture" }],
    ["an oversized response body", 0, { number: 42, body: "x".repeat(MAX_JUDGE_INPUT_BYTES + 1) }],
  ])("refuses %s", (_label, status, payload) => {
    reply(status, payload);
    expect(() => readJudgePrBody(target, "/fixture")).toThrow(/could not verify/);
  });
});
