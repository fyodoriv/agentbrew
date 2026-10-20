import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintMdcBloat } from "../agent-bloat-lint.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("templates/rules — SSO background parallel work", () => {
  const ssoBackground = readFileSync(join(REPO_ROOT, "templates/rules/sso-background-work.mdc"), "utf-8");
  const browserTasks = readFileSync(join(REPO_ROOT, "templates/rules/browser-tasks.mdc"), "utf-8");
  const sharedRules = readFileSync(join(REPO_ROOT, "docs/shared-rules.md"), "utf-8");

  it("sso-background-work.mdc requires background + parallel work, not idle polling", () => {
    expect(ssoBackground).toMatch(/do not sit idle/i);
    expect(ssoBackground).toMatch(/2–5 seconds|2-5/i);
    expect(ssoBackground).toMatch(/9223/);
    expect(ssoBackground).toMatch(/page-zero-errors/);
  });

  it("asks the user to sign in without taking app focus (#312)", () => {
    expect(ssoBackground).toMatch(/tell the user exactly what is needed/i);
    expect(ssoBackground).toMatch(/prompt \+ background listener/i);
    expect(ssoBackground).toMatch(/Never raise, activate, or `open -a` a browser window/i);
    expect(ssoBackground).toMatch(/background tabs only/i);
    expect(ssoBackground).toMatch(/which page needs sign-in and which browser/i);
    expect(ssoBackground).toMatch(/user switches to it/i);
    expect(ssoBackground).toMatch(/expected auth URL\/title/i);
    expect(ssoBackground).toMatch(/browser-content screenshot/i);
  });

  it("never tells agents to raise windows or prove a frontmost window (#312)", () => {
    for (const text of [ssoBackground, browserTasks, sharedRules]) {
      expect(text).not.toMatch(/bring (it|its window) forward/i);
      expect(text).not.toMatch(/raise it frontmost/i);
      expect(text).not.toMatch(/activate the headed browser/i);
      expect(text).not.toMatch(/full[- ]desktop screenshot/i);
      expect(text).not.toMatch(/move its window onto the active display/i);
    }
  });

  it("listens to headed page HTML and resumes immediately after auth", () => {
    expect(ssoBackground).toMatch(/background auth listener/i);
    expect(ssoBackground).toMatch(/document\.documentElement\.outerHTML/);
    expect(ssoBackground).toMatch(/every \*\*2–5 seconds\*\*/);
    expect(ssoBackground).toMatch(/SSO_AUTH_COMPLETE/);
    expect(ssoBackground).toMatch(/do not wait for another user message/i);
    expect(ssoBackground).not.toMatch(/every 30–60 seconds/i);
  });

  it("pins every watcher agent-browser call to one session and tab", () => {
    const calls = ssoBackground.split("\n").filter((line) => line.includes("agent-browser "));
    expect(calls.length).toBeGreaterThan(0);
    for (const line of calls.filter((l) => /agent-browser (connect|get|eval|--session)/.test(l))) {
      expect(line, line).toContain('--session "$SESSION"');
    }
    expect(ssoBackground).toContain('agent-browser --session "$SESSION" --pin-tab connect "$PORT"');
  });

  it("diagnoses and fixes unexpected states discovered during auth waits", () => {
    expect(ssoBackground).toMatch(/unexpected state/i);
    expect(ssoBackground).toMatch(/diagnose it immediately/i);
    expect(ssoBackground).toMatch(/403|wrong account|missing role/i);
    expect(ssoBackground).toMatch(/fix the problem in the same session/i);
    expect(ssoBackground).toMatch(/do not keep waiting/i);
    expect(ssoBackground).toMatch(/definitive authorization/i);
  });

  it("sso-background-work.mdc uses narrow glob when always applied", () => {
    expect(ssoBackground).toMatch(/globs:\s*\["\*\*\/TASKS\.md"\]/);
    expect(ssoBackground).not.toMatch(/\*\*\/\*\.md/);
    const findings = lintMdcBloat(ssoBackground, "templates/rules/sso-background-work.mdc");
    expect(findings.some((f) => f.ruleId === "mdc-always-apply-broad" && f.severity === "error")).toBe(false);
  });

  it("browser-tasks.mdc references sso-background-work after initial poll", () => {
    expect(browserTasks).toMatch(/sso-background-work/);
    expect(browserTasks).toMatch(/background \+ parallel work/i);
    expect(browserTasks).toMatch(/DO NOT.*mark it as "requires human action" and move on permanently/);
  });

  it("browser-tasks.mdc uses narrow TASKS.md glob only", () => {
    expect(browserTasks).toMatch(/globs:\s*\["\*\*\/TASKS\.md"\]/);
    expect(browserTasks).not.toMatch(/\*\*\/\*\.md/);
    const findings = lintMdcBloat(browserTasks, "templates/rules/browser-tasks.mdc");
    expect(findings.some((f) => f.ruleId === "mdc-broad-glob")).toBe(false);
    expect(findings.some((f) => f.ruleId === "mdc-always-apply-broad" && f.severity === "error")).toBe(false);
  });

  it("browser-tasks.mdc enforces attach-first to the shared agents Chrome", () => {
    expect(browserTasks).toMatch(/9223/);
    expect(browserTasks).toMatch(/agent-browser connect/i);
    expect(browserTasks).not.toMatch(/never attach.*9223/i);
    expect(browserTasks).not.toMatch(/do not attach.*9223/i);
    expect(browserTasks).not.toMatch(/agent-browser --session <unique/i);
    expect(browserTasks).toMatch(/timestamp-unique SSO session names/);
  });

  it("pins each Mode 1 session to its own tab", () => {
    const sharedRules = readFileSync(join(REPO_ROOT, "docs/shared-rules.md"), "utf-8");
    expect(browserTasks).toMatch(/agent-browser --session "\$SESSION" --pin-tab connect "\$PORT"/);
    expect(browserTasks).toMatch(/agent-browser --session "\$SESSION" tab new/);
    expect(browserTasks).toMatch(/agent-browser --session "\$SESSION" open "\$URL"/);
    expect(browserTasks).not.toMatch(/^agent-browser (connect|tab new|open) /m);
    expect(sharedRules).toMatch(/--pin-tab connect <port>/);
  });
});
