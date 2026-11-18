import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, constants, mkdtempSync, openSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const mac = process.platform === "darwin";
const command = mac ? "/usr/bin/lockf" : "/usr/bin/flock";
const args = mac ? ["-s", "-t", "0", "3"] : ["-n", "-E", "75", "3"];

function acquire(fd) {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe", fd], timeout: 3000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result.status;
}

function openLock(path) {
  return openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
}

function otherProcess(path) {
  const result = spawnSync(process.execPath, [script, "try", path], {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: "/usr/bin:/bin" },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  return result.status;
}

const [role, path] = process.argv.slice(2);
if (role) {
  const fd = openLock(path);
  const status = acquire(fd);
  if (role === "hold") {
    assert.equal(status, 0);
    process.stdout.write("holder ready\n");
    setInterval(() => {}, 1000);
  } else {
    closeSync(fd);
    process.exitCode = status;
  }
} else {
  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-fence-"));
  const target = join(scratch, "owner");
  let owner;
  let child;
  try {
    owner = openLock(target);
    assert.equal(acquire(owner), 0);
    const identity = statSync(target);
    const observer = openLock(target);
    try {
      assert.equal(acquire(observer), 75);
    } finally {
      closeSync(observer);
    }
    console.log("descriptor retained lock after helper exit");
    assert.equal(otherProcess(target), 75);
    console.log("separate process refused immediately");
    closeSync(owner);
    owner = undefined;
    assert.equal(otherProcess(target), 0);
    console.log("separate process acquired after normal close");

    child = spawn(process.execPath, [script, "hold", target], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin" },
    });
    const finished = once(child, "exit", { signal: AbortSignal.timeout(10000) });
    const [ready] = await once(child.stdout, "data", { signal: AbortSignal.timeout(5000) });
    assert.equal(ready.toString(), "holder ready\n");
    assert.equal(otherProcess(target), 75);
    assert.equal(child.kill("SIGKILL"), true);
    assert.deepEqual(await finished, [null, "SIGKILL"]);
    assert.equal(otherProcess(target), 0);
    console.log("separate process acquired after abrupt holder exit");
    const final = statSync(target);
    assert.equal(final.dev, identity.dev);
    assert.equal(final.ino, identity.ino);
    assert.equal(final.mode & 0o777, 0o600);
    console.log("original 0600 lock inode preserved");
  } finally {
    if (owner !== undefined) closeSync(owner);
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
}
