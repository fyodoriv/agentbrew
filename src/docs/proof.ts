import { readFileSync } from "node:fs";
import yaml from "js-yaml";

/**
 * The README Proof section: collect real numbers into docs/proof/metrics.json,
 * then render the section from that file. `npm run docs:proof` does both.
 * The collected file holds aggregates and counts only, never content.
 */

export interface MetricPoint {
  date: string;
  value: number;
}

export interface Metric {
  value: number | null;
  unit: string;
  date: string;
  kind: string;
  command: string;
  detail?: string;
  history: MetricPoint[];
}

export interface ProofFile {
  metrics: Record<string, Metric>;
  charts: { syncMsByDay: MetricPoint[]; repair: { repaired: number; remaining: number } };
  /** Per-machine field totals. The key is a salted hash, never a host or user name. */
  machines?: Record<string, MachineTotals>;
}

export interface MachineTotals {
  date: string;
  syncs: number;
  syncFailed: number;
  repairs: number;
  repairFailed: number;
  driftSeen: number;
  driftRepaired: number;
}

/** Metrics from real use; the rest are engineering health, never headline proof. */
export const HEADLINE = new Set(["sync_ms", "sync_fail_rate", "repair_fail_rate", "drift_repaired_share"]);

interface Event {
  ts?: string;
  event?: string;
  ok?: boolean;
  ms?: number;
  mode?: string;
  cached_steps?: number;
  changed?: number;
  checked?: number;
  failedRuns?: number;
  driftBefore?: number;
  repaired?: number;
  remaining?: number;
}

export const COMMAND = "npm run docs:proof";
const HISTORY_MAX = 30;

export function readJsonl(file: string): Event[] {
  let text = "";
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Event);
    } catch {
      // A torn line is skipped, never counted.
    }
  }
  return out;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};
const pct = (part: number, all: number): number | null => (all ? Math.round((1000 * part) / all) / 10 : null);

export function catalogItems(catalogYaml: string): number {
  const c = yaml.load(catalogYaml) as Record<string, unknown>;
  let n = 0;
  for (const key of ["skills", "mcp_servers", "cli_tools", "claude_plugins", "rules"]) {
    const v = c[key];
    n += Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
  }
  return n;
}

interface Inputs {
  date: string;
  events: Event[];
  timings: Event[];
  /** Lines from .metrics/user-files.jsonl (scripts/user-files-proof.ts). */
  userFiles?: Event[];
  catalogYaml: string;
  fullSyncAgents: number;
  machine: string;
  /** The command line that made the numbers, when it differs from COMMAND. */
  command?: string;
}

/** Compute every metric from the inputs. A metric with no data has value null. */
export function collect(inp: Inputs, previous?: ProofFile): ProofFile {
  const realUse = "real use";
  const localRun = `local run, ${inp.date}, ${inp.machine}`;
  const span = (es: Event[]) => {
    const ds = es
      .map((e) => (e.ts ?? "").slice(0, 10))
      .filter(Boolean)
      .sort();
    return ds.length ? `${ds[0]} to ${ds[ds.length - 1]}` : "no runs";
  };
  const syncs = inp.events.filter((e) => e.event === "sync" && Number.isFinite(e.ms));
  const repairs = inp.events.filter((e) => e.event === "repair");
  const gates = inp.timings.filter((e) => e.event === "gate" && e.mode === "full");
  const cold = gates.filter((e) => e.ok && e.cached_steps === 0 && Number.isFinite(e.ms));
  const drift = repairs.reduce((a, e) => a + (e.driftBefore ?? 0), 0);
  const fixed = repairs.reduce((a, e) => a + (e.repaired ?? 0), 0);
  const days = (es: Event[]) => new Set(es.map((e) => (e.ts ?? "").slice(0, 10))).size;
  const gateRun = `local run, ${(gates.at(-1)?.ts ?? inp.date).slice(0, 10)}, ${inp.machine}`;
  // The last 3 seeded-home runs: the worst count wins, and a failed sync run voids it.
  const userFiles = (inp.userFiles ?? []).filter((e) => e.event === "user_files").slice(-3);
  const userFilesMetric = (): Metric =>
    m(
      userFiles.length && userFiles.every((e) => e.failedRuns === 0)
        ? Math.max(...userFiles.map((e) => e.changed ?? 0))
        : null,
      "files",
      `local run, ${(userFiles.at(-1)?.ts ?? inp.date).slice(0, 10)}, ${inp.machine}`,
      `most user items changed in one of the last ${userFiles.length} seeded-home runs (3 syncs each); npm run proof:user-files`,
    );

  const m = (value: number | null, unit: string, kind: string, detail?: string): Metric => ({
    value,
    unit,
    date: inp.date,
    kind,
    command: inp.command ?? COMMAND,
    ...(detail ? { detail } : {}),
    history: [],
  });
  const metrics: Record<string, Metric> = {
    full_sync_agents: m(inp.fullSyncAgents, "agents", localRun, "agents with more than a skills folder in agents.yaml"),
    catalog_items: m(
      catalogItems(inp.catalogYaml),
      "items",
      localRun,
      "skills, MCP servers, CLI tools, plugins, rules in src/catalog.yaml",
    ),
    sync_ms: m(
      median(syncs.slice(-20).map((e) => e.ms as number)),
      "ms",
      realUse,
      `median of the last 20 of ${syncs.length} syncs over ${days(syncs)} days`,
    ),
    sync_fail_rate: m(
      pct(syncs.filter((e) => !e.ok).length, syncs.length),
      "%",
      realUse,
      `${syncs.length} syncs, ${span(syncs)}`,
    ),
    repair_fail_rate: m(
      pct(repairs.filter((e) => !e.ok).length, repairs.length),
      "%",
      realUse,
      `${repairs.length} scheduled repairs, ${span(repairs)}`,
    ),
    drift_repaired_share: m(
      pct(fixed, drift),
      "%",
      realUse,
      `${fixed} of ${drift} drift items seen by ${repairs.length} repairs`,
    ),
    gate_pass_rate: m(
      pct(gates.filter((e) => e.ok).length, gates.length),
      "%",
      gateRun,
      `${gates.length} full npm run verify runs, ${span(gates)}`,
    ),
    user_files_changed: userFilesMetric(),
    gate_ms: m(
      median(cold.slice(-10).map((e) => e.ms as number)),
      "ms",
      gateRun,
      `median of ${Math.min(cold.length, 10)} passing uncached runs`,
    ),
  };
  for (const [name, metric] of Object.entries(metrics)) {
    const old = previous?.metrics[name]?.history ?? [];
    const kept = old.filter((p) => p.date !== inp.date);
    metric.history =
      metric.value === null ? kept : [...kept, { date: inp.date, value: metric.value }].slice(-HISTORY_MAX);
  }
  const byDay = new Map<string, number[]>();
  for (const e of syncs) {
    const d = (e.ts ?? "").slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), e.ms as number]);
  }
  const syncMsByDay = [...byDay.keys()]
    .sort()
    .slice(-14)
    .map((d) => ({ date: d, value: median(byDay.get(d) ?? []) ?? 0 }));
  const here: MachineTotals = {
    date: inp.date,
    syncs: syncs.length,
    syncFailed: syncs.filter((e) => !e.ok).length,
    repairs: repairs.length,
    repairFailed: repairs.filter((e) => !e.ok).length,
    driftSeen: drift,
    driftRepaired: fixed,
  };
  const machines = { ...(previous?.machines ?? {}), [inp.machine.split(" ")[0] ?? inp.machine]: here };
  return { metrics, charts: { syncMsByDay, repair: { repaired: fixed, remaining: drift - fixed } }, machines };
}

/** Return the list of problems in a metrics file: each metric needs a date, a kind, and a command. */
export function validate(file: ProofFile): string[] {
  const out: string[] = [];
  for (const [name, x] of Object.entries(file.metrics)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date ?? "")) out.push(`${name}: no date`);
    if (!/^(real use|local run, \d{4}-\d{2}-\d{2}, .+)$/.test(x.kind ?? "")) out.push(`${name}: no data kind`);
    if (!x.command) out.push(`${name}: no command`);
  }
  return out;
}

const show = (x: Metric | undefined): string => {
  if (!x || x.value === null) return "not measured yet";
  const v =
    x.unit === "ms" ? `${x.value.toLocaleString("en-US")} ms` : x.unit === "%" ? `${x.value}%` : `${x.value} ${x.unit}`;
  return x.detail ? `${v} (${x.detail})` : v;
};
const src = (x: Metric | undefined): string => (x ? `\`docs/proof/metrics.json\`, ${x.kind}` : "not measured yet");

interface Row {
  claim: string;
  theory: string;
  metric: string;
  key?: string;
  task?: string;
}

const ROWS: Row[] = [
  {
    claim: "One source of truth reaches every agent",
    theory: "One declared config, rendered per agent, avoids hand-copied drift (DRY: Hunt and Thomas 1999)",
    metric: "agents with a full sync surface",
    key: "full_sync_agents",
  },
  {
    claim: "Curated 200+-item catalog",
    theory: "A curated index saves search time; the count is checked, not guessed",
    metric: "catalog entries",
    key: "catalog_items",
  },
  {
    claim: "Sync is fast enough to run often",
    theory: "Under 2 s keeps a tool inside a user's flow (Nielsen 1993, response-time limits)",
    metric: "`sync` time, goal 2,000 ms or less",
    key: "sync_ms",
  },
  {
    claim: "Sync works reliably",
    theory: "A low failure share is what makes background sync safe",
    metric: "failed `sync` runs, goal 5% or less",
    key: "sync_fail_rate",
  },
  {
    claim: "Self-healing: the scheduled repair runs cleanly",
    theory: "A repair loop only helps when its own runs succeed",
    metric: "failed scheduled repairs, goal 5% or less",
    key: "repair_fail_rate",
  },
  {
    claim: "Self-healing: drift gets fixed",
    theory: "Drift found and fixed by the loop is the outcome the claim promises",
    metric: "drift items the repair fixed",
    key: "drift_repaired_share",
  },
  {
    claim: "Changes ship through a full gate",
    theory: "A gate that passes most runs and is fast gets run, not skipped (Forsgren, Humble, Kim 2018)",
    metric: "passing `npm run verify` runs",
    key: "gate_pass_rate",
  },
  {
    claim: "The gate is fast enough to run before each merge",
    theory: "A shorter feedback loop gets used more (Forsgren, Humble, Kim 2018)",
    metric: "uncached gate time, goal 300,000 ms or less",
    key: "gate_ms",
  },
  {
    claim: "Never destroys your data",
    theory: "Sync must leave user-made files byte for byte the same",
    metric: "user files changed by a sync on a seeded home, goal 0",
    key: "user_files_changed",
  },
  {
    claim: "A fresh machine is set up in one command",
    theory: "Time to configured is the outcome a one-step install promises",
    metric: "seconds from a cold install to a clean `agentbrew status --ci`",
    task: "measure-zero-to-configured",
  },
];

function fieldAndHealth(file: ProofFile): string[] {
  const lines: string[] = [];
  const machines = Object.entries(file.machines ?? {});
  lines.push(
    "",
    `Field data comes from ${machines.length} machine(s), each named by a salted hash: ${
      machines.map(([k, t]) => `\`${k}\` (${t.syncs} syncs, ${t.repairs} repairs, as of ${t.date})`).join("; ") ||
      "none yet"
    }.`,
    "",
    "Engineering health (from the code and the local gate, not field proof):",
    "",
  );
  for (const r of ROWS) {
    if (!r.key || HEADLINE.has(r.key)) continue;
    const x = file.metrics[r.key];
    lines.push(`- ${r.metric}: ${show(x)}; ${x ? x.kind : "not measured yet"}`);
  }
  return lines;
}

/** Render the Proof section body (between the markers) from a metrics file. */
export function render(file: ProofFile): string {
  const lines = [
    "Every number below comes from `docs/proof/metrics.json`. `npm run docs:proof` writes that file and this section.",
    "Each headline row is a field outcome: `real use` numbers come from the local, content-free event log that every real `agentbrew sync` and scheduled repair writes ([`docs/observability.md`](docs/observability.md)). Nothing is uploaded; each machine aggregates its own log.",
    "",
    "| Claim | Theory | Metric | Result | Source |",
    "|---|---|---|---|---|",
  ];
  for (const r of ROWS) {
    if (r.key && !HEADLINE.has(r.key)) continue;
    const x = r.key ? file.metrics[r.key] : undefined;
    const result = r.task ? `not measured yet (task \`${r.task}\` in TASKS.md)` : show(x);
    lines.push(`| ${r.claim} | ${r.theory} | ${r.metric} | ${result} | ${r.task ? "not measured yet" : src(x)} |`);
  }
  lines.push(...fieldAndHealth(file));
  const days = file.charts.syncMsByDay;
  if (days.length) {
    lines.push(
      "",
      "Median `agentbrew sync` time per day (real use, ms):",
      "",
      "```mermaid",
      "xychart-beta",
      '  title "Median sync time per day (ms)"',
      `  x-axis [${days.map((d) => `"${d.date.slice(5)}"`).join(", ")}]`,
      '  y-axis "ms"',
      `  bar [${days.map((d) => d.value).join(", ")}]`,
      "```",
    );
  }
  const { repaired, remaining } = file.charts.repair;
  if (repaired + remaining > 0) {
    lines.push(
      "",
      "Drift items the scheduled repair saw (real use). One item can count in more than one run. Honest gap: most were not fixed by the repair run that saw them.",
      "",
      "```mermaid",
      "pie title Drift items found by scheduled repair",
      `  "Repaired" : ${repaired}`,
      `  "Not fixed by that run" : ${remaining}`,
      "```",
    );
  }
  return lines.join("\n");
}

export const START = "<!-- proof:start -->";
export const END = "<!-- proof:end -->";

export function replaceSection(readme: string, body: string): string {
  const re = new RegExp(`${START}[\\s\\S]*?${END}`, "u");
  if (!re.test(readme)) throw new Error(`README.md has no ${START} / ${END} block`);
  return readme.replace(re, `${START}\n${body}\n${END}`);
}
