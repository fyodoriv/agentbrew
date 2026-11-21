import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import yaml from "js-yaml";
import type { AgentBrewState } from "../types.js";

const [role, root] = process.argv.slice(2);
if (
  !root ||
  !basename(root).startsWith("ab-state-writers-") ||
  process.cwd() !== root ||
  realpathSync(root) !== root ||
  homedir() !== root
) {
  throw new Error("State fixture requires its disposable home and working folder");
}

const { defaultState, getStatePath, invalidateState, loadState, saveState } = await import("../state.js");
const statePath = join(root, ".config", "agentbrew", "state.yaml");
if (getStatePath() !== statePath) throw new Error("State fixture resolved an unexpected file");

function snapshot(value: AgentBrewState | undefined) {
  if (!value || value.schemaVersion !== 1) throw new Error("Unexpected state fixture schema");
  return { catalog: value.catalogVersion, servers: (value.mcpServers ?? []).map((server) => server.name) };
}

function write(value: AgentBrewState) {
  if (saveState(value) === false) throw new Error("State fixture could not save its file");
}

if (role === "seed") {
  write({ ...defaultState(), catalogVersion: "before", mcpServers: [] });
} else if (role === "catalog") {
  const value = loadState();
  if (!value || snapshot(value).catalog !== "before" || value.mcpServers?.length !== 0 || !process.send) {
    throw new Error("First writer loaded unexpected fixture state");
  }
  const options = { signal: AbortSignal.timeout(10_000) };
  const request = Promise.race([once(process, "message", options), once(process, "disconnect", options)]);
  process.send("loaded");
  const [command] = await request;
  if (command !== "save") throw new Error("First writer did not receive the save signal");
  value.catalogVersion = "first-edit";
  write(value);
  process.disconnect?.();
} else if (role === "server") {
  const value = loadState();
  if (!value || value.mcpServers?.length !== 0) throw new Error("Second writer loaded unexpected fixture state");
  value.mcpServers.push({ name: "fixture", command: "fixture", args: [], env: {}, source: "fixture" });
  write(value);
  invalidateState();
  console.log(JSON.stringify(snapshot(loadState())));
} else if (role === "read") {
  const backup = yaml.load(readFileSync(`${statePath}.bak`, "utf8")) as AgentBrewState;
  console.log(JSON.stringify({ current: snapshot(loadState()), backup: snapshot(backup) }));
} else {
  throw new Error("Unknown state fixture role");
}
