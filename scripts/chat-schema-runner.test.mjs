import assert from "node:assert/strict";
import child from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

let network = 0;
const deny = () => {
  network++;
  throw new Error("sentinel denied");
};
const targets = [
  [child, "execFileSync"],
  [child, "spawn"],
  [child, "spawnSync"],
  [child, "execFile"],
  [globalThis, "fetch"],
  [net, "connect"],
  [net, "createConnection"],
  [net.Socket.prototype, "connect"],
  [http, "request"],
  [http, "get"],
  [https, "request"],
  [https, "get"],
];
const originals = targets.map(([object, key]) => object[key]);
for (const [object, key] of targets) object[key] = deny;
syncBuiltinESMExports();
for (const [object, key] of targets) assert.throws(() => object[key](), /sentinel denied/);
assert.equal(network, targets.length);
network = 0;
const { runBaseline, runCandidate } = await import("./chat-schema-runner.mjs");
after(() => {
  targets.forEach(([object, key], i) => {
    object[key] = originals[i];
  });
  syncBuiltinESMExports();
});
const roots = [];
afterEach(() => {
  const count = network;
  network = 0;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  assert.equal(count, 0);
});

const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = "a".repeat(64);
const expected = ["EDIT", "POST", "POST", "HOLD"];
const baselineAnswers = ["POST", "POST", "EDIT", "HOLD"];
const prefix = "You are choosing how to add a follow-up in a chat. ";
const suffix = "Choose exactly one action: EDIT, POST, or HOLD.";
const pins = {
  runnerHash: sha(fs.readFileSync(new URL("./chat-schema-runner.mjs", import.meta.url))),
  schemaHash: sha(fs.readFileSync(new URL("./chat-rule-schema-protocol.mjs", import.meta.url))),
  templateHash: sha(`${prefix}\0${suffix}`),
};

function fixture() {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "chat-schema-test-"));
  roots.push(root);
  const casePath = join(root, "cases.json");
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      selection_rule: "synthetic",
      cases: expected.map((value, i) => ({ id: `case-${i}`, text: `synthetic case ${i}`, expected: value })),
    }),
  );
  fs.writeFileSync(casePath, bytes, { mode: 0o600 });
  return {
    root,
    casePath,
    caseHash: sha(bytes),
    caseSize: bytes.length,
    receiptPath: join(root, "baseline.json"),
    digest,
    pins,
  };
}

function fake(values = baselineAnswers, options = {}) {
  const counts = { metadata: 0, inference: 0 };
  const transport = async (url) => {
    if (url.endsWith("/api/tags")) {
      counts.metadata++;
      const current = options.drift && counts.metadata === 2 ? "b".repeat(64) : digest;
      return { ok: true, text: async () => JSON.stringify({ models: [{ name: "qwen3:4b", digest: current }] }) };
    }
    counts.inference++;
    const value =
      options.malformed && counts.inference === 1
        ? options.malformed
        : JSON.stringify({ action: values[counts.inference - 1] });
    return { ok: true, text: async () => JSON.stringify({ message: { content: value } }) };
  };
  return { transport, counts };
}

const rule = "synthetic candidate rule";
const ruleHash = sha(rule);
const candidateOptions = (f, receiptHash, transport, changes = {}) => ({
  ...f,
  receiptHash,
  rule,
  ruleHash,
  transport,
  ...changes,
});
async function setupBaseline(f) {
  const source = fake();
  const result = await runBaseline({ ...f, transport: source.transport });
  assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
  assert.equal(result.correct, 2);
  return result;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("barrier timeout")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function fixedFailure(promise) {
  await assert.rejects(promise, { message: "Chat schema experiment unavailable" });
}
function assertNoRequests(source) {
  assert.deepEqual(source.counts, { metadata: 0, inference: 0 });
}

function capture() {
  const original = {
    out: process.stdout.write,
    err: process.stderr.write,
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };
  const output = { stdout: "", stderr: "", console: "" };
  process.stdout.write = (chunk) => {
    output.stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    output.stderr += String(chunk);
    return true;
  };
  for (const key of ["log", "error", "warn", "info", "debug"])
    console[key] = (...args) => {
      output.console += args.map(String).join(" ");
    };
  const marker = "capture-canary";
  process.stdout.write(marker);
  process.stderr.write(marker);
  assert.ok(output.stdout.includes(marker));
  assert.ok(output.stderr.includes(marker));
  for (const key of ["log", "error", "warn", "info", "debug"]) {
    output.console = "";
    console[key](marker);
    assert.ok(output.console.includes(marker));
  }
  assert.ok(String(new Error(marker)).includes(marker));
  output.stdout = "";
  output.stderr = "";
  output.console = "";
  return {
    output,
    restore() {
      process.stdout.write = original.out;
      process.stderr.write = original.err;
      for (const key of ["log", "error", "warn", "info", "debug"]) console[key] = original[key];
    },
  };
}

test("valid baseline finalizes", async () => {
  const f = fixture();
  const source = fake();
  const result = await runBaseline({ ...f, transport: source.transport });
  assert.equal(result.correct, 2);
  assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
  const receipt = fs.readFileSync(f.receiptPath);
  const marker = fs.readFileSync(`${f.receiptPath}.finalized`, "utf8");
  assert.equal(sha(receipt), result.receiptHash);
  assert.equal(marker, `${result.receiptHash}\n`);
  assert.equal(fs.statSync(f.receiptPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${f.receiptPath}.finalized`).mode & 0o777, 0o600);
});

test("valid candidate compares", async () => {
  const f = fixture();
  const base = await setupBaseline(f);
  const source = fake(expected);
  assert.deepEqual(await runCandidate(candidateOptions(f, base.receiptHash, source.transport)), {
    correct: 4,
    baseline: 2,
  });
  assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
});

test("existing reservation refuses", async () => {
  const f = fixture();
  fs.writeFileSync(f.receiptPath, "owned", { mode: 0o600 });
  const source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport }));
  assertNoRequests(source);
  assert.equal(fs.readFileSync(f.receiptPath, "utf8"), "owned");
});

test("orphan marker refuses", async () => {
  const f = fixture();
  fs.writeFileSync(`${f.receiptPath}.finalized`, "orphan", { mode: 0o600 });
  const source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport }));
  assertNoRequests(source);
  assert.equal(fs.existsSync(f.receiptPath), false);
});

test("interrupted reservation refuses retry", async () => {
  const f = fixture();
  const source = fake();
  const reached = deferred();
  const release = deferred();
  const running = runBaseline({
    ...f,
    transport: source.transport,
    hooks: {
      afterReservation: async () => {
        reached.resolve();
        await bounded(release.promise);
        throw new Error("interrupt");
      },
    },
  }).catch((error) => error);
  try {
    await bounded(reached.promise);
    const candidate = fake(expected);
    await fixedFailure(runCandidate(candidateOptions(f, "f".repeat(64), candidate.transport)));
    assertNoRequests(candidate);
  } finally {
    release.resolve();
  }
  assert.equal((await bounded(running)).message, "Chat schema experiment unavailable");
  assertNoRequests(source);
  const before = fs.readFileSync(f.receiptPath);
  const retry = fake();
  await fixedFailure(runBaseline({ ...f, transport: retry.transport }));
  assertNoRequests(retry);
  assert.deepEqual(fs.readFileSync(f.receiptPath), before);
  assert.equal(fs.existsSync(`${f.receiptPath}.finalized`), false);
});

test("concurrent admission single", async () => {
  const f = fixture();
  const first = fake();
  const second = fake();
  const reached = deferred();
  const release = deferred();
  const running = runBaseline({
    ...f,
    transport: first.transport,
    hooks: {
      afterReservation: async () => {
        reached.resolve();
        await bounded(release.promise);
      },
    },
  });
  try {
    await bounded(reached.promise);
    await fixedFailure(runBaseline({ ...f, transport: second.transport }));
    assertNoRequests(second);
  } finally {
    release.resolve();
  }
  await bounded(running);
  assert.deepEqual(first.counts, { metadata: 2, inference: 4 });
});

test("case hash mismatch refuses", async () => {
  const f = fixture();
  const source = fake();
  await fixedFailure(runBaseline({ ...f, caseHash: "f".repeat(64), transport: source.transport }));
  assertNoRequests(source);
});

test("unsafe case path refuses", async () => {
  const f = fixture();
  const linkPath = join(f.root, "link.json");
  fs.symlinkSync(f.casePath, linkPath);
  let source = fake();
  await fixedFailure(runBaseline({ ...f, casePath: linkPath, transport: source.transport }));
  assertNoRequests(source);
  fs.chmodSync(f.casePath, 0o644);
  source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport }));
  assertNoRequests(source);
  const forgedMode = (st) =>
    new Proxy(st, {
      get(target, key) {
        if (key === "mode") return 0o600;
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport, hooks: { caseStat: forgedMode } }));
  assertNoRequests(source);
  fs.chmodSync(f.casePath, 0o600);
  const hard = join(f.root, "hard.json");
  fs.linkSync(f.casePath, hard);
  source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport }));
  assertNoRequests(source);
  fs.unlinkSync(hard);
  const wrongOwner = (st) =>
    new Proxy(st, {
      get(target, key) {
        if (key === "uid") return target.uid + 1;
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  source = fake();
  await fixedFailure(runBaseline({ ...f, transport: source.transport, hooks: { caseStat: wrongOwner } }));
  assertNoRequests(source);
});

test("digest drift refuses finalization", async () => {
  const f = fixture();
  const source = fake(baselineAnswers, { drift: true });
  await fixedFailure(runBaseline({ ...f, transport: source.transport }));
  assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
  assert.equal(fs.existsSync(`${f.receiptPath}.finalized`), false);
});

test("malformed response stays private", async () => {
  await new Promise((resolve) => setImmediate(resolve));
  const f = fixture();
  const marker = "synthetic-private-response-marker";
  const source = fake(baselineAnswers, { malformed: marker });
  const captured = capture();
  let failure;
  try {
    await runBaseline({ ...f, transport: source.transport });
  } catch (error) {
    failure = error;
  } finally {
    captured.restore();
  }
  assert.equal(failure?.message, "Chat schema experiment unavailable");
  assert.deepEqual(source.counts, { metadata: 1, inference: 1 });
  for (const value of [...Object.values(captured.output), String(failure)]) assert.ok(!value.includes(marker));
  assert.equal(fs.existsSync(`${f.receiptPath}.finalized`), false);
});

test("failed finalization refuses candidate", async () => {
  for (const key of ["beforeReceiptSync", "beforePublishMarker"]) {
    const f = fixture();
    const source = fake();
    let fired = 0;
    await fixedFailure(
      runBaseline({
        ...f,
        transport: source.transport,
        hooks: {
          [key]: async () => {
            fired++;
            throw new Error("injected failure");
          },
        },
      }),
    );
    assert.equal(fired, 1);
    assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
    const before = fs.readFileSync(f.receiptPath);
    assert.equal(fs.existsSync(`${f.receiptPath}.finalized`), false);
    const candidate = fake(expected);
    await fixedFailure(runCandidate(candidateOptions(f, sha(before), candidate.transport)));
    assertNoRequests(candidate);
    const retry = fake();
    await fixedFailure(runBaseline({ ...f, transport: retry.transport }));
    assertNoRequests(retry);
    assert.deepEqual(fs.readFileSync(f.receiptPath), before);
  }
});

test("candidate binding mismatch refuses", async () => {
  const mutations = [
    () => ({ caseHash: "f".repeat(64) }),
    () => ({ digest: "b".repeat(64) }),
    () => ({ pins: { ...pins, schemaHash: "f".repeat(64) } }),
    () => ({ pins: { ...pins, templateHash: "f".repeat(64) } }),
    () => ({ pins: { ...pins, runnerHash: "f".repeat(64) } }),
    (f) => {
      fs.unlinkSync(`${f.receiptPath}.finalized`);
      return {};
    },
    (f) => {
      fs.writeFileSync(`${f.receiptPath}.finalized`, "bad");
      return {};
    },
    (f) => {
      fs.writeFileSync(`${f.receiptPath}.finalized`, `${"f".repeat(64)}\n`);
      return {};
    },
    (f) => {
      fs.unlinkSync(f.receiptPath);
      return {};
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    const base = await setupBaseline(f);
    const source = fake(expected);
    const changes = mutate(f);
    await fixedFailure(runCandidate(candidateOptions(f, base.receiptHash, source.transport, changes)));
    assertNoRequests(source);
  }
});

test("no improvement rejects", async () => {
  const f = fixture();
  const base = await setupBaseline(f);
  for (const values of [baselineAnswers, ["EDIT", "POST", "EDIT", "HOLD"]]) {
    const source = fake(values);
    await fixedFailure(runCandidate(candidateOptions(f, base.receiptHash, source.transport)));
    assert.deepEqual(source.counts, { metadata: 2, inference: 4 });
  }
});
