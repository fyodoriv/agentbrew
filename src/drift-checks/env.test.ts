import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(),
}));

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEnvHygiene } from "../core/env-sanitize.js";
import { checkEnvHygieneDrift, classifyEnvHygiene, findShellStartupExport } from "./env.js";

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

describe("classifyEnvHygiene (agent-session env, #348)", () => {
  const claudecode = [{ variable: "CLAUDECODE", value: "1" }];

  it("reports CLAUDECODE as a warning, not drift, inside an agent session", () => {
    mockedCheckEnvHygiene.mockReturnValue(claudecode);
    const result = classifyEnvHygiene({ isAgentSession: true, shellStartupExport: () => undefined });
    expect(result.drift).toEqual([]);
    expect(result.sessionWarnings).toHaveLength(1);
    expect(result.sessionWarnings[0].detail).toContain("CLAUDECODE");
  });

  it("reports CLAUDECODE as a warning when --ignore-session-env is passed", () => {
    mockedCheckEnvHygiene.mockReturnValue(claudecode);
    const result = classifyEnvHygiene({
      isAgentSession: false,
      ignoreSessionEnv: true,
      shellStartupExport: () => undefined,
    });
    expect(result.drift).toEqual([]);
    expect(result.sessionWarnings).toHaveLength(1);
  });

  it("keeps CLAUDECODE as drift when a shell startup file exports it", () => {
    mockedCheckEnvHygiene.mockReturnValue(claudecode);
    const result = classifyEnvHygiene({
      isAgentSession: true,
      ignoreSessionEnv: true,
      shellStartupExport: () => "~/.zshrc",
    });
    expect(result.sessionWarnings).toEqual([]);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0].detail).toContain("~/.zshrc");
  });

  it("keeps CLAUDECODE as drift outside an agent session without the flag", () => {
    mockedCheckEnvHygiene.mockReturnValue(claudecode);
    const result = classifyEnvHygiene({ isAgentSession: false, shellStartupExport: () => undefined });
    expect(result.drift).toHaveLength(1);
  });

  it("keeps non-session vars as drift inside an agent session", () => {
    mockedCheckEnvHygiene.mockReturnValue([{ variable: "ANTHROPIC_MODEL", value: "x" }]);
    const result = classifyEnvHygiene({ isAgentSession: true, shellStartupExport: () => undefined });
    expect(result.drift).toHaveLength(1);
    expect(result.sessionWarnings).toEqual([]);
  });
});

describe("findShellStartupExport", () => {
  it("finds an export line in a startup file and ignores comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-env-"));
    writeFileSync(join(dir, ".zshrc"), "# export CLAUDECODE=1\nexport PATH=/x\n");
    expect(findShellStartupExport("CLAUDECODE", dir)).toBeUndefined();
    writeFileSync(join(dir, ".zprofile"), "  export CLAUDECODE=1\n");
    expect(findShellStartupExport("CLAUDECODE", dir)).toContain(".zprofile");
  });
});
