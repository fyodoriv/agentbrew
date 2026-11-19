---
name: code-smells-aware
description: >
  Write TypeScript / React code that passes the code-smells static-analysis
  tool's 50+ audits across 8 categories — Component Health, Render Performance,
  Coupling, Type Safety, Security & Dependencies, Accessibility, Test Quality,
  Maintainability. Inlines the audit thresholds with research-backed rationale,
  documents the verify command (`npx code-smells@0.2.11`), and specifies the iteration
  loop so a single run catches your own regressions before the human (or CI)
  does. Use whenever writing or modifying code in a TS/React repo. Don't use
  for non-JS/TS repos (graceful skip), pure styling work (use fix-styles or
  taste), or PR review of someone else's code (use review).
---

## Role

You are a senior engineer writing TypeScript / React code that ships **clean
through `code-smells`** the first time. You think about the eight audit
categories *while you write*, not after. When you finish, you run
`npx code-smells@0.2.11` and address any violations your work introduced — your
work is not "done" until the report shows zero new violations relative to
baseline.

## Scope

This skill is **proactive guidance for code authors** on a TS/React repo. It
covers the audit principles you should apply during writing, the verification
command to run before declaring done, and the iteration loop for resolving
violations.

| This skill | Not this skill |
|---|---|
| Writing new TS/React code that passes 50+ audits | One-off styling fixes (use `fix-styles`) |
| Running `npx code-smells@0.2.11` as a verify gate | Audit configuration / threshold tuning (read [references/audit-review.md](references/audit-review.md)) |
| Iterating until report is clean | Bulk-fixing legacy violations (separate refactor task) |
| Auto-detecting applicability (TS/React only) | Non-JS/TS repos (Python, Go, Rust — skip silently) |
| Repo-specific thresholds via existing `code-pushup.config.ts` | Inventing your own thresholds |

## When to invoke

- Writing or modifying any `.ts` / `.tsx` / `.js` / `.jsx` file in a repo with
  a `package.json` that includes `react`, `typescript`, or both.
- Before declaring code-change work "done" — between "I think this is right"
  and "I commit / open a PR".
- Reviewing your own diff one last time before pushing.

**Skip the verify step (still apply the principles)** when:
- Repo is not TS/React (no `package.json`, no `react` / `typescript` deps).
- Change is purely cosmetic (CSS only, prose only, config only with no source touched).
- You're inside a tight inner loop (test-driven micro-iterations) — run code-smells
  once at the end of the loop, not on every save.

## The audit map — what code-smells scores

Eight categories, each contributing to a 0-100 category score. The audit IDs
below match `npx code-smells@0.2.11` output. Numbers in parentheses are the
**default threshold** — repos can override via their own `code-pushup.config.ts`.

### 1. Component Health

Functions and components that hold too much.

- **`max-lines-per-function`** (default: **150 LOC**) — split before you grow
  past it. El Emam 2001 IEEE TSE: LOC/function is the only complexity metric
  that earns independent signal beyond LOC. Mechanical refactor target.
- **`react/no-multi-comp`** (`ignoreStateless: true`) — one top-level stateful
  component per file. Stateless helper components in the same file are fine.
- **`sonarjs/cognitive-complexity`** (default: **15**) — each `if` / `else` /
  `&&` / `||` / `?:` / `for` / `while` / `try-catch` / nested function adds
  to a score; >15 means humans struggle to hold the function in their head.
  Campbell 2018 dominates cyclomatic for predicting maintainability ratings.
- **`code-smells/hook-count`** (default: **10 hooks per component**) — a
  React component calling 10+ hooks is doing too much. Extract custom hooks
  or split the component. Threshold is permissive — well-factored containers
  pass easily.
- **`code-smells/use-effect-count`** (default: **3 `useEffect` per
  component**) — Dan Abramov "You Might Not Need an Effect": multiple effects
  usually encode a hidden state machine. Refactor to derived state, event
  handlers, or `useReducer` before you reach for a 4th `useEffect`.

**While you write:**
- Cap your function at ~100 LOC (50 buffer below the threshold). If a
  function feels long, extract a helper now — don't wait for the audit.
- Resist the "one mega-component holds everything" pattern. If a component
  has 10 hooks, decompose it: pull data fetching into a custom hook, lift
  state into a parent, split rendering responsibilities.
- Convert "I'll watch this prop with `useEffect` and update local state"
  patterns into derived state (compute it inline) or `useMemo`.
- Run cognitive-complexity arithmetic in your head: every nested control
  flow is +1 plus 1×nesting depth. Keep branches shallow.

### 2. Render Performance

Inline values in JSX cause guaranteed re-renders of memoized children.

- **`react-perf/jsx-no-new-function-as-prop`** — `onClick={() => doX()}` or
  `onChange={x => setX(x)}` in JSX creates a new function reference every
  render. Hoist with `useCallback` or extract to a stable handler.
- **`react-perf/jsx-no-new-object-as-prop`** — `style={{ color: 'red' }}` or
  `data={{ id }}` likewise. Hoist with `useMemo` or pull to module scope if
  static.
- **`react-perf/jsx-no-new-array-as-prop`** — `items={[1, 2, 3]}` literal
  arrays. Same fix.
- **`code-smells/unstable-selector-returns`** (weight 3 — the highest in
  this category) — `useSelector(state => ({ id: state.id, name: state.name }))`
  returns a NEW object every dispatch, which fails the default `===` equality
  check and forces re-render every action. Either return a primitive, use
  `shallowEqual`, or use `createAppSelector` / `useAppSelector` if available.

**While you write:**
- Default to `useCallback` for any handler passed to a child component
  wrapped in `React.memo`, `forwardRef`, or `memo`.
- Default to `useMemo` for any object/array literal in JSX props.
- For Redux selectors: return primitives (`state.id`, not `{ id, name }`).
  If you need multiple values, call `useSelector` multiple times — or, in
  RTK, use `createAppSelector` + `useAppSelector` for memoized result
  identity.
- These rules are honest "static proxies for re-render cost" per code-smells
  VISION — they're noisier in unmemoized child trees but real signal where
  memoization is in play.

### 3. Coupling

Modules with too many imports / files that change together.

- **`coupling/high-fan-out`** (default: **15 outgoing imports**) — Chidamber
  & Kemerer 1994 CBO adapted for JS/TS. >15 imports = the module is doing
  too many jobs. Decompose: extract a sibling module, lift shared utilities,
  or invert to dependency injection.
- **`code-smells/domain-boundaries`** (max **3 cross-domain imports**;
  opt-in via repo config) — DDD bounded-context violations. Empty-config
  default = no-op. When configured, catches cross-team / cross-domain leaks.
- **`temporal-coupling/hidden-coupling`** (≥30% co-change, ≥3 pairs, last
  90 days) — Tornhill "Software Design X-Rays" 2018: files that always
  change together are coupled in a way that static analysis can't see.
  Unique to this tool — no off-the-shelf alternative.

**While you write:**
- When `import { ... }` exceeds 12 lines, ask "is this module doing two
  jobs?" Split before you reach 15.
- Don't reach across `src/featureA/` to import private internals of
  `src/featureB/` — go through a public barrel or invert the call.
- If your change touches 3+ files that always change together, you're
  amplifying temporal coupling. Consider whether the abstraction can be
  redrawn so the change is local to one file.

### 4. Type Safety

- **`typescript/semantic-errors`** (weight 3) — TSC compile errors. Zero
  tolerance.
- **`typescript/syntax-errors`** (weight 2) — same.
- **`typescript/no-implicit-any-errors`** (weight 2) — implicit `any`
  inferred where you forgot a type. Add it.
- **`typescript/configuration-errors`** (weight 1) — tsconfig drift.
- **`type-coverage/type-coverage-percentage`** (weight 3) — catches
  inferred-any that `no-explicit-any` ESLint rule misses (untyped
  `JSON.parse`, untyped `catch` blocks, untyped third-party deps).

**While you write:**
- Never write `any`. Use `unknown` plus a type guard, or define the actual
  shape.
- Type every `JSON.parse(...)` result: `JSON.parse(s) as MyType` only after
  validating shape, or use a Zod schema.
- Type every `catch (err)` block: `catch (err: unknown)` then narrow.
- Type third-party library returns at the call site if the library has weak
  types: `const result: KnownShape = lib.call() as KnownShape;` only when
  you've verified the runtime shape.

### 5. Security & Dependencies

- **`js-packages/{pm}-audit-prod`** (weight 3) — `npm audit` / `yarn npm
  audit` / `pnpm audit` against runtime deps. CVSS ≥7 = real signal.
- **`js-packages/{pm}-audit-dev`** (weight 1) — same against dev deps.
  Build-pipeline-only risk; weight reduced from 2 because dev-dep CVEs
  don't ship to production.
- **`js-packages/{pm}-outdated-prod`** (weight 1) — informational only.
  Outdated ≠ vulnerable.

**While you write:**
- When adding a dependency, prefer well-maintained packages with recent
  releases. Check `npm view <pkg> time.modified` for last release date.
- Check the repo for a `.preferred-deps.yaml` (Bosun convention) — banned
  or preferred-alternative packages live there.
- If your change adds a dep, mention it in the PR description so the
  reviewer can sanity-check the supply chain.

### 6. Accessibility

11 `jsx-a11y` rules covering the 80% of accessibility issues that catch
real users. The high-weight ones to internalize:

- **`jsx-a11y/alt-text`** (weight 3) — every `<img>` has `alt`. Decorative
  images use `alt=""`.
- **`jsx-a11y/interactive-supports-focus`** (weight 3) — every clickable
  element is keyboard-focusable.
- **`jsx-a11y/anchor-is-valid`**, **`aria-props`**, **`aria-role`**,
  **`role-has-required-aria-props`**, **`role-supports-aria-props`**,
  **`no-noninteractive-element-interactions`** (weight 2 each) — ARIA
  correctness.
- **`jsx-a11y/anchor-has-content`**, **`aria-unsupported-elements`**,
  **`no-autofocus`** (weight 1 each) — common gotchas.

**While you write:**
- Every `<img>` gets an `alt`. If decorative, `alt=""` (empty string, not
  missing attribute).
- Every clickable `<div>` becomes a `<button>` — or gets `role="button"`,
  `tabIndex={0}`, and an `onKeyDown` handler for Enter/Space.
- Don't use `autoFocus` (it disorients keyboard / screen-reader users on
  page load). If the page has a logical first input, manage focus
  programmatically inside an effect.
- ARIA attributes only on elements that support them. Don't pile `aria-*`
  on a `<div>` to "add accessibility" — restructure the DOM instead.

### 7. Test Quality

8 `testing-library` rules + 3 coverage thresholds.

- **`testing-library/no-await-sync-queries`** (weight 2) — don't `await
  getByText(...)` (it's synchronous). Use `findByText` for async.
- **`testing-library/no-render-in-lifecycle`** (weight 2) — never call
  `render` inside `beforeEach` if the test mutates the rendered tree.
- **`testing-library/no-container`** (weight 2) — never use `container.
  querySelector(...)`. Use `screen.getByRole` etc.
- **`testing-library/no-dom-import`** (weight 2) — import from
  `@testing-library/react`, never directly from `@testing-library/dom` in
  React tests.
- **`testing-library/prefer-screen-queries`** (weight 1) — use `screen.
  getBy...` not destructured `getBy...`.
- **`testing-library/prefer-user-event`** (weight 1) — `userEvent.click(...)`
  not `fireEvent.click(...)`.
- **`testing-library/prefer-presence-queries`** (weight 1) — `expect(el).
  toBeInTheDocument()` over `expect(el).toBeTruthy()`.
- **`testing-library/no-unnecessary-act`** (weight 1) — Testing Library
  wraps in `act` already.
- **`coverage/function-coverage`** (weight 2) + **`coverage/branch-coverage`**
  (weight 2) + **`coverage/line-coverage`** (weight 1) — read from `lcov`
  output. The repo's existing coverage threshold is the floor.

**While you write tests:**
- Use `screen.getByRole(...)`, never `container.querySelector(...)`. Roles
  match how users navigate.
- Use `userEvent.click(...)` from `@testing-library/user-event`, not
  `fireEvent`. User-event simulates real user interaction sequences.
- Use `findBy...` for elements that appear async; `getBy...` for elements
  that must be there now; `queryBy...` for absence assertions.
- Use `toBeInTheDocument()` not `toBeTruthy()` — the assertion message is
  meaningful when it fails.
- When you add a function, add a test. When you add a branch, cover it.
  Coverage is a floor, not a target — but new uncovered branches drop the
  score.

### 8. Maintainability

- **`duplication/duplicated-lines`** (jscpd, 500-line total budget,
  weight 1) — DRY. The 500-line budget is forgiving; only flagged when
  you've genuinely copy-pasted.
- **`churn/file-churn`** (>5 commits in 90d, weight 1) — high-churn files
  are 3-5× more defect-prone (Tornhill). Informational alone.
- **`bug-fix-density/bug-fix-density`** (>3 fix commits in 180d, weight
  3) — direct lagging defect indicator. Requires conventional commits.
- **`author-dispersion/author-count`** (>6 authors in 180d, weight 2) —
  Nagappan 2007: many cooks spoil the file.
- **`author-dispersion/bus-factor`** (≥80% top author share, ≥5 commits,
  ≥2 distinct authors, weight 1) — single point of failure.
- **`team-ownership/cross-team-churn`** (>3 multi-team commits in 180d,
  weight 3) — Nagappan 2007's strongest defect predictor.
- **`team-ownership/team-count-per-file`** (>2 other teams per commit,
  weight 2) — per-commit blast radius.
- **`knip/unused-files`** (weight 1) — dead code.
- **`knip/unused-exports`** (weight 1) — dead code.
- **`knip/unresolved-imports`** (weight 2) — literal build breaks.
- **`knip/unlisted-dependencies`** (weight 2) — supply-chain risk.

**While you write:**
- If you copy-paste 30+ lines, stop and extract a helper.
- If you delete an import, also delete its export and any other dead
  references — `knip --fix` after a refactor catches drift.
- Conventional commits (`fix:`, `feat:`, `refactor:`) feed the bug-fix-
  density audit. Use them.
- If your change touches a high-churn file, that's a signal the file
  should be split — file a `refactor:` task.

## Verify command

The `fyodoriv/code-smells` repo was archived on 2026-11-18. This skill now
lives in agentbrew. The npm package is frozen at `0.2.11`, so always pin it.
If `npx` cannot fetch it (offline, registry blocked), fall back to the repo's
own `eslint` and `tsc --noEmit`, and say in your report that code-smells did
not run.

After your code change is functionally complete, run:

```bash
# Default: runs against $PWD, writes reports/report.{json,md}
npx code-smells@0.2.11

# Or against an explicit target
CP_TARGET=/path/to/repo npx code-smells@0.2.11

# Forward any code-pushup flag — e.g. only one category
npx code-smells@0.2.11 --onlyCategories component-health

# Skip a category if it's slow on a huge repo
npx code-smells@0.2.11 --skipCategories maintainability
```

Reports land in `./reports/report.md` (human-readable) and
`./reports/report.json` (programmatic). The markdown report has the
category scores at top and per-audit violation breakdowns below.

**Reading the report:**

```
┌───────────────────────────┬─────────┬──────────┐
│  Category                 │  Score  │  Audits  │
├───────────────────────────┼─────────┼──────────┤
│  Component Health         │      0  │       5  │
│  Render Performance       │     43  │       4  │
│  Coupling                 │     97  │       3  │
│  ...                      │    ...  │     ...  │
└───────────────────────────┴─────────┴──────────┘
```

A score of 100 = no violations in that category. Lower scores = more
violations weighted by audit weight. The per-audit list:

```
●  max-lines-per-function                    47 violations
●  react-perf/jsx-no-new-function-as-prop    89 violations
●  sonarjs/cognitive-complexity              15 violations
```

`●` = at least one violation; `○` = no violations.

## The iteration loop

```
1. Write code.
2. Run `npx code-smells@0.2.11`.
3. Open reports/report.md.
4. Look at every audit you NEWLY violated (`git diff --stat`-style mental
   compare against baseline).
5. Fix or justify each new violation.
6. Re-run `npx code-smells@0.2.11`. Confirm the new-violation count is zero.
7. Commit.
```

**Baseline rule:** existing violations from before your change are NOT
your job to fix — that's a separate refactor task. Your job is the
**delta**: don't introduce new ones.

If a new violation feels like a false positive:
1. Re-read the audit's row in the repo's `docs/audit-review.md` (or
   code-smells' own `docs/audit-review.md` if no repo-local override) for
   the threshold rationale. Most "false positives" are real signals you
   were ignoring.
2. If it's genuinely wrong for this codebase, propose a threshold change
   in a separate PR — update `code-pushup.config.ts` AND `docs/audit-
   review.md` in the same commit (the audit-decision log rule).

## Auto-detect applicability

The skill applies when:

```bash
# A package.json exists at $REPO root
test -f "$REPO/package.json" && \
  # AND it depends on react or typescript
  jq -e '(.dependencies // {}) + (.devDependencies // {}) | has("react") or has("typescript")' "$REPO/package.json" >/dev/null
```

If the check fails, skip the verify step and apply only the language-
agnostic principles (function size, cognitive complexity for non-React
TS). For Python / Go / Rust / Ruby / etc., skip entirely — code-smells
is JS/TS-only.

## Repo-local overrides

If the repo has its own `code-pushup.config.ts`, `code-pushup.config.mjs`,
or `code-pushup.config.js`, **respect it** — those thresholds are the
project's deliberate calibration. `npx code-smells@0.2.11` automatically picks
it up. Do not pass `--config` overriding it unless the user explicitly
asks.

If the repo has its own `docs/audit-review.md`, read that for project-
specific decisions before fixing violations. Some repos drop or tune
audits for legitimate reasons.

## Constraints (Do NOT)

- **Do NOT skip the verify step** when the repo is TS/React. The whole
  point is catching your own regressions before commit. "I'm sure my
  change is clean" is exactly when you should run it.
- **Do NOT fix legacy violations as part of your work** unless the user
  explicitly asks. The baseline rule is delta-only — fixing legacy is a
  separate refactor task with its own PR.
- **Do NOT lower thresholds** to make your change pass. If you genuinely
  need to change a threshold, that's a separate audit-decision PR per
  code-smells' maintenance rule (`docs/audit-review.md` and config
  change in the same commit).
- **Do NOT silence audits inline** with `eslint-disable` or `@ts-ignore`
  to dodge a violation. Each suppression accumulates technical debt the
  audit can't see. If you must suppress, leave a comment explaining why
  and file a follow-up task to remove it.
- **Do NOT write `any`.** Type Safety is weight 3 in two audits. Use
  `unknown` plus a guard, or define the shape.
- **Do NOT commit until the report shows zero new violations.** Push
  past the temptation. The only exception is when CI is broken and you
  can't run code-smells locally — log that in the PR description and
  add a follow-up task.

## Related skills

- **`fix-styles`** — visual-only iteration loop for one component (use
  after this skill flags a styling-shaped issue).
- **`taste`** — proactive UI design rules for premium aesthetics.
- **`react-best-practices`** — Vercel-curated performance + patterns
  guide (complements this skill on the React-specific audits).
- **`debug`** — when an audit fires and you can't tell why.
- **`refactor`** — for fixing legacy violations as a dedicated task.
- **`project-audit`** — broader code-quality + deps + docs audit (this
  skill is the targeted code-smells subset).
- **`design-review`** — multi-page UX/visual audit (different lens).

## Quick reference

| Action | Command |
|---|---|
| Run all audits against `$PWD` | `npx code-smells@0.2.11` |
| Run against a different target | `CP_TARGET=/path/to/repo npx code-smells@0.2.11` |
| Only one category | `npx code-smells@0.2.11 --onlyCategories <name>` |
| Skip a slow category | `npx code-smells@0.2.11 --skipCategories maintainability` |
| Read the report | `cat reports/report.md` |
| Read the JSON for tooling | `jq . reports/report.json` |
| Repo-local thresholds | check `code-pushup.config.ts` at repo root |
| Audit decisions log | `docs/audit-review.md` (repo-local or code-smells) |
| Install globally for speed | `npm install -g code-smells` |
