import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeTools } from "../test-utils/fake-tool.js";
import {
  readCrontabTable,
  runSystemctlUser,
  userSchedulersTargetThisHome,
  writeCrontabTable,
} from "./user-scheduler.js";

let fake: ReturnType<typeof installFakeTools>;

beforeEach(() => {
  fake = installFakeTools(["crontab", "systemctl"]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fake.restore();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("user scheduler guard", () => {
  it("never writes the crontab or changes systemd when HOME is not the user's home folder", () => {
    expect(userSchedulersTargetThisHome()).toBe(false);

    expect(writeCrontabTable("* * * * * true\n")).toBeUndefined();
    for (const verb of ["daemon-reload", "enable", "disable", "start", "stop", "restart"]) {
      expect(runSystemctlUser([verb, "agentbrew-check.timer"])).toBeUndefined();
    }

    expect(fake.calls()).toEqual([]);
  });

  it("still runs read-only queries under a scratch HOME", () => {
    readCrontabTable();
    runSystemctlUser(["is-active", "agentbrew-check.timer"]);
    expect(fake.calls()).toEqual([
      ["crontab", "-l"],
      ["systemctl", "--user", "is-active", "agentbrew-check.timer"],
    ]);
  });

  it("changes them when HOME is the user's home folder", () => {
    // Safety: this case really writes a crontab, so it must reach the fakes.
    for (const tool of ["crontab", "systemctl"]) {
      const resolved = execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf-8" }).trim();
      expect(resolved).toContain("fake-tools-");
    }
    vi.stubEnv("HOME", userInfo().homedir);
    expect(writeCrontabTable("* * * * * true\n")?.status).toBe(0);
    runSystemctlUser(["daemon-reload"]);
    expect(fake.calls()).toEqual([
      ["crontab", "-"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
  });
});
