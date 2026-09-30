import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(),
}));

import { checkEnvHygiene } from "../core/env-sanitize.js";
import { checkEnvHygieneDrift } from "./env.js";

const mockedCheckEnvHygiene = vi.mocked(checkEnvHygiene);

describe("checkEnvHygieneDrift", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no env warnings exist", () => {
    mockedCheckEnvHygiene.mockReturnValue([]);
    const result = checkEnvHygieneDrift();
    expect(result).toEqual([]);
  });

  it("maps each env warning to a DriftItem with agent=shell", () => {
    mockedCheckEnvHygiene.mockReturnValue([
      { variable: "ANTHROPIC_MODEL", value: "claude-3" },
      { variable: "OPENAI_API_KEY", value: "sk-test" },
    ]);
    const result = checkEnvHygieneDrift();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      agent: "shell",
      type: "env-hygiene",
      detail: "ANTHROPIC_MODEL is set — may leak into child agent sessions. Run: eval $(agentbrew env sanitize)",
    });
    expect(result[1]).toEqual({
      agent: "shell",
      type: "env-hygiene",
      detail: "OPENAI_API_KEY is set — may leak into child agent sessions. Run: eval $(agentbrew env sanitize)",
    });
  });

  it("includes the variable name in the detail message", () => {
    mockedCheckEnvHygiene.mockReturnValue([{ variable: "CLAUDE_CODE_USE_BEDROCK", value: "1" }]);
    const [item] = checkEnvHygieneDrift();
    expect(item.detail).toContain("CLAUDE_CODE_USE_BEDROCK");
    expect(item.detail).toContain("eval $(agentbrew env sanitize)");
  });
});
