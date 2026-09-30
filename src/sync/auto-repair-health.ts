import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { logSkipped } from "../core/logger.js";
import { isLabelDisabledInLaunchctlOutput } from "../memory/launchagent.js";
import { formatAge } from "../utils.js";
import { type AutoSyncBackend, activeBackend } from "./auto-sync.js";
import { getLaunchAgentPlistPath, LAUNCHAGENT_LABEL } from "./launchagent.js";
import { AUTO_SYNC_INTERVAL_MINUTES, AUTO_SYNC_INTERVAL_SECONDS, getLogDir } from "./scheduler-paths.js";

/** A run older than three missed ticks means the scheduler is not firing. */
const STALE_AFTER_MS = 3 * AUTO_SYNC_INTERVAL_SECONDS * 1000;
const PROBE_TIMEOUT_MS = 5_000;
const SYSTEMD_TIMER = "agentbrew-check.timer";
const SYSTEMD_SERVICE = "agentbrew-check.service";
const REINSTALL_HINT = "run `agentbrew auto-sync install`";

/** Observed auto-repair scheduler state, from most to least severe. */
export type AutoRepairState =
  | "not-installed"
  | "broken"
  | "disabled"
  | "not-loaded"
  | "never-run"
  | "unverified"
  | "stale"
  | "failing"
  | "active";

/** Raw scheduler evidence. An undefined field means agentbrew could not check it. */
export interface AutoRepairEvidence {
  backend: AutoSyncBackend;
  loaded?: boolean;
  /** launchd refuses to load the job until `launchctl enable` clears its disabled flag. */
  disabled?: boolean;
  missingProgram?: string;
  lastExitCode?: number;
  lastExitReason?: string;
  lastRunAt?: string;
  neverRan?: boolean;
  logPath?: string;
}

export interface AutoRepairHealth extends AutoRepairEvidence {
  state: AutoRepairState;
}

export interface AutoRepairDescription {
  tone: "ok" | "warn" | "error";
  summary: string;
  detail: string;
}

/** Decide the scheduler state from evidence. Never reports "active" without a recent run. */
export function classifyAutoRepair(evidence: AutoRepairEvidence, nowMs: number = Date.now()): AutoRepairHealth {
  const withState = (state: AutoRepairState): AutoRepairHealth => ({ ...evidence, state });
  if (evidence.backend === "none") return withState("not-installed");
  if (evidence.missingProgram) return withState("broken");
  if (evidence.loaded === false) return withState(evidence.disabled ? "disabled" : "not-loaded");
  if (!evidence.lastRunAt) return withState(evidence.neverRan ? "never-run" : "unverified");
  if (nowMs - Date.parse(evidence.lastRunAt) > STALE_AFTER_MS) return withState("stale");
  if ((evidence.lastExitCode ?? 0) !== 0 || evidence.lastExitReason) return withState("failing");
  return withState("active");
}

function describeExit(health: AutoRepairHealth): string {
  if (health.lastExitCode !== undefined && health.lastExitCode !== 0) return `exit code ${health.lastExitCode}`;
  return health.lastExitReason ?? "an error";
}

/** Human-readable status for one scheduler state. */
export function describeAutoRepair(health: AutoRepairHealth): AutoRepairDescription {
  const { backend } = health;
  const lastRan = health.lastRunAt ? formatAge(health.lastRunAt) : "never";
  const cadence = `every ${AUTO_SYNC_INTERVAL_MINUTES} min`;
  switch (health.state) {
    case "not-installed":
      return { tone: "warn", summary: "not installed", detail: REINSTALL_HINT };
    case "broken":
      return {
        tone: "error",
        summary: "broken",
        detail: `${backend} points at a missing program ${health.missingProgram} — ${REINSTALL_HINT}`,
      };
    case "disabled":
      return {
        tone: "warn",
        summary: "disabled",
        detail: `launchd has ${LAUNCHAGENT_LABEL} disabled, so \`agentbrew auto-sync install\` cannot load it — if that is not on purpose, run \`launchctl enable gui/$UID/${LAUNCHAGENT_LABEL}\` first`,
      };
    case "not-loaded":
      return {
        tone: "warn",
        summary: "not running",
        detail: `${backend} is installed but not loaded — ${REINSTALL_HINT}`,
      };
    case "never-run":
      return { tone: "warn", summary: "not run yet", detail: `${backend} is loaded but has not run yet` };
    case "unverified":
      return {
        tone: "warn",
        summary: "unverified",
        detail: `${backend} is installed; agentbrew cannot read its last run`,
      };
    case "stale":
      return {
        tone: "warn",
        summary: "stale",
        detail: `${backend} last ran ${lastRan}, expected ${cadence} — ${REINSTALL_HINT}`,
      };
    case "failing":
      return {
        tone: "warn",
        summary: "failing",
        detail: `${backend} last ran ${lastRan} and failed with ${describeExit(health)}${health.logPath ? ` — see ${health.logPath}` : ""}`,
      };
    case "active":
      return { tone: "ok", summary: "active", detail: `${backend}, ${cadence}, last ran ${lastRan}` };
  }
}

// ── Evidence parsers ─────────────────────────────────────────────

/** Parse `launchctl print` output. `(never exited)` yields no exit fields. */
export function parseLaunchctlPrint(output: string): { lastExitCode?: number; lastExitReason?: string } {
  const code = /^\s*last exit code = (-?\d+)/mu.exec(output);
  if (code) return { lastExitCode: Number(code[1]) };
  const reason = /^\s*last exit reason = (.+)$/mu.exec(output);
  if (reason) return { lastExitReason: reason[1].trim() };
  return {};
}

/** Read the ProgramArguments strings from a LaunchAgent plist. */
export function extractPlistProgramArguments(plistContent: string): string[] {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(plistContent);
  if (!array) return [];
  return [...array[1].matchAll(/<string>([^<]*)<\/string>/gu)].map((match) => match[1]);
}

function extractPlistString(plistContent: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(plistContent)?.[1];
}

/** Parse `systemctl show --timestamp=unix -p ExecMainExitTimestamp -p ExecMainStatus`. */
export function parseSystemctlShow(output: string): { lastRunAt?: string; lastExitCode?: number } {
  const timestamp = /^ExecMainExitTimestamp=@(\d+)/mu.exec(output);
  if (!timestamp) return {};
  const status = /^ExecMainStatus=(-?\d+)/mu.exec(output);
  return {
    lastRunAt: new Date(Number(timestamp[1]) * 1000).toISOString(),
    lastExitCode: status ? Number(status[1]) : undefined,
  };
}

// ── Probes ───────────────────────────────────────────────────────

/** Run a probe command. Returns undefined when it could not run (missing binary or timeout). */
function runProbe(command: string, args: string[]): { status: number; stdout: string } | undefined {
  const result = spawnSync(command, args, { encoding: "utf-8", timeout: PROBE_TIMEOUT_MS });
  if (result.error || result.status === null) {
    logSkipped(`sync/auto-repair-health/${command}`, result.error);
    return undefined;
  }
  return { status: result.status, stdout: result.stdout };
}

function latestMtime(paths: string[]): string | undefined {
  let latest: number | undefined;
  for (const path of paths) {
    try {
      const mtime = statSync(path).mtimeMs;
      if (latest === undefined || mtime > latest) latest = mtime;
    } catch {
      // Missing log file: no evidence from this path.
    }
  }
  return latest === undefined ? undefined : new Date(latest).toISOString();
}

function launchAgentEvidence(): AutoRepairEvidence {
  let plist = "";
  try {
    plist = readFileSync(getLaunchAgentPlistPath(), "utf-8");
  } catch (e) {
    logSkipped("sync/auto-repair-health/read-plist", e);
  }
  const stdoutPath = extractPlistString(plist, "StandardOutPath") ?? join(getLogDir(), "launchagent.log");
  const stderrPath = extractPlistString(plist, "StandardErrorPath") ?? join(getLogDir(), "launchagent.err");
  const missingProgram = extractPlistProgramArguments(plist).find((arg) => arg.startsWith("/") && !existsSync(arg));

  const domain = `gui/${userInfo().uid}`;
  const probe = runProbe("launchctl", ["print", `${domain}/${LAUNCHAGENT_LABEL}`]);
  const loaded = probe === undefined ? undefined : probe.status === 0;
  const exit = probe?.status === 0 ? parseLaunchctlPrint(probe.stdout) : {};
  const lastRunAt = latestMtime([stdoutPath, stderrPath]);
  const disabledProbe = loaded === false ? runProbe("launchctl", ["print-disabled", domain]) : undefined;
  const disabled =
    disabledProbe?.status === 0 ? isLabelDisabledInLaunchctlOutput(disabledProbe.stdout, LAUNCHAGENT_LABEL) : undefined;

  return {
    backend: "launchagent",
    loaded,
    disabled,
    missingProgram,
    ...exit,
    lastRunAt,
    neverRan: loaded === true && exit.lastExitCode === undefined && exit.lastExitReason === undefined,
    logPath: stderrPath,
  };
}

function systemdEvidence(): AutoRepairEvidence {
  const active = runProbe("systemctl", ["--user", "is-active", SYSTEMD_TIMER]);
  const loaded = active === undefined ? undefined : active.stdout.trim() === "active";
  const show = runProbe("systemctl", [
    "--user",
    "show",
    SYSTEMD_SERVICE,
    "--timestamp=unix",
    "-p",
    "ExecMainExitTimestamp",
    "-p",
    "ExecMainStatus",
  ]);
  const history = show?.status === 0 ? parseSystemctlShow(show.stdout) : {};
  return {
    backend: "systemd",
    loaded,
    ...history,
    neverRan: show?.status === 0 && history.lastRunAt === undefined,
    logPath: `journalctl --user -u ${SYSTEMD_SERVICE}`,
  };
}

function cronEvidence(): AutoRepairEvidence {
  const logPath = join(getLogDir(), "cron.log");
  return { backend: "cron", loaded: true, lastRunAt: latestMtime([logPath]), logPath };
}

/** Gather scheduler evidence for the installed backend. */
export function collectAutoRepairEvidence(): AutoRepairEvidence {
  const backend = activeBackend();
  switch (backend) {
    case "launchagent":
      return launchAgentEvidence();
    case "systemd":
      return systemdEvidence();
    case "cron":
      return cronEvidence();
    case "taskscheduler":
    case "none":
      return { backend };
  }
}

/** Probe the auto-repair scheduler and classify what it is really doing. */
export function probeAutoRepairHealth(nowMs: number = Date.now()): AutoRepairHealth {
  return classifyAutoRepair(collectAutoRepairEvidence(), nowMs);
}
