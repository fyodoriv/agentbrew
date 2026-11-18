import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withSignerCommitFence } from "../src/plugins/signer-commit-fence.ts";
import { revokeSigner, signersFor, trustSigner } from "../src/plugins/signers.ts";

const [role, registryArg, releaseArg] = process.argv.slice(2);
if (role === "hold") {
  withSignerCommitFence(registryArg, () => {
    process.stdout.write("fence ready\n");
    const barrier = new Int32Array(new SharedArrayBuffer(4));
    for (let trial = 0; trial < 240 && !existsSync(releaseArg); trial += 1) {
      Atomics.wait(barrier, 0, 0, 25);
    }
    assert.equal(existsSync(releaseArg), true);
  });
} else {
  const scratch = mkdtempSync(join(tmpdir(), "shared-signer-writers-"));
  const registry = join(scratch, "config", "custom-registry");
  const lock = `${registry}.agentbrew-signer-v1.lock`;
  const release = join(scratch, "release");
  const dotfiles = resolve(process.argv[2], "bin/dotfiles-plugin");
  const env = {
    PATH: process.env.PATH,
    HOME: scratch,
    XDG_CONFIG_HOME: join(scratch, "config"),
    XDG_DATA_HOME: join(scratch, "data"),
    AGENT_PLUGINS_ALLOWED_SIGNERS: registry,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    DO_NOT_TRACK: "1",
    AGENTBREW_EVENTS: "0",
    TSX_DISABLE_CACHE: "1",
  };
  Object.assign(process.env, env);
  let child;
  try {
    mkdirSync(env.XDG_CONFIG_HOME);
    const keys = ["fixture-first", "fixture-second"].map((name) => {
      const path = join(scratch, name);
      assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path], { env, timeout: 3000 }).status, 0);
      rmSync(path);
      return readFileSync(`${path}.pub`, "utf8").trim().split(" ").slice(0, 2).join(" ");
    });
    const [first, second] = keys;
    trustSigner("fixture-plugin", first);
    trustSigner("fixture-neighbor", first);
    const baseline = readFileSync(registry);
    const identity = statSync(lock);
    const script = fileURLToPath(import.meta.url);
    child = spawn(process.execPath, ["--import", "tsx", script, "hold", registry, release], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childExit = once(child, "exit", { signal: AbortSignal.timeout(10000) });
    const [ready] = await once(child.stdout, "data", { signal: AbortSignal.timeout(5000) });
    assert.equal(ready.toString(), "fence ready\n");

    function dotTrust(key, mode) {
      const result = spawnSync("/bin/bash", [dotfiles, "trust", "fixture-plugin", "--signer", key, mode], {
        env,
        encoding: "utf8",
        timeout: 3500,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      return result.status;
    }

    assert.equal(dotTrust(second, "--yes"), 75);
    assert.deepEqual(readFileSync(registry), baseline);
    assert.equal(dotTrust(first, "--revoke"), 75);
    assert.deepEqual(readFileSync(registry), baseline);
    console.log("Dotfiles trust and revoke refused before changing bytes");
    writeFileSync(release, "ready\n");
    assert.deepEqual(await childExit, [0, null]);
    assert.equal(dotTrust(second, "--yes"), 0);
    assert.equal(dotTrust(first, "--revoke"), 0);
    assert.deepEqual(signersFor("fixture-plugin"), [second]);
    console.log("Dotfiles trust and revoke succeeded after release");
    revokeSigner("fixture-neighbor", first);
    assert.deepEqual(signersFor("fixture-neighbor"), []);
    assert.deepEqual(signersFor("fixture-plugin"), [second]);
    const after = statSync(lock);
    assert.deepEqual([after.dev, after.ino, after.uid, after.mode], [identity.dev, identity.ino, identity.uid, identity.mode]);
    console.log("Agentbrew revoked its key and preserved the other writer's key and lock");
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
}
