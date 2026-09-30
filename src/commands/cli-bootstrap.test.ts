import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bootstrap.js", () => ({
  bootstrapSource: vi.fn(),
}));

import { bootstrapSource } from "../bootstrap.js";
import { registerBootstrapCommand } from "./cli-bootstrap.js";
import { buildTestProgram } from "./test-program.js";

const mockBootstrapSource = vi.mocked(bootstrapSource);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerBootstrapCommand", () => {
  it("runs bootstrap for the requested source", async () => {
    const program = buildTestProgram(registerBootstrapCommand);

    await program.parseAsync(["node", "test", "bootstrap", "owner/repo"]);

    expect(mockBootstrapSource).toHaveBeenCalledWith("owner/repo", { dryRun: undefined });
  });

  it("passes --dry-run through", async () => {
    const program = buildTestProgram(registerBootstrapCommand);

    await program.parseAsync(["node", "test", "bootstrap", "repo", "--dry-run"]);

    expect(mockBootstrapSource).toHaveBeenCalledWith("repo", { dryRun: true });
  });
});
