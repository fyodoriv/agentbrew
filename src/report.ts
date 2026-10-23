/**
 * `agentbrew report`: turn something that did not work, or could work better,
 * into a GitHub issue on the tool's own repo, safely.
 *
 * Nothing leaves the machine unless the person said yes:
 *   1. scrub the title and body (home paths, user name, emails, tokens, keys,
 *      IP addresses, internal host names, and the owner's private patterns),
 *   2. print a safety checklist and the exact text that would be posted,
 *   3. list open or closed issues with a similar title (duplicates),
 *   4. save the scrubbed draft locally,
 *   5. post with `gh issue create` only when `--yes` is passed. An agent passes
 *      `--yes` only after the person read the draft and said yes in chat.
 * When the signed-in GitHub account owns the repo, it posts nothing: the owner
 * files a task in the repo's own task queue instead.
 * `agentbrew report --off` stops agents from offering reports on this machine;
 * `--on` turns offers back on.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { defaultRunner, githubSlug, type Runner, readRemotes, resolveUpstream } from "./contribute.js";
import { resolveStateHome } from "./utils.js";

export interface ScrubFinding {
  /** Short detector name, for example "email". */
  kind: string;
  /** What the detector looks for, in plain words. */
  label: string;
  count: number;
}

export interface ScrubResult {
  text: string;
  findings: ScrubFinding[];
  /** Matches still present after the scrub; posting is refused when > 0. */
  remaining: number;
}

interface Detector {
  kind: string;
  label: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
}

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The owner's private-pattern regex from the local leak-gate config, if any. */
export function loadPrivatePattern(home = homedir()): string | undefined {
  const file = join(home, ".config", "oss-readiness", "oss-readiness.env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const match = /^\s*(?:export\s+)?OSS_READINESS_INTERNAL_PATTERN=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}

function detectors(options: { home: string; user: string; privatePattern?: string }): Detector[] {
  const list: Detector[] = [];
  if (options.privatePattern) {
    try {
      list.push({
        kind: "private",
        label: "private names (your local leak-gate patterns)",
        pattern: new RegExp(options.privatePattern, "gi"),
        replace: "<private>",
      });
    } catch {
      // An unreadable pattern is reported by the leak gates themselves.
    }
  }
  list.push(
    ...TOKEN_PATTERNS.map((pattern) => ({
      kind: "token",
      label: "tokens, API keys, and private keys",
      pattern,
      replace: "<secret>",
    })),
    {
      kind: "secret-assignment",
      label: "values after password=, token=, secret=, or api_key=",
      pattern: /\b(password|passwd|token|secret|api[_-]?key)(\s*[:=]\s*)(?!<)[^\s"']+/gi,
      replace: (_m, key: string, sep: string) => `${key}${sep}<secret>`,
    },
    {
      kind: "home-path",
      label: "your home folder path",
      pattern: new RegExp(escapeRegExp(options.home), "g"),
      replace: "~",
    },
    {
      kind: "user-path",
      label: "other home folder paths (/Users/<name>, /home/<name>)",
      pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
      replace: "~",
    },
    {
      kind: "email",
      label: "email addresses",
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replace: "<email>",
    },
    {
      kind: "ip",
      label: "IP addresses (other than localhost)",
      pattern: /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b/g,
      replace: "<ip>",
    },
    {
      kind: "internal-host",
      label: "internal host names (.internal, .corp, .lan, .intranet, .local)",
      pattern: /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:internal|corp|lan|intranet|local)\b/gi,
      replace: "<host>",
    },
  );
  if (options.user.length >= 3) {
    list.push({
      kind: "user-name",
      label: "your computer user name",
      pattern: new RegExp(`\\b${escapeRegExp(options.user)}\\b`, "gi"),
      replace: "<user>",
    });
  }
  return list;
}

function countMatches(text: string, list: Detector[]): number {
  let total = 0;
  for (const detector of list)
    total += text.match(new RegExp(detector.pattern.source, detector.pattern.flags))?.length ?? 0;
  return total;
}

/** Replaces private details with placeholders; reports what it found. */
export function scrubReport(
  text: string,
  options: { home?: string; user?: string; privatePattern?: string } = {},
): ScrubResult {
  const list = detectors({
    home: options.home ?? homedir(),
    user: options.user ?? userInfo().username,
    privatePattern: options.privatePattern,
  });
  const byKind = new Map<string, ScrubFinding>();
  let out = text;
  for (const detector of list) {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    const hits = out.match(pattern)?.length ?? 0;
    const finding = byKind.get(detector.kind) ?? { kind: detector.kind, label: detector.label, count: 0 };
    finding.count += hits;
    byKind.set(detector.kind, finding);
    if (hits > 0) {
      out =
        typeof detector.replace === "string"
          ? out.replace(pattern, detector.replace)
          : out.replace(pattern, detector.replace as (substring: string, ...args: string[]) => string);
    }
  }
  return { text: out, findings: [...byKind.values()], remaining: countMatches(out, list) };
}

/** One checklist line per detector: what was checked and what was done. */
export function safetyChecklist(result: ScrubResult): string[] {
  const lines = result.findings.map((f) =>
    f.count === 0 ? `  ✓ none found: ${f.label}` : `  ✓ ${f.count} replaced with a placeholder: ${f.label}`,
  );
  lines.push(
    result.remaining === 0
      ? "  ✓ re-scan of the final text: nothing private left"
      : `  ✗ re-scan of the final text: ${result.remaining} match(es) left; edit the draft before posting`,
  );
  return lines;
}

export interface ReportOptions {
  title?: string;
  bodyFile?: string;
  repo?: string;
  yes?: boolean;
  dryRun?: boolean;
  off?: boolean;
  on?: boolean;
  cwd?: string;
  home?: string;
  user?: string;
  privatePattern?: string;
  run?: Runner;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface ReportResult {
  ok: boolean;
  mode?: "off" | "on" | "disabled" | "owner" | "draft" | "posted";
  repo?: string;
  draftPath?: string;
  issueUrl?: string;
  duplicates?: string[];
  scrub?: ScrubResult;
  error?: string;
}

/** The file whose presence means "do not offer reports on this machine". */
export function optOutFile(home = homedir()): string {
  return join(home, ".config", "agentbrew", "upstream-feedback.off");
}

const FOOTER =
  "\n\n---\n_Reported with `agentbrew report`. The reporter read this text and approved posting it. " +
  "Home paths, user names, emails, tokens, and IP addresses were replaced with placeholders first._";

function welcomeLine(repo: string): string {
  return repo.toLowerCase().startsWith("fyodoriv/") || repo.toLowerCase().startsWith("tasksmd/")
    ? `Fyodor, the author of ${repo}, reads every report and is glad to get it.`
    : `The maintainers of ${repo} welcome reports like this one.`;
}

function resolveRepo(run: Runner, cwd: string, repo?: string): string | undefined {
  if (repo) return githubSlug(`github.com/${repo}`) ?? undefined;
  const top = run("git", ["rev-parse", "--show-toplevel"], cwd);
  if (top.status !== 0) return undefined;
  return resolveUpstream(run, top.stdout, readRemotes(run, top.stdout));
}

function findDuplicates(run: Runner, cwd: string, repo: string, title: string): string[] {
  const words = title
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join(" ");
  if (!words) return [];
  const jq = '.[] | "#\\(.number) [\\(.state)] \\(.title) \\(.url)"';
  const found = run(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--search",
      `${words} in:title`,
      "--limit",
      "5",
      "--json",
      "number,state,title,url",
      "--jq",
      jq,
    ],
    cwd,
  );
  return found.status === 0 && found.stdout ? found.stdout.split("\n").filter(Boolean) : [];
}

function saveDraft(home: string, now: Date, repo: string, title: string, body: string): string {
  const dir = join(resolveStateHome(home, process.env.XDG_STATE_HOME), "agentbrew", "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}-${repo.replace("/", "-")}.md`);
  writeFileSync(path, `<!-- repo: ${repo} -->\n# ${title}\n\n${body}\n`);
  return path;
}

/** Handles --off, --on, and the saved opt-out; undefined means "go on". */
function toggleOffers(options: ReportOptions, home: string, log: (line: string) => void): ReportResult | undefined {
  const off = optOutFile(home);
  if (options.off) {
    mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
    writeFileSync(off, "Agents do not offer upstream reports on this machine. Undo: agentbrew report --on\n");
    log("agentbrew report: offers are off. Agents will not offer to report problems. Undo: agentbrew report --on");
    return { ok: true, mode: "off" };
  }
  if (options.on) {
    rmSync(off, { force: true });
    log("agentbrew report: offers are on. Agents may offer to report problems, and always ask before posting.");
    return { ok: true, mode: "on" };
  }
  if (existsSync(off)) {
    log("agentbrew report: offers are off on this machine (agentbrew report --on turns them back on). Nothing done.");
    return { ok: true, mode: "disabled" };
  }
  return undefined;
}

interface Draft {
  repo: string;
  me: string;
  title: string;
  body: string;
  scrub: ScrubResult;
}

/** Validates the input, resolves the repo, and scrubs the text. */
function buildDraft(options: ReportOptions, home: string, run: Runner, cwd: string): Draft | ReportResult {
  if (!options.title || !options.bodyFile) {
    return { ok: false, error: "Pass --title and --body-file (a Markdown draft of the issue)." };
  }
  if (!existsSync(options.bodyFile)) return { ok: false, error: `No such file: ${options.bodyFile}` };
  const repo = resolveRepo(run, cwd, options.repo);
  if (!repo) return { ok: false, error: "Cannot tell which repo to report to. Pass --repo <owner/name>." };
  const login = run("gh", ["api", "user", "--jq", ".login"], cwd);
  const me = login.status === 0 ? login.stdout : "";
  const scrubOptions = {
    home,
    user: options.user ?? userInfo().username,
    privatePattern: options.privatePattern ?? loadPrivatePattern(home),
  };
  const title = scrubReport(options.title, scrubOptions);
  const body = scrubReport(readFileSync(options.bodyFile, "utf-8"), scrubOptions);
  const scrub: ScrubResult = {
    text: body.text,
    findings: body.findings.map((f, i) => ({ ...f, count: f.count + (title.findings[i]?.count ?? 0) })),
    remaining: body.remaining + title.remaining,
  };
  return { repo, me, title: title.text, body: `${body.text.trimEnd()}${FOOTER}`, scrub };
}

function printDraft(draft: Draft, duplicates: string[], log: (line: string) => void): void {
  log(`agentbrew report → ${draft.repo}`);
  log("Safety check (nothing has been posted):");
  for (const line of safetyChecklist(draft.scrub)) log(line);
  log(duplicates.length ? "Similar issues (comment there instead if one matches):" : "Similar issues: none found.");
  for (const dup of duplicates) log(`  ${dup}`);
  log("");
  log("──── exact text that would be posted ────");
  log(`Title: ${draft.title}`);
  log(draft.body);
  log("─────────────────────────────────────────");
  log(welcomeLine(draft.repo));
}

function postIssue(draft: Draft, run: Runner, cwd: string): { url?: string; error?: string } {
  if (!draft.me) return { error: "GitHub CLI is not signed in. Run: gh auth login" };
  const bodyPath = join(tmpdir(), `agentbrew-report-${process.pid}.md`);
  writeFileSync(bodyPath, draft.body);
  const posted = run(
    "gh",
    ["issue", "create", "--repo", draft.repo, "--title", draft.title, "--body-file", bodyPath],
    cwd,
  );
  rmSync(bodyPath, { force: true });
  if (posted.status !== 0) return { error: `gh issue create failed: ${posted.stderr}` };
  return { url: posted.stdout.split("\n").pop() };
}

export function report(options: ReportOptions = {}): ReportResult {
  const home = options.home ?? homedir();
  const log = options.log ?? ((line: string) => console.log(line));
  const run = options.run ?? defaultRunner;
  const cwd = options.cwd ?? process.cwd();

  const toggled = toggleOffers(options, home, log);
  if (toggled) return toggled;
  const draft = buildDraft(options, home, run, cwd);
  if ("ok" in draft) return draft;
  const { repo, scrub } = draft;
  if (draft.me && repo.split("/")[0].toLowerCase() === draft.me.toLowerCase()) {
    log(`agentbrew report: you own ${repo}. Nothing posted.`);
    log("File it as a task in the repo's own task queue (TASKS.md or its issue tracker) instead.");
    return { ok: true, mode: "owner", repo };
  }

  const duplicates = findDuplicates(run, cwd, repo, draft.title);
  printDraft(draft, duplicates, log);
  const draftPath = saveDraft(home, (options.now ?? (() => new Date()))(), repo, draft.title, draft.body);
  log(`Draft saved: ${draftPath}`);
  const base = { repo, draftPath, duplicates, scrub };

  if (scrub.remaining > 0) {
    return {
      ...base,
      ok: false,
      mode: "draft",
      error: "Private details are still in the draft. Edit it, then run again.",
    };
  }
  if (!options.yes || options.dryRun) {
    log("Not posted. Show this text to the person; post only after they say yes: add --yes.");
    return { ...base, ok: true, mode: "draft" };
  }
  const posted = postIssue(draft, run, cwd);
  if (posted.error) return { ...base, ok: false, mode: "draft", error: posted.error };
  log(`Posted: ${posted.url}`);
  log("Next: offer a fix PR. Only with a second yes: branch, fix, run the gate, then `agentbrew contribute`.");
  return { ...base, ok: true, mode: "posted", issueUrl: posted.url };
}
