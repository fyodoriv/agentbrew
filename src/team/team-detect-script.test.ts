/**
 * RED test for team overlay's `detect:` field — auto-detect signals.
 *
 * Pins user story #27 "What an overlay repo looks like" + "What `team set`
 * does" sections. When the overlay's Agentfile.yaml declares `detect:
 * ./bin/detect.js`, the script runs on `team set` and reports which
 * organization-specific signals fired on this machine.
 *
 * STATUS: RED today.
 * BLOCKED BY: oss-split-implement-team-command (detect-script execution path).
 */

import { describe, expect, it } from "vitest";

describe("team overlay detect: script execution", () => {
  it("module exists at src/commands/cli-team.ts", async () => {
    const mod = await import("./commands/cli-team.js" as never).catch((error: Error) => error);
    expect(mod, "cli-team module missing — see oss-split-implement-team-command").not.toBeInstanceOf(Error);
  });

  it.todo("when detect: field present, the script is executed on `team set`");
  it.todo("detect script's stdout is shown to the operator (signals fired)");
  it.todo("detect script's non-zero exit code: warning, not a fatal team set failure");
  it.todo("detect script's stdout JSON: parsed and recorded in state.team.detectedSignals");
  it.todo("missing detect file path: silently skipped — no error");
  it.todo("detect: field absent in Agentfile: skipped entirely (detect is optional)");
  it.todo("detect script runs with overlay's bin/ on PATH so it can call companion tools");
});
