import { spawn } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logSkipped } from "./logger.js";
import {
  AUTO_TIMEOUT_MS,
  acquireLock,
  askConsent,
  askOnFirstRun,
  BACKLOG_DAYS,
  BACKLOG_EVENTS,
  BATCH_SIZE,
  buildBatch,
  consentText,
  defaultKey,
  defaultKeyFile,
  drainInput,
  keychainKey,
  loadState,
  MAX_ASKS,
  QUESTION,
  QUESTION_EXPLICIT,
  quietCommand,
  resolveKey,
  send,
  sendDaily,
  setConsent,
  status,
} from "./telemetry.js";
import { runAutoSend, startDailySend } from "./telemetry-auto.js";

// The debug log is captured, so a test can prove that no log line holds the key.
vi.mock("./logger.js", async (original) => ({
  ...(await original<typeof import("./logger.js")>()),
  logSkipped: vi.fn(),
}));

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

    it("an env or Keychain value that is not one phc_ key is no key", async () => {
      const file = join(dirname(process.env.AGENTBREW_TELEMETRY_STATE as string), "key.txt");
      writeFileSync(file, "phc_fromFile1\n");
      for (const bad of ["sk_live_abc", "phc_has space", "phc_ok\nx", "janedoe", "phc_"]) {
        process.env.AGENTBREW_POSTHOG_KEY = bad;
        // A set env var stops the lookup: a bad one is never replaced by another source.
        expect(resolveKey({ keychain: () => "phc_fromKeychain", defaultKeyFile: file }), bad).toEqual({
          key: "",
          source: "none",
        });
        const fetchImpl = ok();
        expect(await send("1", { fetchImpl })).toEqual({ sent: 0, skipped: "no key" });
        expect(fetchImpl).not.toHaveBeenCalled();
        delete process.env.AGENTBREW_POSTHOG_KEY;
        expect(resolveKey({ keychain: () => bad, defaultKeyFile: file }), bad).toEqual({
          key: "phc_fromFile1",
          source: "default",
        });
        expect(resolveKey({ keychain: () => bad, defaultKeyFile: join(file, "missing") }).source).toBe("none");
      }
    });
  });

  describe("consent question", () => {
    const unset = () => seedState({ consent: undefined, consentAt: undefined });
    const answers = (...lines: (string | undefined)[]) => vi.fn(async () => lines.shift());
    beforeEach(unset);

    it("is loud: a banner, what is sent, one example event, the promise, where it goes, how to change it", async () => {
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
      // It is an example, and the text says so: it is not an event from this machine.
      expect(text).toContain("One example event, in the exact shape that is sent:");
      expect(text).not.toMatch(/real event/i);
      expect(text).toMatch(/PostHog sees the IP address of the request/);
      expect(text).toContain("src/core/events.ts");
      expect(text).toContain("docs/observability.md#field-telemetry");
      expect(text).toContain("PostHog EU");
      expect(text).toContain("agentbrew telemetry off");
      expect(ask).toHaveBeenCalledWith(QUESTION);
      expect(QUESTION).toBe("Share anonymous performance numbers? [Y/n] ");
      // The example has the real shape: the same builder that makes the request body made it.
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
      expect(readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8")).toBe(before);
    });

    it.each([
      ["AGENTBREW_TELEMETRY", "0"],
      ["DO_NOT_TRACK", "1"],
    ])("an opt-out at a re-install (%s) records no even over a stored yes; a stored no stays as it is", async (name, value) => {
      setConsent("yes", NOW);
      process.env[name] = value;
      const ask = answers("y");
      // Outside the installer the env var blocks sending but does not change the stored answer.
      expect((await askConsent("1", { interactive: true, write: vi.fn(), ask })).consent).toBe("yes");
      expect(savedState().consent).toBe("yes");
      const result = await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask, now: NOW + 5_000 });
      expect(result).toMatchObject({ consent: "no", asked: false });
      expect(result.line).toMatch(/^Telemetry is off \(/);
      expect(ask).not.toHaveBeenCalled();
      expect(savedState()).toMatchObject({ consent: "no", consentAt: new Date(NOW + 5_000).toISOString() });
      // The reverse never happens: no flag or env var turns a stored no into a yes.
      const before = readFileSync(process.env.AGENTBREW_TELEMETRY_STATE as string, "utf-8");
      await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask });
      delete process.env[name];
      await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask });
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

    it("the first interactive run of a normal command asks, then at most once a day", async () => {
      const write = vi.fn();
      const ask = answers(undefined);
      await askOnFirstRun("1", { interactive: true, write, ask, now: NOW });
      expect(write.mock.calls[0][0]).toContain("Help make agentbrew faster");
      expect(ask).toHaveBeenCalledWith(QUESTION_EXPLICIT);
      expect(savedState().askedAt).toBe(new Date(NOW).toISOString());
      // An unanswered question is not repeated on the same day.
      const again = vi.fn();
      await askOnFirstRun("1", { interactive: true, write: again, ask: answers("y"), now: NOW + 3_600_000 });
      expect(again).not.toHaveBeenCalled();
      expect(status().consent).toBe("unset");
      await askOnFirstRun("1", { interactive: true, write: again, ask: answers("y"), now: NOW + 86_400_000 + 1 });
      expect(again).toHaveBeenCalled();
      expect(status()).toMatchObject({ consent: "yes", on: true });
    });

    it("after a normal command only a typed y or n counts: Enter alone leaves it unset", async () => {
      expect(QUESTION_EXPLICIT).toBe("Share anonymous performance numbers? [y/n] ");
      const write = vi.fn();
      const ask = answers("", "y");
      await askOnFirstRun("1", { interactive: true, write, ask, now: NOW });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(status()).toMatchObject({ consent: "unset", on: false });
      expect(write.mock.calls.at(-1)?.[0]).toMatch(/^No answer\. Nothing is sent\./);
      const fetchImpl = ok();
      await sendDaily("1", { fetchImpl, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
      unset();
      await askOnFirstRun("1", { interactive: true, write, ask: answers("n"), now: NOW });
      expect(status().consent).toBe("no");
    });

    it("input typed before the question is thrown away, so a stray Enter is not an answer", async () => {
      const order: string[] = [];
      const drain = vi.fn(async () => {
        order.push("drain");
      });
      const ask = vi.fn(async () => {
        order.push("ask");
        return "n";
      });
      await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask, drain });
      expect(order).toEqual(["drain", "ask"]);

      // The default drain empties a stream that already holds a typed-ahead Enter.
      const input = new PassThrough();
      input.write("\n\ny\n");
      await drainInput(input, 20);
      expect(input.readableLength).toBe(0);
      expect(input.read()).toBeNull();
      expect(input.isPaused()).toBe(true);
      expect(input.listenerCount("data")).toBe(0);
    });

    it("an answer given in another process while the question shows is not written back", async () => {
      // `telemetry off` runs elsewhere while this process prints the question.
      const write = vi.fn(() => {
        if (loadState().consent !== "no") setConsent("no", NOW);
      });
      const result = await askConsent("1", { interactive: true, write, ask: answers(undefined), now: NOW });
      expect(result.consent).toBe("unset");
      expect(savedState()).toMatchObject({ consent: "no", askedAt: new Date(NOW).toISOString() });
    });

    it("a yes covers only later events: nothing recorded before the yes is sent", async () => {
      expect(status().pending).toBe(2);
      await askConsent("1", { install: true, interactive: true, write: vi.fn(), ask: answers("y"), now: NOW });
      expect(savedState().sent).toBe(2);
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect((await send("1", { dryRun: true, now: NOW })).body).toMatchObject({ batch: [] });
      expect(fetchImpl).not.toHaveBeenCalled();
      appendFileSync(process.env.AGENTBREW_EVENTS_FILE as string, `${row(new Date(NOW).toISOString())}\n`);
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 1 });
      // A second yes does not skip events that wait.
      appendFileSync(process.env.AGENTBREW_EVENTS_FILE as string, `${row(new Date(NOW).toISOString())}\n`);
      setConsent("yes", NOW);
      expect(status().pending).toBe(1);
      // no -> yes skips what was recorded while it was off; so does a new state file.
      setConsent("no", NOW);
      setConsent("yes", NOW);
      expect(status().pending).toBe(0);
      process.env.AGENTBREW_TELEMETRY_STATE = join(dirname(process.env.AGENTBREW_EVENTS_FILE as string), "new.json");
      expect(loadState().sent).toBe(4);
      setConsent("yes", NOW);
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
    });

    it("the question path does not start a Keychain lookup on every run when no key is set", async () => {
      delete process.env.AGENTBREW_POSTHOG_KEY;
      const dir = dirname(process.env.AGENTBREW_TELEMETRY_STATE as string);
      const empty = join(dir, "empty-key.txt");
      writeFileSync(empty, "");
      const keychain = vi.fn(() => "");
      const deps = { interactive: true, write: vi.fn(), ask: answers("y"), keychain, defaultKeyFile: empty };
      await askOnFirstRun("1", { ...deps, now: NOW });
      await askOnFirstRun("1", { ...deps, now: NOW + 60_000 });
      await askOnFirstRun("1", { ...deps, now: NOW + 3_600_000 });
      expect(keychain).toHaveBeenCalledTimes(1);
      expect(savedState().keychainMissAt).toBe(new Date(NOW).toISOString());
      await askOnFirstRun("1", { ...deps, now: NOW + 86_400_000 + 1 });
      expect(keychain).toHaveBeenCalledTimes(2);
      expect(deps.write).not.toHaveBeenCalled();
      // The default file or the env var answers "is there a key" with no Keychain lookup at all.
      const withKey = join(dir, "key.txt");
      writeFileSync(withKey, "phc_fromFile1\n");
      await askOnFirstRun("1", { ...deps, defaultKeyFile: withKey, now: NOW + 86_400_000 + 2 });
      expect(keychain).toHaveBeenCalledTimes(2);
      expect(deps.write).toHaveBeenCalled();
    });

    it("with no key nobody is asked and the installer path prints nothing", async () => {
      delete process.env.AGENTBREW_POSTHOG_KEY;
      const dir = dirname(process.env.AGENTBREW_TELEMETRY_STATE as string);
      const empty = join(dir, "empty-key.txt");
      writeFileSync(empty, "");
      const write = vi.fn();
      const ask = answers("y");
      const deps = {
        install: true,
        interactive: true,
        write,
        ask,
        keychain: () => "",
        defaultKeyFile: empty,
        now: NOW,
      };
      expect(await askConsent("1", deps)).toEqual({ consent: "unset", asked: false, line: "" });
      expect(await askConsent("1", { ...deps, interactive: false })).toEqual({
        consent: "unset",
        asked: false,
        line: "",
      });
      expect(write).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      expect(savedState().consent).toBeUndefined();
      // An opt-out flag is still recorded, with nothing printed.
      process.env.AGENTBREW_TELEMETRY = "0";
      expect(await askConsent("1", deps)).toEqual({ consent: "no", asked: false, line: "" });
      expect(savedState().consent).toBe("no");
      delete process.env.AGENTBREW_TELEMETRY;
      expect(await askConsent("1", deps)).toEqual({ consent: "no", asked: false, line: "" });
      // With a key the same call asks.
      unset();
      const withKey = join(dir, "key.txt");
      writeFileSync(withKey, "phc_fromFile1\n");
      expect((await askConsent("1", { ...deps, defaultKeyFile: withKey })).asked).toBe(true);
    });

    it("never asks after help, a version, completion, or machine-readable output", async () => {
      expect(quietCommand("status", ["status"])).toBe(false);
      for (const argv of [
        ["status", "--json"],
        ["--version"],
        ["-V"],
        ["sync", "--help"],
        ["mcp", "-h"],
        ["x", "--json=1"],
      ]) {
        expect(quietCommand("status", argv), argv.join(" ")).toBe(true);
      }
      for (const command of ["completions", "telemetry", "hook"]) expect(quietCommand(command, [command])).toBe(true);
      const write = vi.fn();
      const ask = answers("y");
      await askOnFirstRun("1", { interactive: true, write, ask, command: "actions", argv: ["actions", "--json"] });
      await askOnFirstRun("1", { interactive: true, write, ask, command: "completions", argv: ["completions", "zsh"] });
      expect(write).not.toHaveBeenCalled();
      expect(savedState().askedAt).toBeUndefined();
      await askOnFirstRun("1", { interactive: true, write, ask, command: "status", argv: ["status"] });
      expect(write).toHaveBeenCalled();
    });

    it("an unanswered question backs off: once a day, a few times, then silence until `telemetry ask`", async () => {
      expect(MAX_ASKS).toBeLessThanOrEqual(3);
      const write = vi.fn();
      const day = 86_400_000 + 1;
      for (let i = 0; i < MAX_ASKS + 4; i += 1) {
        await askOnFirstRun("1", { interactive: true, write, ask: answers(""), now: NOW + i * day });
      }
      const banners = write.mock.calls.filter((c) => String(c[0]).includes("Help make agentbrew faster"));
      expect(banners).toHaveLength(MAX_ASKS);
      expect(savedState()).toMatchObject({ askCount: MAX_ASKS });
      expect(status().consent).toBe("unset");
      // The explicit command still asks.
      const result = await askConsent("1", { install: true, interactive: true, write, ask: answers("n") });
      expect(result).toMatchObject({ asked: true, consent: "no" });
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
        // Plain words: only a fixed name list keeps these out, a pattern does not.
        "janedoe",
        "ACMECORP",
        "acme-corp",
        "ACME_CORP",
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
      expect(text).not.toMatch(/jane|acme|example\.com|ghp_|a94a8/i);
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

    it("sends only a released version number: a local suffix or commit is replaced", () => {
      const version = (v: string) =>
        (buildBatch([lines[1]], "k", ID, v).batch as { properties: { app_version: string } }[])[0].properties
          .app_version;
      expect(version("1.2.3")).toBe("1.2.3");
      expect(version("2.0.0-rc.1")).toBe("2.0.0-rc.1");
      for (const local of [
        "1.2.3-janedoe",
        "1.2.3-0a1b2c3",
        "1.2.3-dev.janedoe",
        "1.2.3+a94a8fe",
        "0a1b2c3d",
        "main",
      ]) {
        expect(version(local), local).toBe("0.0.0");
      }
    });

    it("the key never reaches a log line, an error message, or a process argument", async () => {
      vi.mocked(logSkipped).mockClear();
      // The worst case: the network error text quotes the whole request.
      const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
        throw new Error(`request failed: ${String(init?.body)}`);
      });
      const result = await send("1", { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result).toEqual({ sent: 0, skipped: "network" });
      const logged = JSON.stringify(
        vi.mocked(logSkipped).mock.calls.map(([where, e]) => [where, e instanceof Error ? e.message : String(e)]),
      );
      expect(logged).toContain("core/telemetry/send");
      expect(JSON.stringify(result) + logged).not.toContain("phc_test");
      // The only child process is the Keychain read, with fixed arguments: the key comes back on stdout.
      const source = readFileSync(join(ROOT, "src/core/telemetry.ts"), "utf-8");
      expect(source.match(/execFileSync\(|spawn\(|exec\(/g)).toEqual(["execFileSync("]);
      expect(source).toContain('["find-generic-password", "-s", "agentbrew", "-a", "posthog_key", "-w"]');
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

    it("`telemetry off` during a send stops it and is not overwritten with the old yes", async () => {
      writeLog(Array(BATCH_SIZE * 3).fill(row(new Date(NOW).toISOString())));
      seedState();
      // The answer changes in another process while the first request is in flight.
      const fetchImpl = vi.fn(async () => {
        setConsent("no", NOW);
        return new Response("{}", { status: 200 });
      });
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: BATCH_SIZE, skipped: "consent changed" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(savedState()).toMatchObject({ consent: "no", sent: BATCH_SIZE });
      expect(status()).toMatchObject({ on: false, reason: "you said no" });
    });

    it("a second send on the same machine waits out the first; a dead send's lock expires", async () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      writeFileSync(lock, "");
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 0, skipped: "another send is running" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(savedState().sent).toBe(0);
      const old = new Date(Date.now() - 10 * 60_000);
      utimesSync(lock, old, old);
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 2 });
      expect(readdirSync(dirname(lock)).sort()).toEqual(["events.jsonl", "telemetry.json"]);
    });

    it.each([
      ["never answers", ""],
      [
        "answers 200 and never ends the body",
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n",
      ],
    ])(
      "a server that %s cannot hold the process open or change its exit code",
      { timeout: 120_000 },
      async (_name, head) => {
        const sockets: Socket[] = [];
        const server = createServer((socket) => {
          sockets.push(socket);
          socket.on("error", () => {});
          if (head) socket.once("data", () => socket.write(head));
        });
        // Needs a real local port: outside the agent sandbox (AGENTS.md Gotchas).
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const { port } = server.address() as { port: number };
        const dir = dirname(process.env.AGENTBREW_TELEMETRY_STATE as string);
        const script = join(dir, "child.mjs");
        // A real process on a real socket: the automatic send, then a normal end with exit code 7.
        writeFileSync(
          script,
          [
            `const t = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/core/telemetry.ts")).href)});`,
            'process.stdout.write("START\\n");',
            "const started = Date.now();",
            'await t.sendDaily("1.0.0");',
            "process.stdout.write(`DONE ${Date.now() - started}\\n`);",
            "process.exitCode = 7;",
          ].join("\n"),
        );
        try {
          const child = spawn(process.execPath, ["--import", "tsx", script], {
            cwd: ROOT,
            env: { ...process.env, AGENTBREW_TELEMETRY_URL: `http://127.0.0.1:${port}/batch/`, AGENTBREW_EVENTS: "0" },
            stdio: ["ignore", "pipe", "inherit"],
          });
          let out = "";
          let startedAt = 0;
          child.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            if (!startedAt && out.includes("START")) startedAt = Date.now();
          });
          const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
          const total = Date.now() - startedAt;
          expect(sockets.length, "the request reached the server").toBeGreaterThan(0);
          expect(code).toBe(7);
          expect(Number(/DONE (\d+)/.exec(out)?.[1])).toBeLessThanOrEqual(AUTO_TIMEOUT_MS + 500);
          expect(total).toBeLessThanOrEqual(AUTO_TIMEOUT_MS + 1_000);
        } finally {
          for (const socket of sockets) socket.destroy();
          server.close();
        }
      },
    );

    it("the attempt time is written when the send ends, so a killed send is tried again soon", async () => {
      let answer: (res: Response) => void = () => {};
      const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
      const run = send("1", { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      // A scheduler job that ends here kills the send. Nothing on disk says "wait a day".
      expect(savedState().lastAttempt).toBeUndefined();
      answer(new Response("{}", { status: 200 }));
      expect(await run).toEqual({ sent: 2 });
      expect(savedState().lastAttempt).toBe(new Date(NOW).toISOString());
    });

    it("a sync starts the daily send as a detached process and does not wait for it", () => {
      const unref = vi.fn();
      const spawnImpl = vi.fn(() => ({ on: vi.fn(), unref }));
      const start = (now: number) => startDailySend({ now, spawnImpl: spawnImpl as unknown as typeof spawn });
      expect(start(NOW)).toBe(true);
      const [bin, args, options] = spawnImpl.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
      expect(bin).toBe(process.execPath);
      expect(args.slice(-3)).toEqual(["telemetry", "send", "--auto"]);
      // The key is never on a command line.
      expect(args.join(" ")).not.toContain("phc_");
      expect(options).toMatchObject({ detached: true, stdio: "ignore" });
      expect((options.env as NodeJS.ProcessEnv).AGENTBREW_EVENTS).toBe("0");
      expect(unref).toHaveBeenCalledTimes(1);
      // Not due: no process starts. An attempt in the last day, an off switch, or no yes.
      seedState({ lastAttempt: new Date(NOW).toISOString() });
      expect(start(NOW + 60_000)).toBe(false);
      seedState();
      process.env.DO_NOT_TRACK = "1";
      expect(start(NOW)).toBe(false);
      delete process.env.DO_NOT_TRACK;
      setConsent("no", NOW);
      expect(start(NOW)).toBe(false);
      expect(spawnImpl).toHaveBeenCalledTimes(1);
    });

    it("the detached send does not carry a debugger flag from the parent", () => {
      const spawnImpl = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
      const execArgv = process.execArgv;
      process.execArgv = ["--inspect-brk=0", "--import", "tsx", "--inspect", "--inspect-port=0"];
      try {
        expect(startDailySend({ now: NOW, spawnImpl: spawnImpl as unknown as typeof spawn })).toBe(true);
      } finally {
        process.execArgv = execArgv;
      }
      const args = (spawnImpl.mock.calls[0] as unknown as [string, string[]])[1];
      expect(args.slice(0, 2)).toEqual(["--import", "tsx"]);
      expect(args.join(" ")).not.toContain("--inspect");
    });

    it("the detached send ends itself when the send never settles", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const exit = vi.fn();
        void runAutoSend("1.0.0", { sendDaily: () => new Promise<void>(() => {}), exit });
        await vi.advanceTimersByTimeAsync(AUTO_TIMEOUT_MS + 999);
        expect(exit).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(exit).toHaveBeenCalledExactlyOnceWith(0);
        // A send that ends in time exits at once, and the timer does not fire later.
        const quick = vi.fn();
        await runAutoSend("1.0.0", { sendDaily: async () => {}, exit: quick });
        await vi.advanceTimersByTimeAsync(AUTO_TIMEOUT_MS * 2);
        expect(quick).toHaveBeenCalledExactlyOnceWith(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("two processes cannot both take over one stale lock", () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      const old = new Date(Date.now() - 10 * 60_000);
      const other = `1 ${"c".repeat(32)}`;
      writeFileSync(lock, other);
      utimesSync(lock, old, old);
      // Another process is in the middle of the takeover: it holds the takeover guard.
      writeFileSync(`${lock}.steal`, `2 ${"d".repeat(32)}`);
      expect(acquireLock()).toBeUndefined();
      expect(readFileSync(lock, "utf-8")).toBe(other);
      // A guard left by a dead process is removed; the try after that takes the lock.
      utimesSync(`${lock}.steal`, old, old);
      expect(acquireLock()).toBeUndefined();
      const release = acquireLock();
      expect(release).toBeTypeOf("function");
      expect(readdirSync(dirname(lock)).sort()).toEqual(["events.jsonl", "telemetry.json", "telemetry.json.lock"]);
      release?.();
    });

    it("a send that lost its lock stops before the next request", async () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      writeLog(Array(BATCH_SIZE * 2).fill(row(new Date(NOW).toISOString())));
      const fetchImpl = vi.fn(async () => {
        writeFileSync(lock, `1 ${"a".repeat(32)}`);
        return new Response("{}", { status: 200 });
      });
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: BATCH_SIZE, skipped: "lock lost" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("a send that starts as another one ends does not send the same events again", async () => {
      // The key comes from the Keychain fake. It runs after the first look at the
      // state and before the lock: there, another process finishes its send.
      delete process.env.AGENTBREW_POSTHOG_KEY;
      const keychain = vi.fn(() => {
        seedState({ sent: 2, mark: lines[1] });
        return "phc_test";
      });
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl, keychain, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(keychain).toHaveBeenCalledTimes(1);
    });

    it("a mark that cannot be read skips to the end of the log, never back", async () => {
      const at = (i: number) => row(new Date(NOW - 3_600_000 + i * 1_000).toISOString());
      writeLog(Array.from({ length: 10 }, (_, i) => at(i)));
      seedState({ sent: 5, mark: "not a log line" });
      expect(status().pending).toBe(0);
      const fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(savedState().sent).toBe(10);
    });

    it("the send lock names its owner, and a send releases only its own lock", async () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      let during = "";
      const reading = vi.fn(async () => {
        during = readFileSync(lock, "utf-8");
        return new Response("{}", { status: 200 });
      });
      expect(await send("1", { fetchImpl: reading, now: NOW })).toEqual({ sent: 2 });
      expect(during).toMatch(new RegExp(`^${process.pid} [0-9a-f]{32}$`));
      expect(existsSync(lock)).toBe(false);
      // Another process took the lock over while this send was running. Its lock stays.
      seedState();
      const other = `1 ${"a".repeat(32)}`;
      const stolen = vi.fn(async () => {
        writeFileSync(lock, other);
        return new Response("{}", { status: 200 });
      });
      expect(await send("1", { fetchImpl: stolen, now: NOW })).toEqual({ sent: 2 });
      expect(readFileSync(lock, "utf-8")).toBe(other);
    });

    it("a lock dated in the future (the clock was set back) is stale, not held for ever", async () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      writeFileSync(lock, `1 ${"a".repeat(32)}`);
      const future = new Date(Date.now() + 10 * 60_000);
      utimesSync(lock, future, future);
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 2 });
      expect(existsSync(lock)).toBe(false);
    });

    it("a stale lock is replaced in one step; a fresh one is left alone", () => {
      const lock = `${process.env.AGENTBREW_TELEMETRY_STATE}.lock`;
      const other = `1 ${"b".repeat(32)}`;
      writeFileSync(lock, other);
      expect(acquireLock()).toBeUndefined();
      expect(readFileSync(lock, "utf-8")).toBe(other);
      const old = new Date(Date.now() - 10 * 60_000);
      utimesSync(lock, old, old);
      const release = acquireLock();
      expect(release).toBeTypeOf("function");
      expect(readFileSync(lock, "utf-8")).toMatch(new RegExp(`^${process.pid} [0-9a-f]{32}$`));
      // The new lock is fresh: a second send does not get it.
      expect(acquireLock()).toBeUndefined();
      release?.();
      expect(readdirSync(dirname(lock)).sort()).toEqual(["events.jsonl", "telemetry.json"]);
    });

    it("the cursor stays right when the log is trimmed: nothing is sent twice, nothing new is skipped", async () => {
      const at = (i: number) => row(new Date(NOW - 3_600_000 + i * 1_000).toISOString());
      const times = (rows: string[]) => rows.map((line) => JSON.parse(line).ts);
      const sentTimes = (fetchImpl: ReturnType<typeof vi.fn>) =>
        (bodyOf(fetchImpl).batch as { timestamp: string }[]).map((b) => b.timestamp);
      const first = Array.from({ length: 100 }, (_, i) => at(i));
      writeLog(first);
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 100 });
      // The log loses its oldest part; new lines came after the send.
      const added = Array.from({ length: 50 }, (_, i) => at(100 + i));
      writeLog([...first.slice(70), ...added]);
      expect(status().pending).toBe(50);
      let fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 50 });
      expect(sentTimes(fetchImpl)).toEqual(times(added));
      expect(savedState().sent).toBe(80);
      // The next trim removes the last sent line too. Only lines newer than it are sent.
      const more = Array.from({ length: 20 }, (_, i) => at(150 + i));
      writeLog(more);
      expect(status().pending).toBe(20);
      fetchImpl = ok();
      expect(await send("1", { fetchImpl, now: NOW })).toEqual({ sent: 20 });
      expect(sentTimes(fetchImpl)).toEqual(times(more));
      expect(await send("1", { fetchImpl: ok(), now: NOW })).toEqual({ sent: 0, skipped: "nothing new" });
    });

    it("the example event in the question shows the install id that is then saved", async () => {
      rmSync(process.env.AGENTBREW_TELEMETRY_STATE as string);
      let text = "";
      const write = (chunk: string) => {
        text += chunk;
      };
      await askConsent("1.0.0", { install: true, interactive: true, write, ask: async () => "y", now: NOW });
      const shown = /"distinct_id": "([0-9a-f]{32})"/.exec(text)?.[1];
      expect(shown).toBeDefined();
      expect(shown).toBe(savedState().installId);
    });

    it.skipIf(process.platform !== "darwin")("a Keychain lookup that hangs is cut off and means no key", () => {
      // A stand-in for a `security` that waits on a locked Keychain.
      const slow = join(dirname(process.env.AGENTBREW_TELEMETRY_STATE as string), "slow-security");
      writeFileSync(slow, "#!/bin/sh\nexec sleep 5\n");
      chmodSync(slow, 0o755);
      const started = Date.now();
      expect(keychainKey(slow)).toBe("");
      expect(Date.now() - started).toBeLessThan(2_500);
    });

    it("the after-sync path starts no Keychain lookup on each sync when no key is set", async () => {
      delete process.env.AGENTBREW_POSTHOG_KEY;
      const empty = join(dirname(process.env.AGENTBREW_TELEMETRY_STATE as string), "empty-key.txt");
      writeFileSync(empty, "");
      const keychain = vi.fn(() => "");
      const fetchImpl = ok();
      for (const minutes of [0, 30, 60, 90]) {
        await sendDaily("1", { fetchImpl, keychain, defaultKeyFile: empty, now: NOW + minutes * 60_000 });
      }
      expect(keychain).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
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
