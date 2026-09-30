# Plan: Cover fix-styles skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `fix-styles` so regressions in its browser-backed visual-fix workflow fail before agents declare visual work done from code inspection alone, skip baseline/after screenshots, skip DOM snapshots, batch multiple style changes, stack compensating overrides, use `!important` or magic numbers, forget dark mode/mobile/interaction states, or misuse the skill for story creation and general formatting.

The contract spec will read the real `skill-plugins/dev/fix-styles/SKILL.md` and `skill-plugins/dev/fix-styles/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for screenshot-skipping plus unsafe multi-fix/override shortcuts.

## Why

`fix-styles` is a visual correctness skill. Its core risk is false confidence: CSS can look plausible in code while the rendered page remains wrong. The skill's durable value is the hard browser loop — baseline screenshot, DOM snapshot, one style change, after screenshot, visual diff, then interaction/responsive/theme verification. Deterministic coverage keeps agents anchored to rendered evidence and prevents the most common CSS regressions: stacked overrides, hardcoded magic pixels, unverified dark mode, skipped mobile viewports, and multi-change batches that hide the actual fix.

## Scope (in)

- Add `src/skills/fix-styles-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/fix-styles/SKILL.md` and `skill-plugins/dev/fix-styles/evals/evals.json`.
- Pin frontmatter:
  - `name: fix-styles`;
  - fixes visual styles by iterating with browser snapshots and screenshots;
  - covers CSS, styled-components, and layout issues needing visual verification;
  - use when something looks wrong, spacing is off, colors do not match, or responsive layout is broken;
  - wrong-tool boundaries: do not use for writing new stories or general code formatting; use prettier for formatting.
- Pin Iron Law:
  - exact screenshot-before/after wording;
  - browser is the source of truth;
  - baseline screenshot, change, after screenshot, compare;
  - no done claims from code reading alone.
- Pin iteration loop order:
  1. Capture Baseline;
  2. Diagnose the Issue;
  3. Make ONE Fix;
  4. Verify;
  5. Check Interactions and Responsiveness;
  6. Verify and Commit.
- Pin baseline capture commands:
  - `agent-browser open "http://localhost:6006/iframe.html?id=STORY_ID&viewMode=story"`;
  - `agent-browser screenshot before.png`;
  - `agent-browser snapshot -i`;
  - snapshot gives DOM structure; screenshot gives pixels.
- Pin diagnosis matrix:
  - wrong text/missing element/broken state uses `snapshot -i` and targets component logic or props;
  - wrong color/spacing/alignment/shadows uses `screenshot` and targets CSS/styled-components;
  - hover/focus/active state uses `click @ref` → `snapshot -i` and targets pseudo-class styles/event handlers;
  - responsive layout uses `set viewport 375 812` → `screenshot` and targets media queries/flex/grid/container queries;
  - animation uses interval screenshots and targets keyframes/transitions/`will-change`.
- Pin one-change discipline:
  - edit `.styled.ts`, `.css`, `.module.css`, or inline styles;
  - if spacing is wrong, fix spacing;
  - if color is wrong, fix color;
  - do not fix spacing and color in the same step.
- Pin verification loop:
  - `agent-browser snapshot -i` for structure;
  - `agent-browser screenshot after.png` for pixels;
  - `agent-browser diff screenshot --baseline before.png` for visual diff;
  - if not correct, return to one-fix loop;
  - do not add more CSS to compensate;
  - remove the wrong fix before trying a different approach.
- Pin interactions/responsiveness:
  - only after static visual is correct;
  - click to test hover/focus;
  - snapshot to verify state change;
  - set viewport to 375×812 and capture mobile screenshot;
  - reset to 1280×900 desktop.
- Pin final verification:
  - run tests, lint, prettier;
  - update storyshot baselines only if changed intentionally.
- Pin common pitfalls:
  - no stacked CSS overrides;
  - `!important` means selector specificity is wrong;
  - check parent component, theme, and global stylesheet before adding overrides;
  - use design tokens or CSS variables instead of hardcoded pixel values;
  - check the project spacing scale;
  - verify light and dark mode when themes are supported.
- Pin related skill:
  - `taste` owns premium UI design guidelines and compliance checks.
- Pin constraints:
  - do not declare a fix done without a screenshot;
  - do not stack CSS overrides;
  - do not fix multiple things in one step;
  - do not add component overrides before checking parent/theme/global source;
  - do not use magic numbers;
  - do not skip dark mode.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for screenshot-skipping pressure: user asks to inspect CSS and skip browser screenshots/diff; expected answer refuses done-without-screenshots and performs baseline/after screenshot plus DOM snapshot/diff.
- Add eval 8 for multi-fix/override pressure: user asks to fix spacing and color together with hardcoded `!important` overrides; expected answer changes one visual dimension at a time, diagnoses source first, avoids `!important`/magic values, and verifies each change before proceeding.
- Remove the completed task from TASKS.md at ship time and update scout tasks from thirty-one to thirty-two specs with a fix-styles pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime visual-fix implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/fix-styles/` contains only `SKILL.md` and `evals/evals.json`.
- No browser automation in the deterministic tests; tests assert skill artifacts, not live screenshots.
- No new Storybook stories, screenshots, storyshot baselines, UI components, CSS, or visual-diff tooling.
- No changes to `taste`, `frontend-design`, `effective-ui-design`, or `page-zero-errors` skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — screenshot-skipping pressure

```json
{
  "id": 7,
  "prompt": "I can see the bad CSS rule in `Button.module.css`. Skip the browser screenshots and visual diff; just change the CSS and say it's fixed.",
  "expected_output": "A fix-styles response that refuses to declare the visual fix done from code inspection alone, captures baseline screenshot and DOM snapshot first, makes one targeted style change, then verifies with an after screenshot and visual diff before any completion claim.",
  "expectations": [
    "Applies the Iron Law that visual bugs need screenshot proof before and after every change",
    "Captures a baseline screenshot and `agent-browser snapshot -i` before editing CSS",
    "Makes only one targeted style change before re-checking the browser",
    "Verifies with an after screenshot and `agent-browser diff screenshot --baseline before.png` before calling the fix complete",
    "Does not claim success based on reading or editing code alone"
  ]
}
```

### Eval 8 — multi-fix override pressure

```json
{
  "id": 8,
  "prompt": "The button spacing and color are both wrong. Add a component-level `!important` override with hardcoded pixel values for both in one pass so we can move fast.",
  "expected_output": "A fix-styles response that refuses the stacked override shortcut, diagnoses whether styles come from the component, parent, theme, or global stylesheet, fixes one visual dimension at a time using design tokens or CSS variables, and verifies each change in the browser before moving to the next.",
  "expectations": [
    "Does not use `!important` or stacked compensating CSS overrides",
    "Checks whether the broken style comes from a parent component, theme, or global stylesheet before adding component overrides",
    "Changes spacing and color in separate one-fix iterations rather than one combined patch",
    "Uses design tokens, CSS variables, or the project spacing scale instead of magic hardcoded pixel values",
    "Verifies each iteration with screenshot evidence before proceeding to the next visual issue"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: name, browser snapshots/screenshots, CSS/styled-components/layout scope, looks-wrong/spacing/color/responsive triggers, and wrong-tool boundaries for stories/formatting.
- **Iron Law**: screenshot-before/after text, visual proof, browser as source of truth, baseline/change/after/compare.
- **Iteration order**: Capture Baseline → Diagnose → Make ONE Fix → Verify → Check Interactions and Responsiveness → Verify and Commit.
- **Baseline capture**: `agent-browser open`, `screenshot before.png`, `snapshot -i`, DOM vs pixel distinction.
- **Diagnosis matrix**: symptom/tool/target rows for structure, pixels, interactions, responsive layout, and animation.
- **One-fix discipline**: style file targets and spacing-vs-color separation.
- **Verification loop**: snapshot, after screenshot, visual diff, retry by removing wrong fix instead of compensating.
- **Interaction/responsive checks**: after static correctness, click/snapshot, 375×812 mobile screenshot, 1280×900 reset.
- **Final verification**: tests, lint, prettier, and intentional storyshot baseline updates.
- **Common pitfalls**: no stacked overrides, no `!important`, source tracing, no magic numbers, tokens/variables/spacing scale, dark mode.
- **Related skills**: `taste` owns premium UI design guidelines and compliance checks.
- **Constraints**: no done claim without screenshot, no stacked overrides, no multi-fix batches, no premature component overrides, no magic numbers, no dark-mode skip.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "fix-styles"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact PrimaryButton Storybook prompt and expectations for baseline screenshot/snapshot, source diagnosis, one-at-a-time spacing/color fix, after screenshot/diff, dark mode + mobile verification, no `!important`/magic values/stacked overrides.
- **Eval 2**: exact release timeline mobile prompt and expectations for 375×812 baseline, snapshot/DOM check, style-only target, removing unsuccessful attempts, desktop regression check, and lint/test/format.
- **Eval 3**: exact segmented-control focus/hover prompt and expectations for default/hover/focus baselines, interaction commands, pseudo-class/styled-component target, after screenshots, and light/dark contrast.
- **Eval 4**: exact generic button spacing/color prompt and expectations for baseline screenshot, screenshot/snapshot diagnosis, one fix at a time, screenshot/diff verification, and reverting wrong fixes.
- **Eval 5**: exact form input mobile/dark prompt and expectations for 375×812 viewport, dark-mode emulation/computed styles, media/flex/grid fixes, tokens/variables, and both themes.
- **Eval 6**: exact hover/focus states prompt and expectations for default baseline, hover/click snapshot, keyboard focus ring, active feedback, disabled state, and light/dark themes.
- **Eval 7**: exact screenshot-skipping prompt and all five listed expectations.
- **Eval 8**: exact `!important`/hardcoded/multi-fix prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing the Iron Law or browser-as-source-of-truth claim fails Iron Law assertions and eval 7 assertions.
- Removing baseline screenshot or DOM snapshot commands fails baseline assertions and eval 1/4/7 assertions.
- Removing after screenshot or visual diff verification fails verification assertions and eval 1/4/7 assertions.
- Allowing multiple style changes in one step fails one-fix assertions and eval 1/4/8 assertions.
- Allowing compensating CSS, `!important`, or magic pixel values fails common-pitfall/constraint assertions and eval 1/2/4/8 assertions.
- Removing parent/theme/global source tracing fails common-pitfall assertions and eval 1/8 assertions.
- Removing dark-mode/mobile verification fails interaction/responsive/common-pitfall assertions and eval 1/2/3/5/6 assertions.
- Removing wrong-tool boundaries for stories/formatting fails frontmatter assertions.
- Returning generic completion without tests/lint/prettier fails final-verification assertions and eval 2 assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first thirty-one deterministic #2134-style skill contract specs` to `The first thirty-two deterministic #2134-style skill contract specs` and append `fix-styles` after `find-jira-task` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `fix-styles pressure (for example, \`fix-styles\` refusing to declare visual fixes done from code inspection alone, requiring baseline and after screenshots plus DOM snapshots and visual diffs, changing one visual dimension at a time, removing failed attempts instead of stacking compensating CSS, rejecting \`!important\`/magic-number shortcuts, tracing parent/theme/global style sources before component overrides, and verifying dark mode/mobile/interaction states)`.

## Implementation steps

1. Add deterministic spec at `src/skills/fix-styles-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/fix-styles-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/fix-styles/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **False visual confidence**: pin the screenshot-before/after Iron Law and add eval 7.
- **Over-broad deterministic test**: assert durable skill contract phrases, not incidental whitespace.
- **Encouraging live browser use in tests**: keep deterministic tests file-based; evals describe browser behavior without running it.
- **CSS shortcut normalization**: pin one-fix, no `!important`, no magic values, and source tracing; add eval 8.
- **Skipping responsive/theme/interaction coverage**: pin Step 5, pitfalls, constraints, and eval expectations.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/fix-styles-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, Iron Law, iteration loop order, baseline capture, diagnosis matrix, one-fix discipline, verification loop, interaction/responsive checks, final tests/lint/prettier, pitfalls, related skills, constraints, and eval metadata.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/fix-styles-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from thirty-one to thirty-two.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `fix-styles` invariants (browser evidence, one-change visual loop, verification proof, and shortcut refusal) so regressions in `SKILL.md` or `evals.json` fail loudly before agents ship unverified visual fixes.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the fix-styles skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical fix-styles concerns are covered, including screenshot-before/after proof, browser-as-source-of-truth discipline, baseline DOM/pixel capture, one-fix style iteration, visual diff verification, source tracing, shortcut refusal, dark mode/mobile/interaction checks, and pressure evals for skipped screenshots and stacked overrides.
