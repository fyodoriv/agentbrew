import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cases,
  checkThreshold,
  evaluate,
  makeReceipt,
  modelDigest,
  readReceipt,
  requestModel,
  stableCohort,
} from "./eval-chat-message-rule-821.mjs";

test("grades all four fixed synthetic decisions and passes the rule to each request", async () => {
  const prompts = [];
  const responses = ["EDIT", "POST", "POST", "HOLD"];
  const results = await evaluate("fixture rule", async (prompt) => {
    prompts.push(prompt);
    return responses.shift();
  });
  assert.equal(results.length, 4);
  assert.equal(results.filter((entry) => entry.correct).length, 4);
  assert.ok(prompts.every((prompt) => prompt.includes("fixture rule")));
});

test("detects wrong decisions and fails closed on malformed or failed transport", async () => {
  const results = await evaluate("", async () => "POST");
  assert.equal(results.filter((entry) => entry.correct).length, 2);
  await assert.rejects(
    evaluate("", async () => "maybe"),
    /Invalid response/,
  );
  await assert.rejects(
    evaluate("", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(cases.length, 4);
});

test("binds candidate comparison to the pre-change receipt", async () => {
  const results = await evaluate("", async () => "POST");
  const receipt = makeReceipt(results, "a".repeat(64), "c".repeat(64));
  const hash = createHash("sha256").update(receipt).digest("hex");
  assert.equal(readReceipt(receipt, hash, "a".repeat(64), "c".repeat(64)).filter((entry) => entry.correct).length, 2);
  assert.throws(() => readReceipt(`${receipt} `, hash, "a".repeat(64), "c".repeat(64)), /hash mismatch/);
  const altered = JSON.parse(receipt);
  altered.model = "other";
  const changed = JSON.stringify(altered);
  assert.throws(
    () => readReceipt(changed, createHash("sha256").update(changed).digest("hex"), "a".repeat(64), "c".repeat(64)),
    /identity mismatch/,
  );
  assert.throws(() => checkThreshold(2, 3), /threshold/);
  assert.throws(() => checkThreshold(4, 4), /threshold/);
  assert.doesNotThrow(() => checkThreshold(2, 4));
});

test("fails closed on transport, HTTP and malformed JSON failures", async () => {
  await assert.rejects(
    requestModel("fixture", async () => {
      throw new Error("timeout");
    }),
    /timeout/,
  );
  await assert.rejects(
    requestModel("fixture", async () => ({ ok: false, status: 500 })),
    /HTTP 500/,
  );
  await assert.rejects(
    requestModel("fixture", async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    })),
    /invalid JSON/,
  );
});

test("requires the same resolved model digest", async () => {
  const digest = "a".repeat(64);
  assert.equal(
    await modelDigest(async () => ({ ok: true, json: async () => ({ models: [{ name: "qwen3:4b", digest }] }) })),
    digest,
  );
  await assert.rejects(
    modelDigest(async () => ({ ok: true, json: async () => ({ models: [] }) })),
    /digest unavailable/,
  );
  const receipt = makeReceipt(await evaluate("", async () => "POST"), digest, "c".repeat(64));
  const hash = createHash("sha256").update(receipt).digest("hex");
  assert.throws(() => readReceipt(receipt, hash, "b".repeat(64), "c".repeat(64)), /identity mismatch/);
});

test("rejects a model digest change during a cohort", async () => {
  await assert.rejects(
    stableCohort(
      "",
      "a",
      async () => "POST",
      async () => "b",
    ),
    /changed during/,
  );
  assert.equal(
    (
      await stableCohort(
        "",
        "a",
        async () => "POST",
        async () => "a",
      )
    ).length,
    4,
  );
});

function fakeModelFixture() {
  const root = mkdtempSync(join(tmpdir(), "chat-rule-reservation-"));
  const preload = join(root, "fake-model.mjs");
  const requests = join(root, "requests.jsonl");
  writeFileSync(
    preload,
    `
import fs, { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalReadFile = fs.promises.readFile;
fs.promises.readFile = async (path, ...args) => {
  if (process.env.FAKE_CHAT_RULE && String(path).endsWith("/src/catalog.yaml")) {
    return "rules:\\n  - name: merge-recent-chat-messages\\n    content: synthetic rule\\n";
  }
  return originalReadFile(path, ...args);
};
const originalOpen = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (String(args[0]) === process.env.FAKE_CHAT_RECEIPT && (process.env.FAKE_CHAT_FAIL_SYNC || process.env.FAKE_CHAT_PAUSE_SYNC)) {
    const originalSync = handle.sync.bind(handle);
    handle.sync = async () => {
      writeFileSync(process.env.FAKE_CHAT_SYNC_SIGNAL, "sync reached");
      if (process.env.FAKE_CHAT_FAIL_SYNC) throw new Error("synthetic sync failure");
      const deadline = Date.now() + 3000;
      while (!existsSync(process.env.FAKE_CHAT_SYNC_RELEASE)) {
        if (Date.now() >= deadline) throw new Error("synthetic barrier timeout");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalSync();
    };
  }
  return handle;
};
syncBuiltinESMExports();
const originalLog = console.log;
console.log = (...args) => {
  let complete = false;
  try { complete = JSON.parse(readFileSync(process.env.FAKE_CHAT_RECEIPT, "utf8")).answers?.length === 4; } catch {}
  appendFileSync(process.env.FAKE_CHAT_REQUESTS, JSON.stringify({ kind: "report", complete }) + "\\n");
  if (process.env.FAKE_CHAT_FAIL_REPORT) throw new Error("synthetic report failure");
  originalLog(...args);
};
let generation = 0;
globalThis.fetch = async (url) => {
  const kind = String(url).endsWith("/api/tags") ? "metadata" : "generation";
  appendFileSync(process.env.FAKE_CHAT_REQUESTS, JSON.stringify({ kind }) + "\\n");
  if (process.env.FAKE_CHAT_DELAY) await new Promise((resolve) => setTimeout(resolve, 25));
  if (kind === "metadata") return { ok: true, json: async () => ({ models: [{ name: "qwen3:4b", digest: "a".repeat(64) }] }) };
  generation += 1;
  if (Number(process.env.FAKE_CHAT_FAIL_AT || 0) === generation) throw new Error("synthetic interruption");
  const answers = (process.env.FAKE_CHAT_ANSWERS || "POST,POST,POST,POST").split(",");
  return { ok: true, json: async () => ({ message: { content: answers[generation - 1] } }) };
};
`,
  );
  return {
    root,
    preload,
    requests,
    receipt: join(root, "receipt.json"),
    syncSignal: join(root, "sync-signal"),
    syncRelease: join(root, "sync-release"),
  };
}

function runBaseline(fixture, env = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      fixture.preload,
      fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url)),
      "--baseline",
      fixture.receipt,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_CHAT_REQUESTS: fixture.requests,
        FAKE_CHAT_RECEIPT: fixture.receipt,
        FAKE_CHAT_SYNC_SIGNAL: fixture.syncSignal,
        FAKE_CHAT_SYNC_RELEASE: fixture.syncRelease,
        ...env,
      },
    },
  );
}

test("existing receipt blocks model requests", () => {
  const fixture = fakeModelFixture();
  try {
    writeFileSync(fixture.receipt, "existing synthetic receipt", { mode: 0o600 });
    const child = runBaseline(fixture);
    assert.notEqual(child.status, 0);
    const requests = readEvents(fixture).filter((entry) => entry.kind !== "report");
    assert.equal(requests.length, 0, "existing receipt made model requests");
    assert.equal(readFileSync(fixture.receipt, "utf8"), "existing synthetic receipt");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function readEvents(fixture) {
  if (!existsSync(fixture.requests)) return [];
  return readFileSync(fixture.requests, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runBaselineAsync(fixture, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        fixture.preload,
        fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url)),
        "--baseline",
        fixture.receipt,
      ],
      {
        env: {
          ...process.env,
          FAKE_CHAT_REQUESTS: fixture.requests,
          FAKE_CHAT_RECEIPT: fixture.receipt,
          FAKE_CHAT_DELAY: "1",
          FAKE_CHAT_SYNC_SIGNAL: fixture.syncSignal,
          FAKE_CHAT_SYNC_RELEASE: fixture.syncRelease,
          ...env,
        },
        stdio: "ignore",
      },
    );
    const terminate = setTimeout(() => child.kill("SIGTERM"), 3800);
    const escalate = setTimeout(() => child.kill("SIGKILL"), 4200);
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("synthetic child did not terminate"));
    }, 4800);
    function cleanup() {
      clearTimeout(terminate);
      clearTimeout(escalate);
      clearTimeout(deadline);
    }
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (status) => {
      cleanup();
      resolve(status);
    });
  });
}

test("interrupted attempt blocks retry", () => {
  const fixture = fakeModelFixture();
  try {
    const first = runBaseline(fixture, { FAKE_CHAT_FAIL_AT: "2" });
    assert.notEqual(first.status, 0);
    assert.ok(existsSync(fixture.receipt));
    assert.equal(statSync(fixture.receipt).mode & 0o777, 0o600);
    const retained = readFileSync(fixture.receipt, "utf8");
    const priorEvents = readEvents(fixture);
    assert.equal(priorEvents.filter((entry) => entry.kind === "generation").length, 2);
    assert.equal(priorEvents.filter((entry) => entry.kind === "report").length, 0);
    const second = runBaseline(fixture);
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(fixture.receipt, "utf8"), retained);
    assert.deepEqual(readEvents(fixture), priorEvents);
    const hash = createHash("sha256").update(retained).digest("hex");
    const candidate = spawnSync(
      process.execPath,
      [
        "--import",
        fixture.preload,
        fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url)),
        "--candidate",
        fixture.receipt,
        hash,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, FAKE_CHAT_REQUESTS: fixture.requests, FAKE_CHAT_RECEIPT: fixture.receipt },
      },
    );
    assert.notEqual(candidate.status, 0);
    assert.match(candidate.stderr, /Baseline receipt is not finalized/);
    assert.equal(readEvents(fixture).filter((entry) => entry.kind === "generation").length, 2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("concurrent attempts admit one", async () => {
  const fixture = fakeModelFixture();
  try {
    const statuses = await Promise.all([runBaselineAsync(fixture), runBaselineAsync(fixture)]);
    assert.deepEqual(statuses.sort(), [0, 1]);
    const events = readEvents(fixture);
    assert.equal(events.filter((entry) => entry.kind === "generation").length, 4);
    assert.equal(events.filter((entry) => entry.kind === "metadata").length, 2);
    assert.equal(JSON.parse(readFileSync(fixture.receipt, "utf8")).answers.length, 4);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("complete receipt precedes report", () => {
  const fixture = fakeModelFixture();
  try {
    const child = runBaseline(fixture);
    assert.equal(child.status, 0);
    assert.equal(statSync(fixture.receipt).mode & 0o777, 0o600);
    const text = readFileSync(fixture.receipt, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    const harness = createHash("sha256")
      .update(readFileSync(fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url))))
      .digest("hex");
    assert.equal(readReceipt(text, hash, "a".repeat(64), harness).length, 4);
    const events = readEvents(fixture);
    assert.equal(events.filter((entry) => entry.kind === "generation").length, 4);
    assert.equal(events.filter((entry) => entry.kind === "metadata").length, 2);
    const reports = events.filter((entry) => entry.kind === "report");
    assert.ok(reports.length > 0 && reports.every((entry) => entry.complete));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("sync failure cannot finalize receipt", () => {
  const fixture = fakeModelFixture();
  try {
    const first = runBaseline(fixture, { FAKE_CHAT_FAIL_SYNC: "1" });
    assert.notEqual(first.status, 0);
    assert.equal(readFileSync(fixture.syncSignal, "utf8"), "sync reached");
    const text = readFileSync(fixture.receipt, "utf8");
    assert.equal(JSON.parse(text).answers.length, 4);
    const hash = createHash("sha256").update(text).digest("hex");
    const before = readEvents(fixture).filter((entry) => entry.kind === "generation").length;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        fixture.preload,
        fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url)),
        "--candidate",
        fixture.receipt,
        hash,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, FAKE_CHAT_REQUESTS: fixture.requests, FAKE_CHAT_RECEIPT: fixture.receipt },
      },
    );
    assert.notEqual(child.status, 0);
    assert.doesNotMatch(child.stdout, /baseline /, "candidate accepted unsynced receipt");
    assert.match(child.stderr, /Baseline receipt is not finalized/);
    assert.equal(readEvents(fixture).filter((entry) => entry.kind === "generation").length, before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function runCandidate(fixture, hash, env = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      fixture.preload,
      fileURLToPath(new URL("./eval-chat-message-rule-821.mjs", import.meta.url)),
      "--candidate",
      fixture.receipt,
      hash,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, FAKE_CHAT_REQUESTS: fixture.requests, FAKE_CHAT_RECEIPT: fixture.receipt, ...env },
    },
  );
}

test("inflight receipt stays unfinalized", async () => {
  const fixture = fakeModelFixture();
  const pending = runBaselineAsync(fixture, { FAKE_CHAT_PAUSE_SYNC: "1" });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(fixture.syncSignal) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(readFileSync(fixture.syncSignal, "utf8"), "sync reached");
    const text = readFileSync(fixture.receipt, "utf8");
    assert.equal(JSON.parse(text).answers.length, 4);
    const before = readEvents(fixture).filter((entry) => entry.kind === "generation").length;
    const child = runCandidate(fixture, createHash("sha256").update(text).digest("hex"));
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Baseline receipt is not finalized/);
    assert.doesNotMatch(child.stdout, /baseline /);
    assert.equal(readEvents(fixture).filter((entry) => entry.kind === "generation").length, before);
  } finally {
    try {
      writeFileSync(fixture.syncRelease, "release");
    } finally {
      try {
        assert.equal(await pending, 0);
        assert.ok(existsSync(`${fixture.receipt}.finalized`));
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  }
  const timed = fakeModelFixture();
  try {
    const started = Date.now();
    const status = await runBaselineAsync(timed, { FAKE_CHAT_PAUSE_SYNC: "1" });
    assert.equal(status, 1);
    assert.ok(Date.now() - started < 5000);
    assert.equal(readFileSync(timed.syncSignal, "utf8"), "sync reached");
    assert.ok(!existsSync(`${timed.receipt}.finalized`));
  } finally {
    rmSync(timed.root, { recursive: true, force: true });
  }
});

test("finalized receipt survives lost report", () => {
  const fixture = fakeModelFixture();
  try {
    const child = runBaseline(fixture, { FAKE_CHAT_FAIL_REPORT: "1" });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /synthetic report failure/);
    const text = readFileSync(fixture.receipt, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    const marker = `${fixture.receipt}.finalized`;
    assert.equal(statSync(marker).mode & 0o777, 0o600);
    assert.equal(readFileSync(marker, "utf8"), `${hash}\n`);
    assert.deepEqual(JSON.parse(text).answers, ["POST", "POST", "POST", "POST"]);
    const beforeCandidate = readEvents(fixture).filter((entry) => entry.kind === "generation").length;
    const candidate = runCandidate(fixture, hash, { FAKE_CHAT_RULE: "1", FAKE_CHAT_ANSWERS: "EDIT,POST,POST,HOLD" });
    assert.equal(candidate.status, 0);
    assert.match(candidate.stdout, /baseline: 2\/4/);
    assert.match(candidate.stdout, /candidate: 4\/4/);
    assert.equal(readEvents(fixture).filter((entry) => entry.kind === "generation").length - beforeCandidate, 4);
    const before = readEvents(fixture);
    assert.notEqual(runBaseline(fixture).status, 0);
    assert.deepEqual(readEvents(fixture), before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("orphan marker blocks model requests", () => {
  const fixture = fakeModelFixture();
  try {
    const marker = `${fixture.receipt}.finalized`;
    writeFileSync(marker, "orphan marker", { mode: 0o600 });
    assert.notEqual(runBaseline(fixture).status, 0);
    assert.ok(existsSync(fixture.receipt));
    assert.equal(readFileSync(marker, "utf8"), "orphan marker");
    assert.equal(readEvents(fixture).length, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const [name, marker] of [
  ["malformed marker rejected", "bad marker\n"],
  ["mismatched marker rejected", `${"b".repeat(64)}\n`],
]) {
  test(name, () => {
    const fixture = fakeModelFixture();
    try {
      assert.equal(runBaseline(fixture).status, 0);
      const text = readFileSync(fixture.receipt, "utf8");
      const hash = createHash("sha256").update(text).digest("hex");
      writeFileSync(`${fixture.receipt}.finalized`, marker);
      const before = readEvents(fixture).filter((entry) => entry.kind === "generation").length;
      const child = runCandidate(fixture, hash, { FAKE_CHAT_RULE: "1" });
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /Baseline receipt is not finalized/);
      assert.equal(readEvents(fixture).filter((entry) => entry.kind === "generation").length, before);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
