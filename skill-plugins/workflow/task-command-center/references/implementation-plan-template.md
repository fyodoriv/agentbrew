# Cross-system implementation plan template

Use this reference after reading `writing-plans` for a command-center plan that
spans hosts, repositories, state boundaries, or a shared product document.
Keep product commitments in **Product contract (immutable)** and put this
implementation detail in **Engineering guidance (dynamic)**.

## 1. Overall goal and vision

Start with the operator-facing outcome, then explain the durable capability the
work enables. State why the work is needed now, the concrete failure or
constraint it addresses, and the success condition. Do not begin with files,
frameworks, or a proposed implementation.

## 2. Decision and alternatives

For each consequential design choice, record:

- the selected approach;
- the alternatives actually considered;
- why the selected approach is safer, more reusable, or less coupled; and
- what is explicitly not decided yet.

Do not present a proposal as current behavior. Label current facts and proposed
designs separately.

## 3. Evidence and current state

Create a source ledger before recommending changes:

| Claim | Current source of truth | How the data or behavior is provided | Status |
| --- | --- | --- | --- |
| <claim> | <file, API, config, or product source> | <runtime path> | fact \| proposed \| verify |

For any runtime assumption that cannot be proven from source, include a
bounded discovery task and identify the evidence it must collect. Do not infer
host context from a similarly named store, URL field, or widget prop.

## 4. Boundary contracts

Describe every boundary by its owner, transport, authoritative source, schema,
validation, and refresh behavior. A consumer can share a Redux instance with a
host without sharing valid domain context; distinguish **store ownership** from
**state provenance**.

### Host bootstrap payload pattern

When an embedded surface needs host-owned context, define a versioned
`HostBootstrapPayload` rather than reaching into host-specific state:

```text
HostBootstrapPayload v<N>
├── version
├── messageId / correlationId
├── recordKey and monotonic sequence
├── parentInstance { id, entity_type }
├── stable boot identifiers
├── access or capability snapshot
└── optional host snapshot / update fields
```

The payload is useful because it:

1. decouples the embedded surface from one host's Redux slices, routes, and
   component tree;
2. gives future hosts one explicit compatibility boundary instead of another
   adapter-specific data path;
3. supports safe schema evolution through `version`;
4. lets the receiver reject wrong-origin, stale, mismatched, or out-of-order
   updates; and
5. keeps stable identifiers separate from large, sensitive, or changing
   context.

Specify which fields travel in a stable URL, backend lookup, or
origin-validated message. For Redux, document the provider's actual
resolution order. When a sandbox extension or scoped context supplies the
store, hydrate through named actions after the provider resolves; do not assume
`preloadedState` can initialize that inherited-store path. Treat an explicit
store-prop path as a separate contract to prove. Define reset behavior for
record navigation and a visible failure/retry state.

## 5. Numbered work breakdown

List work as numbered tasks, not a prose checklist. Each task uses this shape:

```markdown
### 1. <deliverable>
- **Why:** <risk removed or capability enabled>
- **Parallelism:** <parallel with N/M | depends on N>
- **Owner / boundary:** <team or repository>
- **Change:** <smallest concrete deliverable>
- **Evidence / acceptance:** <falsifiable result>
- **Verification:** `<exact command or observable check>`
```

Group independent tasks into named parallel lanes. Make all integration gates
explicit: contract review before implementation, runtime discovery before
choosing a store path, and a real end-to-end host flow before declaring a
surface portable.

## 6. Rollout, security, and regression coverage

Include:

- ownership and merge/deployment order across repositories;
- authentication, authorization, origin, CSP, and sensitive-data handling;
- compatibility and rollback boundaries;
- unit, contract, integration, and end-to-end tests; and
- observability for bootstrap, validation, and refresh failures.

End with open decisions, their owners, and the evidence required to close each
one. A plan is ready for reviewer validation only when its tasks can be
executed without silently converting an open decision into an implementation
assumption.
