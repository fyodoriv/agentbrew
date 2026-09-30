import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintMdcBloat } from "../agent-bloat-lint.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("templates/rules — SSO background parallel work", () => {
  const ssoBackground = readFileSync(join(REPO_ROOT, "templates/rules/sso-background-work.mdc"), "utf-8");
  const browserTasks = readFileSync(join(REPO_ROOT, "templates/rules/browser-tasks.mdc"), "utf-8");

  it("sso-background-work.mdc requires background + parallel work, not idle polling", () => {
    expect(ssoBackground).toMatch(/do not sit idle/i);
    expect(ssoBackground).toMatch(/2–5 seconds|2-5/i);
    expect(ssoBackground).toMatch(/9223/);
    expect(ssoBackground).toMatch(/page-zero-errors/);
  });

  it("requires an explicit user sign-in request before backgrounding", () => {
    expect(ssoBackground).toMatch(/tell the user exactly what is needed/i);
    expect(ssoBackground).toMatch(/opened.*visible Chrome window/i);
    expect(ssoBackground).toMatch(/prompt \+ background listener/i);
    expect(ssoBackground).toMatch(/stable headed SSO session/i);
    expect(ssoBackground).toMatch(/Never claim a CDP tab is visible/i);
  });

  it("requires chat-embedded SSO screenshot before asking the user to sign in", () => {
    expect(ssoBackground).toMatch(/Present the SSO screenshot in chat/i);
    expect(ssoBackground).toMatch(/embed at least the desktop[\s\S]*screenshot/i);
    expect(ssoBackground).toMatch(/never ask for SSO without a[\s\S]*screenshot/i);
    expect(ssoBackground).toMatch(/Forbidden.*visible Chrome window/i);
    expect(browserTasks).toMatch(/SSO handoff screenshots in chat/i);
    expect(browserTasks).toMatch(/embed at least the desktop screenshot/i);
  });

  it("verifies and reopens the headed window before user handoff", () => {
    expect(ssoBackground).toMatch(/verify the headed handoff/i);
    expect(ssoBackground).toMatch(/expected auth URL\/title/i);
    expect(ssoBackground).toMatch(/browser-content screenshot/i);
    expect(ssoBackground).toMatch(/full desktop screenshot/i);
    expect(ssoBackground).toMatch(/CDP screenshot only proves page content/i);
    expect(ssoBackground).toMatch(/process bound to the[\s\S]*CDP port/i);
    expect(ssoBackground).toMatch(/app-name activation may raise the wrong/i);
    expect(ssoBackground).toMatch(/activate the headed browser/i);
    expect(ssoBackground).toMatch(/reopen the same stable headed session/i);
    expect(ssoBackground).toMatch(/move its window onto the active display/i);
    expect(ssoBackground).toMatch(/do not ask the user to authenticate/i);
    expect(ssoBackground).toMatch(/successful `open`, `activate`, or screenshot command[\s\S]*never satisfies/i);
  });

  it("listens to headed page HTML and resumes immediately after auth", () => {
    expect(ssoBackground).toMatch(/background auth listener/i);
    expect(ssoBackground).toMatch(/document\.documentElement\.outerHTML/);
    expect(ssoBackground).toMatch(/every \*\*2–5 seconds\*\*/);
    expect(ssoBackground).toMatch(/SSO_AUTH_COMPLETE/);
    expect(ssoBackground).toMatch(/do not wait for another user message/i);
    expect(ssoBackground).not.toMatch(/every 30–60 seconds/i);
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

  it("browser-tasks.mdc enforces attach-first without banning purpose Chrome ports", () => {
    expect(browserTasks).toMatch(/9223/);
    expect(browserTasks).toMatch(/9224/);
    expect(browserTasks).toMatch(/9225/);
    expect(browserTasks).toMatch(/agent-browser connect/i);
    expect(browserTasks).not.toMatch(/never attach.*9223/i);
    expect(browserTasks).not.toMatch(/do not attach.*9223/i);
    expect(browserTasks).not.toMatch(/agent-browser --session <unique/i);
    expect(browserTasks).toMatch(/timestamp-unique SSO session names/);
  });
});
