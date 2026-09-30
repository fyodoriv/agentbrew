import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationSummary } from "./validate.js";

vi.mock("chalk", () => {
  const passthrough = (s: string) => s;
  const chalk: Record<string, unknown> = {
    red: passthrough,
    yellow: passthrough,
    green: passthrough,
    cyan: passthrough,
    dim: passthrough,
    blue: passthrough,
    white: passthrough,
    bold: passthrough,
  };
  return { default: chalk };
});

import { showValidationResults } from "./skill-validate-display.js";

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("showValidationResults", () => {
  it("shows header with total skill count", () => {
    const summary: ValidationSummary = { total: 3, valid: 3, withErrors: 0, withWarnings: 0, results: [] };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("Validating 3 skills"))).toBe(true);
  });

  it("shows all-valid summary when no errors or warnings", () => {
    const summary: ValidationSummary = { total: 2, valid: 2, withErrors: 0, withWarnings: 0, results: [] };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("All 2 skills valid"))).toBe(true);
  });

  it("shows error count in summary", () => {
    const summary: ValidationSummary = {
      total: 3,
      valid: 1,
      withErrors: 2,
      withWarnings: 0,
      results: [],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("1/3 valid") && l.includes("2 with errors"))).toBe(true);
  });

  it("shows warning count in summary", () => {
    const summary: ValidationSummary = {
      total: 5,
      valid: 3,
      withErrors: 0,
      withWarnings: 2,
      results: [],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("3/5 valid") && l.includes("2 with warnings"))).toBe(true);
  });

  it("shows both error and warning counts in summary", () => {
    const summary: ValidationSummary = {
      total: 10,
      valid: 6,
      withErrors: 2,
      withWarnings: 2,
      results: [],
    };
    showValidationResults(summary, false);
    expect(
      logs.some((l) => l.includes("6/10 valid") && l.includes("2 with errors") && l.includes("2 with warnings")),
    ).toBe(true);
  });

  it("shows skill result with errors", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "my-skill",
          directory: "/tmp/my-skill",
          sourceLabel: "test-source",
          valid: false,
          issues: [{ severity: "error", message: "Missing description", field: "description" }],
        },
      ],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("my-skill") && l.includes("1 error"))).toBe(true);
    expect(logs.some((l) => l.includes("[description]") && l.includes("Missing description"))).toBe(true);
  });

  it("shows skill result with warnings", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      withErrors: 0,
      withWarnings: 1,
      results: [
        {
          name: "warn-skill",
          directory: "/tmp/warn-skill",
          sourceLabel: "test",
          valid: true,
          issues: [{ severity: "warning", message: "Name too short" }],
        },
      ],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("warn-skill") && l.includes("1 warning"))).toBe(true);
    expect(logs.some((l) => l.includes("Name too short"))).toBe(true);
  });

  it("pluralizes error/warning counts correctly", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "multi-err",
          directory: "/tmp",
          sourceLabel: "s",
          valid: false,
          issues: [
            { severity: "error", message: "err1" },
            { severity: "error", message: "err2" },
            { severity: "warning", message: "warn1" },
            { severity: "warning", message: "warn2" },
            { severity: "warning", message: "warn3" },
          ],
        },
      ],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("2 errors"))).toBe(true);
    expect(logs.some((l) => l.includes("3 warnings"))).toBe(true);
  });

  it("hides info issues in non-verbose mode", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 1,
      withErrors: 0,
      withWarnings: 0,
      results: [
        {
          name: "info-skill",
          directory: "/tmp",
          sourceLabel: "s",
          valid: true,
          issues: [{ severity: "info", message: "Optional field missing" }],
        },
      ],
    };
    showValidationResults(summary, false);
    expect(logs.every((l) => !l.includes("Optional field missing"))).toBe(true);
  });

  it("shows info issues in verbose mode", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 1,
      withErrors: 0,
      withWarnings: 0,
      results: [
        {
          name: "info-skill",
          directory: "/tmp",
          sourceLabel: "s",
          valid: true,
          issues: [{ severity: "info", message: "Optional field missing" }],
        },
      ],
    };
    showValidationResults(summary, true);
    expect(logs.some((l) => l.includes("Optional field missing"))).toBe(true);
  });

  it("shows clean skills in verbose mode", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 1,
      withErrors: 0,
      withWarnings: 0,
      results: [
        {
          name: "clean-skill",
          directory: "/tmp",
          sourceLabel: "my-source",
          valid: true,
          issues: [],
        },
      ],
    };
    showValidationResults(summary, true);
    expect(logs.some((l) => l.includes("clean-skill") && l.includes("my-source"))).toBe(true);
  });

  it("hides clean skills in non-verbose mode", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 1,
      withErrors: 0,
      withWarnings: 0,
      results: [
        {
          name: "clean-skill",
          directory: "/tmp",
          sourceLabel: "my-source",
          valid: true,
          issues: [],
        },
      ],
    };
    showValidationResults(summary, false);
    // Only header + summary, no per-skill line
    expect(logs.every((l) => !l.includes("clean-skill"))).toBe(true);
  });

  it("shows source label in parentheses", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "labeled",
          directory: "/tmp",
          sourceLabel: "catalog-v2",
          valid: false,
          issues: [{ severity: "error", message: "bad" }],
        },
      ],
    };
    showValidationResults(summary, false);
    expect(logs.some((l) => l.includes("(catalog-v2)"))).toBe(true);
  });

  it("omits field bracket when issue has no field", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      withErrors: 1,
      withWarnings: 0,
      results: [
        {
          name: "no-field",
          directory: "/tmp",
          sourceLabel: "s",
          valid: false,
          issues: [{ severity: "error", message: "General error" }],
        },
      ],
    };
    showValidationResults(summary, false);
    const issueLine = logs.find((l) => l.includes("General error"));
    expect(issueLine).toBeDefined();
    expect(issueLine).not.toContain("[");
  });
});
