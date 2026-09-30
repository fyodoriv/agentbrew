# Plan: Cover composition-patterns skill with #2134-style tests

## Goal

Add deterministic #2134-style contract coverage for `composition-patterns` so regressions in its React composition guidance fail before agents add boolean prop flags, overuse structural render props, couple UI to state implementations, prop-drill shared state, use React 19-only APIs in React 18 projects, or answer wrong-tool requests as if they were composition problems.

The contract spec will read the real `skill-plugins/dev/composition-patterns/SKILL.md` and `skill-plugins/dev/composition-patterns/evals/evals.json`, preserve existing eval scenarios, and add pressure coverage for wrong-tool routing plus React-version/escape-hatch boundaries.

## Why

`composition-patterns` is a high-leverage React design skill. Its dangerous failure modes are not syntax errors; they are architectural drift: adding one more boolean prop, making a monolithic parent with render slots, trapping state inside UI, or making UI components know whether state comes from Redux, RTK Query, or local hooks. Deterministic tests should pin the skill's boundaries and examples so future edits cannot quietly dilute the guidance.

## Scope (in)

- Add `src/skills/composition-patterns-contract.test.ts` using the established #2134 local helper pattern.
- Read the real SKILL.md and evals files from `skill-plugins/dev/composition-patterns/`.
- Pin frontmatter name, description, trigger scope, and wrong-tool routing.
- Pin the opening purpose: flexible, maintainable React components; avoid boolean prop proliferation by using compound components, lifting state, and composing internals.
- Pin `When to Apply` triggers: boolean prop refactors, reusable component libraries, flexible component APIs, component architecture reviews, compound components, and context providers.
- Pin priority categories: Component Architecture HIGH, State Management MEDIUM, Implementation Patterns MEDIUM.
- Pin rule 1.1: avoid boolean props such as `isThread`, `isEditing`, `isDMThread`; each boolean doubles possible states; use composition instead; variants are explicit and share internals without one monolithic parent.
- Pin rule 1.2: use compound components with shared context; subcomponents access shared state via context, not props; includes Provider/Frame/Input/Submit/Header/Footer shape and usage.
- Pin rule 2.1: provider is the only place that knows state management; UI consumes context interface and does not know whether state comes from `useState`, Redux, or RTK Query; same UI can work with different providers.
- Pin rule 2.2: context interfaces define `state`, `actions`, and `meta`; UI consumes the interface, not the implementation.
- Pin rule 2.3: lift state into provider components; siblings access shared state without prop drilling; components need shared provider boundary rather than visual nesting.
- Pin rule 3.1: create explicit component variants instead of one component with many modes.
- Pin rule 3.2: prefer `children` for structural composition; reserve render props only when parent needs to pass data back to child.
- Pin Constraints: no boolean props, no structural render props, no state-implementation coupling, no prop drilling, no React 19 APIs unless project targets React 19+.
- Pin attribution/compatibility note: adapted from `vercel-labs/agent-skills` and strips React 19 APIs in favour of `useContext()` and `forwardRef`.
- Preserve existing evals 1-6 with exact prompts and core expectations.
- Add eval 7 for wrong-tool routing pressure: performance optimization and IDS component usage should route to `react-best-practices` / `ids-web-development` unless there is a real component-architecture composition problem.
- Add eval 8 for React version / escape-hatch pressure: in React 18 or unspecified projects, avoid `use()` and ref-as-prop; use `useContext()` / `forwardRef`; do not ban render props when parent must pass item data back to a child.
- Remove the completed task from TASKS.md at ship time and update scout tasks from twenty-two to twenty-three specs with a composition-patterns pressure example.

## Scope (out)

- No SKILL.md prose changes unless the spec reveals a contradiction that must be fixed.
- No React source-code refactor in this repo.
- No new helper extraction; the existing P2 scout task remains the tracking item.
- No script-level tests; `skill-plugins/dev/composition-patterns/` contains only `SKILL.md` and `evals/evals.json`.
- No new dependency or React runtime test harness. This is a documentation/eval contract test for the skill artifact, not a component library implementation.

## Concrete eval additions

### Eval 7 — wrong-tool routing pressure

```json
{
  "id": 7,
  "prompt": "This React grid feels slow and uses IDS Table. Can composition-patterns optimize rendering and tell me the right IDS props?",
  "expected_output": "A scope correction that routes performance and IDS-library questions to the right skills while only applying composition guidance if there is an API-shape problem.",
  "expectations": [
    "Routes render performance optimization to `react-best-practices` rather than claiming composition is the performance tool",
    "Routes IDS component prop selection to `ids-web-development` rather than inventing IDS APIs",
    "Still checks whether the grid API has boolean prop proliferation, structural render props, prop drilling, or state coupling",
    "If composition guidance applies, focuses on component API shape and provider boundaries rather than memoization or virtualization",
    "Does not rewrite the component solely for performance without a composition smell"
  ]
}
```

### Eval 8 — React version and render-prop escape-hatch pressure

```json
{
  "id": 8,
  "prompt": "Our project is React 18. Please refactor this compound component with React 19 `use()` and ref-as-prop, and replace every render prop with children even when the parent passes item data to the child.",
  "expected_output": "A compatibility-safe composition recommendation that keeps React 18-friendly APIs and preserves render props when they are the correct data-passing boundary.",
  "expectations": [
    "Refuses React 19-only `use()` and ref-as-prop APIs unless the project targets React 19+",
    "Uses `useContext()` and `forwardRef` patterns for broader React compatibility",
    "Distinguishes structural render props from render props that pass data back to children",
    "Replaces structural slots with children but keeps render props for item/data callbacks when appropriate",
    "Avoids adding boolean mode props while proposing explicit variants or compound children"
  ]
}
```

## Deterministic assertion map

### Frontmatter, purpose, triggers, and wrong-tool boundaries

Pin:

- `name: composition-patterns`
- React composition patterns that scale: compound components, state lifting, context providers, dependency injection
- Use for boolean prop proliferation, flexible component libraries, and component architecture reviews
- Do not use for performance optimization (`react-best-practices`) or IDS component usage (`ids-web-development`)
- Opening purpose paragraph: flexible, maintainable React components; avoid boolean prop proliferation; humans and AI agents can work with codebases as they scale.

### Rule categories and component architecture

Pin:

- category table with Component Architecture HIGH, State Management MEDIUM, Implementation Patterns MEDIUM
- section 1.1 critical impact and explicit boolean prop examples
- `Each boolean doubles possible states`
- composition example with `Composer.Frame`, `Composer.Header`, `Composer.Input`, `Composer.Footer`, `Composer.Attachments`, `Composer.Formatting`, `Composer.Submit`
- variants `ChannelComposer`, `ThreadComposer`, and `EditComposer`
- statement that each variant is explicit and shares internals without one monolithic parent.

### Compound components and provider shape

Pin:

- use compound components with shared context
- subcomponents access shared state via context, not props
- `ComposerContext`, `ComposerProvider`, `ComposerFrame`, `ComposerInput`, `ComposerSubmit`
- `Composer = { Provider, Frame, Input, Submit, Header, Footer }`
- example usage under `<Composer.Provider state={state} actions={actions} meta={meta}>`.

### State management and dependency injection

Pin:

- provider component is the only place that knows how state is managed
- UI components consume context interface and do not know whether state comes from `useState`, Redux, or RTK Query
- same UI can work with local and global providers
- context interfaces define `state`, `actions`, `meta`
- UI consumes interface, not implementation
- lift state into provider components, avoid prop drilling, and let sibling components share state via provider boundary even when not visually nested.

### Implementation patterns and constraints

Pin:

- explicit variants over many modes
- prefer `children` for composition instead of `renderX` props
- render props are appropriate when parent needs to pass data back to child
- Constraints section: do not add boolean props, do not use render props for structural composition, do not couple UI to state implementation, do not prop-drill shared state, do not use React 19 APIs unless project targets React 19+
- adaptation note from `vercel-labs/agent-skills`, with React 19 APIs stripped in favour of `useContext()` and `forwardRef`.

### Eval preservation and metadata

Pin:

- `evals.skill_name === "composition-patterns"`
- length 8 after implementation and unique IDs
- evals 1-6 exact prompts and core expectations
- eval 7 wrong-tool routing pressure
- eval 8 React version / render-prop escape-hatch pressure
- every eval has non-empty prompt/expected output and at least four expectations/assertions.

## Falsifiability checks

- Red phase fails against the original 6-eval file because evals 7-8 are missing.
- Removing wrong-tool routing to `react-best-practices` or `ids-web-development` fails the spec.
- Removing the boolean-prop proliferation warning or explicit boolean examples fails the spec.
- Removing compound component/provider/context guidance fails the spec.
- Removing state/provider decoupling from `useState`, Redux, and RTK Query fails the spec.
- Removing `state` / `actions` / `meta` context shape fails the spec.
- Removing provider boundary / sibling state access / no prop-drilling guidance fails the spec.
- Removing explicit variants or children-over-structural-render-props guidance fails the spec.
- Removing render-prop escape hatch for parent-passes-data cases fails the spec.
- Removing React 19 compatibility constraint or `useContext()` / `forwardRef` adaptation note fails the spec.
- Removing pressure eval coverage for wrong-tool routing or React-version escape hatches fails the spec.

## Scout task updates

- `extract-shared-2134-skill-contract-test-helpers`: update from twenty-two to twenty-three deterministic specs and add `composition-patterns` after `competitor-spot-check`.
- `document-2134-pressure-eval-conventions`: add composition-patterns pressure examples covering wrong-tool routing, boolean-prop refusal, render-prop escape hatches, provider/state decoupling, no prop drilling, React-version compatibility, and no implementation-runtime tests for documentation-only skills.

## Implementation steps

1. Add the deterministic spec at `src/skills/composition-patterns-contract.test.ts`.
2. Red phase: run `npx vitest run src/skills/composition-patterns-contract.test.ts --reporter=verbose`; expect failure on missing evals 7-8 while SKILL.md assertions pass.
3. Add evals 7-8 to `skill-plugins/dev/composition-patterns/evals/evals.json`.
4. Update TASKS bookkeeping: remove the completed task and update the two scout tasks.
5. Run focused spec, CLI removed-command guard, `npm run skills:coverage`, and full `npm run verify`.
6. Commit, push, open PR with verification evidence and vision trace, and merge only after checks pass.

## Risks and mitigations

- **Over-locking examples**: pin durable concepts and representative code terms rather than every line of long examples.
- **Wrong-tool drift**: explicitly assert performance and IDS routing from frontmatter and eval pressure.
- **Overzealous render-prop ban**: preserve the documented escape hatch for data-passing render props.
- **React-version compatibility drift**: pin the React 19 constraint and adaptation note.
- **Scope creep into runtime refactors**: keep this to skill/eval artifacts because there is no repo-owned React component implementation for this task.
- **Helper duplication**: update the existing scout task rather than extracting the helper inside this PR.

## Acceptance criteria

- `src/skills/composition-patterns-contract.test.ts` exists and reads real skill/eval files.
- The spec pins frontmatter, triggers, wrong-tool boundaries, boolean-prop refusal, compound components, provider/context shape, state decoupling, dependency injection, explicit variants, children/render-prop rules, constraints, and compatibility note.
- Evals 1-6 are preserved and asserted.
- Evals 7-8 are added with concrete pressure expectations.
- Red phase fails on missing evals 7-8 and green phase passes after adding them.
- `npx vitest run src/skills/composition-patterns-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes before commit/PR.
- TASKS bookkeeping removes the completed task and updates scout task count/examples from twenty-two to twenty-three.

## Vision trace

- **Vision goal**: VISION.md G5 — Drift detection + auto-repair; this adds deterministic drift detection for a built-in skill artifact that agents rely on for React architecture guidance.
- **User story**: `docs/user-stories/18-lint-validate.md` / US 18 — validation catches broken agent artifacts and metadata before users rely on them.
- **Competitor prior art**: `docs/competition.md` tracks Vercel skills CLI / agent-skills as the delegated skills ecosystem; this PR tests an adapted built-in skill artifact rather than adding product-facing functionality.
