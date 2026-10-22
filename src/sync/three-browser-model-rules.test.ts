import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf-8");

describe("browser rules — three-browser model (#322)", () => {
  const browserTasks = read("templates/rules/browser-tasks.mdc");
  const ssoBackground = read("templates/rules/sso-background-work.mdc");
  const sharedRules = read("docs/shared-rules.md");

  it("states the three browsers: user, one shared agents Chrome, one locked temp browser", () => {
    expect(browserTasks).toMatch(/at most three browsers/i);
    expect(browserTasks).toMatch(/user's own browser[\s\S]*never use it unless/i);
    expect(browserTasks).toMatch(/one shared agents Chrome[\s\S]*`9223`/i);
    expect(browserTasks).toMatch(/one temporary browser/i);
  });

  it("never starts another browser when the agents Chrome is down", () => {
    expect(browserTasks).toMatch(/never start another browser[\s\S]*report/i);
  });

  it("locks the temporary browser with a lease", () => {
    expect(browserTasks).toMatch(/temp-browser acquire/);
    expect(browserTasks).toMatch(/temp-browser release/);
    expect(browserTasks).toMatch(/report who holds it and why/i);
    expect(browserTasks).toMatch(/never take it over while the holder's lease is live/i);
    expect(browserTasks).toMatch(/fresh profile[\s\S]*deleted after use/i);
  });

  it("drops the extra purpose Chromes and task-local browsers", () => {
    for (const text of [browserTasks, ssoBackground, sharedRules]) {
      expect(text).not.toMatch(/`9224`|`9225`|9224 debug|9225 tooling/);
      expect(text).not.toMatch(/task-local (non-SSO )?browser/i);
      expect(text).not.toMatch(/--remote-debugging-port=0/);
    }
  });

  it("keeps the no-focus rule from #312", () => {
    expect(browserTasks).toMatch(/never raise or focus a window/i);
  });
});
