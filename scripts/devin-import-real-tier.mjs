#!/usr/bin/env node
/**
 * Slow-tier "real Devin" import regression test.
 *
 * What this does
 * --------------
 * The fast tier (`simulateDevinImport` in `src/mcp/devin-import.simulator.ts`)
 * is the test-suite stand-in for Devin's strict-interpolation MCP loader.
 * It's fast and runs on every commit, but it can drift from Devin's actual
 * behavior. This slow tier closes the loop by exercising the REAL Devin CLI
 * binary against fixtures generated from the same {@link MCP_AGENT_MATRIX}:
 *
 *  1. Build a sandbox HOME (`$TMPDIR/devin-real-tier-<rand>/`).
 *  2. For every fixture in the matrix, write a dirty config (bare `${VAR}`).
 *  3. Run `sweepMcpConfigs` to heal the placeholders — same code path the
 *     post-sync sweep uses.
 *  4. Run `devin mcp list` with HOME pointed at the sandbox, asserting exit 0
 *     and no "Failed to load MCP configuration" error in stderr.
 *
 * Outcomes
 * --------
 *   - Exit 0: real Devin can import every peer config cleanly. ✅
 *   - Exit 1: Devin's loader crashed. ❌ The fast-tier simulator is wrong
 *             — update `devin-import.simulator.ts` to match real behavior.
 *   - Exit 77: Devin CLI not installed. Skipped (treat as "needs env").
 *
 * Running
 * -------
 *   npm run test:devin-import-real    # local
 *   .github/workflows/devin-import-real.yml runs this nightly + on PR label `mcp-devin`
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ── Setup ────────────────────────────────────────────────────────────────────

function info(msg) {
  process.stderr.write(`\u001b[36m[devin-real-tier]\u001b[0m ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\u001b[31m[devin-real-tier] FAIL\u001b[0m ${msg}\n`);
}
function ok(msg) {
  process.stderr.write(`\u001b[32m[devin-real-tier] OK\u001b[0m ${msg}\n`);
}

// ── 1. Check Devin is available ──────────────────────────────────────────────

// Prefer the real binary over the dotfiles caffeinate wrapper at ~/.local/bin/devin:
// the wrapper uses $HOME/.local/share/devin/... which breaks when we override HOME
// to point at the sandbox. The versioned binary path lives in the REAL home, so we
// resolve it before HOME mutation.
const realHome = process.env.HOME;
const devinCandidates = [
  process.env.DEVIN_BIN,
  `${realHome}/.local/share/devin/cli/_versions/current/bin/devin`,
  `${realHome}/.local/bin/devin`,
  "/usr/local/bin/devin",
].filter(Boolean);

let devinBin;
for (const candidate of devinCandidates) {
  try {
    const r = spawnSync(candidate, ["--version"], { stdio: "pipe" });
    if (r.status === 0) {
      devinBin = candidate;
      info(`Found Devin CLI at ${candidate} — ${r.stdout.toString().trim()}`);
      break;
    }
  } catch {
    // Try next candidate.
  }
}

if (!devinBin) {
  info("Devin CLI not found in any candidate location. Skipping the real-tier test.");
  info("To run locally: install Devin (https://cli.devin.ai/) and re-run `npm run test:devin-import-real`.");
  process.exit(77); // Standard "skip" exit code for autotools-style test runners.
}

// ── 2. Build the sandbox HOME with fixtures ─────────────────────────────────

const sandboxHome = mkdtempSync(join(tmpdir(), "devin-real-tier-"));
process.env.HOME = sandboxHome;
info(`Sandbox HOME: ${sandboxHome}`);

// Dynamically import the matrix + sweep AFTER setting HOME so any expandHome()
// calls during module-eval also point at the sandbox.
const { MCP_AGENT_MATRIX, dirtyServerSample } = await import("../dist/mcp/agent-matrix.fixtures.js").catch(async () => {
  // Fall back to tsx-resolving the source files when dist isn't built.
  return await import("../src/mcp/agent-matrix.fixtures.ts");
});
const { sweepMcpConfigs } = await import("../dist/mcp/resilient-sweep.js").catch(
  async () => await import("../src/mcp/resilient-sweep.ts"),
);

let wroteCount = 0;
for (const fixture of MCP_AGENT_MATRIX) {
  const fullPath = join(sandboxHome, fixture.relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, fixture.render(dirtyServerSample("github")));
  wroteCount++;
}
info(`Wrote ${wroteCount} dirty fixture(s) to sandbox HOME`);

// ── 3. Run the sweep (the production code path) ──────────────────────────────

// Set DEVIN_REAL_TIER_SKIP_SWEEP=1 to bypass the sweep and verify the test
// correctly DETECTS a regression. The script's expected exit code under that
// mode is 1 — used by self-tests, not in normal runs.
if (process.env.DEVIN_REAL_TIER_SKIP_SWEEP === "1") {
  info("DEVIN_REAL_TIER_SKIP_SWEEP=1 — skipping sweep. Expecting crash to verify test fidelity.");
} else {
  const detectedAgents = MCP_AGENT_MATRIX.map((f) => ({
    name: f.name,
    detected: true,
    skillsDir: "(unused-in-sweep)",
  }));
  const sweepResults = sweepMcpConfigs({ detected: detectedAgents });
  info(
    `Sweep healed ${sweepResults.reduce((sum, r) => sum + r.fixedCount, 0)} placeholders across ${sweepResults.length} files`,
  );
}

// ── 4. Run real Devin against the sandbox ────────────────────────────────────

info("Running `devin mcp list` against sandbox HOME…");
const devinResult = spawnSync(devinBin, ["mcp", "list"], {
  env: { ...process.env, HOME: sandboxHome },
  encoding: "utf-8",
  stdio: "pipe",
  timeout: 30_000,
});

const stdout = devinResult.stdout ?? "";
const stderr = devinResult.stderr ?? "";

// Devin's documented crash signature — match the message the user actually saw.
const CRASH_PATTERNS = [
  /Failed to load MCP configuration/i,
  /Environment variable '[A-Z_]+' not found and no default provided/,
];

let crashed = false;
for (const pat of CRASH_PATTERNS) {
  if (pat.test(stdout) || pat.test(stderr)) {
    fail(`Devin's MCP loader crashed — matched pattern: ${pat}`);
    crashed = true;
  }
}

if (devinResult.status !== 0) {
  fail(`devin mcp list exited with status ${devinResult.status}`);
  crashed = true;
}

if (crashed) {
  process.stderr.write("\n── devin mcp list stdout ──\n");
  process.stderr.write(stdout);
  process.stderr.write("\n── devin mcp list stderr ──\n");
  process.stderr.write(stderr);
  process.stderr.write("\n");
  fail("Real-tier test FAILED — agentbrew's resilient sweep did NOT prevent the crash class.");
  fail("This means the fast-tier simulator drifted from Devin's actual behavior.");
  fail("Action: inspect the output above, update simulator and/or the resilient sweep.");
  rmSync(sandboxHome, { recursive: true, force: true });
  process.exit(1);
}

ok("Devin successfully imported every peer config with no env vars set — resilient sweep works in production.");
info(
  `devin mcp list stdout (${stdout.length} chars):\n${stdout.slice(0, 2000)}${stdout.length > 2000 ? "\n…(truncated)" : ""}`,
);
rmSync(sandboxHome, { recursive: true, force: true });
process.exit(0);
