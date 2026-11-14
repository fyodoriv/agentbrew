import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type LaunchdJob, parseMemoryUpgradeLaunchdJob } from "./upgrade-launchagent.js";

interface CandidateInput {
  plist: string;
  loadedOutput: string;
  oldPath: string;
  newPath: string;
  oldSpec: string;
  newSpec: string;
  label: string;
}

function loadedEnvironment(output: string): Record<string, string> {
  const block = /^\tenvironment = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1];
  if (block === undefined) throw new Error("memory job environment unavailable");
  const values: Record<string, string> = Object.create(null);
  for (const line of block.split("\n")) {
    if (!line) continue;
    const match = /^\t\t([^\s]+) => (.*)$/.exec(line);
    if (!match || match[1] in values) throw new Error("memory job environment is ambiguous");
    values[match[1]] = match[2];
  }
  return values;
}

function parsePlist(plist: string): Record<string, unknown> {
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
    input: plist,
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1_000_000,
  });
  if (result.error || result.status !== 0) throw new Error("invalid memory job file");
  const file: unknown = JSON.parse(result.stdout);
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("invalid memory job file");
  return file as Record<string, unknown>;
}

function supportedJobShape(data: Record<string, unknown>, output: string, args: string[]): boolean {
  const keys = [
    "EnvironmentVariables",
    "KeepAlive",
    "Label",
    "ProgramArguments",
    "RunAtLoad",
    "StandardErrorPath",
    "StandardOutPath",
    "ThrottleInterval",
    "WorkingDirectory",
  ];
  const field = (name: string) => new RegExp(`^\\t${name} = (.*)$`, "m").exec(output)?.[1];
  const properties = field("properties")?.split(" | ") ?? [];
  return (
    Object.keys(data).length === keys.length &&
    keys.every((key) => Object.hasOwn(data, key)) &&
    data.KeepAlive === true &&
    data.RunAtLoad === true &&
    Number.isSafeInteger(data.ThrottleInterval) &&
    field("minimum runtime") === String(data.ThrottleInterval) &&
    field("program") === args[0] &&
    field("stdout path") === data.StandardOutPath &&
    field("stderr path") === data.StandardErrorPath &&
    properties.includes("keepalive") &&
    properties.includes("runatload") &&
    properties.every((value) => ["keepalive", "runatload", "inferred program"].includes(value))
  );
}

/** Derive a candidate in memory; the caller must verify and safely publish its job file. */
export function deriveMemoryCandidate(input: CandidateInput): { plist: string; job: LaunchdJob } {
  const { plist, loadedOutput, oldPath, newPath, oldSpec, newSpec, label } = input;
  const spec = /^mcp-memory-service\[sqlite\]==\d+\.\d+\.\d+$/;
  if (
    process.platform !== "darwin" ||
    !isAbsolute(oldPath) ||
    !isAbsolute(newPath) ||
    oldPath === newPath ||
    !spec.test(oldSpec) ||
    !spec.test(newSpec) ||
    oldSpec === newSpec ||
    plist.length > 1_000_000
  )
    throw new Error("invalid memory candidate request");
  const data = parsePlist(plist);
  const args = data.ProgramArguments;
  const env = data.EnvironmentVariables;
  const loaded = parseMemoryUpgradeLaunchdJob(loadedOutput);
  if (
    data.Label !== label ||
    loaded.path !== oldPath ||
    data.WorkingDirectory !== loaded.workingDirectory ||
    !Array.isArray(args) ||
    !args.every((arg) => typeof arg === "string") ||
    JSON.stringify(args) !== JSON.stringify(loaded.args) ||
    !supportedJobShape(data, loadedOutput, args) ||
    !env ||
    typeof env !== "object" ||
    Array.isArray(env)
  )
    throw new Error("memory job file differs from loaded job");
  const saved = env as Record<string, unknown>;
  const actual = loadedEnvironment(loadedOutput);
  if (
    saved.HOME !== loaded.home ||
    Object.entries(saved).some(([key, value]) => typeof value !== "string" || actual[key] !== value) ||
    Object.keys(actual).some(
      (key) => !Object.hasOwn(saved, key) && key !== "OSLogRateLimit" && key !== "XPC_SERVICE_NAME",
    )
  )
    throw new Error("memory job environment differs from loaded job");
  const index = args.indexOf(oldSpec);
  const needle = `<string>${oldSpec}</string>`;
  if (
    index < 1 ||
    args[index - 1] !== "--from" ||
    args.lastIndexOf(oldSpec) !== index ||
    plist.split(needle).length !== 2
  )
    throw new Error("memory job version is ambiguous");
  const candidateArgs = [...args];
  candidateArgs[index] = newSpec;
  const candidatePlist = plist.replace(needle, `<string>${newSpec}</string>`);
  if (!isDeepStrictEqual(parsePlist(candidatePlist), { ...data, ProgramArguments: candidateArgs })) {
    throw new Error("memory candidate does not contain the expected job");
  }
  return {
    plist: candidatePlist,
    job: { ...loaded, path: newPath, args: candidateArgs, pid: null },
  };
}
