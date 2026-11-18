import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

appendFileSync(process.env.SYNC_CHILD_PRELOAD_RECEIPT, "loaded\n");

function deny() {
  appendFileSync(process.env.SYNC_CHILD_ATTEMPT_RECEIPT, "denied\n");
  throw new Error("Subprocess attempt denied by the isolated fixture");
}

for (const name of ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]) {
  childProcess[name] = deny;
}
syncBuiltinESMExports();
