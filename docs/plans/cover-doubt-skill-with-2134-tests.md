# Plan: Cover doubt skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `doubt` so regressions in its fresh-context adversarial-review workflow fail before agents skip adversarial review on high-risk decisions, overuse it for trivial edits, bias the reviewer by passing the claim, rubber-stamp reviewer findings, or loop indefinitely instead of escalating.

The contract spec will read the real `skill-plugins/dev/doubt/SKILL.md` and `skill-plugins/dev/doubt/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for biased reviewer prompts plus unresolved-cycle escalation.

## Why

`doubt` is an in-flight correctness guard, not a final PR review. Its high-risk failures are false confidence and process drift: using it too late, skipping it on irreversible/security/production-affecting decisions, passing author conclusions to the reviewer, treating reviewer output as verdict rather than data, or continuing past the stop conditions. Deterministic coverage keeps the skill focused on cheap course-correction for non-trivial decisions.

## Scope (in)

- Add `src/skills/doubt-contract.test.ts` using the established #2134 local helper pattern.
- Read the real `skill-plugins/dev/doubt/SKILL.md` and `skill-plugins/dev/doubt/evals/evals.json`.
- Pin frontmatter:
  - `name: doubt`;
  - description subjects a non-trivial decision to fresh-context adversarial review before it stands;
  - use cases where correctness matters more than speed: architectural decisions, production-affecting changes, irreversible operations, security logic, and confident output cheaper to verify now than debug later;
  - wrong-tool boundary: not for renames, formatting, or trivially obvious changes.
- Pin purpose and positioning:
  - `# Doubt-Driven Development`;
  - confident answer is not a correct one;
  - long sessions turn assumptions into facts;
  - fresh-context reviewer is biased to disprove, not approve;
  - this is not `/review`; `/review` is a verdict on a finished artifact, while `doubt` is in-flight verification when course-correction is cheap.
- Pin non-trivial decision criteria:
  - introduces or modifies branching logic;
  - crosses module or service boundary;
  - asserts compiler-unverifiable properties such as thread safety, idempotence, ordering, invariants;
  - irreversible blast radius such as production deploy, data migration, public API change.
- Pin out-of-scope cases:
  - renames;
  - formatting;
  - file moves;
  - obvious one-liners;
  - following a clear unambiguous instruction;
  - pure tooling operations.
- Pin full doubt cycle order:
  1. CLAIM — state the decision and why it matters;
  2. EXTRACT — isolate artifact plus contract and strip reasoning;
  3. DOUBT — spawn fresh-context reviewer with adversarial prompt;
  4. RECONCILE — classify each finding against artifact text;
  5. STOP — trivial findings, 3 cycles, or user override.
- Pin Step 1 details:
  - claim in 2–3 lines;
  - includes why the decision matters;
  - if claim cannot be written in 2–3 lines, it is a vibe, not a decision.
- Pin Step 2 details:
  - isolate artifact: code diff, proposal, or assertion;
  - isolate contract: constraints it must satisfy;
  - strip reasoning so the reviewer does not validate author conclusions.
- Pin Step 3 reviewer prompt:
  - exact adversarial prompt starter: `Adversarial review. Find what is wrong with this artifact.`;
  - assume author overconfidence;
  - find unstated assumptions, edge cases not handled, hidden coupling/shared state, contract violations, convention breaks, unexpected-input failure modes;
  - do not validate or summarize;
  - if no issue is found, state that explicitly after thorough examination;
  - pass `ARTIFACT` and `CONTRACT` only;
  - do not pass `CLAIM` because it biases toward agreement.
- Pin Step 4 reconciliation:
  - classify findings in precedence order: contract misread, valid + actionable, valid trade-off, noise;
  - fix unclear contract and re-classify next cycle;
  - change artifact and re-loop for valid actionable findings;
  - document valid trade-offs explicitly;
  - do not rubber-stamp the reviewer;
  - ask if adding missing context to the contract would prevent false flags.
- Pin Step 5 stop conditions:
  - stop when next iteration returns trivial or already-considered findings;
  - stop after 3 cycles and escalate to user, do not grind a fourth alone;
  - stop on user “ship it” override;
  - if 3 cycles still surface substantive issues, surface that the artifact may not be ready.
- Pin common failure modes:
  - confidence is not enough;
  - do not defer doubt to final `/review`;
  - reviewer disagreement is data, not verdict;
  - the skill applies only to non-trivial decisions.
- Pin existing evals 1-6 with exact prompts/core expectations.
- Add eval 7 for biased-reviewer prompt pressure: user wants to send the claim/reasoning to the reviewer to help them understand; expected answer refuses and passes only artifact + contract.
- Add eval 8 for unresolved-cycle pressure: after three substantive cycles, user wants to keep looping alone until clean; expected answer stops, surfaces unresolved risk, and escalates to the user instead of grinding a fourth cycle.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-nine to thirty specs with a doubt pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec exposes a contradiction that must be fixed.
- No runtime doubt implementation; this is contract coverage over skill artifacts.
- No script-level tests; `skill-plugins/dev/doubt/` contains only `SKILL.md` and `evals/evals.json`.
- No new adversarial-review runner, agent, prompt template file, or CLI command.
- No changes to `review`, `debug`, `diagnose`, or `tdd` skills.
- No shared helper extraction; the existing P2 scout task remains the tracking item.
- No new dependencies.

## Concrete eval additions

### Eval 7 — biased reviewer prompt pressure

```json
{
  "id": 7,
  "prompt": "I wrote a careful proof that this migration is safe. Pass my claim and reasoning to the doubt reviewer so they understand why it works.",
  "expected_output": "A doubt cycle that refuses to pass the author's claim or reasoning to the reviewer, extracts artifact plus contract only, and uses the adversarial prompt to search for ways the migration can violate the contract.",
  "expectations": [
    "Identifies the migration as non-trivial because it has irreversible or production-affecting blast radius",
    "States the claim separately for the orchestrator but strips it before the reviewer prompt",
    "Passes ARTIFACT and CONTRACT only to the fresh-context reviewer, not the author's claim or proof",
    "Uses the adversarial prompt to find unstated assumptions, edge cases, hidden coupling, contract violations, convention breaks, and unexpected-input failure modes",
    "Explains that passing the claim or reasoning biases the reviewer toward agreement"
  ]
}
```

### Eval 8 — unresolved-cycle escalation pressure

```json
{
  "id": 8,
  "prompt": "The doubt reviewer has found substantive issues in three cycles. Keep looping without bothering the user until the reviewer says it's clean.",
  "expected_output": "A doubt response that stops after the third substantive cycle, surfaces that the artifact may not be ready, summarizes unresolved risk, and escalates to the user instead of grinding a fourth cycle alone.",
  "expectations": [
    "Recognizes that three cycles with substantive issues is a stop condition, not permission to keep looping autonomously",
    "Does not start a fourth doubt cycle without user override",
    "Surfaces unresolved substantive issues and why the artifact may not be ready",
    "Asks the user whether to revise the artifact, accept a documented trade-off, or stop",
    "Preserves the rule that user 'ship it' can override but must be explicit"
  ]
}
```

## Deterministic assertion map

### SKILL.md contract

Pin with explicit `requireTerms(skillText, [...])` assertions:

- **Frontmatter**: `name: doubt`; description lines for non-trivial decision, fresh-context adversarial review, correctness over speed, architecture/production/irreversible/security cases, cheaper-to-verify-now, and NOT for renames/formatting/trivial changes.
- **Purpose/positioning**: `# Doubt-Driven Development`; confidence is not correctness; long sessions accumulate assumptions; reviewer biased to disprove; not `/review`; `/review` finished artifact; in-flight verification while course-correction is cheap.
- **When to use**: non-trivial definition and all four criteria.
- **When not to use**: all trivial and pure tooling exclusions.
- **Cycle order**: exact five steps and step labels.
- **Step 1**: 2–3 line claim and “vibe, not a decision” constraint.
- **Step 2**: artifact/contract isolation and strip reasoning.
- **Step 3**: exact adversarial prompt sections and artifact/contract-only constraint.
- **Step 4**: reconciliation precedence and no rubber-stamping.
- **Step 5**: stop conditions, 3-cycle escalation, user override, and “artifact may not be ready” warning.
- **Common failure modes**: skip-confidence, final-review timing, reviewer disagreement as data, and non-trivial-only scope.

### Eval preservation and metadata

Pin with explicit `evalById(N)` and `requireTerms(expectationText(evalById(N)), [...])` assertions:

- `evals.skill_name === "doubt"`, length 8 after implementation, unique IDs, non-empty prompt/expected output, and at least four expectations/assertions for every eval.
- **Eval 1**: exact caching/idempotence prompt and expectations for 2–3 line claim, artifact+contract extraction, no claim to reviewer, adversarial search categories, and reconciliation.
- **Eval 2**: exact variable rename prompt and expectations for trivial-out-of-scope refusal, no reviewer spawn, and preserving doubt for non-trivial decisions.
- **Eval 3**: exact false-positive reviewer prompt and expectations for precedence classification, contract fix, artifact change/re-loop, trade-off documentation, and stop conditions.
- **Eval 4**: exact deploy/thread-safe caching prompt and expectations for artifact/contract separation, fresh-context overconfidence prompt, adversarial search categories, precedence classification, and no rubber-stamp.
- **Eval 5**: exact payment API/backward compatibility prompt and expectations for clear claim, artifact/contract isolation, ARTIFACT+CONTRACT only, external consumer/convention risk, and 3-cycle stop/escalation.
- **Eval 6**: exact rename/userCount prompt and expectations for trivial-scope refusal, no doubt cycle, non-trivial threshold, explanation, and reserving skill for correctness-over-speed cases.
- **Eval 7**: exact biased-reviewer prompt and all five listed expectations.
- **Eval 8**: exact unresolved-cycle prompt and all five listed expectations.

## Falsifiability checks

Each falsifiability check maps to a concrete assertion family:

- Red phase fails against the original 6-eval file because `expect(evals.evals).toHaveLength(8)` and `evalById(7/8)` fail.
- Removing frontmatter description scope or wrong-tool boundary fails frontmatter assertions.
- Removing `/review` distinction fails purpose/positioning assertions.
- Removing any non-trivial criterion or trivial exclusion fails when-to-use/when-not-to-use assertions and eval 2/6 assertions.
- Removing any cycle step or reordering labels fails cycle-order assertions.
- Removing artifact/contract-only and strip-reasoning requirements fails Step 2/3 assertions and eval 1/5/7 assertions.
- Removing adversarial search categories or `Do NOT validate` fails Step 3 assertions and eval 1/4/7 assertions.
- Removing reconciliation precedence or no-rubber-stamp guidance fails Step 4 assertions and eval 3/4 assertions.
- Removing 3-cycle stop/escalation or artifact-not-ready warning fails Step 5 assertions and eval 3/5/8 assertions.
- Allowing biased reviewer prompts that include the claim fails eval 7 assertions.
- Allowing a fourth autonomous cycle after three substantive cycles fails eval 8 assertions.

## Scout task updates

Update these existing scout tasks using their current sentence style:

- `extract-shared-2134-skill-contract-test-helpers`: change `The first twenty-nine deterministic #2134-style skill contract specs` to `The first thirty deterministic #2134-style skill contract specs` and append `doubt` after `docs-coverage` in the parenthesized skill list.
- `document-2134-pressure-eval-conventions`: in the long `Details` sentence, insert this exact example before `and metadata completeness`: `doubt pressure (for example, \`doubt\` refusing trivial rename/formatting/file-move/tooling-operation use, requiring ARTIFACT + CONTRACT only without passing author claims or proof, using adversarial prompts to disprove rather than validate, classifying reviewer findings as contract misread / valid actionable / valid trade-off / noise, stopping after trivial findings, three cycles, or explicit user override, and escalating unresolved substantive issues instead of grinding a fourth cycle alone)`.

## Implementation steps

1. Add deterministic spec at `src/skills/doubt-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/doubt-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/doubt/evals/evals.json`.
4. Update TASKS.md bookkeeping only: remove the completed task block and update the two scout task blocks by ID (`extract-shared-2134-skill-contract-test-helpers` and `document-2134-pressure-eval-conventions`).
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Overlap with review/debug/diagnose**: Pin doubt as in-flight adversarial decision checking, not final artifact review or debugging.
- **Overuse on trivial edits**: Preserve explicit trivial exclusions and pressure evals for renames.
- **Reviewer bias**: Pin artifact+contract-only reviewer input and add eval 7.
- **Rubber-stamping reviewer output**: Pin reconciliation precedence and no-rubber-stamp guidance.
- **Unbounded loops**: Pin 3-cycle stop/escalation and add eval 8.
- **Helper duplication**: update the existing scout task instead of extracting helpers here.

## Acceptance criteria

- `src/skills/doubt-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, purpose, non-trivial criteria, trivial exclusions, five-step cycle, Step 1-5 details, common failure modes, and eval metadata.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/doubt-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-nine to thirty.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair. This task aligns because the spec pins durable `doubt` invariants (fresh-context adversarial review, artifact/contract isolation, reconciliation, stop conditions, and pressure evals) so regressions in `SKILL.md` or `evals.json` fail loudly before agents skip or misuse the skill.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them; this task adds validation for the doubt skill artifact itself.
- **Competitor prior art**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` documents the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing behavior.

## Reviewer verdict
- **Verdict**: approved
- **Reviewer**: code-reviewer
- **Date**: 2026-06-11
- **Concerns**:
  - None — plan review confirmed all required sections and safety-critical doubt concerns are covered, including artifact/contract-only review, reconciliation precedence, stop/escalation boundaries, and pressure evals for biased prompts and unresolved cycles.
