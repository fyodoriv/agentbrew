import { execFileSync, spawnSync } from "node:child_process";
import { MEMORY_PINNED_SPEC } from "./constants.js";

export interface MemoryInvokeOptions {
  memoryBin?: string;
  uvxBin?: string;
  env?: NodeJS.ProcessEnv;
}

function resolveMemoryBin(options?: MemoryInvokeOptions): string | undefined {
  const candidate = options?.memoryBin ?? process.env.AGENTBREW_MEMORY_BIN;
  if (candidate) return candidate;
  try {
    return execFileSync("command", ["-v", "memory"], { encoding: "utf-8", env: options?.env }).trim();
  } catch {
    return undefined;
  }
}

/** Resolve uvx for LaunchAgents — launchd ignores PATH env for ProgramArguments[0]. */
export function resolveUvxBin(options?: MemoryInvokeOptions): string | undefined {
  const candidate = options?.uvxBin ?? process.env.AGENTBREW_UVX_BIN;
  if (candidate) return candidate;
  try {
    return execFileSync("command", ["-v", "uvx"], { encoding: "utf-8", env: options?.env }).trim();
  } catch {
    return undefined;
  }
}

/** Invoke upstream `memory` CLI, falling back to pinned uvx spec. */
export function invokeMemory(
  args: string[],
  options?: MemoryInvokeOptions,
): {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const memoryBin = resolveMemoryBin(options);
  const uvxBin = resolveUvxBin(options);
  const env = options?.env ?? process.env;

  let result: ReturnType<typeof spawnSync>;
  if (memoryBin) {
    result = spawnSync(memoryBin, args, { encoding: "utf-8", env });
  } else if (uvxBin) {
    result = spawnSync(uvxBin, ["--system-certs", "--from", MEMORY_PINNED_SPEC, "memory", ...args], {
      encoding: "utf-8",
      env,
    });
  } else {
    return { ok: false, status: 127, stdout: "", stderr: "memory/uvx not found on PATH" };
  }

  const status = result.status;
  return {
    ok: status === 0,
    status,
    stdout: result.stdout ? String(result.stdout) : "",
    stderr: result.stderr ? String(result.stderr) : "",
  };
}

/** Upstream 11.7.0 dropped `maintain`; fall back to read-only schema check. */
export function invokeMemoryMaintenance(options?: MemoryInvokeOptions): {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  command: string;
} {
  const maintain = invokeMemory(["maintain"], options);
  if (maintain.ok) {
    return { ...maintain, command: "maintain" };
  }
  if (maintain.stderr.includes("No such command 'maintain'")) {
    const checkDb = invokeMemory(["check-db"], options);
    return { ...checkDb, command: "check-db" };
  }
  return { ...maintain, command: "maintain" };
}
