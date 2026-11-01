// `npm run docs:proof`: collect the README Proof metrics into
// docs/proof/metrics.json, then rewrite the README Proof section from it.
// Inputs: the content-free event log (AGENTBREW_EVENTS_FILE, default
// ~/.local/share/agentbrew/logs/events.jsonl) and the gate timings
// (AGENTBREW_METRICS_DIR/gate-timings.jsonl, default .metrics).
// `--render` skips collecting and only rewrites the README from the file.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildAgentMatrix } from "../src/docs/agent-matrix.js";
import { collect, type ProofFile, readJsonl, render, replaceSection, validate } from "../src/docs/proof.js";
import { fieldTotals, personalSetting } from "../src/docs/proof-posthog.js";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "docs/proof/metrics.json");
const readmePath = join(root, "README.md");

// A machine label: a salted hash of the host name. The salt stays on this
// machine (XDG state), so the label cannot be reversed to a host or user.
function proofSalt(): string {
  const saltFile = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "agentbrew/proof-salt");
  if (!existsSync(saltFile)) {
    mkdirSync(dirname(saltFile), { recursive: true });
    writeFileSync(saltFile, randomBytes(16).toString("hex"), { mode: 0o600 });
  }
  return readFileSync(saltFile, "utf-8").trim();
}

function machineLabel(): string {
  return `m-${createHash("sha256").update(`${proofSalt()}:${hostname()}`).digest("hex").slice(0, 10)}`;
}

// The install receipt's `run` block (scripts/install.sh run), if a receipt exists.
function readInstallRun(): { ok?: boolean; seconds?: number; finished_at?: string } | undefined {
  const receipt =
    process.env.AGENTBREW_INSTALL_RECEIPT ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "agentbrew/install-receipt.json");
  try {
    return (
      JSON.parse(readFileSync(receipt, "utf-8")) as { run?: { ok?: boolean; seconds?: number; finished_at?: string } }
    ).run;
  } catch {
    return undefined;
  }
}

let file: ProofFile | undefined = existsSync(out) ? (JSON.parse(readFileSync(out, "utf-8")) as ProofFile) : undefined;
if (!process.argv.includes("--render")) {
  const events = process.env.AGENTBREW_EVENTS_FILE ?? join(homedir(), ".local/share/agentbrew/logs/events.jsonl");
  const metricsDir = process.env.AGENTBREW_METRICS_DIR ?? join(root, ".metrics");
  file = collect(
    {
      date: new Date().toISOString().slice(0, 10),
      events: readJsonl(events),
      timings: readJsonl(join(metricsDir, "gate-timings.jsonl")),
      userFiles: readJsonl(join(metricsDir, "user-files.jsonl")),
      catalogYaml: readFileSync(join(root, "src/catalog.yaml"), "utf-8"),
      fullSyncAgents: buildAgentMatrix().filter((r) => !r.experimental && (r.mcp || r.rules || r.commands)).length,
      // A machine label without the host name.
      machine: `${machineLabel()} (${process.platform} ${arch()})`,
      installRun: readInstallRun(),
      command: process.env.AGENTBREW_METRICS_DIR
        ? "AGENTBREW_METRICS_DIR=<main checkout>/.metrics npm run docs:proof"
        : undefined,
    },
    file,
  );
  // Field totals from every install that sends telemetry; the local aggregate stays the fallback.
  const field = await fieldTotals({
    key: personalSetting("AGENTBREW_POSTHOG_QUERY_KEY", "posthog_query_key"),
    project: personalSetting("AGENTBREW_POSTHOG_PROJECT", "posthog_project_id"),
    url: process.env.AGENTBREW_POSTHOG_QUERY_URL,
    salt: proofSalt(),
  });
  if (field.note) console.log(`note: ${field.note}`);
  else file.machines = { ...(file.machines ?? {}), ...field.machines };
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}
if (!file) {
  console.error("docs/proof/metrics.json is missing: run npm run docs:proof first");
  process.exit(1);
}
const problems = validate(file);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
writeFileSync(readmePath, replaceSection(readFileSync(readmePath, "utf-8"), render(file)), "utf-8");
for (const [k, v] of Object.entries(file.metrics))
  console.log(`${k.padEnd(22)} ${String(v.value).padEnd(10)} ${v.kind}`);
