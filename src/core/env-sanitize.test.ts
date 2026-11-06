import { stripVTControlCharacters } from "node:util";
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

  const privacyCases = [
    ["C01", "ANTHROPIC_MODEL", true],
    ["C02", "OPENAI_MODEL", true],
    ["C03", "CLAUDE_MODEL", true],
    ["C04", "CLAUDECODE", false],
    ["C05", "CLAUDE_CODE_USE_BEDROCK", true],
    ["C06", "CLAUDE_CODE_USE_VERTEX", true],
    ["C07", "OPENAI_API_KEY", false],
    ["C08", "ANTHROPIC_API_KEY", true],
    ["C09", "CUSTOM_PRIVACY_VAR", true],
  ] as const;

  it("keeps the sealed default variable identities", () => {
    expect(DEFAULT_SANITIZE_VARS).toEqual(privacyCases.slice(0, 8).map(([, variable]) => variable));
  });

  it.each(privacyCases)("%s displays only the identity of %s", (id, variable, long) => {
    const marker = `SYNTHETIC_VALUE_${id}_`;
    const value = marker + (long ? "Z".repeat(64) : "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      displayEnvCheck([{ variable, value }]);
      const line = stripVTControlCharacters(String(logSpy.mock.calls[0][0]));
      const output = stripVTControlCharacters([...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n"));
      expect.soft(line).toBe(`  ${variable} is set`);
      expect.soft(line.split(variable)).toHaveLength(2);
      expect.soft(output).not.toContain(value);
      expect.soft(output).not.toContain(marker);
      expect.soft(output).not.toContain("SYNTHETIC_");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("does not read a warning value while displaying its identity", () => {
    let valueReads = 0;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      displayEnvCheck([
        {
          variable: "CUSTOM_PRIVACY_VAR",
          get value() {
            valueReads += 1;
            return "SYNTHETIC_VALUE_GETTER_";
          },
        },
      ]);
      expect.soft(valueReads).toBe(0);
      expect(stripVTControlCharacters(String(logSpy.mock.calls[0][0]))).toBe("  CUSTOM_PRIVACY_VAR is set");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("keeps custom helper selection, internal values and unset output", () => {
    const variable = "CUSTOM_PRIVACY_VAR";
    const value = `SYNTHETIC_VALUE_C09_${"Z".repeat(64)}`;
    process.env[variable] = value;
    try {
      const warnings = checkEnvHygiene([variable]);
      expect(warnings).toEqual([{ variable, value }]);
      expect(generateSanitizeCommands([variable])).toBe("unset CUSTOM_PRIVACY_VAR");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        displayEnvCheck(warnings);
        expect(stripVTControlCharacters(String(logSpy.mock.calls[0][0]))).toBe("  CUSTOM_PRIVACY_VAR is set");
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    } finally {
      delete process.env[variable];
    }
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
