/** status Config line matches agentbrew lint (measure-quiet-lint-counts). */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lint.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lint.js")>()),
  silentLintCounts: vi.fn().mockReturnValue({ errors: 0, warnings: 0 }),
  validateConfig: vi.fn().mockReturnValue({ errors: 0, warnings: 0, details: [] }),
}));

import * as lintModule from "./lint.js";
import { printCompactConfigLine } from "./status.js";

function configLine(): string {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  printCompactConfigLine();
  const line = log.mock.calls.map((c) => String(c[0])).join("\n");
  log.mockRestore();
  return line;
}

describe("status Config line", () => {
  afterEach(() => {
    vi.mocked(lintModule.silentLintCounts).mockReturnValue({ errors: 0, warnings: 0 });
  });

  it("reports a lint error that validateConfig does not see", () => {
    vi.mocked(lintModule.silentLintCounts).mockReturnValue({ errors: 1, warnings: 0 });
    expect(configLine()).toMatch(/1 error\(s\)/);
  });

  it("reports warnings next to valid", () => {
    vi.mocked(lintModule.silentLintCounts).mockReturnValue({ errors: 0, warnings: 12 });
    const line = configLine();
    expect(line).toMatch(/valid/);
    expect(line).toMatch(/12 warning\(s\)/);
  });

  it("says valid when lint is clean", () => {
    expect(configLine()).toMatch(/valid/);
    expect(configLine()).not.toMatch(/warning|error/);
  });
});
