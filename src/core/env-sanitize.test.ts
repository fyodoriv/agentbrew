import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkEnvHygiene,
  DEFAULT_SANITIZE_VARS,
  displayEnvCheck,
  displaySanitizeCommands,
  generateSanitizeCommands,
} from "./env-sanitize.js";

describe("DEFAULT_SANITIZE_VARS", () => {
  it("includes the critical model/API vars", () => {
    expect(DEFAULT_SANITIZE_VARS).toContain("ANTHROPIC_MODEL");
    expect(DEFAULT_SANITIZE_VARS).toContain("OPENAI_MODEL");
    expect(DEFAULT_SANITIZE_VARS).toContain("CLAUDE_MODEL");
    expect(DEFAULT_SANITIZE_VARS).toContain("CLAUDECODE");
  });

  it("includes API key vars that leak credentials", () => {
    expect(DEFAULT_SANITIZE_VARS).toContain("OPENAI_API_KEY");
    expect(DEFAULT_SANITIZE_VARS).toContain("ANTHROPIC_API_KEY");
  });

  it("includes backend routing vars", () => {
    expect(DEFAULT_SANITIZE_VARS).toContain("CLAUDE_CODE_USE_BEDROCK");
    expect(DEFAULT_SANITIZE_VARS).toContain("CLAUDE_CODE_USE_VERTEX");
  });
});

describe("checkEnvHygiene", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all sanitize vars
    for (const key of DEFAULT_SANITIZE_VARS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of DEFAULT_SANITIZE_VARS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns empty array when no dangerous vars are set", () => {
    const warnings = checkEnvHygiene();
    expect(warnings).toEqual([]);
  });

  it("detects a single set var", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-4-6-thinking";
    const warnings = checkEnvHygiene();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].variable).toBe("ANTHROPIC_MODEL");
    expect(warnings[0].value).toBe("claude-opus-4-6-thinking");
  });

  it("detects multiple set vars", () => {
    process.env.ANTHROPIC_MODEL = "test-model";
    process.env.OPENAI_MODEL = "gpt-4";
    const warnings = checkEnvHygiene();
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.variable)).toContain("ANTHROPIC_MODEL");
    expect(warnings.map((w) => w.variable)).toContain("OPENAI_MODEL");
  });

  it("ignores empty string values", () => {
    process.env.ANTHROPIC_MODEL = "";
    const warnings = checkEnvHygiene();
    expect(warnings).toEqual([]);
  });

  it("accepts a custom list of variables to check", () => {
    process.env.CUSTOM_VAR = "value";
    const warnings = checkEnvHygiene(["CUSTOM_VAR", "NONEXISTENT_VAR"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].variable).toBe("CUSTOM_VAR");
    delete process.env.CUSTOM_VAR;
  });
});

describe("generateSanitizeCommands", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of DEFAULT_SANITIZE_VARS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of DEFAULT_SANITIZE_VARS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns empty string when no vars are set", () => {
    expect(generateSanitizeCommands()).toBe("");
  });

  it("returns unset command for single set var", () => {
    process.env.ANTHROPIC_MODEL = "test";
    expect(generateSanitizeCommands()).toBe("unset ANTHROPIC_MODEL");
  });

  it("returns unset command for multiple set vars", () => {
    process.env.ANTHROPIC_MODEL = "test";
    process.env.CLAUDECODE = "1";
    const command = generateSanitizeCommands();
    expect(command).toContain("unset");
    expect(command).toContain("ANTHROPIC_MODEL");
    expect(command).toContain("CLAUDECODE");
  });

  it("accepts custom variable list", () => {
    process.env.MY_VAR = "val";
    expect(generateSanitizeCommands(["MY_VAR"])).toBe("unset MY_VAR");
    delete process.env.MY_VAR;
  });
});

describe("displayEnvCheck", () => {
  it("prints clean message for no warnings", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayEnvCheck([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No dangerous env vars"));
    spy.mockRestore();
  });

  it("prints warning details for each env var", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    displayEnvCheck([
      { variable: "ANTHROPIC_MODEL", value: "claude-opus-4-6-thinking" },
      { variable: "OPENAI_MODEL", value: "gpt-4" },
    ]);
    const logOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const errOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    const output = `${logOutput}\n${errOutput}`;
    expect(output).toContain("ANTHROPIC_MODEL");
    expect(output).toContain("OPENAI_MODEL");
    expect(output).toContain("2 env var(s)");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("truncates long values at 40 chars", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const longValue = "a".repeat(60);
    displayEnvCheck([{ variable: "TEST_VAR", value: longValue }]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("...");
    expect(output).not.toContain(longValue);
    spy.mockRestore();
  });
});

describe("displaySanitizeCommands", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of DEFAULT_SANITIZE_VARS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of DEFAULT_SANITIZE_VARS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("prints to stderr when no vars to unset", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    displaySanitizeCommands();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("No dangerous env vars"));
    spy.mockRestore();
  });

  it("prints unset command to stdout when vars are set", () => {
    process.env.ANTHROPIC_MODEL = "test";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    displaySanitizeCommands();
    expect(spy).toHaveBeenCalledWith("unset ANTHROPIC_MODEL");
    spy.mockRestore();
  });
});
