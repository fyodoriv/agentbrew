# Cover caveman skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/caveman/` so its ultra-compressed communication contract remains terse without sacrificing technical accuracy, safety warnings, code, decision points, persistence, or explicit deactivation behavior.

## Why

`caveman` changes communication style, not engineering behavior. Its main risk is over-compression: omitting warnings, code details, ordering constraints, or deactivation requests because brevity is prioritized too aggressively. Deterministic coverage protects VISION.md G5 (drift detection + auto-repair) and US 18 (validation catches broken agent artifacts before users rely on them).

## Scope in

- Add `src/skills/caveman-contract.test.ts` using the established #2134-style skill contract pattern.
- Read the real `skill-plugins/dev/caveman/SKILL.md` and `skill-plugins/dev/caveman/evals/evals.json` from disk.
- Assert SKILL.md contract content:
  - description: ultra-compressed communication mode, cuts filler/articles/pleasantries, preserves full technical accuracy, ~75% token reduction, active until explicit stop/normal mode;
  - What changes section: strip filler, keep technical accuracy/all decisions/all warnings/all code;
  - output pattern: `[thing] [action] [reason]. [next step].` and the bad/good example pair;
  - safety valve: auto-suspend for security warnings, irreversible operations, multi-step sequences where order could be misread, and explicit clarification requests;
  - after the warning or instruction, return to caveman;
  - persistence: stays active across turns until `stop caveman`, `normal mode`, `full sentences`, or equivalent;
  - no silent drift back to verbose mode;
  - deactivation acknowledgement: `Normal mode.` and default communication style.
- Assert eval metadata coverage:
  - normal activation/debugging in compressed mode;
  - destructive-operation safety valve;
  - deployment/multi-step clarity safety valve;
  - direct deactivation request;
  - pressure case requiring all code/warnings/decisions survive compression.


## Concrete eval additions

Add exactly two eval entries, numbered 4 and 5:

```json
{
  "id": 4,
  "prompt": "stop caveman — normal mode please",
  "expected_output": "A brief deactivation acknowledgement followed by default communication style for subsequent replies.",
  "expectations": [
    "Acknowledges deactivation briefly with the exact style of wording `Normal mode.`",
    "Stops using caveman compression after the deactivation request",
    "Treats `stop caveman`, `normal mode`, and `full sentences` as explicit deactivation phrases",
    "Does not continue caveman mode after the user asks for normal mode"
  ]
}
```

```json
{
  "id": 5,
  "prompt": "caveman mode: compress this answer, but keep the code block, warning, and decision point intact",
  "expected_output": "A compressed response that preserves all code, technical warnings, and decisions instead of deleting them for brevity.",
  "expectations": [
    "Keeps code intact instead of omitting or rewriting it for compression",
    "Preserves technical warnings and decision points despite caveman mode",
    "Strips filler, pleasantries, hedging, and recap prose only",
    "Uses fuller language when compression could hide a warning or make instructions ambiguous"
  ]
}
```

Eval 3 remains the multi-step clarity safety-valve case. Eval 4 is a pure deactivation scenario so deactivation is not only indirectly asserted inside eval 3. For `or equivalent`, the deterministic spec pins the three explicit phrases listed in SKILL.md (`stop caveman`, `normal mode`, `full sentences`) and leaves semantic equivalents as prose guidance rather than trying to enumerate every synonym.

## Concrete test assertions

The spec will use the same helper names as neighboring specs: `requireTerms`, `expectationText`, `scenarioText`, and `evalMatching`.

Core SKILL.md assertions will pin these exact strings or regexes:

```typescript
requireTerms(skillText, [
  "Ultra-compressed communication mode. Cuts filler, articles, pleasantries.",
  "Preserves full technical accuracy. ~75% token reduction. Stays active until",
  '"stop caveman" or "normal mode". Use for long sessions or when brevity matters.',
  "Strip: articles, filler phrases, pleasantries, hedging, summaries of what you just did.",
  "Keep: technical accuracy, all decisions, all warnings, all code.",
  "Pattern: `[thing] [action] [reason]. [next step].`",
  "Bad: \"I've gone ahead and updated the configuration file to use the new endpoint URL, which should resolve the connectivity issue you were seeing.\"",
  "Good: \"Config updated → new endpoint. Fixes connectivity.\"",
  "Automatically revert to full language for:",
  "Security warnings",
  "Irreversible operations (delete, reset, force-push)",
  "Multi-step sequences where fragment order could cause misread",
  "Any time the user explicitly asks for clarification",
  "After the warning or instruction, return to caveman.",
  "Caveman mode persists across all turns until the user says:",
  '"stop caveman"',
  '"normal mode"',
  '"full sentences"',
  "Do not drift back to verbose mode without explicit instruction.",
  "When the user says \"stop caveman\" or \"normal mode\": acknowledge briefly (\"Normal mode.\") and return to default communication style.",
]);
```

Eval coverage assertions will use these scenario lookups:

```typescript
evalMatching(/turn on caveman mode|debug this issue/i);
evalMatching(/delete the old database backup|irreversible/i);
evalMatching(/deployment sequence|multi-step/i);
evalMatching(/stop caveman|normal mode please/i);
evalMatching(/code block|warning|decision point/i);
```

Each scenario assertion will check at least four expectations covering activation/persistence, destructive safety warnings, multi-step clarity, pure deactivation, and code/warning/decision preservation.

## Scope out

- Do not change `caveman` runtime behavior; this skill has no deterministic helper script.
- Do not run live agent evals in this slice.
- Do not rewrite the skill prose unless the tests reveal a real missing contract.
- Do not extract shared test helpers; existing scout tasks track shared #2134 helper/documentation work.

## Implementation steps

1. Add `src/skills/caveman-contract.test.ts` with local helper functions matching neighboring #2134 specs.
2. Pin SKILL.md trigger scope, compression rules, examples, auto-suspend cases, persistence rules, and deactivation behavior.
3. Extend `skill-plugins/dev/caveman/evals/evals.json` from 3 to 5 scenarios by adding direct-deactivation and preserve-code/warnings/decisions pressure cases.
4. Ensure each eval has a unique ID, non-empty prompt/output, and at least four concrete expectations.
5. Remove the completed task block from `TASKS.md`, update the helper-extraction scout task from eleven to twelve contract specs, and enrich an existing scout task if implementation reveals a reusable gap.
6. Run focused and full verification:
   - `npx vitest run src/skills/caveman-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`

## Risks and mitigations

- **Over-compression drift**: Pin the explicit keep-list for technical accuracy, decisions, warnings, and code.
- **Safety-warning drift**: Pin every auto-suspend case and the requirement to use fuller language when compression could cause harm or misread ordering.
- **Persistence drift**: Pin both stay-active behavior and explicit stop phrases.
- **Deactivation drift**: Add a direct deactivation pressure eval, not just an indirect expectation inside another scenario.
- **Brittle prose locks**: Use exact strings for fixed headings/examples and regexes for eval scenario lookup.

## Acceptance criteria

- New deterministic spec reads `skill-plugins/dev/caveman/SKILL.md` and `skill-plugins/dev/caveman/evals/evals.json`.
- The spec pins trigger scope, compression rules, keep-list, output pattern, examples, auto-suspend safety valve, return-to-caveman behavior, persistence, no-drift rule, and deactivation acknowledgement.
- Evals cover normal activation, destructive safety warning, multi-step clarity, direct deactivation, and preserve-code/warnings/decisions pressure.
- `npx vitest run src/skills/caveman-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`; the shared-helper scout task records twelve skill specs.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — internal deterministic regression coverage for an agentbrew-owned style-control skill.

## Reviewer verdict

Approved after revision. Reviewer confirmed the plan now includes exact eval JSON for IDs 4 and 5, concrete `requireTerms()` and `evalMatching()` assertions, a clarified eval 3 vs eval 4 boundary, and deterministic handling for the documented deactivation phrases while leaving semantic equivalents as prose guidance. No blocking issues remain.
