# Spike: portability of Minsky's check-rule-*.mjs scripts

**Status**: complete — 2026-05-26
**Parent task**: `reuse-minsky-check-rule-scripts`
**Sub-task**: `reuse-minsky-check-rule-spike` (sub-task A)

## Question

Can agentbrew invoke Minsky's deterministic rule linters (`~/apps/tooling/minsky/scripts/check-rule-*.mjs`) directly against the agentbrew repo — the GET-it path in the agentbrew "delegate → contribute → absorb" strategy — or are the scripts hardcoded to the Minsky repo's filesystem layout and need either an upstream contribution or vendoring before they can be reused?

## Verdict

**3 of 12 scripts are portable today** via a `--repo=<path>` CLI flag or `process.cwd()` default. The other **9 hardcode** `REPO_ROOT = resolve(HERE, "..")` (or equivalent) at module top and always read from the Minsky checkout regardless of where they're invoked.

→ **Recommended strategy: CONTRIBUTE-then-WRAP** (the third step of the decision order).
- Open an upstream PR against `github.com/fyodoriv/minsky` adding the `--repo=<path>` flag pattern (already proven by rules 1, 6, 17) to the 9 hardcoded scripts.
- Once merged, build the agentbrew adapter (`src/adapters/rule-lint.{ts,minsky.ts}`) that spawns the scripts with `--repo=$(pwd)`.
- VENDOR is the fallback only if the upstream PR is rejected or sits >90 days (the same window the parent task documents).

## Per-script classification

Source paths are relative to `~/apps/tooling/minsky/scripts/` and line numbers are from the on-disk file at the time of this spike.

| Script | Root resolution | Class | Strategy |
|---|---|---|---|
| `check-rule-1-novel-justification.mjs:172` | `repo: process.cwd()` + `--repo=` flag | **CWD-PORTABLE** | WRAP today |
| `check-rule-2-dep-coverage.mjs:345` | `repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-3-doc-first.mjs:206` | `repoRoot = resolve(HERE, "..")` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-4-otel-coverage.mjs:44` | `REPO_ROOT = resolve(HERE, "..")` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-5-glossary-discipline.mjs:281` | `repoRoot = resolve(HERE, "..")` + reads `vision.md`, `scripts/glossary-allowlist.txt` | **HARDCODED + minsky-specific paths** | CONTRIBUTE `--repo=` + parameterise glossary filenames |
| `check-rule-6-let-it-crash.mjs:264` | `repo: process.cwd()` + `--repo=` flag | **CWD-PORTABLE** | WRAP today |
| `check-rule-7-chaos-coverage.mjs:33` | `REPO_ROOT = resolve(__dirname, "..")` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-9-tasksmd-fields.mjs:37` | `REPO_ROOT = resolve(HERE, "..")` (reads `TASKS.md` from there) | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-11-no-flaky-gates.mjs` | (no on-disk root — analyses CI-emitted job data) | **DATA-DRIVEN** | WRAP today — input is a JSON path, not a repo |
| `check-rule-12-scope-discipline.mjs:51` | `REPO_ROOT = resolve(HERE, "..")` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-13-sibling-anchors.mjs:36` | `REPO_ROOT = resolve(HERE, "..")` | **HARDCODED** | CONTRIBUTE `--repo=` |
| `check-rule-17-proactive-heal.mjs:60` | `REPO_ROOT = resolve(HERE, "..")` (default) + `--repo=` flag at `:215` | **OVERRIDABLE** | WRAP today |

**Portable today (4):** 1, 6, 11, 17. Rules 1/6/17 expose a `--repo=` flag; rule 11 doesn't care about repo layout because its input is JSON-shaped flake data.

**Needs upstream contribution (8):** 2, 3, 4, 5, 7, 9, 12, 13. All resolve their root once at module load and never read it from argv.

## Upstream patch template

The pattern already established by `check-rule-1`, `check-rule-6`, and `check-rule-17` is consistent — copy it into the 8 hardcoded scripts:

```javascript
// Before (rule-9, line 37):
const REPO_ROOT = resolve(HERE, "..");
// ... later ...
const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");

// After:
const DEFAULT_REPO_ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const out = { repo: DEFAULT_REPO_ROOT };
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m && m[1] === "repo") out.repo = m[2];
  }
  return out;
}

async function main() {
  const { repo } = parseArgs(process.argv.slice(2));
  const tasksMd = readFileSync(resolve(repo, "TASKS.md"), "utf8");
  // ... rest of main, using `repo` instead of `REPO_ROOT` ...
}
```

Backwards-compatible by construction — when no flag is passed, the default is the same `resolve(HERE, "..")` value the script used before, so every existing Minsky invocation keeps working.

Each script also needs a regression test (`check-rule-<N>-*.test.mjs`) that builds a fixture repo in a tmpdir, runs the script with `--repo=<tmpdir>`, and asserts behaviour reflects the fixture — not the Minsky repo's actual TASKS.md / ARCHITECTURE.md / etc. The pattern for fixture-based tests is already in `check-rule-1-novel-justification.test.mjs`.

## Cost estimate

- **Upstream Minsky PR**: ~15 LOC per script × 8 scripts = ~120 LOC implementation + ~50 LOC of fixture tests per script = ~520 LOC total. Includes a one-paragraph rationale in the PR body citing this spike.
- **Agentbrew adapter** (sub-task C): ~80 LOC for the interface + impl + tests.
- **Runner + CI gate** (sub-task D): ~50 LOC for `scripts/run-rule-lints.mjs` + ~20-line GitHub Action workflow.
- **Downstream task edits** (part of sub-task D): mark 6 `adopt-rule-N` tasks as `**Blocked by**: reuse-minsky-check-rule-scripts`. About 6 × 2-line diffs.

Net delta: ~750 LOC added (most of it to Minsky upstream), in exchange for retiring 6 × ~200 LOC of locally reimplementing rules that already exist. The contribution loop also stages future rules (e.g. `adopt-rule-N` for rules Minsky doesn't have yet) to be contributed upstream first — keeping agentbrew on the curator side of the line per its `VISION.md`.

## Open questions for sub-task B

1. **Rule 5's glossary path is hardcoded to `vision.md` + `scripts/glossary-allowlist.txt`.** Should `--glossary-path=` / `--allowlist=` be added too, or should we vendor only this one? Recommendation: parameterise both as separate flags. Glossary names differ across repos (`VISION.md` vs `vision.md` vs no vision file at all), and the agentbrew constitution uses `VISION.md` (different filename + casing).
2. **Rule 2's adapter-coverage check is hard-coupled to Minsky's `novel/adapters/` layout** (it walks every `.ts` file under `novel/` and matches against the dependency-table in `docs/ARCHITECTURE.md`). For agentbrew, the equivalent layout is `src/adapters/` + `ARCHITECTURE.md` at repo root. Recommendation: add `--adapter-dir=`, `--architecture-doc=` flags (parameterised paths) at the same time as `--repo=`. Default to today's hardcoded values when omitted.
3. **Rule 11 is data-driven** — input is the flake-report JSON from CI. We can wrap it today, but agentbrew doesn't yet emit the same JSON shape Minsky's flake-detector consumes. Add a paired task to emit it (or skip rule 11 in agentbrew's adapter for the first slice).

## Decision

Lock in **CONTRIBUTE-then-WRAP** as the default for the 8 hardcoded scripts. Update the parent task's `**Pivot**` to reflect this (replace the speculative "if Minsky's scripts hard-depend on Minsky-specific paths" with the empirical answer: "yes, 8 of 12 do; the upstream PR is the path"). Park the open questions above in sub-task B so the upstream PR scope is explicit.
