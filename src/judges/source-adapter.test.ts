import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtCliRoot } from "../cli-build-health.js";
import { readJudgeSource } from "./source.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("../cli-build-health.js", () => ({ builtCliRoot: vi.fn() }));

describe("judge reader adapter", () => {
  let fixture: string;
  let owner: string;
  let asset: string;

  beforeEach(() => {
    vi.resetAllMocks();
    fixture = mkdtempSync(join(tmpdir(), "agentbrew-judge-adapter-"));
    owner = join(fixture, "owner");
    asset = join(fixture, "dist", "native", `${process.platform}-${process.arch}`, "judge-source");
    mkdirSync(owner);
    writeFileSync(join(owner, "clarity.md"), "Unqualified path read\n");
    mkdirSync(dirname(asset), { recursive: true });
    writeFileSync(asset, "", { mode: 0o700 });
    vi.mocked(builtCliRoot).mockReturnValue(fixture);
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  function reply(status: number, stdout: Buffer<ArrayBuffer>): void {
    vi.mocked(spawnSync).mockReturnValue({
      status,
      stdout,
      stderr: Buffer.alloc(0),
      pid: 1,
      output: [null, stdout, Buffer.alloc(0)],
      signal: null,
    });
  }

  it("returns only the text from the bundled reader", () => {
    reply(0, Buffer.from("Qualified reader output\n"));
    expect(readJudgeSource(owner, "clarity.md")).toBe("Qualified reader output\n");
    expect(spawnSync).toHaveBeenCalledWith(
      asset,
      [owner, "clarity.md"],
      expect.objectContaining({ shell: false, timeout: expect.any(Number), maxBuffer: expect.any(Number) }),
    );
  });

  it("refuses an absent asset without falling back to the owner file", () => {
    rmSync(asset);
    expect(() => readJudgeSource(owner, "clarity.md")).toThrow(/Judge source/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    ["a nonzero exit with output", 2, Buffer.from("Refused output")],
    ["invalid UTF-8", 0, Buffer.from([0xff])],
    ["oversized output", 0, Buffer.alloc(128 * 1024 + 1)],
  ])("refuses %s", (_label, status, stdout) => {
    reply(status, stdout);
    expect(() => readJudgeSource(owner, "clarity.md")).toThrow(/Judge source/);
    expect(spawnSync).toHaveBeenCalledOnce();
  });
});
