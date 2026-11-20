#!/usr/bin/env node
// Whole-site usefulness audit report (see references/site-audit.md). Node, no dependencies.
//
//   node site-report.mjs <round-dir> --out <dir> [--round <name>] [--target 80]
//
// Reads every <round-dir>/*.json panel file:
//   {"panel","opened?","of?","views":[{"view","score","verdict?","elements":[{"element","score","reason","fix"}]}]}
// Writes <out>/report.html (pages worst first) and appends the round to <out>/history.json.
// Exits 0 when every page averages at least the target across panels, 1 when not, 2 on bad input.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Read the panel files of one round. */
export function readPanels(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!p.panel || !Array.isArray(p.views)) throw new Error(`${f}: needs "panel" and "views"`);
      return { ...p, file: f };
    });
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

/** Merge panels into pages, worst first. Each page: view, mean, panels{}, verdicts[], elements[]. */
export function merge(panels) {
  const pages = new Map();
  for (const p of panels) {
    for (const v of p.views) {
      const page = pages.get(v.view) ?? { view: v.view, panels: {}, verdicts: [], elements: [] };
      page.panels[p.panel] ??= [];
      page.panels[p.panel].push(Number(v.score));
      if (v.verdict) page.verdicts.push(`${p.panel}: ${v.verdict}`);
      for (const e of v.elements ?? []) page.elements.push({ ...e, score: Number(e.score), panel: p.panel });
      pages.set(v.view, page);
    }
  }
  const out = [...pages.values()].map((pg) => {
    const scores = Object.fromEntries(Object.entries(pg.panels).map(([k, xs]) => [k, avg(xs)]));
    pg.elements.sort((a, b) => a.score - b.score);
    return { ...pg, panels: scores, mean: avg(Object.values(scores)) };
  });
  return out.sort((a, b) => a.mean - b.mean);
}

/** Judges that opened fewer files than they were given. */
export function underRead(panels) {
  return panels
    .filter((p) => Number.isFinite(p.opened) && Number.isFinite(p.of) && p.opened < p.of)
    .map((p) => `${p.file} (${p.panel}): opened ${p.opened} of ${p.of}`);
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function html(pages, history, warnings, target) {
  const panelNames = [...new Set(pages.flatMap((p) => Object.keys(p.panels)))].sort();
  const rows = pages
    .map(
      (p) => `<section><h2>${esc(p.view)} <span class="${p.mean >= target ? "ok" : "bad"}">${p.mean}</span></h2>
<p>${panelNames.map((n) => `${esc(n)} ${p.panels[n] ?? "–"}`).join(" · ")}${p.verdicts.length ? ` · ${esc(p.verdicts.join("; "))}` : ""}</p>
<table><tr><th>Element</th><th>Panel</th><th>Score</th><th>Reason</th><th>Fix</th></tr>
${p.elements.map((e) => `<tr><td>${esc(e.element)}</td><td>${esc(e.panel)}</td><td>${e.score}</td><td>${esc(e.reason)}</td><td>${esc(e.fix)}</td></tr>`).join("\n")}
</table></section>`,
    )
    .join("\n");
  const views = [...new Set(history.flatMap((h) => Object.keys(h.pages)))].sort();
  const hist = `<table><tr><th>Page</th>${history.map((h) => `<th>${esc(h.round)}</th>`).join("")}</tr>
${views.map((v) => `<tr><td>${esc(v)}</td>${history.map((h) => `<td>${h.pages[v] ?? "–"}</td>`).join("")}</tr>`).join("\n")}</table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site audit</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--line:#ccc;--ok:#1a7f37;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--line:#444;--ok:#4ac26b;--bad:#ff7b72}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:16px}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
.ok{color:var(--ok)}.bad{color:var(--bad)}</style></head><body>
<h1>Site audit, worst first</h1><p>Target: every page averages at least ${target} across panels.</p>
${warnings.length ? `<h2>Judges that did not open every file</h2><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
${rows}
<h2>History</h2>${hist}</body></html>\n`;
}

/** Build the report for one round; returns {pages, pass, warnings}. */
export function build(roundDir, out, { round, target = 80 } = {}) {
  const panels = readPanels(roundDir);
  const pages = merge(panels);
  const warnings = underRead(panels);
  mkdirSync(out, { recursive: true });
  const histFile = join(out, "history.json");
  const history = existsSync(histFile) ? JSON.parse(readFileSync(histFile, "utf8")) : [];
  const name = round ?? `R${history.length + 1}`;
  const entry = { round: name, pages: Object.fromEntries(pages.map((p) => [p.view, p.mean])) };
  const i = history.findIndex((h) => h.round === name);
  if (i >= 0) history[i] = entry;
  else history.push(entry);
  writeFileSync(histFile, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(out, "report.html"), html(pages, history, warnings, target), { mode: 0o600 });
  return { pages, warnings, pass: pages.length > 0 && pages.every((p) => p.mean >= target) };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const out = opt("--out");
  const round = opt("--round");
  const target = Number(opt("--target") ?? 80);
  const dir = args[0];
  if (!dir || !out) {
    console.error("usage: site-report.mjs <round-dir> --out <dir> [--round <name>] [--target 80]");
    return 2;
  }
  try {
    const r = build(dir, out, { round, target });
    for (const w of r.warnings) console.log(`warning: ${w}`);
    for (const p of r.pages) console.log(`${p.mean}\t${p.view}`);
    console.log(`report: ${join(out, "report.html")}`);
    return r.pass ? 0 : 1;
  } catch (e) {
    console.error(String(e.message ?? e));
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
