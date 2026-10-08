import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../drift-checks/hooks.js", () => ({
  checkHooksDrift: vi.fn(() => []),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(() => ({
    agents: [
      { name: "claude-code", detected: true },
      { name: "cursor", detected: true },
    ],
  })),
}));

import { checkHooksDrift } from "../drift-checks/hooks.js";
import { runHooksVerify } from "./verify-cli.js";

const mockCheckHooksDrift = vi.mocked(checkHooksDrift);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runHooksVerify", () => {
  it("returns 0 when no hook drift is reported", () => {
    expect(runHooksVerify()).toBe(0);
  });

  it("returns 1 and prints drift for cursor", () => {
    mockCheckHooksDrift.mockReturnValue([
      { agent: "cursor", type: "hooks", detail: "missing hook(s): preToolUse:Bash" },
    ]);
    expect(runHooksVerify({ agent: "cursor" })).toBe(1);
  });

  it("rejects unknown agents", () => {
    expect(runHooksVerify({ agent: "unknown-agent" })).toBe(1);
  });

  it("emits JSON when requested", () => {
    const log = vi.spyOn(console, "log");
    runHooksVerify({ json: true, agent: "cursor" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"cursor"'));
  });
});
