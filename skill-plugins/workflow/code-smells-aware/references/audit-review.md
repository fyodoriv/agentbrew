# Audit review

> Living document. One entry per audit code-smells emits, judged against
> the VISION.md rubric (**research-backed, <10% FP, actionable**) with
> the decision and rationale recorded.
>
> **Maintenance rule:** every time an audit is added, removed, or its
> threshold/weight is tuned, this file and `code-pushup.config.ts/mjs`
> must change in the same commit. A CI check enforces this (see
> TASKS.md `audit-review-lint`). If you're adding an audit, add a row
> here with your decision recorded up front.
>
> **Status legend:**
> - ✅ **Kept** — solid signal, well-researched, low FP, actionable
> - ⚙ **Tuned** — signal is valid, threshold/weight/scope adjusted
> - ❌ **Dropped** — noisy, redundant, or research-discredited
> - 🔧 **Structural** — audit emits but doesn't score (fold into a
>   category or drop)

---

## Decision log — April 2026

First comprehensive review. **58 audits emitted, 34 previously scored,
24 previously unscored.** Applied in code-smells PR 11 (repo now archived).

### Headline changes

- **Dropped** `sonarjs/cyclomatic-complexity` (redundant with cognitive),
  `react/jsx-no-bind` (redundant with react-perf), `npm-outdated-dev`
  (was weight 0), and the entire `@code-pushup/jsdocs-plugin` (Steidl
  2013 ICSM: comment density has no correlation with defect rate).
- **Tuned** `author-dispersion/bus-factor` to gate on ≥2 distinct
  authors per file (inverts on solo repos), `react/no-multi-comp` to
  `ignoreStateless: true` (stop flagging legitimate helper components),
  `js-packages/npm-audit-dev` weight 2 → 1 (dev-dep vulns are build-
  pipeline-only risk).
- **Added** two previously-missing scored categories:
  **Accessibility** (11 jsx-a11y audits) and **Test Quality** (8
  testing-library audits + 3 coverage audits). Before this pass, those
  audits emitted without contributing to any category score.

### Result

- **Categories:** 6 → 8
- **Scored audits:** 34 → 48 (TS + lockfile + lcov present)
- **Unscored-but-emitted audits:** 24 → 0

---

## Category 1 · Component Health

| Audit | Threshold | Decision | Why |
|---|---|---|---|
| `max-lines-per-function` | 150 | ✅ Kept | El Emam 2001 IEEE TSE: LOC/function is the only complexity metric that earns independent signal (~80% of others are LOC-correlated). Mechanical refactor target. |
| `react/no-multi-comp` | `ignoreStateless: true` | ⚙ Tuned | Was `false`, firing on legitimate helper components. Now only flags files exporting multiple top-level components. |
| `sonarjs/cognitive-complexity` | 15 | ✅ Kept | Campbell 2018 shows cognitive correlates with maintainability ratings better than cyclomatic. Default threshold. |
| `sonarjs/cyclomatic-complexity` | — | ❌ Dropped | Redundant with cognitive (Campbell 2018: cognitive strictly dominates; McCabe 1976 is ~80% explained by LOC). |
| `code-smells/hook-count` | 10 | ✅ Kept | Pragmatic responsibility-overload signal. Threshold permissive enough to leave well-factored containers alone. |
| `code-smells/use-effect-count` | 3 | ✅ Kept | Dan Abramov's "You Might Not Need an Effect" codifies the research: multiple effects usually encode a hidden state machine. |

## Category 2 · Render Performance

| Audit | Decision | Why |
|---|---|---|
| `react-perf/jsx-no-new-function-as-prop` | ✅ Kept (wt 1) | Honest "static proxy for re-render cost" per VISION. Real with `React.memo`, noisier with unmemoized children in React 18. Weight held at 1. |
| `react-perf/jsx-no-new-object-as-prop` | ✅ Kept (wt 1) | Same rationale. |
| `react-perf/jsx-no-new-array-as-prop` | ✅ Kept (wt 1) | Same rationale. |
| `react/jsx-no-bind` | ❌ Dropped | Redundant with `react-perf/jsx-no-new-function-as-prop`. |
| `code-smells/unstable-selector-returns` | ✅ Kept (wt 3) | Highest-quality rule here. Inline object returns from `useSelector` are a **real** perf bug (bypasses `===` check, guaranteed re-render every dispatch) — not a proxy. Near-zero FP. |

## Category 3 · Coupling

| Audit | Decision | Why |
|---|---|---|
| `coupling/high-fan-out` (15) | ✅ Kept | Import count is the cleanest JS/TS proxy for syntactic coupling (adapted from Chidamber & Kemerer 1994 CBO). |
| `code-smells/domain-boundaries` (3, opt-in) | ✅ Kept | Empty-categories-map = no-op default. When configured, catches DDD bounded-context violations. User-supplied map → near-zero FP. |
| `temporal-coupling/hidden-coupling` (30%, 3+ pairs, 90d) | ✅ Kept | Tornhill "Software Design X-Rays" 2018: temporal coupling predicts defects **independently** of static coupling. No off-the-shelf Node tool — custom code justified. |

## Category 4 · Type Safety

| Audit | Decision | Why |
|---|---|---|
| `typescript/semantic-errors` | ✅ Kept (wt 3) | TSC diagnostics. Zero FP by definition. |
| `typescript/syntax-errors` | ✅ Kept (wt 2) | Same. |
| `typescript/no-implicit-any-errors` | ✅ Kept (wt 2) | Same. |
| `typescript/configuration-errors` | ✅ Kept (wt 1) | Rare but catches tsconfig drift. |
| `type-coverage/type-coverage-percentage` | ✅ Kept (wt 3) | Catches inferred-any that `no-explicit-any` can't see (untyped `JSON.parse`, untyped catch blocks, untyped deps). |

## Category 5 · Security & Dependencies

| Audit | Weight | Decision | Why |
|---|---|---|---|
| `js-packages/{pm}-audit-prod` | 3 | ✅ Kept | Runtime-exploitable CVEs. Real signal at CVSS ≥7. |
| `js-packages/{pm}-audit-dev` | 2 → 1 | ⚙ Tuned | Build-pipeline-only risk; shouldn't weigh as heavily as prod. |
| `js-packages/{pm}-outdated-prod` | 1 | ✅ Kept | Informational — outdated ≠ vulnerable. |
| `js-packages/{pm}-outdated-dev` | 0 | ❌ Dropped | Already weight 0, was just polluting the report. |

## Category 6 · Accessibility (new)

Curated subset — the 11 rules that catch real user-facing issues.
Noisy jsx-a11y rules on non-standard patterns intentionally excluded.

| Audit | Weight | Decision |
|---|---|---|
| `jsx-a11y/alt-text` | 3 | ✅ Kept |
| `jsx-a11y/interactive-supports-focus` | 3 | ✅ Kept |
| `jsx-a11y/anchor-is-valid` | 2 | ✅ Kept |
| `jsx-a11y/aria-props` | 2 | ✅ Kept |
| `jsx-a11y/aria-role` | 2 | ✅ Kept |
| `jsx-a11y/no-noninteractive-element-interactions` | 2 | ✅ Kept |
| `jsx-a11y/role-has-required-aria-props` | 2 | ✅ Kept |
| `jsx-a11y/role-supports-aria-props` | 2 | ✅ Kept |
| `jsx-a11y/anchor-has-content` | 1 | ✅ Kept |
| `jsx-a11y/aria-unsupported-elements` | 1 | ✅ Kept |
| `jsx-a11y/no-autofocus` | 1 | ✅ Kept |

Prior state: all 11 emitted but weren't in any category → not scored.
Absorbed into new category in PR #11.

## Category 7 · Test Quality (new)

testing-library antipatterns + function/branch/line coverage.

| Audit | Weight | Decision |
|---|---|---|
| `testing-library/no-await-sync-queries` | 2 | ✅ Kept |
| `testing-library/no-render-in-lifecycle` | 2 | ✅ Kept |
| `testing-library/no-container` | 2 | ✅ Kept |
| `testing-library/no-dom-import` | 2 | ✅ Kept |
| `testing-library/prefer-screen-queries` | 1 | ✅ Kept |
| `testing-library/prefer-user-event` | 1 | ✅ Kept |
| `testing-library/prefer-presence-queries` | 1 | ✅ Kept |
| `testing-library/no-unnecessary-act` | 1 | ✅ Kept |
| `coverage/function-coverage` | 2 | ✅ Kept |
| `coverage/branch-coverage` | 2 | ✅ Kept |
| `coverage/line-coverage` | 1 | ✅ Kept |

Prior state: all 11 emitted but weren't in any category → not scored.
Absorbed into new category in PR #11.

## Category 8 · Maintainability

| Audit | Decision | Why |
|---|---|---|
| `duplication/duplicated-lines` (jscpd, 500-line budget) | ✅ Kept (wt 1) | Classic DRY smell. 500-line total budget is forgiving. |
| `churn/file-churn` (>5 commits in 90d) | ✅ Kept (wt 1) | Tornhill: high-churn files are 3-5× defect-prone. Informational alone; useful combined. |
| `bug-fix-density/bug-fix-density` (>3 fix/180d) | ✅ Kept (wt 3) | Direct lagging defect indicator. Requires conventional-commits discipline. |
| `author-dispersion/author-count` (>6/180d) | ✅ Kept (wt 2) | Nagappan 2007: >6 authors correlates with 2-3× defect rate. |
| `author-dispersion/bus-factor` (≥80% top share, min 5 commits, **≥2 distinct authors**) | ⚙ Tuned | Added `≥2 authors` gate in PR #12's neighborhood. On solo/personal repos every file had 100% one-author dominance by definition — flagging them all was unactionable noise. Team repos still get the signal. |
| `team-ownership/cross-team-churn` (>3 multi-team/180d) | ✅ Kept (wt 3) | Nagappan 2007 direct measure — strongest defect predictor in static analysis. |
| `team-ownership/team-count-per-file` (>2 other teams/commit) | ✅ Kept (wt 2) | Complement to cross-team-churn: per-commit cross-team blast radius. |
| `knip/unused-files` | ✅ Kept (wt 1) | Dead code. |
| `knip/unused-exports` | ✅ Kept (wt 1) | Dead code. |
| `knip/unresolved-imports` | ✅ Kept (wt 2) | Literal build-breaking bugs. |
| `knip/unlisted-dependencies` | ✅ Kept (wt 2) | Supply-chain risk. |

---

## Previously emitted but dropped

- **`@code-pushup/jsdocs-plugin`** (8 sub-audits: classes, enums,
  functions, interfaces, methods, properties, types, variables coverage)
  — dropped entirely in PR #11. Steidl 2013 ICSM: no statistical
  correlation between comment density and defect rate or
  maintainability. If per-public-API documentation coverage matters
  later, add it back scoped to public exports only (not every variable).

---

## How to maintain this doc

1. **Adding an audit** — add a row to the appropriate category, record
   the decision (`✅ Kept` from the start, `⚙ Tuned` if threshold/weight
   changes on day one) and the rationale. Update the category header
   count.
2. **Removing an audit** — move the row to "Previously emitted but
   dropped" and explain why, with a research citation or pragmatic
   reasoning.
3. **Tuning an audit** — change the row in place, change the status to
   `⚙ Tuned`, and note the before/after and why.
4. **CI enforcement** — the `audit-review-lint` task in TASKS.md tracks
   the check that every audit slug emitted at runtime has a
   corresponding table row here.
