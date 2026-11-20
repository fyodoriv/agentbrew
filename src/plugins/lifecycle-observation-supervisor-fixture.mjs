import { execFileSync, spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [role, mode] = process.argv.slice(2);
const fixture = fileURLToPath(import.meta.url);
const env = { PATH: "/usr/bin:/bin" };

function record(label) {
  writeSync(1, `${label}\n`);
}

function readGroup() {
  try {
    const output = execFileSync("/bin/ps", ["-p", String(process.pid), "-o", "pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000,
    });
    const value = output.trim();
    const group = Number(value);
    return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(group) ? group : undefined;
  } catch {
    return undefined;
  }
}

function worker() {
  if (mode === "normal") process.exit(0);
  setTimeout(() => process.exit(0), 2_500);
  process.send("worker-ready");
}

function sentinel() {
  const expiry = setTimeout(() => process.exit(1), 8_000);
  process.on("SIGTERM", () => process.exit(2));
  process.once("message", (message) => {
    if (message !== "confirm") return;
    record("sentinel-normal");
    clearTimeout(expiry);
    process.exit(0);
  });
  process.send("ready");
}

function supervisor() {
  const child = spawn(process.execPath, [fixture, "worker", mode], {
    env,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let ready = false;
  let requested = false;
  let ownsSignal = false;
  let signaled = false;
  let terminal;
  let expired = false;

  function completeStop() {
    if (!signaled || !terminal) return;
    if (terminal.signal !== "SIGTERM") process.exit(3);
    record("worker-stopped");
    record("supervisor-stopped");
    process.exit(0);
  }

  function completeExpiry() {
    if (!expired || !terminal) return;
    if (terminal.code !== 0 || terminal.signal !== null) process.exit(3);
    record("worker-expired");
    record("supervisor-expired");
    process.exit(0);
  }

  // The supervisor owns both expiry and reaping for this fixture invocation.
  setTimeout(() => {
    expired = true;
    if (!terminal) process.exit(3);
    completeExpiry();
  }, 4_000);
  if (mode === "stop") {
    process.on("SIGTERM", () => {
      signaled = true;
      completeStop();
    });
  }

  child.once("error", () => process.exit(3));
  child.once("exit", (code, signal) => {
    terminal = { code, signal };
    if (mode === "normal") {
      if (code !== 0 || signal !== null) process.exit(3);
      record("worker-completed");
      process.exit(0);
    }
    if (ownsSignal) completeStop();
    else completeExpiry();
  });
  child.on("message", (message) => {
    if (message !== "worker-ready" || ready || mode === "no-ready") return;
    ready = true;
    process.send("ready");
  });

  process.on("message", (message) => {
    if (message !== "stop" || !ready || requested || expired) return;
    requested = true;
    const group = readGroup();
    if (group === undefined) {
      record("group-unavailable");
      return;
    }
    if (group !== process.pid) {
      record("wrong-group");
      return;
    }

    try {
      record("signal-attempt");
      if (mode !== "stop") throw new Error("synthetic signal refusal");
      ownsSignal = true;
      process.kill(0, "SIGTERM");
    } catch {
      ownsSignal = false;
      record("signal-failed");
    }
  });
}

if (!process.send) process.exit(3);
if (role === "worker") worker();
else if (role === "sentinel") sentinel();
else if (role === "supervisor") supervisor();
else process.exit(3);
