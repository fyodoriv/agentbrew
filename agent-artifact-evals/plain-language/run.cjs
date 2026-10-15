#!/usr/bin/env node
// Plain-language report for sampled agent output.
//
// No arguments: score the bundled samples and failing fixtures, print one
// row per agent and surface, and exit 1 if a sample fails or a fixture passes.
// With `--surface <name> <file>...`: score your own captured output (opt-in).
const fs = require("node:fs");
const path = require("node:path");
const { evaluatePlainLanguage, SURFACES } = require("../plain-language.cjs");

const ROOT = __dirname;

// Samples live at samples/<agent>/<surface>.<ext>; fixtures at failing/<agent>--<surface>.<ext>.
function describeFile(file, dir) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  if (dir === "samples") return { agent: path.basename(path.dirname(file)), surface: base };
  const [agent, surface] = base.split("--");
  return { agent, surface };
}

function evaluateFile(filePath, surface) {
  const text = fs.readFileSync(filePath, "utf-8");
  return evaluatePlainLanguage({ artifactPath: path.relative(process.cwd(), filePath), surface, text });
}

function listFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
    .sort();
}

function runBundled() {
  let unexpected = 0;
  console.log("expect  result  agent        surface        diagnostics");
  for (const [dir, expected] of [
    ["samples", "PASS"],
    ["failing", "FAIL"],
  ]) {
    for (const file of listFiles(path.join(ROOT, dir))) {
      const { agent, surface } = describeFile(file, dir);
      const result = evaluateFile(file, surface);
      if (result.status !== expected) unexpected += 1;
      const gaps = result.diagnostics.map((d) => d.id).join(",") || "-";
      console.log(`${expected.padEnd(8)}${result.status.padEnd(8)}${agent.padEnd(13)}${surface.padEnd(15)}${gaps}`);
    }
  }
  console.log(unexpected === 0 ? "\nplain-language: OK" : `\nplain-language: ${unexpected} unexpected result(s)`);
  return unexpected === 0 ? 0 : 1;
}

function runFiles(args) {
  const surfaceIndex = args.indexOf("--surface");
  const surface = surfaceIndex >= 0 ? args[surfaceIndex + 1] : undefined;
  const files = args.filter((_, index) => index !== surfaceIndex && index !== surfaceIndex + 1);
  if (!surface || files.length === 0) {
    console.error(`usage: run.cjs --surface <${SURFACES.join("|")}> <file>...`);
    return 2;
  }
  let failures = 0;
  for (const file of files) {
    const result = evaluateFile(path.resolve(file), surface);
    if (result.status === "FAIL") failures += 1;
    console.log(`${result.output}\n`);
  }
  return failures === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
process.exitCode = args.length === 0 ? runBundled() : runFiles(args);
