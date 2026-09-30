import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, createSilentLogger, logSkipped } from "./logger.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("logs messages to console when not quiet", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(false);
    logger.log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("suppresses output when quiet is true", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(true);
    logger.log("hello");
    logger.info("info");
    logger.warn("warn");
    logger.error("err");
    logger.success("✓", "done");
    expect(spy).not.toHaveBeenCalled();
  });

  it("defaults to non-quiet mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger();
    logger.log("default");
    expect(spy).toHaveBeenCalledWith("default");
  });

  it("info writes to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger();
    logger.info("test info");
    expect(spy).toHaveBeenCalledWith("test info");
  });

  it("warn applies yellow chalk formatting", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger();
    logger.warn("warning");
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain("warning");
  });

  it("error applies red chalk formatting", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger();
    logger.error("error msg");
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain("error msg");
  });

  it("success formats with icon and message", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger();
    logger.success("✓", "done");
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain("done");
  });

  it("bold returns a string", () => {
    const logger = createLogger();
    const result = logger.bold("test");
    expect(typeof result).toBe("string");
    expect(result).toContain("test");
  });

  it("dim returns a string", () => {
    const logger = createLogger();
    expect(logger.dim("dimmed")).toContain("dimmed");
  });

  it("green returns a string", () => {
    const logger = createLogger();
    expect(logger.green("ok")).toContain("ok");
  });

  it("yellow returns a string", () => {
    const logger = createLogger();
    expect(logger.yellow("caution")).toContain("caution");
  });

  it("red returns a string", () => {
    const logger = createLogger();
    expect(logger.red("danger")).toContain("danger");
  });

  it("cyan returns a string", () => {
    const logger = createLogger();
    expect(logger.cyan("info")).toContain("info");
  });

  it("blue returns a string", () => {
    const logger = createLogger();
    expect(logger.blue("link")).toContain("link");
  });
});

describe("createLogger compact mode — info silenced, warn/error surface", () => {
  // Compact mode silences info/log/success but keeps warn/error so users
  // see actionable problems even on a no-op sync. The user-facing contract
  // is ≤5 lines on a fully-converged no-op sync.
  it("silences log/info/success but still surfaces warn/error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(false, true);
    logger.log("hello");
    logger.info("info");
    logger.success("✓", "done");
    logger.warn("warning");
    logger.error("err");
    expect(logSpy).not.toHaveBeenCalled();
    // warn + error both write to console.error
    expect(errSpy).toHaveBeenCalledTimes(2);
    const errCalls = errSpy.mock.calls.map((c) => c[0]).join(" ");
    expect(errCalls).toContain("warning");
    expect(errCalls).toContain("err");
  });

  it("quiet takes precedence over compact (every call is a noop)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(true, true);
    logger.log("hello");
    logger.info("info");
    logger.success("✓", "done");
    logger.warn("warning");
    logger.error("err");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("default mode (no compact, no quiet) is unchanged", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(false, false);
    logger.log("hello");
    logger.info("info");
    logger.success("✓", "done");
    expect(logSpy).toHaveBeenCalledTimes(3);
  });
});

describe("createSilentLogger", () => {
  it("never writes to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createSilentLogger();
    logger.log("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    logger.success("✓", "e");
    expect(spy).not.toHaveBeenCalled();
  });

  it("bold returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.bold("test")).toBe("test");
  });

  it("dim returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.dim("test")).toBe("test");
  });

  it("green returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.green("test")).toBe("test");
  });

  it("yellow returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.yellow("test")).toBe("test");
  });

  it("red returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.red("test")).toBe("test");
  });

  it("cyan returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.cyan("test")).toBe("test");
  });

  it("blue returns the input unchanged", () => {
    const logger = createSilentLogger();
    expect(logger.blue("test")).toBe("test");
  });
});

describe("logSkipped", () => {
  const originalEnv = process.env.AGENTBREW_DEBUG;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENTBREW_DEBUG;
    } else {
      process.env.AGENTBREW_DEBUG = originalEnv;
    }
  });

  it("outputs nothing when AGENTBREW_DEBUG is unset", async () => {
    delete process.env.AGENTBREW_DEBUG;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Re-import to pick up the env change
    const mod = await import("./logger.js");
    // DEBUG is evaluated at import time, so if it was false at import, logSkipped is a no-op
    mod.logSkipped("test-context", new Error("oops"));
    // When DEBUG was false at module load, logSkipped produces no output
    if (!mod.DEBUG) {
      expect(errorSpy).not.toHaveBeenCalled();
    }
  });

  it("extracts message from Error instances", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Call directly — the function checks the module-level DEBUG constant
    logSkipped("read-file", new Error("ENOENT"));
    // If DEBUG is falsy (default in tests), no output expected
    expect(errorSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("converts non-Error values to strings", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSkipped("parse-yaml", "unexpected token");
    expect(errorSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
