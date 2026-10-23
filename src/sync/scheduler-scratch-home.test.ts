// A scratch HOME (vitest.isolated-home.ts) must never change the real
// user's crontab or systemd user timers: both are per user, not per HOME.
// Real child_process with fake `crontab` and `systemctl` first on PATH.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeTools } from "../test-utils/fake-tool.js";
import { installCron, isCronInstalled, uninstallCron } from "./cron.js";
import { installSystemdTimer, uninstallSystemdTimer } from "./systemd.js";

let fake: ReturnType<typeof installFakeTools>;

/** Calls that only read scheduler state. */
function isReadOnly([tool, ...args]: string[]): boolean {
  if (tool === "crontab") return args[0] === "-l";
  if (tool === "systemctl") return ["is-active", "is-enabled", "show", "status", "list-timers"].includes(args[1] ?? "");
  return true;
}

beforeEach(() => {
  // `crontab -l` exits 0 with no output: an empty table, so install proceeds to write.
  fake = installFakeTools(["crontab", "systemctl"]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

describe("user schedulers under a scratch HOME", () => {
  it("cron install and uninstall never write the user's crontab", async () => {
    await installCron();
    await uninstallCron();
    isCronInstalled();

    expect(fake.calls().filter((call) => !isReadOnly(call))).toEqual([]);
  });

  it("systemd timer install and uninstall never change the user's systemd manager", async () => {
    await installSystemdTimer();
    await uninstallSystemdTimer();

    expect(fake.calls().filter((call) => !isReadOnly(call))).toEqual([]);
  });
});
