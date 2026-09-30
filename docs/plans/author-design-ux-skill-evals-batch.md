# Plan: author-design-ux-skill-evals-batch

## Goal
Add spec-valid `evals/evals.json` files for four uncovered built-in design/UX skills: `composition-patterns`, `design-review`, `fix-styles`, and `taste`.

## Why
The parent P0 eval-coverage epic needs reviewed, tractable batches rather than one giant PR. These four skills form a coherent frontend/design surface and have strong behavioral contracts that can be evaluated with realistic prompts:

- `composition-patterns` should steer React component architecture away from boolean prop proliferation and toward compound components/providers.
- `design-review` should perform a whole-app audit, capture route/theme/viewport evidence, root-cause findings, and write structured `TASKS.md` entries without editing source code.
- `fix-styles` should use screenshot-backed before/after iteration, one visual fix at a time.
- `taste` should enforce premium UI guardrails such as dependency verification, anti-emoji, Lila ban, responsive layout, and performance-safe animation.

## Scope (in)
- Create `evals/evals.json` under each selected skill directory.
- Use the accepted `expectations` format.
- Include prompts that exercise skill-specific traps, not generic "use this skill" prompts.
- Keep each eval independently judgeable with 3-5 concrete expectations.
- Cite the prompt source for every scenario inside `expected_output` or expectation text so reviewers can distinguish skill-derived fixtures from invented prompts.
- Run at least one representative with-skill vs without-skill spot check per skill and summarize the signal in the PR body.
- Run the built-in coverage gate at the current branch-appropriate threshold and the full verify suite before committing.

## Scope (out)
- Does not edit the selected `SKILL.md` files.
- Does not require a fully automated browser-backed eval runner in CI; browser/screenshot requirements are asserted as workflow artifacts in `evals.json`, then spot-checked manually/agent-driven for representative scenarios.
- Does not raise the global 90% gate; that remains blocked by the parent epic.
- Does not add new skills or migrate skill content to external source repos.

## Prompt sources and fixture assumptions

The eval prompts will be grounded in existing repo artifacts, not invented from scratch:

| Skill | Prompt source | Fixture model | Expectations must check |
|---|---|---|---|
| `composition-patterns` | The skill's own canonical composer examples and constraints (`SKILL.md` §§ 1.1-3.2) plus the existing task-grooming note that distinguishes `arch` / `refactor` / `composition-patterns` in `TASKS.md` | Inline React component snippets in the prompt; no dev server required | Reject adding more booleans/render props; propose explicit variants, compound components, provider-isolated state, and generic `state/actions/meta` context |
| `design-review` | The skill's route/theme/viewport workflow and output contract (`SKILL.md` Output Contract + Phases 0-7) and the repo's recurring dashboard/design-audit task language in `TASKS.md` | Deterministic fictive app inventory in the prompt: route list, theme toggle mechanism, existing source file paths/line hints, and a running-app URL placeholder; no real browser dependency for schema validation | Inventory routes and surfaces; capture light/dark desktop/mobile screenshots under `/tmp/design-review/...`; root-cause findings to file:line; append lint-clean deduplicated `TASKS.md` entries; do not edit source |
| `fix-styles` | The skill's screenshot loop and Iron Law (`SKILL.md` lines 10-95) plus the existing `recreate-storybook-screenshot-tool` task in `TASKS.md` as the real Storybook screenshot operator workflow | Storybook URL + before-screenshot symptom + relevant CSS snippet embedded in the prompt; no external Storybook required for schema validation | Baseline screenshot first; DOM snapshot for structure; one style change only; after screenshot + visual diff; mobile/dark verification; no `!important`, magic numbers, or stacked overrides |
| `taste` | The skill's default architecture, anti-emoji/Lila bans, dashboard bans, motion/performance guardrails, and data/form rules (`SKILL.md` §§ 2-9) | Product prompts for dashboard, landing page, and form/admin surfaces with package/dependency context included inline | Check dependencies before imports; no emoji/Lila/Inter/hero-dashboard/KPI-grid slop; responsive single-column mobile fallback; transform/opacity-only motion; Client Component isolation for interactivity |

For `design-review` and `fix-styles`, `evals.json` is a prose-quality benchmark, not a pixel-diff harness. The independently judgeable artifact is whether the agent's answer follows the screenshot workflow with concrete commands/paths and root-cause evidence. The PR still includes representative A/B spot checks so reviewers can see that the skill changes behavior compared with a baseline prompt-only response.

## Implementation steps

1. Read the selected `SKILL.md` files and extract each skill's non-negotiable behaviors.
2. Create one `evals/evals.json` per skill with realistic prompts:
   - `composition-patterns`: refactor a boolean-heavy React composer into explicit variants and compound/provider structure.
   - `design-review`: audit a running dashboard fixture across routes, themes, viewports, and output deduplicated task entries with root-cause file evidence.
   - `fix-styles`: fix a visual regression fixture using baseline screenshot, snapshot diagnosis, one change, after screenshot, and dark/mobile verification.
   - `taste`: design premium dashboard, landing, and form/admin surfaces while checking dependencies and avoiding banned AI slop patterns.
3. Validate JSON shape and coverage:
   - `npm run dev -- skills coverage --ci --threshold 34 --builtins`
4. Run one representative A/B spot check per skill:
   - With-skill arm: prompt a subagent to read the target `SKILL.md` and answer one eval scenario.
   - Without-skill arm: prompt a separate subagent with the same scenario but without the `SKILL.md`.
   - Score both arms against the same expectations. Include a short `## Skill eval results` table in the PR body. If `with_skill` is below 80% assertion pass or `without_skill` matches it on every skill-specific expectation, revise the eval or file a sharpen/merge/delete follow-up.
5. Run full verification:
   - `npm run verify`
6. Scout files touched and add any discovered follow-up task if a real gap appears.
7. Remove this subtask from `TASKS.md` in the same shipping commit.

## Taste eval rule map

The `taste` file is broad, so the three scenarios will be deliberately split instead of trying to test every rule at once:

1. **Internal dashboard scenario** — tests dependency verification, technical sans/mono typography, no dashboard hero, no KPI card grid opener, no emoji, no Lila/blue-purple dark mode, monospace numbers, and grouped-by-function layout.
2. **Premium landing page scenario** — tests asymmetric hero/split-screen layout, one desaturated accent, non-Inter display font, responsive mobile fallback, no 3-column equal-card feature row, and reliable image placeholders.
3. **Interactive form/admin scenario** — tests RSC/client boundary isolation, labels above inputs with helper/error text, loading/empty/error states, transform/opacity-only animations, no `h-screen`, no flex percentage math, and package checks before using icon/motion libraries.

## Risks and mitigations

- **Risk**: Eval prompts are too generic and pass without the skill. **Mitigation**: Each prompt cites its source and includes traps that only the skill contract highlights; the A/B spot check must show either skill lift or a documented reason why the skill still ships.
- **Risk**: The current threshold changes when open eval PRs merge. **Mitigation**: This branch only needs to pass the documented local threshold for its independent four-file batch; the parent task tracks cumulative coverage.
- **Risk**: Design-review prompts accidentally ask the agent to modify source code. **Mitigation**: Expectations explicitly require audit-only output and `TASKS.md` entries, matching the skill constraints.
- **Risk**: Screenshot-heavy skills look untestable in prose evals. **Mitigation**: Assert command/path/artifact discipline in `evals.json` and use the representative A/B spot checks to confirm the skill makes agents mention the visual proof loop that baseline answers usually skip.

## Acceptance criteria
- `skill-plugins/dev/composition-patterns/evals/evals.json` is valid and checks compound/provider guidance.
- `skill-plugins/dev/design-review/evals/evals.json` is valid and checks whole-app audit discipline.
- `skill-plugins/dev/fix-styles/evals/evals.json` is valid and checks screenshot-backed visual verification.
- `skill-plugins/dev/taste/evals/evals.json` is valid and checks premium UI guardrails.
- `npm run dev -- skills coverage --ci --threshold 34 --builtins` passes.
- One representative with-skill vs without-skill spot check per skill is summarized for the PR body, with with-skill ≥80% assertion pass or a follow-up task filed.
- `npm run verify` passes before commit.

## Reviewer validation

PLAN_VERDICT: APPROVED

RATIONALE: Reviewer approved the revised plan after it added explicit prompt sources, design-review/fix-styles fixture assumptions, taste rule mapping, with-skill vs without-skill evidence, and a concrete pivot/pass bar.
