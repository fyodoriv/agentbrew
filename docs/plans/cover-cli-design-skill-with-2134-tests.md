# Cover cli-design skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/cli-design/` so its CLI-review contract keeps npm/brew/uv conventions, default-behavior discipline, command consolidation, declarative config source-of-truth rules, and impact-ordered output from drifting.

## Why

`cli-design` influences command UX and can create lasting CLI surface area. Its highest-risk drift is normalizing opt-in flags for behaviors most users want, treating manifest writes as optional `--save` behavior, accepting extensionless config files, leaving redundant commands visible, or producing generic advice instead of concrete impact-ordered changes. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken agent artifacts before users rely on them).

## Scope in

- Add `src/skills/cli-design-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/cli-design/SKILL.md` and `skill-plugins/dev/cli-design/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - purpose/prose entry: review the CLI defined in `$1`, defaulting to `./src/cli.ts`;
  - package-manager conventions: install/remove update manifest by default, no `--save` anti-pattern, standard `.yaml` / `.json` / `.toml` manifest extensions;
  - default-behavior flip discipline: ask whether most users want opt-in behavior and replace positive opt-ins with negative opt-outs;
  - concrete before/after defaults for parallel execution, auto-fix on dashboard, manifest update, and discovery/detection;
  - redundant command consolidation: `--help` / `--help-all`, `doctor` / `status --fix`, `update` / `sync --pull`, hidden alias when useful;
  - declarative config source of truth: `init --from-state` captures full state, file supports all features, global config authoritative, project config additive, `--config <path>` supported;
  - output contract: concrete changes with rationale, ordered by impact.
- Assert eval metadata coverage:
  - existing broad CLI design review;
  - existing `--save` anti-pattern review;
  - existing redundant `doctor` / `status --fix` consolidation review;
  - new declarative-config source-of-truth pressure case;
  - new review-only/default-behavior pressure case that asks to apply changes directly but should still produce concrete review recommendations rather than claim edits.

## Concrete eval additions

Add exactly two eval entries, numbered 4 and 5:

```json
{
  "id": 4,
  "prompt": "review a CLI where `agentbrew init --from-state` writes only MCP servers into an extensionless Agentfile, while skills and rules remain only in global state",
  "expected_output": "A declarative-config critique that requires a standard file extension and treats the config file as the source of truth for all feature categories.",
  "expectations": [
    "Flags the extensionless Agentfile and recommends a standard extension such as .yaml, .json, or .toml",
    "Requires init --from-state to capture the full current state, not only MCP servers",
    "Requires the declarative config file to support all feature categories, not just a subset such as only MCP servers",
    "Distinguishes global config as authoritative from project config as additive",
    "Recommends a --config <path> override for configs outside the current working directory"
  ]
}
```

```json
{
  "id": 5,
  "prompt": "review this CLI and apply every fix directly: it has `--parallel`, `--discover`, and `--save` opt-in flags for behaviors most users want",
  "expected_output": "A review-only, impact-ordered recommendation list that flips user-wanted opt-in flags into defaults with negative opt-outs instead of claiming implementation.",
  "expectations": [
    "Identifies --parallel, --discover, and --save as opt-in defaults to challenge because most users likely want those behaviors",
    "Recommends default parallel execution with a --sequential or equivalent opt-out",
    "Recommends default discovery/detection summaries with a negative opt-out if needed",
    "Recommends manifest updates by default with a --no-save or equivalent opt-out",
    "Provides a prioritized list of changes without claiming implementation",
    "Does not output 'I've updated your CLI' or similar file-edit claim language",
    "Treats the prompt's request to apply every fix directly as review-only pressure, not permission to claim edits"
  ]
}
```

Eval 4 is the declarative source-of-truth pressure case. Eval 5 is a default-behavior and review-only boundary pressure case. Existing eval 1 remains the broad positive review, eval 2 remains the `--save` convention case, and eval 3 remains redundant-command consolidation. The final `evals.json` keeps root `skill_name: "cli-design"`, preserves evals 1-3 unchanged, and appends evals 4-5 so the array has exactly five entries with IDs 1-5.

## Concrete test assertions

The spec will use the same helper names as neighboring specs: `requireTerms`, `expectationText`, `scenarioText`, `evalMatching`, and `evalById`.

Core SKILL.md assertions will pin these exact strings or regexes:

```typescript
requireTerms(skillText, [
  "Review the CLI defined in $1 (default: ./src/cli.ts) for design quality.",
  "## 1. Follow package-manager conventions",
  "**install/remove always update the manifest**",
  "**No `--save` anti-pattern**",
  "make it the default. Add `--no-X` to opt out instead of `--X` to opt in.",
  "**File format uses standard extension**",
  "`.yaml`, `.json`, or `.toml`",
  "## 2. Run more by default",
  "For each flag that's opt-in, ask: \"would most users want this?\" If yes, flip it:",
  "| Parallel execution | `--parallel` to opt in | Default. `--sequential` to opt out |",
  "| Auto-fix on dashboard | Report drift, suggest command | Fix automatically, report what was fixed |",
  "| Manifest update | `--save` flag or separate write | Always write to manifest |",
  "| Discovery/detection | `--discover` flag | Always show brief summary |",
  "## 3. Combine redundant commands",
  "Look for `--help` / `--help-all` splits, `doctor` / `status --fix` overlaps, `update` / `sync --pull` duplicates.",
  "one visible command with a flag, the other hidden as an alias.",
  "## 4. Declarative config as source of truth",
  "`init --from-state` should capture the FULL current state into the file",
  "The file should support ALL features",
  "Global config is authoritative",
  "Project config is additive",
  "`--config <path>` flag for pointing at a config outside cwd",
  "## 5. Output",
  "Produce a list of concrete changes with rationale, ordered by impact.",
]);
```

Existing-eval preservation assertions will pin evals 1-3 by ID, prompt, and representative expectation text:

```typescript
expect(evalById(1)).toMatchObject({
  prompt: "review the CLI in src/cli.ts for design quality",
});
expect(expectationText(evalById(1))).toContain(
  "Audits install/remove behavior for manifest updates by default",
);
expect(evalById(2)).toMatchObject({
  prompt: "my CLI has `tool sync --save` to update the manifest; is that the right convention?",
});
expect(expectationText(evalById(2))).toContain("Identifies --save as an anti-pattern");
expect(evalById(3)).toMatchObject({
  prompt: "I have both `tool doctor` and `tool status --fix`; should these stay separate?",
});
expect(expectationText(evalById(3))).toContain("Recommends one visible command with flags");
```

Eval coverage assertions will use these scenario lookups:

```typescript
evalMatching(/review the CLI in src\/cli\.ts|design quality/i);
evalMatching(/sync --save|manifest/i);
evalMatching(/tool doctor|status --fix/i);
evalMatching(/init --from-state|extensionless Agentfile|skills and rules/i);
evalMatching(/--parallel|--discover|--save|apply every fix/i);
```

The metadata test will pin existing evals 1-3 by ID, prompt, and representative expectation text so the new pressure cases are appended rather than replacing existing coverage. Each scenario assertion will check at least four expectations covering package-manager conventions, `--save`, redundant commands, declarative config, default-behavior flips, impact ordering, and review-only boundaries.

## Scope out

- Do not change `cli-design` runtime behavior; this skill has no deterministic helper script.
- Do not run live agent evals in this slice.
- Do not apply actual CLI design changes to `src/cli.ts`.
- Do not extract shared test helpers; existing scout tasks track shared #2134 helper/documentation work.
- Do not rewrite the skill prose unless the tests reveal a real missing contract.


## Plan status

This document is the pre-implementation plan. The `evals.json` additions and `src/skills/cli-design-contract.test.ts` are intentionally pending until this plan is approved. The revision response above describes changes made to the plan text, not completed implementation changes.

## Implementation steps

1. Add `src/skills/cli-design-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md package-manager conventions, default-behavior table, redundant command consolidation, declarative config source-of-truth rules, and impact-ordered output contract.
3. Extend `skill-plugins/dev/cli-design/evals/evals.json` from 3 to 5 scenarios by adding declarative-config and review-only/default-behavior pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md`, update TASKS.md task `extract-shared-2134-skill-contract-test-helpers` from thirteen to fourteen contract specs, and enrich the pressure-eval conventions scout task with CLI default-behavior pressure if useful.
6. Run focused and full verification:
   - `npx vitest run src/skills/cli-design-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **CLI convention drift**: Pin package-manager conventions, manifest update defaults, and standard config extensions.
- **Default-behavior drift**: Pin the "would most users want this?" question and the before/after table for positive opt-ins to negative opt-outs.
- **Command sprawl drift**: Pin redundant-command examples and the one-visible-command/hidden-alias recommendation.
- **Declarative-source drift**: Pin full-state capture, all-feature support, global/project semantics, and `--config <path>`.
- **Brittle prose locks**: Use exact strings for stable headings/table rows and regexes for scenario lookup.

## Acceptance criteria

- New deterministic spec at `src/skills/cli-design-contract.test.ts` reads `skill-plugins/dev/cli-design/SKILL.md` and `skill-plugins/dev/cli-design/evals/evals.json`.
- The spec pins package-manager conventions, `--save` anti-pattern handling, default-behavior flips, redundant command consolidation, declarative config source-of-truth behavior, and impact-ordered output.
- Evals cover broad CLI design review, `--save`, redundant commands, declarative config source of truth, and review-only/default-behavior pressure; evals 1-3 remain unchanged and evals 4-5 are appended under root `skill_name: "cli-design"`.
- `npx vitest run src/skills/cli-design-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records fourteen skill specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned CLI review skill.

## Reviewer verdict — revision 1

- **Verdict**: needs-revision
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - Add explicit assertions pinning evals 1-3 by ID and representative expectation text.
  - Strengthen eval 5's review-only boundary so it fails if the skill claims file edits.
  - Reword eval 4's all-feature expectation without requiring a brittle feature-category list.
  - Avoid pinning frontmatter description; pin the prose entry/default path instead.

## Revision response

- Added existing-eval preservation assertions for evals 1-3.
- Strengthened eval 5 with prioritized-review, no-implementation-claim, and review-only-pressure expectations.
- Reworded eval 4 to require all feature categories, not just a subset such as only MCP servers.
- Removed the frontmatter description assertion and kept the prose/default-path assertion.

## Reviewer verdict — revision 2

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**: <none>
