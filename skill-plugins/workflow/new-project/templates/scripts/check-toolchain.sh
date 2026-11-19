#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { printf 'toolchain: %s missing. Run scripts/setup.sh with your project tools.\n' "$1" >&2; exit 1; }
}

if [ -f package.json ] || [ -f .node-version ]; then
  require_tool node
  node <<'NODE'
const { existsSync, readFileSync } = require("fs");
const { spawnSync } = require("child_process");

function refuse(message) {
  console.error(`toolchain: ${message}`);
  process.exitCode = 1;
}

function check() {
  if (existsSync(".node-version")) {
    let pin;
    try {
      pin = readFileSync(".node-version", "utf8").trim();
    } catch {
      return refuse("Cannot read .node-version. Fix the version pin and retry the commit.");
    }
    const version = /^v?(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(pin);
    if (!version) return refuse(".node-version needs a numeric Node pin. Fix it and retry the commit.");
    const [major, minor] = process.versions.node.split(".");
    if (version[1] !== major || (version[2] !== undefined && version[2] !== minor)) {
      return refuse(`Node ${process.versions.node} does not match .node-version (${pin}). Select the pinned Node version and retry the commit.`);
    }
  }
  if (!existsSync("package.json")) return;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync("package.json", "utf8"));
  } catch {
    return refuse("Cannot read package.json as JSON. Fix it and retry the commit.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return refuse("package.json needs a JSON object. Fix it and retry the commit.");
  }
  const groups = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies];
  for (const [name, binary] of [["@biomejs/biome", "biome"], ["lefthook", "lefthook"]]) {
    if (!groups.some((group) => group && Object.prototype.hasOwnProperty.call(group, name))) continue;
    const launcher = `./node_modules/.bin/${binary}`;
    const run = spawnSync(launcher, ["--version"], { stdio: "ignore", timeout: 2000 });
    if (run.status !== 0) {
      return refuse(`${binary} cannot start. Run scripts/setup.sh on this machine and retry the commit.`);
    }
  }
}

check();
NODE
fi

[ ! -f pyproject.toml ] || require_tool uv
[ ! -f Cargo.toml ] || require_tool cargo
