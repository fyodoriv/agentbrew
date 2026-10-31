import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { isUserModified, loadManifest, type Manifest } from "../manifest.js";

const AGENT_BINARIES: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  codex: "codex",
  "gemini-cli": "gemini",
  opencode: "opencode",
};

export interface AgentRuntime {
  agent: string;
  binary: string;
  available: boolean;
  version?: string;
  login?: "signed in" | "needs login" | "unavailable";
  desktopInstalled?: boolean;
}

function findExecutable(binary: string, path: string): string | undefined {
  for (const directory of path.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, binary);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* Try the next PATH entry. */
    }
  }
  return undefined;
}

function readVersion(executable: string): string | undefined {
  const version = spawnSync(executable, ["--version"], { encoding: "utf-8", timeout: 1000, maxBuffer: 4096 });
  if (version.status !== 0) return undefined;
  const line = version.stdout?.trim().split("\n")[0] ?? "";
  return /^[\w .+()-]*\d+\.\d+[\w .+()-]*$/u.test(line) ? line : undefined;
}

function readCodexLogin(executable: string): AgentRuntime["login"] {
  const login = spawnSync(executable, ["login", "status"], { encoding: "utf-8", timeout: 1000, maxBuffer: 4096 });
  if (login.error || login.status === null) return "unavailable";
  return login.status === 0 ? "signed in" : "needs login";
}

/** PATH readiness is synchronous and local. Detailed probes are scoped to one status invocation. */
export function inspectAgentRuntime(
  agent: string,
  options: { path?: string; home?: string; details?: boolean } = {},
): AgentRuntime | undefined {
  const binary = AGENT_BINARIES[agent];
  if (!binary) return undefined;
  const executable = findExecutable(binary, options.path ?? process.env.PATH ?? "");
  const result: AgentRuntime = { agent, binary, available: executable !== undefined };
  if (agent === "codex" && process.platform === "darwin") {
    result.desktopInstalled = [
      "/Applications/ChatGPT.app",
      join(options.home ?? homedir(), "Applications/ChatGPT.app"),
    ].some(existsSync);
  }
  if (!executable || !options.details) return result;
  result.version = readVersion(executable);
  if (agent === "codex") result.login = readCodexLogin(executable);
  return result;
}

/** Generated skill links are owned by sync; real folders need explicit adoption as sources. */
export function unmanagedAgentSkills(skillsDir: string, manifest: Manifest = loadManifest()): string[] {
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md")))
      .filter((entry) => isUserModified(join(skillsDir, entry.name, "SKILL.md"), manifest))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
