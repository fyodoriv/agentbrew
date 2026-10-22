import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner, RunResult } from "./contribute.js";
import { optOutFile, report, safetyChecklist, scrubReport } from "./report.js";

const HOME = "/Users/jdoe";
// Built at runtime so secret scanners never see a literal key in this file.
const GH_TOKEN = `ghp_${"a1B2".repeat(9)}`;
const AWS_KEY = `AKIA${"ABCD".repeat(4)}`;

function fakeGh(options: { login?: string; issues?: string } = {}): { run: Runner; calls: string[] } {
  const calls: string[] = [];
  const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
  const run: Runner = (cmd, args) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (line === "gh api user --jq .login") return ok(options.login ?? "someone");
    if (line.startsWith("gh issue list")) return ok(options.issues ?? "");
    if (line.startsWith("gh issue create")) return ok("https://github.com/fyodoriv/agentbrew/issues/1234");
    if (line === "git rev-parse --show-toplevel") return { status: 1, stdout: "", stderr: "not a repo" };
    return ok();
  };
  return { run, calls };
}

function scratch(): { home: string; body: string } {
  const home = mkdtempSync(join(tmpdir(), "report-test-"));
  const body = join(home, "draft.md");
  writeFileSync(body, `Sync failed in ${HOME}/apps/x with token ${GH_TOKEN}.\nContact jdoe@example.com\n`);
  return { home, body };
}

describe("scrubReport", () => {
  it("replaces every kind of private detail and finds nothing left", () => {
    const text = [
      `cd ${HOME}/apps/tooling && run`,
      "other user: /home/alice/.config",
      `token ${GH_TOKEN} and ${AWS_KEY}`,
      "password=hunter22 api_key: abc123",
      "mail jdoe@example.com",
      "server 10.2.3.4 and build.corp and localhost 127.0.0.1",
      "user jdoe ran it at acmecorp",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const result = scrubReport(text, { home: HOME, user: "jdoe", privatePattern: "acmecorp" });
    expect(result.text).not.toContain(HOME);
    expect(result.text).not.toContain("/home/alice");
    expect(result.text).not.toContain(GH_TOKEN);
    expect(result.text).not.toContain(AWS_KEY);
    expect(result.text).not.toContain("hunter22");
    expect(result.text).not.toContain("abc123");
    expect(result.text).not.toContain("jdoe@example.com");
    expect(result.text).not.toContain("10.2.3.4");
    expect(result.text).not.toContain("build.corp");
    expect(result.text).not.toMatch(/\bjdoe\b/);
    expect(result.text).not.toContain("acmecorp");
    expect(result.text).not.toContain("MIIabc");
    expect(result.text).toContain("127.0.0.1");
    expect(result.text).toContain("~/apps/tooling");
    expect(result.remaining).toBe(0);
    const kinds = Object.fromEntries(result.findings.map((f) => [f.kind, f.count]));
    for (const kind of [
      "token",
      "secret-assignment",
      "home-path",
      "user-path",
      "email",
      "ip",
      "internal-host",
      "user-name",
      "private",
    ]) {
      expect(kinds[kind], kind).toBeGreaterThan(0);
    }
  });

  it("leaves plain text alone and says so in the checklist", () => {
    const result = scrubReport("agentbrew sync prints a wrong hint", { home: HOME, user: "jdoe" });
    expect(result.text).toBe("agentbrew sync prints a wrong hint");
    const lines = safetyChecklist(result);
    expect(lines.every((l) => l.includes("✓"))).toBe(true);
    expect(lines.at(-1)).toContain("nothing private left");
  });
});

describe("agentbrew report", () => {
  it("never posts without --yes: prints the checklist and exact text, saves a draft", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh();
    const lines: string[] = [];
    const result = report({
      title: "Sync fails",
      bodyFile: body,
      repo: "fyodoriv/agentbrew",
      home,
      user: "jdoe",
      run,
      log: (l) => lines.push(l),
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("draft");
    expect(calls.some((c) => c.startsWith("gh issue create"))).toBe(false);
    const out = lines.join("\n");
    expect(out).toContain("Safety check (nothing has been posted)");
    expect(out).toContain("exact text that would be posted");
    expect(out).toContain("Fyodor, the author of fyodoriv/agentbrew, reads every report and is glad to get it.");
    expect(out).not.toContain(GH_TOKEN);
    expect(result.draftPath && existsSync(result.draftPath)).toBe(true);
    const draft = readFileSync(result.draftPath as string, "utf-8");
    expect(draft).not.toContain(GH_TOKEN);
    expect(draft).not.toContain("jdoe@example.com");
  });

  it("posts the scrubbed text with --yes and offers a fix PR next", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh();
    const lines: string[] = [];
    const result = report({
      title: "Sync fails",
      bodyFile: body,
      repo: "fyodoriv/agentbrew",
      yes: true,
      home,
      user: "jdoe",
      run,
      log: (l) => lines.push(l),
    });
    expect(result.mode).toBe("posted");
    expect(result.issueUrl).toBe("https://github.com/fyodoriv/agentbrew/issues/1234");
    const create = calls.find((c) => c.startsWith("gh issue create"));
    expect(create).toContain("--repo fyodoriv/agentbrew");
    expect(create).not.toContain(GH_TOKEN);
    expect(lines.join("\n")).toContain("Only with a second yes");
  });

  it("dry run with --yes still posts nothing", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh();
    const result = report({
      title: "t",
      bodyFile: body,
      repo: "fyodoriv/dotfiles",
      yes: true,
      dryRun: true,
      home,
      user: "jdoe",
      run,
      log: () => {},
    });
    expect(result.mode).toBe("draft");
    expect(calls.some((c) => c.startsWith("gh issue create"))).toBe(false);
  });

  it("the repo owner gets a task hint, never an issue", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh({ login: "fyodoriv" });
    const lines: string[] = [];
    const result = report({
      title: "t",
      bodyFile: body,
      repo: "fyodoriv/agentbrew",
      yes: true,
      home,
      user: "jdoe",
      run,
      log: (l) => lines.push(l),
    });
    expect(result.mode).toBe("owner");
    expect(calls.some((c) => c.startsWith("gh issue create"))).toBe(false);
    expect(lines.join("\n")).toContain("task queue");
  });

  it("lists similar issues before asking", () => {
    const { home, body } = scratch();
    const { run } = fakeGh({
      issues: "#7 [OPEN] Sync fails on missing dir https://github.com/fyodoriv/agentbrew/issues/7",
    });
    const result = report({
      title: "Sync fails on missing dir",
      bodyFile: body,
      repo: "fyodoriv/agentbrew",
      home,
      user: "jdoe",
      run,
      log: () => {},
    });
    expect(result.duplicates).toEqual([
      "#7 [OPEN] Sync fails on missing dir https://github.com/fyodoriv/agentbrew/issues/7",
    ]);
  });

  it("--off stops offers on this machine and --on turns them back on", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh();
    expect(report({ off: true, home, log: () => {} }).mode).toBe("off");
    expect(existsSync(optOutFile(home))).toBe(true);
    expect(
      report({ title: "t", bodyFile: body, repo: "fyodoriv/agentbrew", yes: true, home, run, log: () => {} }).mode,
    ).toBe("disabled");
    expect(calls).toEqual([]);
    expect(report({ on: true, home, log: () => {} }).mode).toBe("on");
    expect(existsSync(optOutFile(home))).toBe(false);
  });

  it("refuses to post when a private detail survives the scrub", () => {
    const { home, body } = scratch();
    const { run, calls } = fakeGh();
    // A pattern that the placeholder itself matches cannot be scrubbed away.
    const result = report({
      title: "t",
      bodyFile: body,
      repo: "fyodoriv/agentbrew",
      yes: true,
      home,
      user: "jdoe",
      privatePattern: "secret",
      run,
      log: () => {},
    });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("gh issue create"))).toBe(false);
  });

  it("asks for --repo when it cannot tell the repo", () => {
    const { home, body } = scratch();
    const { run } = fakeGh();
    const result = report({ title: "t", bodyFile: body, home, run, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("--repo");
  });
});
