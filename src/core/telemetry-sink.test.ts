import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogDir } from "../sync/scheduler-paths.js";
import { logSkipped } from "./logger.js";
import {
  askOnFirstRun,
  buildBatch,
  DEFAULT_URL,
  loadState,
  send,
  sendDaily,
  sendDailyDue,
  setConsent,
  status,
} from "./telemetry.js";
import { cleanErrorLine, ERROR_LOG_FILES, readSinkPolicy, sinkFingerprint } from "./telemetry-sink.js";

vi.mock("./logger.js", async (original) => ({
  ...(await original<typeof import("./logger.js")>()),
  logSkipped: vi.fn(),
}));

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = "org-secret-token-1234";
const URL_OK = "https://splunk.example.com:8088/services/collector/event";
const HEC = { version: 1, kind: "splunk-hec", url: URL_OK, token: { env: "ORG_HEC_TOKEN" } };
const rows = [
  JSON.stringify({ ts: "2026-11-09T10:00:00.000Z", event: "sync", story: "US06", ok: true, ms: 900 }),
  JSON.stringify({ ts: "2026-11-09T11:00:00.000Z", event: "command", command: "status", ok: true, ms: 41 }),
];
const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));
type Fetch = ReturnType<typeof vi.fn>;
const callsTo = (f: Fetch, url: string) => f.mock.calls.filter((c) => c[0] === url);
const bodyText = (f: Fetch, call = 0) => (f.mock.calls[call] as unknown as [string, { body: string }])[1].body;
const allBodies = (f: Fetch) => f.mock.calls.map((_, i) => bodyText(f, i)).join("\n");
const hecObjects = (f: Fetch, call = 0) =>
  bodyText(f, call)
    .split("\n")
    .map((l) => JSON.parse(l));

let dir: string;
const state = () => JSON.parse(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8"));
const seed = (extra: Record<string, unknown> = {}) =>
  writeFileSync(
    process.env.AGENTBREW_TELEMETRY_STATE as string,
    JSON.stringify({ installId: ID, sent: 0, consent: "yes", consentAt: "2026-01-01T00:00:00.000Z", ...extra }),
  );
const writeLog = (r: string[]) => writeFileSync(process.env.AGENTBREW_EVENTS_FILE as string, `${r.join("\n")}\n`);
function policy(obj: unknown, mode = 0o600): void {
  const file = process.env.AGENTBREW_TELEMETRY_SINK_FILE as string;
  writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj), { mode });
  chmodSync(file, mode);
}
/** Seeds the state as if the policy had been seen before, so the cursor is not moved by rule 9. */
function adopt(extra: Record<string, unknown> = {}): void {
  seed({ sinkFp: sinkFingerprint(readSinkPolicy()), ...extra });
}
const filePath = () => join(homedir(), ".local", "org-sink", "events.jsonl");
const logDir = () => getLogDir();
const writeErr = (name: string, text: string) => {
  mkdirSync(logDir(), { recursive: true });
  writeFileSync(join(logDir(), name), text);
};

describe("org log sink", () => {
  const env = { ...process.env };
  beforeEach(() => {
    // The scratch HOME is shared by every test in this file; start each one clean.
    for (const name of [".local", "d", "real.jsonl", "elsewhere.jsonl", "hec-token"]) {
      rmSync(join(homedir(), name), { recursive: true, force: true });
    }
    dir = mkdtempSync(join(tmpdir(), "ab-sink-"));
    process.env.AGENTBREW_EVENTS_FILE = join(dir, "events.jsonl");
    process.env.AGENTBREW_TELEMETRY_STATE = join(dir, "telemetry.json");
    process.env.AGENTBREW_TELEMETRY_SINK_FILE = join(dir, "telemetry-sink.json");
    process.env.AGENTBREW_POSTHOG_KEY = "phc_test";
    process.env.ORG_HEC_TOKEN = TOKEN;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    delete process.env.AGENTBREW_TELEMETRY;
    delete process.env.AGENTBREW_TELEMETRY_ASK;
    writeLog(rows);
    seed();
    vi.mocked(logSkipped).mockClear();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  describe("1, 4: no policy and kind posthog behave as before", () => {
    it("sends the PostHog body to the public default", async () => {
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
      expect((f.mock.calls[0] as unknown[])[0]).toBe(DEFAULT_URL);
      expect(JSON.parse(bodyText(f))).toEqual(buildBatch(rows, "phc_test", ID, "1.2.3"));
      expect(status().sink).toBeUndefined();
    });

    it("kind posthog is the same request", async () => {
      policy({ version: 1, kind: "posthog" });
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
      expect((f.mock.calls[0] as unknown[])[0]).toBe(DEFAULT_URL);
      expect(JSON.parse(bodyText(f))).toEqual(buildBatch(rows, "phc_test", ID, "1.2.3"));
    });
  });

  describe("2: an invalid policy sends nothing and asks nothing", () => {
    const cases: [string, unknown, string?][] = [
      ["bad json", "{not json", "bad-json"],
      ["wrong version", { ...HEC, version: 2 }, "bad-version"],
      ["unknown key", { ...HEC, extra: 1 }, "unknown-key"],
      ["unknown kind", { version: 1, kind: "other" }, "bad-kind"],
      ["bad consent", { ...HEC, consent: "always" }, "bad-consent"],
      ["managed with posthog", { version: 1, kind: "posthog", consent: "managed" }, "managed-needs-org-sink"],
      ["error logs with posthog", { version: 1, kind: "posthog", error_logs: true }, "error-logs-need-org-sink"],
      ["error logs with off", { version: 1, kind: "off", error_logs: true }, "error-logs-need-org-sink"],
      ["http url", { ...HEC, url: "http://splunk.example.com/x" }, "url-not-https"],
      ["user info in url", { ...HEC, url: "https://u:p@splunk.example.com/x" }, "url-userinfo"],
      ["missing url", { version: 1, kind: "splunk-hec", token: HEC.token }, "missing-url"],
      ["missing token", { version: 1, kind: "splunk-hec", url: URL_OK }, "missing-token"],
      ["two token sources", { ...HEC, token: { env: "A", file: "~/x" } }, "bad-token"],
      ["bad keychain", { ...HEC, token: { keychain: { service: "s" } } }, "bad-token"],
      ["bad index", { ...HEC, index: "has space" }, "bad-index"],
      ["bad sourcetype", { ...HEC, sourcetype: "x".repeat(65) }, "bad-sourcetype"],
      ["file without path", { version: 1, kind: "file" }, "bad-path"],
      ["path outside home", { version: 1, kind: "file", path: "/etc/x.jsonl" }, "path-outside-home"],
      ["path climbs out of home", { version: 1, kind: "file", path: "~/../x.jsonl" }, "path-outside-home"],
    ];
    for (const [name, obj, code] of cases) {
      it(name, async () => {
        policy(obj);
        const st = status();
        expect(st).toMatchObject({ on: false, reason: `sink policy invalid: ${code}` });
        const f = ok();
        const asked = vi.fn(async () => "y");
        seed({ consent: undefined });
        await askOnFirstRun("1.2.3", { interactive: true, ask: asked, write: () => {}, now: NOW });
        expect(asked).not.toHaveBeenCalled();
        seed();
        expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe(`sink policy invalid: ${code}`);
        expect(f).not.toHaveBeenCalled();
        expect(JSON.stringify(st)).not.toContain(TOKEN);
      });
    }

    it("a file that others can write", async () => {
      policy(HEC, 0o666);
      expect(status()).toMatchObject({ on: false, reason: "sink policy invalid: writable-by-others" });
      policy(HEC, 0o620);
      expect(status().reason).toBe("sink policy invalid: writable-by-others");
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(f).not.toHaveBeenCalled();
    });

    it("a symlink as the sink file path", () => {
      const target = join(homedir(), "real.jsonl");
      writeFileSync(target, "");
      mkdirSync(join(homedir(), "d"), { recursive: true });
      symlinkSync(target, join(homedir(), "d", "link.jsonl"));
      policy({ version: 1, kind: "file", path: "~/d/link.jsonl" });
      expect(status().reason).toBe("sink policy invalid: path-symlink");
    });

    it("the reason never shows file content", () => {
      policy(`{"version":1,"kind":"splunk-hec","token":"${TOKEN}", oops`);
      expect(JSON.stringify(status())).not.toContain(TOKEN);
    });
  });

  describe("3: kind off", () => {
    it("sends nothing, asks nothing, says why", async () => {
      policy({ version: 1, kind: "off" });
      expect(status()).toMatchObject({ on: false, reason: "off by org policy" });
      const asked = vi.fn(async () => "y");
      seed({ consent: undefined });
      await askOnFirstRun("1.2.3", { interactive: true, ask: asked, write: () => {}, now: NOW });
      expect(asked).not.toHaveBeenCalled();
      seed();
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("off by org policy");
      expect(f).not.toHaveBeenCalled();
    });
  });

  describe("5: splunk-hec", () => {
    it("posts one JSON object per event to the url, with the Splunk header, and never touches the public default", async () => {
      policy({ ...HEC, index: "devtools", sourcetype: "tool:telemetry", source: "tool" });
      adopt();
      const keychain = vi.fn(() => "phc_fromKeychain");
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW, keychain })).toEqual({ sent: 2 });
      expect(f).toHaveBeenCalledTimes(1);
      expect(callsTo(f, DEFAULT_URL)).toHaveLength(0);
      const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
      expect(url).toBe(URL_OK);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ authorization: `Splunk ${TOKEN}`, "content-type": "application/json" });
      const objs = hecObjects(f);
      expect(objs).toHaveLength(2);
      expect(objs[0]).toEqual({
        time: Date.parse("2026-11-09T10:00:00.000Z") / 1000,
        source: "tool",
        sourcetype: "tool:telemetry",
        index: "devtools",
        event: {
          event: "agentbrew.sync",
          story: "US06",
          ok: true,
          duration_ms: 900,
          app_version: "1.2.3",
          os: expect.any(String),
          arch: expect.any(String),
          runtime: "ts",
          install_id: ID,
          version: "1.2.3",
        },
      });
      expect(bodyText(f)).not.toContain("phc_");
      expect(keychain).not.toHaveBeenCalled();
      expect(state().sent).toBe(2);
    });

    it("defaults: sourcetype agentbrew:telemetry, source agentbrew, no index key", async () => {
      policy(HEC);
      adopt();
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      const [first] = hecObjects(f);
      expect(first).toMatchObject({ source: "agentbrew", sourcetype: "agentbrew:telemetry" });
      expect(first).not.toHaveProperty("index");
    });

    it("the Keychain token source asks the Keychain, not the PostHog key sources", () => {
      policy({ ...HEC, token: { keychain: { service: "org-telemetry", account: "hec_token" } } });
      expect(status().sink).toMatchObject({ kind: "splunk-hec", tokenSource: "keychain" });
    });

    it("a token file must not be readable by group or others", async () => {
      const tokenFile = join(homedir(), "hec-token");
      writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o644 });
      chmodSync(tokenFile, 0o644);
      policy({ ...HEC, token: { file: "~/hec-token" } });
      adopt();
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("sink token unavailable");
      expect(f).not.toHaveBeenCalled();
      chmodSync(tokenFile, 0o600);
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
      expect(
        (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers.authorization,
      ).toBe(`Splunk ${TOKEN}`);
    });

    it("a token with whitespace or over 512 chars is no token", async () => {
      policy(HEC);
      adopt();
      for (const bad of ["has space", "x".repeat(513), "tab\there", ""]) {
        process.env.ORG_HEC_TOKEN = bad;
        const f = ok();
        expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("sink token unavailable");
        expect(f).not.toHaveBeenCalled();
      }
    });

    it("a non-2xx answer keeps the cursor", async () => {
      policy(HEC);
      adopt();
      const f = vi.fn(async () => new Response("no", { status: 503 }));
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 0, skipped: "http 503" });
      expect(state().sent).toBe(0);
    });

    it("end to end: a real local server receives the events in the documented shape", async () => {
      policy(HEC);
      adopt();
      const received: { url?: string; auth?: string; body: string }[] = [];
      const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => {
          body += c;
        });
        req.on("end", () => {
          received.push({ url: req.url, auth: req.headers.authorization, body });
          res.end("{}");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const { port } = server.address() as { port: number };
      // The policy needs https, so the test sends the request to the local http server in its place.
      const toLocal = ((input: string, init: RequestInit) =>
        fetch(`http://127.0.0.1:${port}${new URL(input).pathname}`, init)) as unknown as typeof fetch;
      try {
        expect(await send("1.2.3", { fetchImpl: toLocal, now: NOW })).toEqual({ sent: 2 });
      } finally {
        server.close();
      }
      expect(received).toHaveLength(1);
      expect(received[0].url).toBe("/services/collector/event");
      expect(received[0].auth).toBe(`Splunk ${TOKEN}`);
      const objs = received[0].body.split("\n").map((l) => JSON.parse(l));
      expect(objs.map((o) => o.event.event)).toEqual(["agentbrew.sync", "agentbrew.command"]);
      expect(objs.every((o) => typeof o.time === "number")).toBe(true);
    });
  });

  describe("6: kind file", () => {
    it("appends one JSON line per event, makes no request, and sets modes", async () => {
      policy({ version: 1, kind: "file", path: "~/.local/org-sink/events.jsonl" });
      adopt();
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
      expect(f).not.toHaveBeenCalled();
      const out = readFileSync(filePath(), "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({
        event: "agentbrew.sync",
        story: "US06",
        install_id: ID,
        version: "1.2.3",
        time: "2026-11-09T10:00:00.000Z",
        sourcetype: "agentbrew:telemetry",
      });
      expect(statSync(filePath()).mode & 0o777).toBe(0o600);
      expect(statSync(join(homedir(), ".local", "org-sink")).mode & 0o777).toBe(0o700);
    });

    it("a file over 10 MB is renamed to .1 and a new file starts", async () => {
      policy({ version: 1, kind: "file", path: "~/.local/org-sink/events.jsonl" });
      adopt();
      mkdirSync(join(homedir(), ".local", "org-sink"), { recursive: true });
      writeFileSync(filePath(), "x".repeat(10 * 1024 * 1024 + 1));
      writeFileSync(`${filePath()}.1`, "old");
      await send("1.2.3", { fetchImpl: ok(), now: NOW });
      expect(statSync(`${filePath()}.1`).size).toBe(10 * 1024 * 1024 + 1);
      expect(readFileSync(filePath(), "utf-8").trim().split("\n")).toHaveLength(2);
    });

    it("a symlink at the path is refused at write time", async () => {
      policy({ version: 1, kind: "file", path: "~/.local/org-sink/events.jsonl" });
      adopt();
      mkdirSync(join(homedir(), ".local", "org-sink"), { recursive: true });
      const target = join(homedir(), "elsewhere.jsonl");
      writeFileSync(target, "");
      symlinkSync(target, filePath());
      // The policy check sees the link first, so nothing is written either way.
      expect(status().reason).toBe("sink policy invalid: path-symlink");
      expect(readFileSync(target, "utf-8")).toBe("");
    });
  });

  describe("7: consent with an org sink", () => {
    it("ask: the question names the destination, and the stored answer decides", async () => {
      policy(HEC);
      seed({ consent: undefined });
      const written: string[] = [];
      const asked = vi.fn(async () => "y");
      await askOnFirstRun("1.2.3", { interactive: true, ask: asked, write: (t) => written.push(t), now: NOW });
      expect(asked).toHaveBeenCalledTimes(1);
      const text = written.join("");
      expect(text).toContain("your organization's log system at splunk.example.com:8088");
      expect(text).not.toContain("PostHog EU");
      expect(status()).toMatchObject({ on: true, reason: "on", sink: { consentSource: "ask" } });
      seed({ consent: undefined });
      expect(status()).toMatchObject({ on: false, reason: "not answered yet" });
    });

    it("ask: a org sink needs no PostHog key to ask", async () => {
      policy(HEC);
      seed({ consent: undefined });
      process.env.AGENTBREW_POSTHOG_KEY = "";
      const asked = vi.fn(async () => "n");
      await askOnFirstRun("1.2.3", { interactive: true, ask: asked, write: () => {}, now: NOW });
      expect(asked).toHaveBeenCalledTimes(1);
    });

    it("managed: sends without a stored yes, never asks, and says so", async () => {
      policy({ ...HEC, consent: "managed" });
      adopt();
      seed({ consent: undefined, sinkFp: sinkFingerprint(readSinkPolicy()) });
      expect(status()).toMatchObject({ on: true, reason: "managed by org policy", sink: { consentSource: "managed" } });
      const asked = vi.fn(async () => "y");
      await askOnFirstRun("1.2.3", { interactive: true, ask: asked, write: () => {}, now: NOW });
      expect(asked).not.toHaveBeenCalled();
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
    });

    it("managed: a stored no still stops it, and `telemetry on` clears that", async () => {
      policy({ ...HEC, consent: "managed" });
      adopt({ consent: "no" });
      const f = ok();
      expect(status()).toMatchObject({ on: false, reason: "you said no" });
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("you said no");
      expect(f).not.toHaveBeenCalled();
      setConsent("yes", NOW);
      expect(status()).toMatchObject({ on: true, reason: "managed by org policy" });
    });
  });

  describe("8: env off switches stop every sink, managed too", () => {
    for (const [name, value] of [
      ["DO_NOT_TRACK", "1"],
      ["CI", "true"],
      ["AGENTBREW_TELEMETRY", "0"],
    ] as const) {
      for (const sink of [
        { ...HEC, consent: "managed" },
        { version: 1, kind: "file", consent: "managed", path: "~/.local/org-sink/events.jsonl" },
      ]) {
        it(`${name} with ${sink.kind}`, async () => {
          policy(sink);
          adopt();
          process.env[name] = value;
          const f = ok();
          expect(status().on).toBe(false);
          expect((await send("1.2.3", { fetchImpl: f, now: NOW })).sent).toBe(0);
          expect(f).not.toHaveBeenCalled();
          expect(existsSync(filePath())).toBe(false);
          expect(sendDailyDue({ now: NOW })).toBe(false);
        });
      }
    }
  });

  describe("9: a changed destination moves the cursor to the end", () => {
    it("first sight of a policy skips the recorded events, then new ones go to the new sink", async () => {
      policy(HEC);
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 0, skipped: "destination changed" });
      expect(f).not.toHaveBeenCalled();
      expect(state()).toMatchObject({ sent: 2, sinkFp: "splunk-hec:splunk.example.com:8088" });
      expect(JSON.stringify(state())).not.toContain(TOKEN);
      writeLog([
        ...rows,
        JSON.stringify({ ts: "2026-11-09T11:30:00.000Z", event: "command", command: "sync", ok: true, ms: 5 }),
      ]);
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 1 });
      expect(callsTo(f, URL_OK)).toHaveLength(1);
    });

    it("a changed host, and a removed policy, each move it again", async () => {
      policy(HEC);
      adopt();
      policy({ ...HEC, url: "https://other.example.com/x" });
      writeLog([...rows, rows[0]]);
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("destination changed");
      expect(state().sent).toBe(3);
      writeLog([...rows, rows[0], rows[1]]);
      // Removing the policy goes back to the public default: the event above is not uploaded there.
      process.env.AGENTBREW_TELEMETRY_SINK_FILE = join(dir, "gone.json");
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("destination changed");
      expect(state()).toMatchObject({ sent: 4, sinkFp: "public" });
      expect(f).not.toHaveBeenCalled();
    });

    it("events recorded while the policy says off never go to the public default", async () => {
      policy({ version: 1, kind: "off" });
      // The cheap check after any command notes the change, with no send.
      expect(sendDailyDue({ now: NOW })).toBe(false);
      expect(state()).toMatchObject({ sent: 2, sinkFp: "off" });
      writeLog([...rows, rows[0]]);
      process.env.AGENTBREW_TELEMETRY_SINK_FILE = join(dir, "gone.json");
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("destination changed");
      expect(state()).toMatchObject({ sent: 3, sinkFp: "public" });
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(f).not.toHaveBeenCalled();
    });

    it("events recorded under an invalid policy never go to the public default", async () => {
      policy("{");
      const f = ok();
      // A manual send notes the change too.
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toContain("sink policy invalid");
      expect(state()).toMatchObject({ sent: 2, sinkFp: "invalid" });
      writeLog([...rows, rows[0]]);
      process.env.AGENTBREW_TELEMETRY_SINK_FILE = join(dir, "gone.json");
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("destination changed");
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(f).not.toHaveBeenCalled();
    });

    it("events recorded while off do not go to the org sink when it comes back", async () => {
      policy(HEC);
      adopt({ sent: 2 });
      policy({ version: 1, kind: "off" });
      expect(sendDailyDue({ now: NOW })).toBe(false);
      writeLog([...rows, rows[0]]);
      policy(HEC);
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).skipped).toBe("destination changed");
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(f).not.toHaveBeenCalled();
    });

    it("with no state file an off policy makes none", async () => {
      rmSync(process.env.AGENTBREW_TELEMETRY_STATE as string, { force: true });
      policy({ version: 1, kind: "off" });
      expect(sendDailyDue({ now: NOW })).toBe(false);
      await send("1.2.3", { fetchImpl: ok(), now: NOW });
      expect(existsSync(process.env.AGENTBREW_TELEMETRY_STATE as string)).toBe(false);
    });

    it("a public install with no policy keeps its cursor (no stored fingerprint is the public default)", async () => {
      const f = ok();
      expect(await send("1.2.3", { fetchImpl: f, now: NOW })).toEqual({ sent: 2 });
    });

    it("the fingerprint is kind plus host or path, never the token", () => {
      policy(HEC);
      expect(sinkFingerprint(readSinkPolicy())).toBe("splunk-hec:splunk.example.com:8088");
      policy({ version: 1, kind: "file", path: "~/.local/org-sink/events.jsonl" });
      expect(sinkFingerprint(readSinkPolicy())).toBe(`file:${filePath()}`);
    });
  });

  describe("10: the token never leaks", () => {
    it("status, dry run, logs, and errors hold no token; dry run shows <token>", async () => {
      policy(HEC);
      adopt();
      const st = status();
      expect(st.sink).toEqual({
        kind: "splunk-hec",
        target: "splunk.example.com:8088",
        consentSource: "ask",
        errorLogs: false,
        tokenSource: "env",
      });
      const dry = await send("1.2.3", { dryRun: true, now: NOW });
      expect(JSON.stringify(dry)).toContain("Splunk <token>");
      expect(JSON.stringify([st, dry])).not.toContain(TOKEN);
      const boom = vi.fn(async () => {
        throw Object.assign(new Error(`connect failed with Splunk ${TOKEN}`), { name: "FetchError" });
      });
      const out = await send("1.2.3", { fetchImpl: boom, now: NOW });
      expect(out.skipped).toBe("network");
      expect(JSON.stringify(out)).not.toContain(TOKEN);
      expect(JSON.stringify(vi.mocked(logSkipped).mock.calls)).not.toContain(TOKEN);
      expect(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8")).not.toContain(TOKEN);
    });
  });

  describe("11: error logs", () => {
    const fileList = [...ERROR_LOG_FILES];
    beforeEach(() => {
      policy({ ...HEC, error_logs: true });
    });

    it("the fixed list holds the files agentbrew's own plists write", () => {
      expect(fileList).toEqual(["launchagent.err", "mcp-memory.err.log", "mcp-memory-maintain.err.log"]);
    });

    it("the first send records where each file ends; later sends forward only new lines", async () => {
      writeErr("launchagent.err", "old line\n");
      adopt();
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(f).toHaveBeenCalledTimes(1);
      expect(allBodies(f)).not.toContain("old line");
      writeErr("launchagent.err", "old line\nnew line\n");
      const g = ok();
      const out = await send("1.2.3", { fetchImpl: g, now: NOW });
      expect(out.errorLines).toBe(1);
      const [obj] = hecObjects(g, g.mock.calls.length - 1);
      expect(obj).toMatchObject({
        sourcetype: "agentbrew:error_log",
        event: { event: "agentbrew.error_log", file: "launchagent.err", line: "new line", install_id: ID },
      });
      // Nothing is sent twice.
      const h = ok();
      await send("1.2.3", { fetchImpl: h, now: NOW });
      expect(h).not.toHaveBeenCalled();
    });

    it("redacts URL credentials, shows the home path as ~, and cuts a line at 2000 chars", async () => {
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr(
        "launchagent.err",
        `fatal: https://user:tok3n@github.example.com/o/r.git failed in ${homedir()}/apps/x\n${"y".repeat(3000)}\n`,
      );
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      const lines = hecObjects(f, f.mock.calls.length - 1).map((o) => o.event.line as string);
      expect(lines[0]).toBe("fatal: https://***@github.example.com/o/r.git failed in ~/apps/x");
      expect(lines[1]).toHaveLength(2000);
      expect(allBodies(f)).not.toContain("tok3n");
      expect(allBodies(f)).not.toContain(homedir());
      expect(cleanErrorLine(`${homedir()}/a`)).toBe("~/a");
    });

    it("caps the lines per send (ERROR_LINES_PER_SEND) and keeps the rest for the next", async () => {
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr("launchagent.err", `${Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n")}\n`);
      const f = ok();
      expect((await send("1.2.3", { fetchImpl: f, now: NOW })).errorLines).toBe(200);
      const g = ok();
      expect((await send("1.2.3", { fetchImpl: g, now: NOW })).errorLines).toBe(50);
      expect(hecObjects(g, g.mock.calls.length - 1)[0].event.line).toBe("line 200");
    });

    it("a file that shrank is read again from the start", async () => {
      adopt({ errCursors: { "launchagent.err": 500 } });
      writeErr("launchagent.err", "fresh after trim\n");
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(hecObjects(f, f.mock.calls.length - 1)[0].event.line).toBe("fresh after trim");
    });

    it("reads only files from the fixed list, and not a half-written line", async () => {
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr("other.err", "not on the list\n");
      writeErr("launchagent.err", "whole\npartial");
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(hecObjects(f, f.mock.calls.length - 1).map((o) => o.event.line)).toEqual(["whole"]);
      expect(allBodies(f)).not.toContain("not on the list");
    });

    it("a failed send keeps the cursors", async () => {
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr("launchagent.err", "a\n");
      const bad = vi.fn(async () => new Response("", { status: 500 }));
      await send("1.2.3", { fetchImpl: bad, now: NOW });
      expect(state().errCursors["launchagent.err"]).toBe(0);
    });

    it("the file sink gets error lines too", async () => {
      policy({ version: 1, kind: "file", error_logs: true, path: "~/.local/org-sink/events.jsonl" });
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr("launchagent.err", "boom\n");
      await send("1.2.3", { fetchImpl: ok(), now: NOW });
      const last = readFileSync(filePath(), "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .pop();
      expect(last).toMatchObject({
        event: "agentbrew.error_log",
        file: "launchagent.err",
        line: "boom",
        sourcetype: "agentbrew:error_log",
      });
    });

    it("with kind posthog or no policy, no error-log event is sent", async () => {
      writeErr("launchagent.err", "secret failure\n");
      for (const p of [{ version: 1, kind: "posthog" }, undefined]) {
        if (p) policy(p);
        else process.env.AGENTBREW_TELEMETRY_SINK_FILE = join(dir, "none.json");
        seed({ errCursors: { "launchagent.err": 0 } });
        writeLog(rows);
        const f = ok();
        await send("1.2.3", { fetchImpl: f, now: NOW });
        expect(f).toHaveBeenCalledTimes(1);
        expect(allBodies(f)).not.toContain("error_log");
        expect(allBodies(f)).not.toContain("secret failure");
        expect((f.mock.calls[0] as unknown[])[0]).toBe(DEFAULT_URL);
      }
    });

    it("error_logs false forwards nothing and drops old cursors", async () => {
      policy(HEC);
      adopt({ errCursors: { "launchagent.err": 0 } });
      writeErr("launchagent.err", "x\n");
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(allBodies(f)).not.toContain("error_log");
      expect(state().errCursors).toBeUndefined();
    });
  });

  describe("12: names come from fixed lists", () => {
    it("a made-up command or story name never reaches an org body", async () => {
      policy(HEC);
      adopt();
      writeLog([
        JSON.stringify({ ts: "2026-11-09T10:00:00.000Z", event: "command", command: "my-secret-cmd", ok: true, ms: 1 }),
        JSON.stringify({
          ts: "2026-11-09T10:01:00.000Z",
          event: "sync",
          module: "secret-module-name",
          ok: true,
          ms: 1,
        }),
        JSON.stringify({ ts: "2026-11-09T10:02:00.000Z", event: "made-up-event", ok: true, ms: 1 }),
      ]);
      const f = ok();
      await send("1.2.3", { fetchImpl: f, now: NOW });
      expect(bodyText(f)).not.toContain("my-secret-cmd");
      expect(bodyText(f)).not.toContain("secret-module-name");
      expect(bodyText(f)).not.toContain("made-up-event");
    });
  });

  describe("13: status shows the sink", () => {
    it("kind and host, consent source, error logs, token source", () => {
      policy({ ...HEC, consent: "managed", error_logs: true });
      expect(status().sink).toEqual({
        kind: "splunk-hec",
        target: "splunk.example.com:8088",
        consentSource: "managed",
        errorLogs: true,
        tokenSource: "env",
      });
    });

    it("a file sink shows its path with ~", () => {
      policy({ version: 1, kind: "file", path: `${homedir()}/.local/org-sink/events.jsonl` });
      expect(status().sink?.target).toBe("~/.local/org-sink/events.jsonl");
      expect(JSON.stringify(status())).not.toContain(homedir());
    });
  });

  describe("14: the scheduled send follows the same rules", () => {
    it("managed: the daily send is due and sends", async () => {
      policy({ ...HEC, consent: "managed" });
      adopt({ consent: undefined });
      process.env.AGENTBREW_POSTHOG_KEY = "";
      expect(sendDailyDue({ now: NOW, keychain: () => "" })).toBe(true);
      const f = ok();
      await sendDaily("1.2.3", { now: NOW, fetchImpl: f, keychain: () => "" });
      expect(callsTo(f, URL_OK)).toHaveLength(1);
      expect(callsTo(f, DEFAULT_URL)).toHaveLength(0);
    });

    it("off and an invalid policy: not due, nothing sent", async () => {
      for (const p of [{ version: 1, kind: "off" }, { version: 2 }]) {
        policy(p);
        seed();
        const f = ok();
        expect(sendDailyDue({ now: NOW })).toBe(false);
        await sendDaily("1.2.3", { now: NOW, fetchImpl: f });
        expect(f).not.toHaveBeenCalled();
      }
    });

    it("ask without a stored yes is not due", () => {
      policy(HEC);
      adopt({ consent: undefined });
      expect(sendDailyDue({ now: NOW })).toBe(false);
    });
  });

  it("state keeps loading after a sink field is added", () => {
    seed({ sinkFp: "splunk-hec:splunk.example.com", errCursors: { "launchagent.err": 3, bad: -1 } });
    expect(loadState()).toMatchObject({
      sinkFp: "splunk-hec:splunk.example.com",
      errCursors: { "launchagent.err": 3 },
    });
  });
});
