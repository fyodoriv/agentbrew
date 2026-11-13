#!/usr/bin/env node
// Principal-engineer judge panel for a UI page (see references/design-judges.md).
//
//   node judge.mjs lenses                         list the ten lenses
//   node judge.mjs prompt --lens hierarchy --shots <dir> [--context f] [--decisions f]
//                                                 print one blind judge's prompt
//   node judge.mjs score <dir> [--json] [--target 8]
//                                                 score every <dir>/*.txt judge reply by the rubric
//   node judge.mjs conflicts <dir> [--decisions f] [--json]
//                                                 list fixes that ask opposite things in one round
//                                                 or reverse the ledger; exit 1 when any exist
//
// Judges list issues; this script turns issues into scores, so a score moves when an issue
// closes (free 0-10 scores from LLM judges stall near 6 and flip between rounds).
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LENSES = {
  hierarchy: "visual hierarchy and layout: what the eye reads first, grouping, balance, empty space",
  interaction: "interaction design: affordances, feedback, undo, consistent action order, error states",
  a11y: "accessibility: contrast 4.5:1 text and 3:1 controls, 44 px targets, labels, focus, both themes",
  mobile: "phone layout: thumb reach, first screen, overflow, sticky bars, one-hand use",
  system: "design system: one type scale, spacing scale, button and chip variants, one icon set",
  copy: "copy and microcopy: plain words, labels that say what happens, numbers people can use",
  cognitive: "cognitive load: one next action, choices per screen, scanning, memory burden",
  polish: "craft and polish: alignment, crop, rough edges, placeholder content, dark mode parity",
  product: "product fit: does the page move the user's real goal forward, trust, missing outcome",
  overall: "overall ship readiness at a top product company",
};

// Rubric (UICrit-style: the score follows from the critique, not from a free guess).
export const WEIGHT = { blocker: 2.5, major: 1.0, minor: 0.3 };
const BLOCKER_CAP = 6;

export function prompt({ lens, shots, context = "", decisions = "" }) {
  const what = LENSES[lens] ?? lens;
  return [
    "You are a principal UI engineer (15+ years, shipped consumer apps at scale). You did not build this page.",
    `Read every screenshot in ${shots} with the Read tool (phone and desktop, light and dark).`,
    context ? `Product context:\n${context}` : "",
    decisions ? `Settled decisions (the owner chose these; do not report them as issues):\n${decisions}` : "",
    `Your lens: ${what}. Report only what your lens covers.`,
    "List the issues a principal would flag in review. Severity:",
    "- blocker: broken, unusable, unreadable, or inaccessible in a screenshot; a ship-stopper.",
    "- major: clearly slows or confuses the main task, or breaks the page's own system on every screen.",
    "- minor: polish a careful reviewer would mention but would ship with.",
    "Do not report taste (a color you would pick differently), anything you cannot see in a screenshot,",
    "or a guess about code. Do not invent issues to fill a quota: a good page has few.",
    "Reply ONLY with lines in this exact form, at most 8, most severe first, or the single line NONE:",
    "ISSUE: <blocker|major|minor> | <screenshot file> | <element> | <problem> | <fix>",
    "Start each fix with one direction verb: add, remove, show, hide, increase, reduce, enlarge,",
    "shrink, darken, lighten, emphasize, quiet, move, or change. Do not ask to reverse a settled",
    "decision unless it causes a blocker you can see; then name the decision and the screenshot.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parse(text) {
  const issues = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*[-*]?\s*ISSUE:\s*(blocker|major|minor)\s*\|(.*)$/i);
    if (!m) continue;
    const [shot = "", element = "", problem = "", fix = ""] = m[2].split("|").map((x) => x.trim());
    issues.push({ severity: m[1].toLowerCase(), shot, element, problem, fix });
  }
  return issues;
}

export function scoreOf(issues) {
  const raw = 10 - issues.reduce((s, i) => s + WEIGHT[i.severity], 0);
  const capped = issues.some((i) => i.severity === "blocker") ? Math.min(raw, BLOCKER_CAP) : raw;
  return Math.max(0, Math.round(capped * 10) / 10);
}

const words = (s) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9а-я ]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
const overlap = (a, b) => {
  const inter = [...a].filter((w) => b.has(w)).length;
  return inter / Math.max(1, Math.min(a.size, b.size));
};

/** Issues two or more judges name (by shared words in element and problem), worst first. */
export function consensus(byJudge) {
  const all = byJudge.flatMap(({ judge, issues }) =>
    issues.map((i) => ({ ...i, judge, w: words(`${i.element} ${i.problem}`) })),
  );
  const groups = [];
  for (const i of all) {
    const g = groups.find((x) => overlap(x.w, i.w) >= 0.5);
    if (g) {
      g.items.push(i);
      for (const w of i.w) g.w.add(w);
    } else groups.push({ w: new Set(i.w), items: [i] });
  }
  return groups
    .map((g) => ({
      judges: new Set(g.items.map((i) => i.judge)).size,
      weight: g.items.reduce((s, i) => s + WEIGHT[i.severity], 0),
      element: g.items[0].element,
      problem: g.items[0].problem,
      fixes: [...new Set(g.items.map((i) => i.fix))].slice(0, 3),
    }))
    .filter((g) => g.judges >= 2)
    .sort((a, b) => b.weight - a.weight);
}

// Opposite directions: a fix and its reverse on one element cannot both be built.
const OPPOSITE = [
  ["add", "remove"],
  ["show", "hide"],
  ["increase", "reduce"],
  ["enlarge", "shrink"],
  ["darken", "lighten"],
  ["emphasize", "quiet"],
];
const SYNONYM = {
  drop: "remove",
  delete: "remove",
  removed: "remove",
  restore: "add",
  reintroduce: "add",
  added: "add",
  reveal: "show",
  shown: "show",
  collapse: "hide",
  hidden: "hide",
  raise: "increase",
  heavier: "increase",
  lower: "reduce",
  soften: "quiet",
  mute: "quiet",
  quieter: "quiet",
  louder: "emphasize",
  bolder: "emphasize",
  stronger: "emphasize",
  bigger: "enlarge",
  larger: "enlarge",
  widen: "enlarge",
  smaller: "shrink",
  narrow: "shrink",
};
const opposite = (d) => OPPOSITE.find((p) => p.includes(d))?.find((x) => x !== d);

/** The direction a fix or ledger line asks for: its first direction word, or "" when none. */
export function direction(text) {
  for (const w of String(text)
    .toLowerCase()
    .match(/[a-z]+/g) ?? []) {
    const d = SYNONYM[w] ?? w;
    if (opposite(d)) return d;
  }
  return "";
}

/** Fixes that ask opposite things on one element, in this round or against the ledger. */
export function conflicts(byJudge, decisions = "") {
  const fixes = byJudge.flatMap(({ judge, issues }) =>
    issues.map((i) => ({ judge, element: i.element, fix: i.fix, d: direction(i.fix), w: words(i.element) })),
  );
  const out = [];
  for (let a = 0; a < fixes.length; a++)
    for (let b = a + 1; b < fixes.length; b++) {
      const [x, y] = [fixes[a], fixes[b]];
      if (x.judge !== y.judge && x.d && opposite(x.d) === y.d && overlap(x.w, y.w) >= 0.5)
        out.push({ kind: "round", element: x.element, asks: [`${x.judge}: ${x.fix}`, `${y.judge}: ${y.fix}`] });
    }
  for (const line of String(decisions)
    .split("\n")
    .filter((l) => l.trim())) {
    const d = direction(line);
    const lw = words(line);
    for (const f of fixes) {
      const hit = [...f.w].filter((w) => lw.has(w)).length / Math.max(1, f.w.size);
      if (d && opposite(d) === f.d && hit >= 0.5)
        out.push({ kind: "ledger", element: f.element, asks: [`ledger: ${line.trim()}`, `${f.judge}: ${f.fix}`] });
    }
  }
  return out;
}

const replies = (dir) =>
  readdirSync(dir)
    // judge replies only: the round's context and decisions sit beside them
    .filter((f) => f.endsWith(".txt") && !["context.txt", "decisions.txt"].includes(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const issues = /^\s*NONE\s*$/m.test(text) ? [] : parse(text);
      return { judge: f.replace(/\.txt$/, ""), issues, score: scoreOf(issues) };
    });

/** Conflicts for a round folder; the ledger defaults to <dir>/decisions.txt. */
export function roundConflicts(dir, decisionsFile = "") {
  try {
    return conflicts(replies(dir), readFileSync(decisionsFile || join(dir, "decisions.txt"), "utf8"));
  } catch {
    return conflicts(replies(dir));
  }
}

export function score(dir, target = 8) {
  const byJudge = replies(dir);
  const scores = byJudge.map((j) => j.score);
  const mean = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
  return {
    judges: byJudge.map(({ judge, score, issues }) => ({ judge, score, issues: issues.length })),
    mean,
    min: scores.length ? Math.min(...scores) : 0,
    at_target: scores.filter((s) => s >= target).length,
    target,
    consensus: consensus(byJudge),
  };
}

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

// run as a command (also through a symlinked path such as /tmp on macOS)
const main = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (main) {
  const cmd = process.argv[2];
  if (cmd === "lenses") {
    for (const [k, v] of Object.entries(LENSES)) console.log(`${k}\t${v}`);
  } else if (cmd === "prompt") {
    const read = (f) => (f ? readFileSync(f, "utf8").trim() : "");
    console.log(
      prompt({
        lens: arg("lens", "overall"),
        shots: arg("shots", "."),
        context: read(arg("context")),
        decisions: read(arg("decisions")),
      }),
    );
  } else if (cmd === "score") {
    const r = score(process.argv[3], Number(arg("target", "8")));
    if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
    else {
      for (const j of r.judges) console.log(`${j.judge}\t${j.score}\t(${j.issues} issues)`);
      console.log(`mean ${r.mean} · min ${r.min} · ${r.at_target}/${r.judges.length} at ${r.target}+`);
      for (const c of r.consensus)
        console.log(`- [${c.judges} judges] ${c.element}: ${c.problem} -> ${c.fixes.join(" / ")}`);
    }
    process.exitCode = r.judges.length && r.min >= r.target ? 0 : 1;
  } else if (cmd === "conflicts") {
    const c = roundConflicts(process.argv[3], arg("decisions"));
    if (process.argv.includes("--json")) console.log(JSON.stringify(c, null, 2));
    else {
      for (const x of c) console.log(`- ${x.kind} conflict on ${x.element}: ${x.asks.join("  <>  ")}`);
      console.log(c.length ? `${c.length} conflicts: build none; settle each in decisions.txt` : "no conflicts");
    }
    process.exitCode = c.length ? 1 : 0;
  } else {
    console.error("usage: judge.mjs lenses | prompt --lens <l> --shots <dir> | score <dir> | conflicts <dir>");
    process.exitCode = 2;
  }
}
