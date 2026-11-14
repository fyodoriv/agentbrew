import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

export function validCandidateSchemaInputs(dbPath: string, candidateSpec: string, uvxBin: string): boolean {
  return (
    isAbsolute(uvxBin) &&
    isAbsolute(dbPath) &&
    !/[%?#\0]/.test(dbPath) &&
    /^mcp-memory-service\[sqlite\]==\d+\.\d+\.\d+$/.test(candidateSpec)
  );
}

/** Run the candidate's read-only schema check against the selected database. */
export function checkCandidateSchema(
  dbPath: string,
  candidateSpec: string,
  options: { uvxBin: string; env: NodeJS.ProcessEnv },
): boolean {
  const uvx = options.uvxBin;
  if (!validCandidateSchemaInputs(dbPath, candidateSpec, uvx)) {
    return false;
  }
  const result = spawnSync(
    uvx,
    ["--python", "3.13", "--system-certs", "--from", candidateSpec, "memory", "check-db", "--db-path", dbPath],
    { encoding: "utf-8", env: options.env, timeout: 30_000 },
  );
  return result.status === 0 && !result.error && !result.signal;
}
