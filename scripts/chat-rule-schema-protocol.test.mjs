import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import test from "node:test";
import { requestDecision } from "./chat-rule-schema-protocol.mjs";

const fixedError = "Chat decision response unavailable";
const schema = {
  type: "object",
  properties: { action: { type: "string", enum: ["EDIT", "POST", "HOLD"] } },
  required: ["action"],
  additionalProperties: false,
};

async function guarded(fn) {
  let network = 0;
  const deny = () => {
    network++;
    throw new Error("network blocked");
  };
  const originals = {
    fetch: globalThis.fetch,
    connect: net.connect,
    createConnection: net.createConnection,
    socketConnect: net.Socket.prototype.connect,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    stdout: process.stdout.write,
    stderr: process.stderr.write,
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };
  const captured = { stdout: "", stderr: "", console: "" };
  globalThis.fetch = deny;
  net.connect = deny;
  net.createConnection = deny;
  net.Socket.prototype.connect = deny;
  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  process.stdout.write = (chunk) => {
    captured.stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    captured.stderr += String(chunk);
    return true;
  };
  console.log =
    console.error =
    console.warn =
    console.info =
    console.debug =
      (...args) => {
        captured.console += args.map(String).join(" ");
      };
  try {
    const marker = "synthetic-capture-canary";
    process.stdout.write(marker);
    process.stderr.write(marker);
    for (const method of ["log", "error", "warn", "info", "debug"]) {
      captured.console = "";
      console[method](marker);
      assert.ok(captured.console.includes(marker));
    }
    assert.ok(captured.stdout.includes(marker));
    assert.ok(captured.stderr.includes(marker));
    assert.ok(String(new Error(marker)).includes(marker));
    captured.stdout = "";
    captured.stderr = "";
    captured.console = "";
    await fn(captured);
    assert.equal(network, 0);
  } finally {
    globalThis.fetch = originals.fetch;
    net.connect = originals.connect;
    net.createConnection = originals.createConnection;
    net.Socket.prototype.connect = originals.socketConnect;
    http.request = originals.httpRequest;
    http.get = originals.httpGet;
    https.request = originals.httpsRequest;
    https.get = originals.httpsGet;
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
    console.log = originals.log;
    console.error = originals.error;
    console.warn = originals.warn;
    console.info = originals.info;
    console.debug = originals.debug;
  }
}

function fakeResponse(content, marker = "") {
  let calls = 0;
  const requests = [];
  return {
    transport: async (url, options) => {
      calls++;
      requests.push({ url, options });
      return { ok: true, text: async () => JSON.stringify({ message: { content }, marker }) };
    },
    calls: () => calls,
    requests,
  };
}
async function refuses(captured, content, marker) {
  const fake = fakeResponse(content, marker);
  let error;
  try {
    await requestDecision("synthetic prompt", fake.transport);
  } catch (caught) {
    error = caught;
  }
  assert.equal(fake.calls(), 1);
  assert.equal(error?.message, fixedError);
  for (const channel of [...Object.values(captured), String(error)]) assert.ok(!channel.includes(marker));
}

test("valid enum decisions", async () =>
  guarded(async () => {
    let calls = 0;
    for (const value of ["EDIT", "POST", "HOLD"]) {
      const fake = fakeResponse(JSON.stringify({ action: value }));
      assert.equal(await requestDecision("synthetic prompt", fake.transport), value);
      calls += fake.calls();
    }
    assert.equal(calls, 3);
  }));

test("exact request schema", async () =>
  guarded(async () => {
    const fake = fakeResponse('{"action":"EDIT"}');
    assert.equal(await requestDecision("synthetic prompt", fake.transport), "EDIT");
    assert.equal(fake.calls(), 1);
    const [{ url, options }] = fake.requests;
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    assert.deepEqual(options, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:4b",
        stream: false,
        think: false,
        options: { temperature: 0 },
        format: schema,
        messages: [{ role: "user", content: "synthetic prompt" }],
      }),
    });
  }));

test("malformed JSON refused", async () =>
  guarded(async (captured) => {
    const values = [
      '{"action":"EDIT"',
      "",
      '/* malformed-marker-2 */{"action":"EDIT"}',
      '{"action":"EDIT",}',
      '{"action":"EDIT"} malformed-marker-4',
      '{"action":"EDIT"}{"note":"malformed-marker-5"}',
    ];
    for (const [index, value] of values.entries()) await refuses(captured, value, `malformed-marker-${index}`);
  }));

test("missing key refused", async () => guarded(async (c) => refuses(c, "{}", "missing-marker")));
test("extra key refused", async () =>
  guarded(async (c) => refuses(c, '{"action":"EDIT","extra":"x"}', "extra-marker")));
test("unknown enum refused", async () => guarded(async (c) => refuses(c, '{"action":"OTHER"}', "enum-marker")));
test("non-string refused", async () => guarded(async (c) => refuses(c, '{"action":5}', "type-marker")));
test("duplicate key refused", async () =>
  guarded(async (c) => refuses(c, '{"action":"EDIT","action":"POST"}', "duplicate-marker")));
test("HTTP failure refused", async () =>
  guarded(async (captured) => {
    let calls = 0;
    const marker = "http-error-marker";
    let error;
    try {
      await requestDecision("synthetic prompt", async () => {
        calls++;
        return { ok: false, text: async () => marker };
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(calls, 1);
    assert.equal(error?.message, fixedError);
    for (const channel of [...Object.values(captured), String(error)]) assert.ok(!channel.includes(marker));
  }));
test("transport failure refused", async () =>
  guarded(async (captured) => {
    let calls = 0;
    const marker = "transport-error-marker";
    let error;
    try {
      await requestDecision("synthetic prompt", async () => {
        calls++;
        throw new Error(marker);
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(calls, 1);
    assert.equal(error?.message, fixedError);
    for (const channel of [...Object.values(captured), String(error)]) assert.ok(!channel.includes(marker));
  }));
