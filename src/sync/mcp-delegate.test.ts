import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  delegateMcpClientEdit,
  delegateMcpInstall,
  delegateMcpNew,
  delegateMcpUninstall,
  listMcpmServerNames,
  mcpServerConfigEquals,
  readMcpmServer,
} from "./mcp-delegate.js";

/**
 * These tests exercise the subprocess wrapper via fake `mcpm` scripts
 * and the real binary when it's on PATH. The helper is a thin wrapper
 * so a real / near-real subprocess is the cheapest way to assert the
 * contract. The `AGENTBREW_MCPM_BIN` env override lets tests point at
 * a fake script without mocking child_process.
 */

const hasMcpm = (() => {
  try {
    execFileSync("mcpm", ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
})();

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-mcp-delegate-test-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AGENTBREW_MCPM_BIN;
  rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("delegateMcpInstall — input validation", () => {
  it("runs mcpm install for resolution even when every agent is a carve-out (slice 4c)", () => {
    // Slice 4c removed the all-carve-out short-circuit: the
    // installFromRegistry caller now uses mcpm install for registry
    // resolution, so the subprocess must run regardless of detected
    // agents. Carve-outs are reported informationally — the caller
    // routes them through the native sync path.
    const fakeBin = join(testRoot, "fake-mcpm.sh");
    writeFileSync(fakeBin, "#!/bin/bash\nexit 0\n", { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpInstall({
      serverName: "time",
      agents: ["copilot", "opencode", "kiro", "amp"],
    });
    expect(result.ok).toBe(true);
    expect(result.carveOuts).toEqual(expect.arrayContaining(["copilot", "opencode", "kiro", "amp"]));
  });
});

describe("delegateMcpInstall — subprocess failure", () => {
  it("returns ok=false and does not throw when the binary is missing", () => {
    process.env.AGENTBREW_MCPM_BIN = "/nonexistent/path/to/mcpm-bin-that-does-not-exist";
    const result = delegateMcpInstall({
      serverName: "time",
      agents: ["claude-code"],
    });
    expect(result.ok).toBe(false);
    expect(result.carveOuts).toEqual([]);
  });

  it("returns ok=false when the binary exits non-zero", () => {
    process.env.AGENTBREW_MCPM_BIN = "/usr/bin/false";
    const result = delegateMcpInstall({
      serverName: "time",
      agents: ["claude-code"],
    });
    expect(result.ok).toBe(false);
    expect(result.carveOuts).toEqual([]);
  });

  it("captures stdout/stderr from a failing subprocess for debugging", () => {
    // Fake binary that writes to stderr then exits 1.
    const fakeBin = join(testRoot, "fake-failing-mcpm.sh");
    writeFileSync(fakeBin, "#!/bin/bash\necho 'mcpm stdout line' >&1\necho 'mcpm stderr line' >&2\nexit 2\n", {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpInstall({ serverName: "time", agents: ["claude-code"] });
    expect(result.ok).toBe(false);
    expect(result.stdout ?? "").toContain("mcpm stdout line");
    expect(result.stderr ?? "").toContain("mcpm stderr line");
  });
});

describe("delegateMcpInstall — fake binary success", () => {
  it("returns ok=true with captured stdout on a clean subprocess exit", () => {
    const fakeBin = join(testRoot, "fake-success-mcpm.sh");
    writeFileSync(
      fakeBin,
      '#!/bin/bash\necho "Installing server \'$2\' to global configuration..."\necho "Successfully installed $2."\nexit 0\n',
      { encoding: "utf-8", mode: 0o755 },
    );
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpInstall({ serverName: "time", agents: ["claude-code"] });
    expect(result.ok).toBe(true);
    expect(result.stdout ?? "").toContain("Installing server 'time'");
    expect(result.carveOuts).toEqual([]);
  });

  it("reports carve-outs alongside a successful install for a mixed agent list", () => {
    const fakeBin = join(testRoot, "fake-success-mcpm.sh");
    writeFileSync(fakeBin, "#!/bin/bash\necho 'ok'\nexit 0\n", { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpInstall({
      serverName: "time",
      agents: ["claude-code", "copilot"],
    });
    expect(result.ok).toBe(true);
    expect(result.carveOuts).toEqual(["copilot"]);
  });
});

describe.skipIf(!hasMcpm)("delegateMcpInstall — real mcpm binary smoke", () => {
  it("does not throw when invoked with a known registry server for the canary", () => {
    // Real mcpm installs from its own registry. `time` is a well-known
    // mcpm registry server. The test asserts the helper completes
    // without throwing; `ok` may be true or false depending on mcpm's
    // current registry state and network availability.
    const result = delegateMcpInstall({ serverName: "time", agents: ["claude-code"] });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.carveOuts)).toBe(true);
  }, 65_000);
});

describe("delegateMcpClientEdit — input validation", () => {
  it("returns ok=false and empty perClient without invoking the subprocess when every agent is a carve-out", () => {
    // Symmetric with delegateMcpInstall — when every detected client
    // is a carve-out (copilot, kiro, etc.), mcpm has nothing
    // to edit. Short-circuits before any subprocess.
    const result = delegateMcpClientEdit({
      serverName: "time",
      agents: ["copilot", "opencode", "kiro", "amp"],
    });
    expect(result.ok).toBe(false);
    expect(result.perClient).toEqual([]);
    expect(result.carveOuts).toEqual(expect.arrayContaining(["copilot", "opencode", "kiro", "amp"]));
  });
});

describe("delegateMcpClientEdit — subprocess behavior", () => {
  it("reports ok=false per-client when the binary is missing but does not throw", () => {
    process.env.AGENTBREW_MCPM_BIN = "/nonexistent/path/to/mcpm-bin-that-does-not-exist";
    const result = delegateMcpClientEdit({
      serverName: "time",
      agents: ["claude-code"],
    });
    expect(result.ok).toBe(false);
    expect(result.carveOuts).toEqual([]);
    expect(result.perClient).toHaveLength(1);
    expect(result.perClient[0]).toMatchObject({ client: "claude-code", ok: false });
  });

  it("iterates across every intersection client when mixed with carve-outs", () => {
    // Fake binary records every invocation into a log file so we can
    // assert each intersection client got its own subprocess call.
    const logFile = join(testRoot, "client-edit.log");
    const fakeBin = join(testRoot, "fake-client-edit-mcpm.sh");
    writeFileSync(fakeBin, `#!/bin/bash\necho "$@" >> "${logFile}"\necho "Added '$5' to client '$3'"\nexit 0\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    // Mix of intersection (claude-code, cline, codex → codex-cli
    // rename) and carve-outs (copilot, amp, cursor). The helper must iterate
    // across only the intersection subset with name-translated forms.
    const result = delegateMcpClientEdit({
      serverName: "time",
      agents: ["claude-code", "cline", "codex", "copilot", "amp", "cursor"],
    });
    expect(result.ok).toBe(true);
    expect(result.carveOuts).toEqual(["copilot", "amp", "cursor"]);
    expect(result.perClient.map((r) => r.client)).toEqual(["claude-code", "cline", "codex-cli"]);
    expect(result.perClient.every((r) => r.ok)).toBe(true);
    // Every invocation goes to the log — one line per client with the
    // exact argv mcpm received. Confirms --add-server + --force shape.
    const logContents = readFileSync(logFile, "utf-8");
    expect(logContents).toContain("client edit claude-code --add-server time --force");
    expect(logContents).toContain("client edit cline --add-server time --force");
    expect(logContents).toContain("client edit codex-cli --add-server time --force");
    // Carve-outs never reach the subprocess.
    expect(logContents).not.toContain("copilot");
    expect(logContents).not.toContain("amp");
  });

  it("isolates per-client failures so one bad client doesn't abort the loop", () => {
    // Fake binary that fails for `cline` but succeeds for the rest.
    // The loop must record the failure without throwing and still
    // invoke the subsequent clients.
    const fakeBin = join(testRoot, "fake-partial-fail-mcpm.sh");
    writeFileSync(
      fakeBin,
      `${[
        "#!/bin/bash",
        'if [ "$3" = "cline" ]; then',
        '  echo "config file missing for cline" >&2',
        "  exit 3",
        "fi",
        'echo "ok for $3"',
        "exit 0",
      ].join("\n")}\n`,
      { encoding: "utf-8", mode: 0o755 },
    );
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpClientEdit({
      serverName: "time",
      agents: ["claude-code", "cline", "gemini-cli"],
    });
    // Overall ok is false because at least one client failed.
    expect(result.ok).toBe(false);
    expect(result.perClient).toHaveLength(3);
    const byClient = Object.fromEntries(result.perClient.map((r) => [r.client, r]));
    expect(byClient["claude-code"].ok).toBe(true);
    expect(byClient.cline.ok).toBe(false);
    expect(byClient.cline.stderr ?? "").toContain("config file missing");
    expect(byClient["gemini-cli"].ok).toBe(true);
  });
});

describe.skipIf(!hasMcpm)("delegateMcpClientEdit — real mcpm binary smoke", () => {
  it("does not throw when invoked with a known client for the canary", () => {
    // The real mcpm binary will likely exit non-zero here because the
    // server `time` may not be in mcpm's global config on the test
    // machine, or the client config might be missing. The test only
    // asserts the helper completes without throwing — matching the
    // `delegateMcpInstall` smoke test's shape.
    const result = delegateMcpClientEdit({ serverName: "time", agents: ["claude-code"] });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.carveOuts)).toBe(true);
    expect(Array.isArray(result.perClient)).toBe(true);
  });
});

// `bridge-mcp-sync-to-mcpm-for-intersection` slice 1: `delegateMcpUninstall`
// is the symmetric mirror of `delegateMcpClientEdit` on the remove side.
// It runs `mcpm client edit <client> --remove-server <name>` per
// intersection client + `mcpm uninstall <name> --force` for global cleanup.

describe("delegateMcpUninstall — input validation", () => {
  it("returns ok=false with carve-outs reported when every agent is a carve-out", () => {
    const result = delegateMcpUninstall({
      serverName: "time",
      agents: ["kiro", "copilot"],
    });
    expect(result.ok).toBe(false);
    expect(result.carveOuts).toEqual(expect.arrayContaining(["kiro", "copilot"]));
    expect(result.perClient).toEqual([]);
    expect(result.globalUninstall.ok).toBe(false);
  });

  it("rejects wildcard agent lists at the helper boundary", () => {
    // Symmetry with `delegateMcpInstall` and `delegateMcpClientEdit`. A
    // future wildcard caller would have to opt in via a separate code path.
    const result = delegateMcpUninstall({ serverName: "time", agents: ["*"] });
    expect(result.ok).toBe(false);
    expect(result.perClient).toEqual([]);
  });
});

describe("delegateMcpUninstall — subprocess behavior", () => {
  it("runs mcpm client edit --remove-server per intersection client + mcpm uninstall once", () => {
    // Fake binary that records each invocation to a file so the test can
    // assert exact argv ordering. The helper makes one subprocess call
    // per client (slice 3b shape) plus one global uninstall.
    const callLog = join(testRoot, "calls.log");
    writeFileSync(callLog, "");
    const fakeBin = join(testRoot, "fake-mcpm-record.sh");
    writeFileSync(fakeBin, `#!/bin/bash\necho "$@" >> "${callLog}"\nexit 0\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpUninstall({
      serverName: "time",
      agents: ["claude-code", "cline"],
    });

    expect(result.ok).toBe(true);
    expect(result.perClient).toHaveLength(2);
    expect(result.perClient[0].client).toBe("claude-code");
    expect(result.perClient[1].client).toBe("cline");
    expect(result.globalUninstall.ok).toBe(true);

    const calls = readFileSync(callLog, "utf-8").trim().split("\n");
    // Two client edits + one global uninstall = three calls.
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("client edit claude-code --remove-server time --force");
    expect(calls[1]).toBe("client edit cline --remove-server time --force");
    expect(calls[2]).toBe("uninstall time --force");
  });

  it("returns ok=false when the binary is missing (ENOENT graceful fallback)", () => {
    process.env.AGENTBREW_MCPM_BIN = "/nonexistent/path/to/mcpm-bin-that-does-not-exist";
    const result = delegateMcpUninstall({
      serverName: "time",
      agents: ["claude-code"],
    });
    expect(result.ok).toBe(false);
    // Per-client failures still surface in the array — the loop ran.
    expect(result.perClient).toHaveLength(1);
    expect(result.perClient[0].ok).toBe(false);
    expect(result.globalUninstall.ok).toBe(false);
  });

  it("isolates per-client failures so other clients still get processed", () => {
    // Fake binary that exits non-zero only when the second arg is `cline`.
    // Other clients and the global uninstall succeed.
    const fakeBin = join(testRoot, "fake-mcpm-cline-fails.sh");
    writeFileSync(
      fakeBin,
      `#!/bin/bash\nif [ "$3" = "cline" ]; then\n  echo "config file missing" >&2\n  exit 1\nfi\nexit 0\n`,
      { encoding: "utf-8", mode: 0o755 },
    );
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpUninstall({
      serverName: "time",
      agents: ["claude-code", "cline", "gemini-cli"],
    });

    // Overall ok is false because at least one client failed.
    expect(result.ok).toBe(false);
    expect(result.perClient).toHaveLength(3);
    const byClient = Object.fromEntries(result.perClient.map((r) => [r.client, r]));
    expect(byClient["claude-code"].ok).toBe(true);
    expect(byClient.cline.ok).toBe(false);
    expect(byClient.cline.stderr ?? "").toContain("config file missing");
    expect(byClient["gemini-cli"].ok).toBe(true);
    // Global uninstall ran (3rd arg was the server name "time", not "cline").
    expect(result.globalUninstall.ok).toBe(true);
  });

  it("runs global uninstall even when per-client steps failed", () => {
    // Fake binary that fails per-client edits but succeeds for `uninstall`.
    const fakeBin = join(testRoot, "fake-mcpm-edits-fail.sh");
    writeFileSync(fakeBin, `#!/bin/bash\nif [ "$1" = "uninstall" ]; then\n  exit 0\nfi\nexit 1\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpUninstall({
      serverName: "time",
      agents: ["claude-code"],
    });

    expect(result.ok).toBe(false);
    expect(result.perClient[0].ok).toBe(false);
    // Global uninstall ran independently and succeeded.
    expect(result.globalUninstall.ok).toBe(true);
  });
});

// `bridge-mcp-sync-to-mcpm-for-intersection` slice 3: `delegateMcpNew` is
// the missing piece for `agentbrew mcp add <custom>` — runs `mcpm new`
// non-interactively to register a user-defined server with mcpm.

describe("delegateMcpNew — argv construction", () => {
  it("builds the stdio argv with command + args + env", () => {
    // Fake binary that records the exact argv to a file so the test
    // can assert `mcpm new --type stdio` was invoked correctly.
    const callLog = join(testRoot, "calls.log");
    writeFileSync(callLog, "");
    const fakeBin = join(testRoot, "fake-mcpm-record-new.sh");
    writeFileSync(fakeBin, `#!/bin/bash\necho "$@" >> "${callLog}"\nexit 0\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpNew({
      serverName: "my-srv",
      command: "node",
      args: ["./srv.js", "--port", "3000"],
      env: { LOG_LEVEL: "debug", PORT: "3000" },
    });

    expect(result.ok).toBe(true);
    const calls = readFileSync(callLog, "utf-8").trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(
      "new my-srv --force --type stdio --command node --args ./srv.js --port 3000 --env LOG_LEVEL=debug,PORT=3000",
    );
  });

  it("builds the remote argv with url + headers", () => {
    const callLog = join(testRoot, "calls.log");
    writeFileSync(callLog, "");
    const fakeBin = join(testRoot, "fake-mcpm-record-remote.sh");
    writeFileSync(fakeBin, `#!/bin/bash\necho "$@" >> "${callLog}"\nexit 0\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpNew({
      serverName: "remote-srv",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer secret" },
    });

    expect(result.ok).toBe(true);
    const calls = readFileSync(callLog, "utf-8").trim().split("\n");
    expect(calls[0]).toBe(
      "new remote-srv --force --type remote --url https://api.example.com/mcp --headers Authorization=Bearer secret",
    );
  });

  it("omits --args + --env when both are empty", () => {
    const callLog = join(testRoot, "calls.log");
    writeFileSync(callLog, "");
    const fakeBin = join(testRoot, "fake-mcpm-minimal.sh");
    writeFileSync(fakeBin, `#!/bin/bash\necho "$@" >> "${callLog}"\nexit 0\n`, {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpNew({
      serverName: "minimal",
      command: "echo",
    });

    expect(result.ok).toBe(true);
    const calls = readFileSync(callLog, "utf-8").trim().split("\n");
    expect(calls[0]).toBe("new minimal --force --type stdio --command echo");
  });
});

describe("delegateMcpNew — args containing whitespace", () => {
  afterEach(() => {
    delete process.env.AGENTBREW_MCPM_CONFIG_DIR;
  });

  it("restores the exact args after mcpm splits --args on whitespace", () => {
    const configDir = join(testRoot, "mcpm-config");
    mkdirSync(configDir, { recursive: true });
    process.env.AGENTBREW_MCPM_CONFIG_DIR = configDir;
    const fakeBin = join(testRoot, "fake-mcpm-split.py");
    writeFileSync(
      fakeBin,
      [
        "#!/usr/bin/env python3",
        "import json, sys",
        "argv = sys.argv[1:]",
        "name = argv[1]",
        "command = argv[argv.index('--command') + 1]",
        "args = argv[argv.index('--args') + 1].split()",
        `path = ${JSON.stringify(join(configDir, "servers.json"))}`,
        "json.dump({name: {'name': name, 'command': command, 'args': args, 'env': {}}}, open(path, 'w'))",
        "",
      ].join("\n"),
      { encoding: "utf-8", mode: 0o755 },
    );
    process.env.AGENTBREW_MCPM_BIN = fakeBin;
    const script = 'overlay="$HOME/overlay"; exec "$overlay/bin/wrapper.sh"';

    const result = delegateMcpNew({ serverName: "wrapped", command: "/bin/bash", args: ["-lc", script] });

    expect(result.ok).toBe(true);
    expect(readMcpmServer("wrapped")?.args).toEqual(["-lc", script]);
  });
});

describe("delegateMcpNew — failure modes", () => {
  it("returns ok=false when the binary is missing (ENOENT graceful fallback)", () => {
    process.env.AGENTBREW_MCPM_BIN = "/nonexistent/path/to/mcpm-bin-that-does-not-exist";
    const result = delegateMcpNew({
      serverName: "my-srv",
      command: "node",
      args: ["./srv.js"],
    });
    expect(result.ok).toBe(false);
  });

  it("captures stdout/stderr from a failing subprocess", () => {
    const fakeBin = join(testRoot, "fake-mcpm-fail.sh");
    writeFileSync(fakeBin, "#!/bin/bash\necho 'mcpm: server already exists' >&2\nexit 1\n", {
      encoding: "utf-8",
      mode: 0o755,
    });
    process.env.AGENTBREW_MCPM_BIN = fakeBin;

    const result = delegateMcpNew({
      serverName: "my-srv",
      command: "node",
      args: ["./srv.js"],
    });

    expect(result.ok).toBe(false);
    expect(result.stderr ?? "").toContain("server already exists");
  });
});

describe.skipIf(!hasMcpm)("delegateMcpNew — real mcpm binary smoke", () => {
  // Each test run uses a pid-unique entry name so concurrent runs don't collide.
  // The afterAll teardown removes it via `mcpm uninstall --force` so the user's
  // global mcpm config (~/.config/mcpm/servers.json) doesn't accumulate orphans.
  // Each failed teardown was leaking ~1 entry per test run, and the user observed
  // 11+ orphans before this fix (root cause of P0 `cleanup-mcpm-test-smoke-pollution`).
  const smokeServerName = `agentbrew-test-smoke-${process.pid}`;

  afterAll(() => {
    // Best-effort teardown — exit silently regardless of whether the install
    // succeeded. mcpm uninstall non-zero is fine (entry might not exist if
    // install path threw earlier). Capturing stdio also keeps test output clean.
    try {
      execFileSync("mcpm", ["uninstall", smokeServerName, "--force"], {
        stdio: "ignore",
        timeout: 10_000,
      });
    } catch {
      // Ignored — orphan-cleanup is best-effort. If mcpm itself crashes (the
      // "Too many open files" error we observed during the one-shot cleanup),
      // the next test run will simply leave another orphan; not catastrophic.
    }
  });

  it("does not throw when invoked with a known stdio config", () => {
    // Real mcpm config dir would pollute on success. Point AGENTBREW_MCPM_BIN
    // at the real mcpm binary explicitly (since tests reset the env) but leave
    // mcpm's config dir as-is — mcpm doesn't honor AGENTBREW_MCPM_CONFIG_DIR
    // (that's an agentbrew-only override for `readMcpmServer`), so the
    // ~/.config/mcpm/servers.json on the dev machine WOULD pick up the
    // smoke-test entry. The afterAll above is the cleanup hook that removes
    // it before the test process exits. Uses a pid-unique name so concurrent
    // runs from sibling processes don't step on each other.
    const result = delegateMcpNew({
      serverName: smokeServerName,
      command: "echo",
      args: ["smoke"],
    });
    expect(typeof result.ok).toBe("boolean");
  });
});

describe.skipIf(!hasMcpm)("delegateMcpUninstall — real mcpm binary smoke", () => {
  it("does not throw when invoked for a known intersection client", () => {
    // The real mcpm binary will likely exit non-zero here because the
    // server `time` may not be in mcpm's global config on the test
    // machine. The test only asserts the helper completes without
    // throwing — matching the install/edit smoke test shapes.
    const result = delegateMcpUninstall({ serverName: "time", agents: ["claude-code"] });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.carveOuts)).toBe(true);
    expect(Array.isArray(result.perClient)).toBe(true);
    expect(typeof result.globalUninstall.ok).toBe("boolean");
  });
});

describe("readMcpmServer — slice 4c", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = join(testRoot, "mcpm-config");
    mkdirSync(configDir, { recursive: true });
    process.env.AGENTBREW_MCPM_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.AGENTBREW_MCPM_CONFIG_DIR;
  });

  it("returns undefined when servers.json doesn't exist", () => {
    expect(readMcpmServer("time")).toBeUndefined();
  });

  it("returns undefined when the server is not in servers.json", () => {
    writeFileSync(
      join(configDir, "servers.json"),
      JSON.stringify({ fetch: { name: "fetch", command: "uvx", args: ["mcp-server-fetch"], env: {} } }),
    );
    expect(readMcpmServer("time")).toBeUndefined();
  });

  it("returns the parsed McpServer when present", () => {
    writeFileSync(
      join(configDir, "servers.json"),
      JSON.stringify({
        time: {
          name: "time",
          profile_tags: [],
          command: "uvx",
          args: ["mcp-server-time", "--local-timezone=America/New_York"],
          env: {},
        },
      }),
    );
    const result = readMcpmServer("time");
    expect(result).toBeDefined();
    expect(result?.name).toBe("time");
    expect(result?.command).toBe("uvx");
    expect(result?.args).toEqual(["mcp-server-time", "--local-timezone=America/New_York"]);
    expect(result?.source).toBe("registry");
  });

  it("preserves env vars in the parsed McpServer", () => {
    writeFileSync(
      join(configDir, "servers.json"),
      JSON.stringify({
        github: {
          name: "github",
          command: "uvx",
          args: ["mcp-server-github"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      }),
    );
    const result = readMcpmServer("github");
    expect(result?.env).toEqual({ GITHUB_TOKEN: "${GITHUB_TOKEN}" });
  });

  it("preserves remote URL and headers in the parsed McpServer", () => {
    writeFileSync(
      join(configDir, "servers.json"),
      JSON.stringify({
        remote: {
          name: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      }),
    );
    const result = readMcpmServer("remote");
    expect(result?.command).toBe("");
    expect(result?.url).toBe("https://example.com/mcp");
    expect(result?.headers).toEqual({ Authorization: "Bearer ${TOKEN}" });
  });

  it("defaults missing args/env to empty values", () => {
    writeFileSync(join(configDir, "servers.json"), JSON.stringify({ minimal: { name: "minimal", command: "echo" } }));
    const result = readMcpmServer("minimal");
    expect(result?.args).toEqual([]);
    expect(result?.env).toEqual({});
  });

  it("returns undefined when servers.json is malformed JSON", () => {
    writeFileSync(join(configDir, "servers.json"), "{ not valid json");
    expect(readMcpmServer("time")).toBeUndefined();
  });
});

describe("mcpServerConfigEquals", () => {
  it("matches equivalent definitions regardless of env key order", () => {
    const left = {
      name: "memory",
      command: "uvx",
      args: ["--from", "mcp-memory-service[sqlite]", "memory", "server"],
      env: { STORAGE: "sqlite_vec", FUSION: "rrf" },
      source: "agentfile" as const,
    };
    const right = {
      ...left,
      env: { FUSION: "rrf", STORAGE: "sqlite_vec" },
      source: "registry" as const,
    };
    expect(mcpServerConfigEquals(left, right)).toBe(true);
  });

  it("detects same-name backend drift", () => {
    const desired = {
      name: "memory",
      command: "uvx",
      args: ["--from", "mcp-memory-service[sqlite]", "memory", "server"],
      env: {},
      source: "agentfile" as const,
    };
    const stale = {
      name: "memory",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory@latest"],
      env: {},
      source: "registry" as const,
    };
    expect(mcpServerConfigEquals(desired, stale)).toBe(false);
  });
});

describe("listMcpmServerNames — slice 2 (bridge state additions)", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = join(testRoot, "mcpm-config");
    mkdirSync(configDir, { recursive: true });
    process.env.AGENTBREW_MCPM_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.AGENTBREW_MCPM_CONFIG_DIR;
  });

  it("returns an empty Set when servers.json doesn't exist", () => {
    const names = listMcpmServerNames();
    expect(names).toBeInstanceOf(Set);
    expect(names.size).toBe(0);
  });

  it("returns the set of server names from servers.json", () => {
    writeFileSync(
      join(configDir, "servers.json"),
      JSON.stringify({
        time: { name: "time", command: "uvx", args: ["mcp-server-time"], env: {} },
        fetch: { name: "fetch", command: "uvx", args: ["mcp-server-fetch"], env: {} },
        github: { name: "github", command: "uvx", args: [], env: {} },
      }),
    );
    const names = listMcpmServerNames();
    expect(names).toEqual(new Set(["time", "fetch", "github"]));
  });

  it("returns an empty Set when servers.json is empty object", () => {
    writeFileSync(join(configDir, "servers.json"), "{}");
    expect(listMcpmServerNames().size).toBe(0);
  });

  it("returns an empty Set when servers.json is malformed JSON", () => {
    writeFileSync(join(configDir, "servers.json"), "{ not valid json");
    const names = listMcpmServerNames();
    expect(names).toBeInstanceOf(Set);
    expect(names.size).toBe(0);
  });
});
