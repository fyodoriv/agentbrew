import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
  };
});

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
}));

vi.mock("../catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({ mcp_servers: [] })),
}));

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

vi.mock("./mcp-status.js", () => ({
  getSetupInstructions: vi.fn(() => ({})),
}));

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { ExitPromptError } from "@inquirer/core";
import { confirm, input } from "@inquirer/prompts";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import type { McpServerStatus } from "./mcp-status.js";
import { appendToShellConfig, setupServerEnvVars, setupSingleServer } from "./mcp-wizard.js";

const mockInput = vi.mocked(input);
const mockConfirm = vi.mocked(confirm);

function makeServer(overrides: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    name: "test-server",
    description: "A test server",
    category: "test",
    installed: true,
    requiredVars: ["TEST_TOKEN"],
    missingVars: ["TEST_TOKEN"],
    ready: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEST_TOKEN;
});

describe("setupServerEnvVars", () => {
  it("returns false and prints cancellation message when input() throws ExitPromptError (line 109-111)", async () => {
    mockInput.mockRejectedValueOnce(new ExitPromptError());

    const result = await setupServerEnvVars(makeServer());

    expect(result).toBe(false);
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
    expect(output).toContain("test-server");
  });

  it("invokes the validate callback passed to input() to cover line 103", async () => {
    // Capture the validate fn from the options passed to input() so we can invoke it directly.
    // Use `as never` to avoid fighting the inquirer InputConfig type (which requires a cancel method).
    type ValidateFn = (val: string) => boolean | string | Promise<boolean | string>;
    let capturedValidate: ValidateFn | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockInput.mockImplementationOnce((async (options: { validate?: ValidateFn }) => {
      capturedValidate = options.validate;
      return "my-token";
    }) as never);
    mockConfirm.mockResolvedValueOnce(false);

    await setupServerEnvVars(makeServer());

    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("hello")).toBe(true);
    expect(capturedValidate!("  ")).toBe("Value cannot be empty");
  });

  it("returns false and prints cancellation message when confirm() throws ExitPromptError (line 130-132)", async () => {
    mockInput.mockResolvedValueOnce("my-token");
    mockConfirm.mockRejectedValueOnce(new ExitPromptError());

    const result = await setupServerEnvVars(makeServer());

    expect(result).toBe(false);
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
    expect(output).toContain("test-server");
  });

  it("re-throws non-ExitPromptError errors from confirm() (line 134)", async () => {
    mockInput.mockResolvedValueOnce("my-token");
    const boom = new Error("unexpected confirm failure");
    mockConfirm.mockRejectedValueOnce(boom);

    await expect(setupServerEnvVars(makeServer())).rejects.toThrow("unexpected confirm failure");
  });
});

describe("setupSingleServer", () => {
  it("returns early with cancellation message when ExitPromptError propagates from setupServerEnvVars (lines 180-182)", async () => {
    // Server is installed with missing vars — calls setupServerEnvVars which calls input()
    // Throw ExitPromptError from outside the inner try/catch so it bubbles to the outer handler
    mockInput.mockResolvedValueOnce("my-token");
    const exitError = new ExitPromptError();
    // The confirm() throw bubbles out of setupServerEnvVars's catch only if it's NOT ExitPromptError there,
    // so instead we throw ExitPromptError from setupServerEnvVars' confirm catch, which returns false,
    // but to trigger the OUTER catch in setupSingleServer we need a path that throws ExitPromptError at the top level.
    // setupSingleServer calls confirm() itself when server is not installed.
    mockConfirm.mockRejectedValueOnce(exitError);

    await setupSingleServer(makeServer({ installed: false }));

    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("cancelled");
  });

  it("returns early without calling env setup when server has no missing vars", async () => {
    const server = makeServer({ missingVars: [] });

    await setupSingleServer(server);

    expect(mockInput).not.toHaveBeenCalled();
    const output = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(output).toContain("fully configured");
  });
});

describe("appendToShellConfig", () => {
  it("warns and prints manual instruction when write fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    appendToShellConfig("MY_KEY", "my-value");

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Could not write"));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("MY_KEY"));
  });

  it("appends to shell config on success", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(writeFileAtomicSync).mockReturnValue(undefined);

    appendToShellConfig("MY_KEY", "my-value");

    expect(writeFileAtomicSync).toHaveBeenCalled();
  });

  it("escapes shell-special characters in values", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(writeFileAtomicSync).mockReturnValue(undefined);

    appendToShellConfig("MY_KEY", 'value"with$pecial`chars\\');

    const writtenContent = vi.mocked(writeFileAtomicSync).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('\\"');
    expect(writtenContent).toContain("\\$");
    expect(writtenContent).toContain("\\`");
    expect(writtenContent).toContain("\\\\");
    expect(writtenContent).not.toContain('value"with');
  });

  it("updates existing var with escaped regex in varName", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('export MY.KEY="old-value"\n');
    vi.mocked(writeFileAtomicSync).mockReturnValue(undefined);

    appendToShellConfig("MY.KEY", "new-value");

    const writtenContent = vi.mocked(writeFileAtomicSync).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain("new-value");
    expect(writtenContent).not.toContain("old-value");
  });
});

describe("setupLink rendering — setupServerEnvVars", () => {
  it("prints a Setup guide line with a clickable URL when setupLink is present", async () => {
    mockInput.mockResolvedValue("xoxb-abc123");
    mockConfirm.mockResolvedValue(false); // skip saving to avoid side effects

    const server = makeServer({
      name: "slack-work",
      setupLink: "https://docs.google.com/document/d/example/edit",
    });

    await setupServerEnvVars(server);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(output).toContain("Setup guide:");
    expect(output).toContain("https://docs.google.com/document/d/example/edit");
  });

  it("omits the Setup guide line when setupLink is undefined", async () => {
    mockInput.mockResolvedValue("xoxb-abc123");
    mockConfirm.mockResolvedValue(false);

    const server = makeServer({ name: "generic-server" });

    await setupServerEnvVars(server);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(output).not.toContain("Setup guide:");
  });
});

describe("setupLink rendering — setupSingleServer", () => {
  it("prints the Setup guide line in the single-server flow when installed and setupLink is set", async () => {
    mockInput.mockResolvedValue("xoxb-abc123");
    mockConfirm.mockResolvedValue(false);

    const server = makeServer({
      name: "slack-work",
      installed: true,
      setupLink: "https://docs.google.com/document/d/example/edit",
    });

    await setupSingleServer(server);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(output).toContain("Setup guide:");
    expect(output).toContain("https://docs.google.com/document/d/example/edit");
  });

  it("renders the Setup guide link alongside the note when both are present", async () => {
    mockInput.mockResolvedValue("xoxb-abc123");
    mockConfirm.mockResolvedValue(false);

    const server = makeServer({
      name: "slack-work",
      installed: true,
      note: "Approval required for Prod via ServiceNow.",
      setupLink: "https://docs.google.com/document/d/example/edit",
    });

    await setupSingleServer(server);

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(output).toContain("Approval required");
    expect(output).toContain("Setup guide:");
    expect(output).toContain("https://docs.google.com/document/d/example/edit");
  });
});
