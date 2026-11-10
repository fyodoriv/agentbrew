import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_TIMEOUT_MS,
  askConsent,
  askOnFirstRun,
  BACKLOG_DAYS,
  BACKLOG_EVENTS,
  BATCH_SIZE,
  buildBatch,
  consentText,
  defaultKey,
  defaultKeyFile,
  loadState,
  QUESTION,
  resolveKey,
  send,
  sendDaily,
  setConsent,
  status,
} from "./telemetry.js";

const ROOT = join(import.meta.dirname, "../..");
const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const ID = "0123456789abcdef0123456789abcdef";
const lines = [
  JSON.stringify({ ts: "2026-11-09T10:00:00.000Z", event: "sync", story: "US06", ok: true, ms: 900 }),
  JSON.stringify({ ts: "2026-11-09T11:00:00.000Z", event: "command", command: "status", ok: true, ms: 41 }),
];
const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));
const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((fetchImpl.mock.calls[call] as unknown as [string, { body: string }])[1].body);

/** A state with a stored "yes", so sends are allowed. */
function seedState(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    process.env.AGENTBREW_TELEMETRY_STATE as string,
    JSON.stringify({ installId: ID, sent: 0, consent: "yes", consentAt: "2026-01-01T00:00:00.000Z", ...extra }),
  );
}
const savedState = () => JSON.parse(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8"));
const writeLog = (rows: string[]) => writeFileSync(process.env.AGENTBREW_EVENTS_FILE as string, `${rows.join("\n")}\n`);
const row = (ts: string) => JSON.stringify({ ts, event: "command", command: "status", ok: true, ms: 1 });

describe("field telemetry", () => {
  const env = { ...process.env };
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "ab-tel-"));
    process.env.AGENTBREW_EVENTS_FILE = join(dir, "events.jsonl");
    process.env.AGENTBREW_TELEMETRY_STATE = join(dir, "telemetry.json");
    process.env.AGENTBREW_POSTHOG_KEY = "phc_test";
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    delete process.env.AGENTBREW_TELEMETRY;
    delete process.env.AGENTBREW_TELEMETRY_ASK;
    writeLog(lines);
    seedState();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  describe("default key", () => {
    it("the committed file is empty or one write-only project key", () => {
      const text = readFileSync(defaultKeyFile(), "utf-8");
      expect(text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(1);
      expect(text.replace(/\n$/, "")).toMatch(/^(phc_[A-Za-z0-9]+)?$/);
    });

    it("the build ships it beside cli.js, where the built CLI reads it", () => {
      expect(defaultKeyFile()).toBe(join(ROOT, "src/core/telemetry-default-key.txt"));
      expect(readFileSync(join(ROOT, "tsup.config.ts"), "utf-8")).toContain(
        'copyFileSync("src/core/telemetry-default-key.txt", join(outDir, "telemetry-default-key.txt"))',
      );
      expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).files).toContain("dist");
    });

    it("lookup order is env, then Keychain, then the default file; the source is named, never the value", () => {
      const file = join(dirname(process.env.AGENTBREW_TELEMETRY_STATE as string), "key.txt");
      writeFileSync(file, "phc_fromFile1\n");
      const deps = { keychain: () => "phc_fromKeychain", defaultKeyFile: file };
      expect(resolveKey(deps)).toEqual({ key: "phc_test", source: "env" });
      delete process.env.AGENTBREW_POSTHOG_KEY;
      expect(resolveKey(deps)).toEqual({ key: "phc_fromKeychain", source: "keychain" });
      expect(resolveKey({ ...deps, keychain: () => "" })).toEqual({ key: "phc_fromFile1", source: "default" });
      const st = status({ ...deps, keychain: () => "" });
      expect(st).toMatchObject({ on: true, keySource: "default" });
      expect(JSON.stringify(st)).not.toContain("phc_");
    });

    it("an empty, missing, or malformed file is no key", () => {
      const dir = dirname(process.env.AGENTBREW_TELEMETRY_STATE as string);
      const cases = ["", "\n", "phc_a\nphc_b\n", "sk_live_abc\n", "phc_has space\n", "phc_ok1 \n"];
      for (const [i, text] of cases.entries()) {
        writeFileSync(join(dir, `k${i}`), text);
        expect(defaultKey(join(dir, `k${i}`)), JSON.stringify(text)).toBe("");
      }
      expect(defaultKey(join(dir, "missing"))).toBe("");
      delete process.env.AGENTBREW_POSTHOG_KEY;
      expect(resolveKey({ keychain: () => "", defaultKeyFile: join(dir, "k0") })).toEqual({ key: "", source: "none" });
    });
  });

  describe("consent question", () => {
    const unset = () => seedState({ consent: undefined, consentAt: undefined });
    const answers = (...lines: (string | undefined)[]) => vi.fn(async () => lines.shift());
    beforeEach(unset);

    it("is loud: a banner, what is sent, one real example, the promise, where it goes, how to change it", async () => {
      const write = vi.fn();
      const ask = answers("y");
      await askConsent("1.0.0", { install: true, interactive: true, write, ask, now: NOW });
      const text = write.mock.calls.map((c) => c[0]).join("");
      expect(text.startsWith("\n====")).toBe(true);
      expect(text).toContain("Help make agentbrew faster: share anonymous performance numbers?");
      expect(text).toMatch(
        /command name, its duration, ok or error, counts,\nthe agentbrew version, your OS and CPU type, and a random install id/,
      );
      expect(text).toMatch(
        /never a path, file name, host name, user name,\nargument, message, or content\. No IP-based location\. No person profile\./,
      );
      expect(text).toContain("src/core/events.ts");
      expect(text).toContain("docs/observability.md#field-telemetry");
      expect(text).toContain("PostHog EU");
      expect(text).toContain("agentbrew telemetry off");
      expect(ask).toHaveBeenCalledWith(QUESTION);
      expect(QUESTION).toBe("Share anonymous performance numbers? [Y/n] ");
      // The example is a real event: the same builder that makes the request body made it.
      const example = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const line = JSON.stringify({
        ts: new Date(NOW).toISOString(),
        event: "command",
        command: "sync",
        ok: true,
        ms: 1840,
      });
      expect(example).toEqual((buildBatch([line], "k", ID, "1.0.0").batch as unknown[])[0]);
      expect(consentText("1.0.0", { now: NOW })).toBe(text.slice(0, -1));
    });

    it.each([
      ["y", "yes"],
      ["YES", "yes"],
      ["", "yes"],
      ["n", "no"],
      ["No", "no"],
    ])("answer %j records %s, with one confirming line and the command to change it", async (answer, consent) => {
      const result = await askConsent("1.0.0", {
        install: true,
        interactive: true,
        write: vi.fn(),
        ask: answers(answer),
        now: NOW,
      });
      expect(result).toMatchObject({ consent, asked: true });
      expect(result.line).toMatch(consent === "yes" ? /Telemetry is on\./ : /Telemetry is off\. Nothing is sent\./);
      expect(result.line).toContain("agentbrew telemetry on | off");
      expect(savedState()).toMatchObject({ consent, consentAt: new Date(NOW).toISOString() });
      expect(status()).toMatchObject({ consent, consentAt: new Date(NOW).toISOString(), on: consent === "yes" });
    });

    it("an unclear answer asks again; end of input leaves it unset", async () => {
      const write = vi.fn();
      const ask = answers("maybe", "n");
      expect((await askConsent("1", { install: true, interactive: true, write, ask })).consent).toBe("no");
      expect(ask).toHaveBeenCalledTimes(2);
      unset();
      const eof = await askConsent("1", { install: true, interactive: true, write, ask: answers(undefined) });
      expect(eof).toMatchObject({ consent: "unset", asked: true });
      expect(status()).toMatchObject({ consent: "unset", on: false, reason: "not answered yet" });
    });

    it("a non-interactive install asks nothing and stays unset; CI counts as non-interactive", async () => {
      const write = vi.fn();
      const ask = answers("y");
      const result = await askConsent("1", { install: true, interactive: false, write, ask });
      expect(result).toMatchObject({ consent: "unset", asked: false });
      expect(result.line).toMatch(/not asked/);
      process.env.CI = "true";
      expect((await askConsent("1", { install: true, interactive: true, write, ask })).consent).toBe("unset");
      delete process.env.CI;
      expect(write).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      expect(savedState().consent).toBeUndefined();
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "not answered yet" });
      await sendDaily("1", { fetchImpl, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      ["AGENTBREW_TELEMETRY", "0", "AGENTBREW_TELEMETRY=0"],
      ["DO_NOT_TRACK", "1", "DO_NOT_TRACK"],
    ])("%s=%s at install records no without a prompt and says so in one line", async (name, value, reason) => {
      process.env[name] = value;
      const ask = answers("y");
      const result = await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask, now: NOW });
      expect(result).toMatchObject({ consent: "no", asked: false });
      expect(result.line).toBe(
        `Telemetry is off (${reason}). Nothing is sent. Change it any time: agentbrew telemetry on | off`,
      );
      expect(ask).not.toHaveBeenCalled();
      delete process.env[name];
      expect(status()).toMatchObject({ consent: "no", on: false, reason: "you said no" });
    });

    it.each(["no", "yes"] as const)("a re-install never asks again and never changes a stored %s", async (stored) => {
      setConsent(stored, NOW);
      const before = readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8");
      const ask = answers(stored === "no" ? "y" : "n");
      const write = vi.fn();
      const result = await askConsent("1", { install: true, interactive: true, write, ask });
      expect(result).toMatchObject({ consent: stored, asked: false });
      expect(ask).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      // An opt-out env var on a re-install does not rewrite a stored yes either.
      process.env.AGENTBREW_TELEMETRY = "0";
      expect((await askConsent("1", { install: true, interactive: true, write, ask })).consent).toBe(stored);
      expect(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8")).toBe(before);
    });

    it("a state from before the question has no answer: unset, and nothing is sent", async () => {
      seedState({ consent: undefined, consentAt: undefined, enabled: true, noticeAt: "2026-01-01T00:00:00.000Z" });
      expect(status()).toMatchObject({ consent: "unset", on: false, reason: "not answered yet" });
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "not answered yet" });
      await sendDaily("1", { fetchImpl, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
      // An earlier `telemetry off` is kept as a no.
      seedState({ consent: undefined, enabled: false });
      expect(status()).toMatchObject({ consent: "no", reason: "you said no" });
    });

    it("the first interactive run of a normal command asks once; a later run sends", async () => {
      const write = vi.fn();
      const fetchImpl = ok();
      await askOnFirstRun("1", { interactive: true, write, ask: answers(undefined) });
      expect(write.mock.calls[0][0]).toContain("Help make agentbrew faster");
      expect(savedState().askedAt).toBeDefined();
      // Shown once: an unanswered question is not repeated.
      const again = vi.fn();
      await askOnFirstRun("1", { interactive: true, write: again, ask: answers("y") });
      expect(again).not.toHaveBeenCalled();
      expect(status().consent).toBe("unset");

      unset();
      await askOnFirstRun("1", { interactive: true, write, ask: answers("") });
      expect(status()).toMatchObject({ consent: "yes", on: true });
      await sendDaily("1", { fetchImpl, now: NOW });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("a normal command stays silent with no terminal, an off switch, or no key", async () => {
      const write = vi.fn();
      const ask = answers("y");
      await askOnFirstRun("1", { interactive: false, write, ask });
      for (const [name, value] of [
        ["CI", "1"],
        ["DO_NOT_TRACK", "1"],
        ["AGENTBREW_TELEMETRY", "0"],
        ["AGENTBREW_TELEMETRY_ASK", "0"],
      ]) {
        process.env[name] = value;
        await askOnFirstRun("1", { interactive: true, write, ask });
        delete process.env[name];
      }
      process.env.AGENTBREW_POSTHOG_KEY = "";
      await askOnFirstRun("1", { interactive: true, write, ask });
      expect(write).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      expect(savedState().consent).toBeUndefined();
      expect(savedState().askedAt).toBeUndefined();
    });
  });

  describe("off switches", () => {
    it.each([
      ["DO_NOT_TRACK", "1", "DO_NOT_TRACK"],
      ["DO_NOT_TRACK", "true", "DO_NOT_TRACK"],
      ["CI", "1", "CI"],
      ["CI", "true", "CI"],
      ["AGENTBREW_TELEMETRY", "0", "AGENTBREW_TELEMETRY=0"],
    ])("%s=%s sends nothing, on the manual and the automatic path", async (name, value, reason) => {
      process.env[name] = value;
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: reason });
      await sendDaily("1", { interactive: true, fetchImpl, now: NOW });
      expect(status()).toMatchObject({ on: false, reason, consent: "yes" });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("DO_NOT_TRACK empty or 0 does not turn it off", () => {
      process.env.DO_NOT_TRACK = "0";
      expect(status().on).toBe(true);
      process.env.DO_NOT_TRACK = "";
      expect(status().on).toBe(true);
    });

    it("no key or `telemetry off` sends nothing; `telemetry on` turns it back on", async () => {
      const fetchImpl = ok();
      process.env.AGENTBREW_POSTHOG_KEY = "";
      expect((await send("1", { fetchImpl })).skipped).toBe("no key");
      process.env.AGENTBREW_POSTHOG_KEY = "phc_test";
      setConsent("no");
      expect(status()).toMatchObject({ on: false, reason: "you said no", keySource: "env", pending: 2 });
      expect((await send("1", { fetchImpl })).skipped).toBe("you said no");
      await sendDaily("1", { interactive: true, fetchImpl, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
      setConsent("yes");
      expect(status()).toMatchObject({ on: true, reason: "on" });
    });

    it("status shows the last send", async () => {
      expect(status().lastSend).toBeUndefined();
      await send("1.0.0", { fetchImpl: ok() });
      expect(status()).toMatchObject({ pending: 0, lastSend: expect.stringMatching(/^\d{4}-/) });
    });
  });

  describe("private", () => {
    it("sends each event once, anonymously, with no person profile or GeoIP", async () => {
      const fetchImpl = ok();
      expect(await send("1.0.0", { fetchImpl })).toEqual({ sent: 2 });
      const body = bodyOf(fetchImpl);
      expect(body.api_key).toBe("phc_test");
      expect(body.batch[0]).toMatchObject({
        event: "agentbrew.sync",
        distinct_id: ID,
        timestamp: "2026-11-09T10:00:00.000Z",
      });
      expect(body.batch[1].properties).toEqual({
        ok: true,
        command: "status",
        ms: 41,
        app_version: "1.0.0",
        os: expect.stringMatching(/^(darwin|linux|other)$/),
        arch: expect.stringMatching(/^(arm64|x64|other)$/),
        runtime: "ts",
        $geoip_disable: true,
        $process_person_profile: false,
      });
      expect(await send("1.0.0", { fetchImpl })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("a dry run shows the body with the key hidden and sends nothing, even when off", async () => {
      process.env.DO_NOT_TRACK = "1";
      const fetchImpl = vi.fn();
      const before = readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8");
      const r = await send("1.0.0", { dryRun: true, fetchImpl });
      expect(r).toMatchObject({ sent: 0, pending: 2, body: { api_key: "<posthog_key>" } });
      expect(JSON.stringify(r)).not.toContain("phc_test");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8")).toBe(before);
    });

    it("canary: no path, user name, email, URL, or token leaves the machine, even from an edited log", () => {
      const canaries = [
        // Built at run time: the push gate refuses a literal home path.
        ["", "Users", "janedoe", "secret-project"].join("/"),
        "janedoe42",
        "Jane.Doe",
        "jane.doe@example.com",
        "https://git.example.com/team/repo.git",
        "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
        "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
        "sync --agentfile ~/private/Agentfile.yaml",
      ];
      const tampered = canaries.flatMap((canary) => [
        JSON.stringify({
          ts: "2026-11-09T12:00:00.000Z",
          event: "command",
          story: canary,
          command: canary,
          ok: true,
          ms: 5,
          path: canary,
          host: canary,
          user: canary,
          args: [canary],
          message: canary,
          error: canary,
          skill: canary,
          code: canary,
          module: canary,
          types: [canary, "skills"],
          driftBefore: canary,
        }),
        JSON.stringify({ ts: canary, event: canary, ok: canary }),
        JSON.stringify({ ts: canary, event: "janedoe", ok: true }),
        JSON.stringify({ ts: canary, event: "sync", [canary]: true, ok: true }),
      ]);
      const body = buildBatch(tampered, "<posthog_key>", ID, canaries[0]);
      const text = JSON.stringify(body);
      for (const canary of canaries) expect(text, canary).not.toContain(canary);
      expect(text).not.toMatch(/jane|example\.com|ghp_|a94a8/i);
      const batch = body.batch as { event: string; timestamp?: string; properties: Record<string, unknown> }[];
      expect(batch).toHaveLength(2 * canaries.length);
      const allowed = [
        "$geoip_disable",
        "$process_person_profile",
        "app_version",
        "arch",
        "ms",
        "ok",
        "os",
        "runtime",
        "story",
        "types",
      ];
      for (const item of batch) {
        for (const key of Object.keys(item.properties)) expect(allowed).toContain(key);
        expect(item.properties.app_version).toBe("0.0.0");
        expect(item.properties.types ?? ["skills"]).toEqual(["skills"]);
      }
    });

    it("keeps a command name only from the known command list", () => {
      const rows = ["status", "sync", "janedoe", "my-private-skill", "status --json"].map((command) =>
        JSON.stringify({ ts: "2026-11-09T12:00:00.000Z", event: "command", command, ok: true, ms: 1 }),
      );
      const batch = buildBatch(rows, "k", ID, "1.0.0").batch as { properties: { command?: string } }[];
      expect(batch.map((b) => b.properties.command)).toEqual(["status", "sync", undefined, undefined, undefined]);
    });
  });

  describe("reliable", () => {
    it("a failed send keeps the events for next time and never throws", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error("offline");
      });
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "network" });
      expect(status().pending).toBe(2);
      await expect(sendDaily("1", { fetchImpl, now: NOW + 2 * 86_400_000 })).resolves.toBeUndefined();
    });

    it("the cursor moves only after a 2xx", async () => {
      const fetchImpl = vi.fn(async () => new Response("no", { status: 503 }));
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "http 503" });
      expect(savedState().sent).toBe(0);
      expect(savedState().lastSend).toBeUndefined();
      expect(await send("1", { fetchImpl: ok() })).toEqual({ sent: 2 });
      expect(savedState().sent).toBe(2);
    });

    it("sends at most once a day, and a failed try also waits a day", async () => {
      const failing = vi.fn(async () => {
        throw new Error("offline");
      });
      await sendDaily("1", { fetchImpl: failing, now: NOW });
      await sendDaily("1", { fetchImpl: failing, now: NOW + 60_000 });
      expect(failing).toHaveBeenCalledTimes(1);
      const fetchImpl = ok();
      await sendDaily("1", { fetchImpl, now: NOW + 86_400_000 + 1 });
      await sendDaily("1", { fetchImpl, now: NOW + 86_400_000 + 60_000 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("the automatic path gives up after its time budget", async () => {
      expect(AUTO_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("timeout")), ms);
        return controller.signal;
      });
      try {
        const hanging = vi.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        );
        const run = sendDaily("1", { fetchImpl: hanging as unknown as typeof fetch, now: NOW });
        await vi.advanceTimersByTimeAsync(AUTO_TIMEOUT_MS);
        await run;
        expect(timeout).toHaveBeenCalledWith(AUTO_TIMEOUT_MS);
        expect(hanging).toHaveBeenCalledTimes(1);
        expect(savedState().sent).toBe(0);
      } finally {
        timeout.mockRestore();
        vi.useRealTimers();
      }
    });

    it("a first send skips the old backlog: only the newest events, and none older than the day cap", async () => {
      const old = row(new Date(NOW - (BACKLOG_DAYS + 1) * 86_400_000).toISOString());
      const recent = row(new Date(NOW - 3_600_000).toISOString());
      writeLog([...Array(BACKLOG_EVENTS + 700).fill(recent)]);
      let fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: BACKLOG_EVENTS });
      expect(fetchImpl).toHaveBeenCalledTimes(BACKLOG_EVENTS / BATCH_SIZE);
      expect(savedState().sent).toBe(BACKLOG_EVENTS + 700);

      seedState();
      writeLog([...Array(50).fill(old), "not json", ...Array(3).fill(recent)]);
      fetchImpl = ok();
      expect((await send("1", { dryRun: true, now: NOW })).pending).toBe(3);
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 3 });
      expect(bodyOf(fetchImpl).batch).toHaveLength(3);

      seedState();
      writeLog(Array(5).fill(old));
      fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(savedState().sent).toBe(5);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("sends at most BATCH_SIZE events per request and keeps what a failed request did not send", async () => {
      expect(BATCH_SIZE).toBeLessThanOrEqual(500);
      writeLog(Array(BATCH_SIZE + 20).fill(row(new Date(NOW).toISOString())));
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls += 1;
        return new Response("{}", { status: calls === 1 ? 200 : 500 });
      });
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: BATCH_SIZE, skipped: "http 500" });
      expect(bodyOf(fetchImpl, 0).batch).toHaveLength(BATCH_SIZE);
      expect(savedState().sent).toBe(BATCH_SIZE);
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 20 });
    });

    it("writes the state file whole, with mode 600", async () => {
      await send("1", { fetchImpl: ok() });
      const file = process.env.AGENTBREW_TELEMETRY_STATE as string;
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(dirname(file)).sort()).toEqual(["events.jsonl", "telemetry.json"]);
      expect(savedState()).toMatchObject({ installId: ID, sent: 2, consent: "yes" });
    });

    it.each([
      ["not json", "{half"],
      ["a wrong shape", JSON.stringify({ installId: "janedoe", sent: -4, consent: "yes" })],
      ["empty", ""],
    ])("a corrupt state file (%s) is unset, never yes, and the cursor starts at the end of the log", async (_name, text) => {
      writeFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, text);
      const state = loadState();
      expect(state).toMatchObject({ sent: 2 });
      expect(state.consent).toBeUndefined();
      expect(state.installId).toMatch(/^[0-9a-f]{32}$/);
      expect(loadState().installId).toBe(state.installId);
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "not answered yet" });
      await sendDaily("1", { fetchImpl, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a corrupt state file keeps a readable no", () => {
      writeFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, JSON.stringify({ consent: "no", sent: "x" }));
      expect(loadState().consent).toBe("no");
      expect(status().reason).toBe("you said no");
    });

    it("a truncated or rotated log moves the cursor to its end, not to 0", async () => {
      seedState({ sent: 500 });
      const fetchImpl = ok();
      expect(status().pending).toBe(0);
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(savedState().sent).toBe(2);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a missing log or state file is not an error", async () => {
      process.env.AGENTBREW_EVENTS_FILE = join(tmpdir(), "ab-tel-missing", "events.jsonl");
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      process.env.AGENTBREW_TELEMETRY_STATE = join(tmpdir(), "ab-tel-missing", "nope", "telemetry.json");
      expect(status()).toMatchObject({ on: false, reason: "not answered yet", consent: "unset", pending: 0 });
    });
  });
});
