import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { buildMemoryDaemonPlist, MEMORY_AGENT_LABEL } from "./launchagent.js";
import { deriveMemoryCandidate } from "./upgrade-candidate.js";

const oldSpec = "mcp-memory-service[sqlite]==11.7.0";
const newSpec = "mcp-memory-service[sqlite]==12.9.0";
const oldPath = "/fixture/old.plist";
const newPath = "/fixture/new.plist";
const plist = buildMemoryDaemonPlist("/fixture", "/fixture/logs", "/fixture/uvx");

function parsed(xml: string): { ProgramArguments: string[]; EnvironmentVariables: Record<string, string> } {
  return JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8" }),
  );
}

function loaded(xml = plist): string {
  const data = parsed(xml);
  return [
    `\tpath = ${oldPath}`,
    "\tprogram = /fixture/uvx",
    "\tworking directory = /fixture",
    "\tstdout path = /fixture/logs/mcp-memory.out.log",
    "\tstderr path = /fixture/logs/mcp-memory.err.log",
    "\tminimum runtime = 10",
    "\tproperties = keepalive | runatload | inferred program",
    "\tpid = 101",
    "\targuments = {",
    ...data.ProgramArguments.map((arg) => `\t\t${arg}`),
    "\t}",
    "\tenvironment = {",
    ...Object.entries(data.EnvironmentVariables).map(([key, value]) => `\t\t${key} => ${value}`),
    "\t\tXPC_SERVICE_NAME => fixture",
    "\t}",
    "\tinherited environment = {",
    "\t\tPATH => /bin",
    "\t\tUV_PYTHON_PREFERENCE => synthetic-inherited",
    "\t\tLANG => synthetic-overridden",
    "\t}",
    "\tdefault environment = {",
    "\t\tLANG => C",
    "\t\tSYNTHETIC_DEFAULT => synthetic-default",
    "\t}",
  ].join("\n");
}

it.runIf(process.platform === "darwin")("derives only the version change from matching job evidence", () => {
  const result = deriveMemoryCandidate({
    plist,
    loadedOutput: loaded(),
    oldPath,
    newPath,
    oldSpec,
    newSpec,
    label: MEMORY_AGENT_LABEL,
  });
  const before = parsed(plist);
  const after = parsed(result.plist);
  expect(after.EnvironmentVariables).toEqual(before.EnvironmentVariables);
  expect(after.ProgramArguments).toEqual(before.ProgramArguments.map((arg) => (arg === oldSpec ? newSpec : arg)));
  expect(result.job.args).toEqual(after.ProgramArguments);
  expect(result.job.path).toBe(newPath);
  expect(result.observedRuntime).toEqual({
    uvxBin: "/fixture/uvx",
    cwd: "/fixture",
    env: {
      ...before.EnvironmentVariables,
      UV_PYTHON_PREFERENCE: "synthetic-inherited",
      SYNTHETIC_DEFAULT: "synthetic-default",
      XPC_SERVICE_NAME: "fixture",
    },
  });
});

it.runIf(process.platform === "darwin").each(["duplicate", "malformed", "second block"])(
  "rejects %s inherited environment",
  (scenario) => {
    const line = "\t\tUV_PYTHON_PREFERENCE => synthetic-inherited";
    const output =
      scenario === "second block"
        ? `${loaded()}\n\tinherited environment = {\n\t\tUV_PYTHON_PREFERENCE => other\n\t}`
        : loaded().replace(
            line,
            scenario === "duplicate" ? `${line}\n\t\tUV_PYTHON_PREFERENCE => other` : "\t\tbroken entry",
          );
    expect(() =>
      deriveMemoryCandidate({
        plist,
        loadedOutput: output,
        oldPath,
        newPath,
        oldSpec,
        newSpec,
        label: MEMORY_AGENT_LABEL,
      }),
    ).toThrow();
  },
);

it
  .runIf(process.platform === "darwin")
  .each(["environment", "arguments", "directory", "extra", "duplicate", "malformed", "launcher options"])(
  "refuses %s mismatch before creating a candidate",
  (scenario) => {
    let xml = plist;
    let output = loaded();
    if (scenario === "environment") output = output.replace("HOME => /fixture", "HOME => /other");
    if (scenario === "arguments") output = output.replace("\t\t/fixture/uvx", "\t\t/fixture/other");
    if (scenario === "directory") output = output.replace("working directory = /fixture", "working directory = /other");
    if (scenario === "extra") output = output.replace("\t\tXPC_SERVICE_NAME => fixture", "\t\tUNEXPECTED => fixture");
    if (scenario === "duplicate") xml += `\n<!-- <string>${oldSpec}</string> -->`;
    if (scenario === "malformed") xml = "not a plist";
    if (scenario === "launcher options") {
      xml = plist.replace("--system-certs", "--no-config");
      output = loaded(xml);
    }
    expect(() =>
      deriveMemoryCandidate({
        plist: xml,
        loadedOutput: output,
        oldPath,
        newPath,
        oldSpec,
        newSpec,
        label: MEMORY_AGENT_LABEL,
      }),
    ).toThrow();
  },
);

it.runIf(process.platform === "darwin")("refuses an encoded argument when the literal pin is only in a comment", () => {
  const encoded = oldSpec.replace(/0$/, "&#48;");
  const xml = `${plist.replace(`<string>${oldSpec}</string>`, `<string>${encoded}</string>`)}\n<!-- <string>${oldSpec}</string> -->`;
  expect(() =>
    deriveMemoryCandidate({
      plist: xml,
      loadedOutput: loaded(xml),
      oldPath,
      newPath,
      oldSpec,
      newSpec,
      label: MEMORY_AGENT_LABEL,
    }),
  ).toThrow();
});

it.runIf(process.platform === "darwin")("refuses an encoded argument when the literal pin is in another field", () => {
  const encoded = oldSpec.replace(/0$/, "&#48;");
  const xml = plist
    .replace(`<string>${oldSpec}</string>`, `<string>${encoded}</string>`)
    .replace("</dict>\n</plist>", `<key>Fixture</key><string>${oldSpec}</string></dict>\n</plist>`);
  expect(() =>
    deriveMemoryCandidate({
      plist: xml,
      loadedOutput: loaded(xml),
      oldPath,
      newPath,
      oldSpec,
      newSpec,
      label: MEMORY_AGENT_LABEL,
    }),
  ).toThrow();
});

it.runIf(process.platform === "darwin")("refuses saved job settings that differ from loaded properties", () => {
  const changed = plist.replace("<key>KeepAlive</key>\n  <true/>", "<key>KeepAlive</key>\n  <false/>");
  expect(changed).not.toBe(plist);
  expect(() =>
    deriveMemoryCandidate({
      plist: changed,
      loadedOutput: loaded(),
      oldPath,
      newPath,
      oldSpec,
      newSpec,
      label: MEMORY_AGENT_LABEL,
    }),
  ).toThrow();
});
