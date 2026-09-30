# Code style — comment examples

Reference for `templates/rules/code-style.mdc`. Loaded on demand; not injected into every TS session.

## Comment adjacency

**Wrong** — comment describes the effect below, not the selector:

```ts
// Once per mount, log when the experiment service did not deliver the assignment...
const hasAssignment = useSelector(sel.hasAssignment);
const loggedRef = useRef(false);
useEffect(() => { ... });
```

**Right** — comment sits directly above the effect:

```ts
const hasAssignment = useSelector(sel.hasAssignment);
const loggedRef = useRef(false);

// Once per mount, log when the experiment service did not deliver the assignment...
useEffect(() => { ... });
```

## Comment brevity — cross-team import

**Wrong** — multi-line essay above an import:

```ts
// Top-level import (not via `scenesSelect`) so this module loads under
// cross-team specs that wholesale-replace `scenesSelect` with a narrow
// `{ getCurrentEngagement: vi.fn() }` mock — the wholesale replacement
// strips `scenesSelect.getCurrentEngagementType`, leaving an undefined
// input to `createSelector` and crashing module evaluation. ...
import { getCurrentEngagement } from "./scenes.js";
```

**Right** — one line + AGENTS.md pointer:

```ts
// Top-level (not `scenesSelect.X`) — cross-team specs wholesale-mock
// `scenesSelect`. See AGENTS.md § scenes-mock-contract.
import { getCurrentEngagement } from "./scenes.js";
```

## Test comment bloat (see also `testing.mdc`)

**Wrong** — PR #2095 tripwire pattern with redundant prose:

```ts
// Tripwire 1: an icon: "" fixture must trigger the Layer 1 assertion.
// If somebody weakens `expect(config.icon).not.toBe("")` to a tautology...
it.fails(
  'Layer 1 tripwire: a fixture with `icon: ""` must trigger the empty-string assertion',
  () => {
    const broken: ToolConfig = { icon: "", included: true };
    expect(broken.icon).not.toBe("");
  },
);
```

**Right** — name + assertion are enough:

```ts
it.fails("rejects empty icon string", () => {
  const broken: ToolConfig = { icon: "", included: true };
  expect(broken.icon).not.toBe("");
});
```
