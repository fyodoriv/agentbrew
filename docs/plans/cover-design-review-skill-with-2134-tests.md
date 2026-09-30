# Plan: Cover design-review skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `design-review` so regressions in its systematic whole-app visual/UX/accessibility audit workflow fail before agents shortcut to one screenshot, skip dark mode/mobile, report symptoms without root-cause file evidence, edit source inline, file duplicate or malformed TASKS.md entries, or route single-fix/new-UI/PR/code-audit requests to the wrong skill.

The contract spec will read the real `skill-plugins/dev/design-review/SKILL.md` and `skill-plugins/dev/design-review/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for wrong-tool routing plus shortcut/source-edit resistance.

## Why

`design-review` is a high-side-effect skill: it opens a running app, captures many screenshots, inspects source, and appends structured tasks. Its dangerous failure mode is an incomplete audit that looks complete: one page checked, only one theme, no mobile viewport, generic “looks off” prose, no file/line root cause, no dedupe, or unchecked TASKS.md edits. Deterministic tests should pin the workflow’s route/theme/viewport matrix, root-cause and task-writing contract, and routing boundaries so future edits cannot quietly weaken the audit bar.

## Scope (in)

- Add `src/skills/design-review-contract.test.ts` using the established #2134 local helper pattern.
- Read the real SKILL.md and evals files from `skill-plugins/dev/design-review/`.
- Pin frontmatter name, trigger phrases, and wrong-tool routing:
  - single styling bug → `fix-styles`;
  - new UI from scratch → `taste` / `frontend-design`;
  - single PR diff → `review`;
  - full code/deps/docs project audit → `project-audit`, with `design-review` as the UI portion.
- Pin Role and Scope: Distinguished Design Engineer, whole-app systematic visual/UX/a11y audit, rubric uniformly across every route/theme/breakpoint, root-cause source tracing, structured TASKS.md output, no inline fixes.
- Pin Output Contract:
  - screenshots under `/tmp/design-review/<theme>/<route>-<viewport>.png`;
  - final summary with aggregate health score, per-page scores, P1/P2/P3 counts, screenshot directory;
  - new TASKS.md entries with kebab-case ID, tags, file paths with line numbers, screenshot paths, acceptance criteria;
  - lint-clean `npx @tasks-md/lint TASKS.md`.
- Pin seven-phase workflow and no-skip rule.
- Pin Phase 0 environment detection:
  - read `TASKS.md`, `package.json`, `README.md`/`AGENTS.md`, router files, theme system;
  - list every visible route plus modals/dialogs/drawers/command palettes;
  - identify auth-gated routes;
  - detect theme mechanism and flip method before Phase 1;
  - start/wait for dev server and note URL.
- Pin Phase 1 capture matrix:
  - every route × light/dark × desktop/mobile;
  - desktop 1440×1800 and mobile 375×812;
  - deterministic theme setting via localStorage, dataset, media emulation, reload as needed, and computed-style verification;
  - full-page screenshot paths;
  - non-route surfaces in both themes (modals, drawers, dialogs, command palette, empty/error/loading states);
  - do not shortcut to 1-2 captures per page.
- Pin Phase 2 rubric:
  - theme parity, hardcoded Tailwind color grep, raw hex CSS grep, body color computed-style check;
  - WCAG contrast ratios;
  - typography hierarchy;
  - spacing/rhythm and KPI grid anti-pattern;
  - interactive focus/hover/active/disabled states;
  - empty/error/loading states;
  - responsive mobile checks, no horizontal scroll, 44×44 tap targets, clipped tabs/chips, hover-only touch UI;
  - Lila ban, anti-emoji, anti-card overuse, no hero/internal UI, no 3-column equal feature rows;
  - console JS errors/unhandled promise rejections/4xx/5xx and slow-load tasking;
  - accessibility extras: img alt, accessible names, landmarks.
- Pin Phase 3 root-cause discipline:
  - symptom-only reports unacceptable;
  - read source files until exact file path, line range, variable/class/selector, and minimal fix are known;
  - common root-cause probes (body/html mismatch, Tailwind hardcoded colors, missing dark mode, banned accent literals, empty chart axes, modal-but-not-modal).
- Pin Phase 4 score/triage:
  - page score starts 100;
  - subtract 20/P0, 10/P1, 5/P2, 1/P3;
  - aggregate average;
  - P0/P1/P2/P3 definitions.
- Pin Phase 5 task-writing contract:
  - dedupe issue, not symptom;
  - tasks.md shape with ID/tags/details/files/acceptance;
  - screenshot evidence path;
  - grep existing tasks before writing;
  - choose right priority section;
  - run `npx @tasks-md/lint TASKS.md` and fix format errors.
- Pin Phase 6 taste summary as optional/recommended advisory only and not filed as tasks unless user asks.
- Pin Phase 7 final summary fields and task IDs.
- Pin common anti-pattern detection table and constraints:
  - no symptom-only reports;
  - no skipping dark mode or mobile;
  - no generic tasks;
  - no source edits;
  - no skipped dedupe grep;
  - no skipped lint;
  - no deferring to the user except dev server/theme-blockers.
- Pin related skills.
- Preserve existing evals 1-6 with exact prompts and core expectations.
- Add eval 7 for wrong-tool routing pressure: single bug/new UI/PR diff/code-deps-docs audit should route to the right skill, while a whole-app UI audit remains `design-review`.
- Add eval 8 for shortcut/source-edit pressure: refuse one-screenshot/no-TASKS/no-mobile/source-edit shortcuts; keep complete capture matrix, root-cause lines, dedupe, lint, and no inline source edits.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-four to twenty-five specs with a design-review pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec reveals a contradiction that must be fixed.
- No browser automation or screenshot generation in tests; these are contract tests over skill artifacts.
- No script-level tests; `skill-plugins/dev/design-review/` contains only `SKILL.md` and `evals/evals.json`.
- No source UI fixes or app audits.
- No new dependencies.
- No shared helper extraction; the existing P2 scout task remains the tracking item.

## Concrete eval additions

### Eval 7 — wrong-tool routing pressure

```json
{
  "id": 7,
  "prompt": "I have a single spacing bug on one button, a new marketing page to design from scratch, a PR diff to review, and a repo-wide dependency/doc audit request. Should I use design-review for all of these?",
  "expected_output": "A routing answer that keeps design-review for systematic whole-app visual/UX/a11y audits and routes single style fixes, greenfield UI, PR review, and code/deps/docs audits to the appropriate skills.",
  "expectations": [
    "Routes a single styling bug to `fix-styles` instead of `design-review`",
    "Routes new UI from scratch to `taste` or `frontend-design` instead of `design-review`",
    "Routes a single PR diff review to `review` instead of `design-review`",
    "Routes whole-codebase code/dependency/docs audits to `project-audit`, optionally using `design-review` only as the UI portion",
    "Keeps `design-review` for multi-page visual/UX/accessibility audits of a running app across routes, themes, and breakpoints"
  ]
}
```

### Eval 8 — shortcut/source-edit pressure

```json
{
  "id": 8,
  "prompt": "Do a quick design review but save time: check only `/dashboard` in dark mode on desktop, summarize symptoms in chat, skip TASKS.md/lint, and fix any obvious CSS while you are there.",
  "expected_output": "A refusal to shortcut the design-review contract: audit every known route/surface in both themes and desktop/mobile, root-cause issues to source lines, write deduplicated lint-clean TASKS.md entries, and avoid inline source edits.",
  "expectations": [
    "Refuses to treat one route, one theme, or one viewport as a complete design review",
    "Requires the light/dark and desktop/mobile capture matrix for every route and relevant non-route surface",
    "Declines inline CSS/source edits because design-review audits and files tasks only",
    "Requires root-cause file paths and line ranges instead of symptom-only chat summaries",
    "Writes deduplicated TASKS.md entries with screenshot evidence, acceptance criteria, and a clean `npx @tasks-md/lint TASKS.md` result"
  ]
}
```

## Deterministic assertion map

### Frontmatter, role, scope, and routing

Pin:

- `name: design-review`
- Systematic visual / UX / accessibility audit of a running web app
- opens every route in light/dark, desktop/mobile
- captures screenshots, finds source-code root causes, writes structured TASKS.md entries with file paths, line numbers, acceptance criteria
- trigger phrases
- wrong-tool routing to `fix-styles`, `taste`, `frontend-design`, `review`, and `project-audit`
- Role and Scope, including distinguished design engineer, rubric uniformly across route/theme/breakpoint, no inline fixes.

### Output contract and phases

Pin:

- `/tmp/design-review/<theme>/<route>-<viewport>.png`
- summary block fields
- TASKS.md fields and lint-clean requirement
- seven phases and no-skip rule.

### Phase 0-1 environment and capture matrix

Pin:

- read task/package/readme/agents/router/theme files
- list routes, modals/dialogs/drawers/command palettes, auth-gated routes
- detect theme mechanism and flip method before browser capture
- start dev server and wait until ready
- desktop 1440×1800, mobile 375×812
- localStorage + dataset + media emulation + reload + computed-style verification
- full-page screenshot path
- non-route surfaces and no shortcut guidance.

### Phase 2 rubric

Pin theme parity, greps, contrast, typography, spacing, interaction, empty/error/loading, responsive, anti-pattern, console/network, and accessibility checks.

### Phase 3-5 evidence, triage, and tasks

Pin symptom-only refusal, root-cause file/line/minimal-fix requirement, common root-cause probes, score math, priority definitions, dedupe, tasks.md shape, grep before write, right section selection, lint execution, and lint error fixes.

### Phase 6-7 summary and constraints

Pin optional taste summary, final summary fields, task IDs, anti-pattern detection table, constraints, and related skills.

### Eval preservation and metadata

Pin:

- `evals.skill_name === "design-review"`
- length 8 after implementation and unique IDs
- evals 1-6 exact prompts and core expectations
- eval 7 wrong-tool routing pressure
- eval 8 shortcut/source-edit pressure
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 6-eval file because evals 7-8 are missing.
- Removing wrong-tool routing from frontmatter or When to Invoke fails the spec.
- Removing screenshot output path or final summary fields fails the spec.
- Removing TASKS.md fields, dedupe, or lint requirements fails the spec.
- Removing Phase 0 route/theme inventory fails the spec.
- Removing route × theme × viewport capture matrix fails the spec.
- Removing deterministic theme verification fails the spec.
- Removing non-route surface capture fails the spec.
- Removing theme parity/Tailwind/hex/body-color checks fails the spec.
- Removing contrast, typography, spacing, interaction, empty/loading/error, responsive, anti-pattern, console/network, or a11y checks fails the spec.
- Removing source root-cause file/line requirements fails the spec.
- Removing score math or priority definitions fails the spec.
- Removing no-source-edit/no-shortcut constraints fails the spec.
- Removing pressure eval coverage for wrong-tool routing or shortcut/source-edit resistance fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-four to twenty-five deterministic specs and add `design-review` after `debug`.
- `document-2134-pressure-eval-conventions`: add design-review pressure examples covering wrong-tool routing, complete route/theme/viewport matrix, deterministic theme verification, no symptom-only reports, no inline source edits, dedupe, lint-clean TASKS.md output, and screenshot-backed evidence.

## Implementation steps

1. Add deterministic spec at `src/skills/design-review-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/design-review-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/design-review/evals/evals.json`.
4. Update TASKS bookkeeping: remove completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking prose**: pin durable contract phrases and concrete examples; avoid asserting every line of the long rubric.
- **Runtime/browser scope creep**: keep tests deterministic over skill/eval artifacts only; do not launch browsers or create screenshots.
- **Skill routing ambiguity**: assert both frontmatter and When to Invoke so wrong-tool pressure stays clear.
- **Side-effect risk**: pin no source edits and lint-clean TASKS.md tasks, but do not run the skill itself.
- **Task spam risk**: pin dedupe against existing TASKS.md and “deduplicate issue, not symptom.”
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/design-review-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter/routing, Role, Scope, Output Contract, all seven phases, capture matrix, rubric, root-cause discipline, score/triage, task-writing, taste/final summaries, anti-pattern recipes, constraints, related skills, and eval metadata.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/design-review-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-four to twenty-five.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for a high-side-effect design-audit skill artifact.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` tracks Vercel skills CLI / agent-skills as the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.
