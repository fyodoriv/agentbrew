---
name: writing-plans
description: Use when asked to create or revise a non-trivial implementation, architecture, integration, migration, or cross-repository plan before coding.
---

# Writing plans

## Outcome

Produce an evidence-backed implementation plan that lets a new engineer execute
the work without rediscovering the problem, inventing an interface, or hiding
dependencies in prose. A plan request authorizes planning only; do not implement
product code unless the user explicitly asks to build it.

Use this skill for multi-step work. A single-file, obvious fix can skip the
full format. For initiative-scale work with a docs hub, Jira, or multiple
repositories, also read `task-command-center` and its implementation-plan
template.

## Before writing

1. Read the repository instructions, vision, task or product source, and the
   relevant code/configuration/API paths.
2. Separate evidence from inference. Do not assume a host field, route, Redux
   slice, or similarly named config is authoritative.
3. Identify required data, its authoritative source, the current delivery
   path, owner, and security classification.
4. Compare material alternatives before selecting an approach. If a decision
   needs a product, security, or platform owner, record it as unresolved rather
   than silently choosing.

## Required plan shape

Use this sequence unless the repository owns a stricter template:

```markdown
# <Feature> implementation plan

## Overall goal and vision
<User outcome, why now, current constraint or failure, durable capability.>

## Decision and alternatives
<Selected approach, material alternatives, and evidence-based tradeoffs.>

## Evidence and current state
| Claim | Current source of truth | Delivery path | Status |
| --- | --- | --- | --- |
| <claim> | <file/API/config/product source> | <runtime path> | fact \| proposed \| verify |

## Scope
<In and out of scope, reuse candidates, assumptions, and open decisions.>

## Boundary contracts (when applicable)
<Owner, authority, transport, schema/version, validation, update/reset, retry UX.>

## Numbered work breakdown
### 1. <Deliverable>
- **Why:** <risk removed or capability enabled>
- **Parallelism:** <parallel with N | depends on N>
- **Owner / boundary:** <team, repository, or API boundary>
- **Change:** <specific files, interface, and behavior>
- **Evidence / acceptance:** <falsifiable result>
- **Verification:** `<exact command or observable check>`

## Rollout, security, and regression coverage
<Merge order, authorization/origin/data handling, unit/contract/integration/e2e checks.>
```

Use the literal status vocabulary `fact | proposed | verify`. Facts name their
source; proposals name an owner and the evidence needed to accept or reject
them. Cite exact paths, APIs, commands, and known call sites once they are
verified. Do not fabricate line numbers, endpoint behavior, or test commands.

## Task quality bar

Numbered work is the plan's execution contract. Each task must be independently
reviewable and include:

- **Why:** the user outcome, risk, or capability it addresses;
- **Parallelism:** an explicit prerequisite or concurrent lane;
- **Owner / boundary:** the responsible repository, team, or system edge;
- **Change:** the smallest concrete deliverable, including affected files and
  interfaces where evidence supports them;
- **Evidence / acceptance:** a behavior a reviewer can falsify; and
- **Verification:** the exact test, typecheck, lint, contract check, or
  observable runtime result.

Break work at reviewable boundaries, not arbitrary technical layers. Name
shared contracts before their producers and consumers. Include docs, migration,
observability, and rollback work in the task that requires it rather than
creating vague cleanup tasks.

## Host and embedded-surface contracts

For host-to-embedded-surface, API, or shared-state work, define the boundary
before proposing component or store changes. State which system owns each datum,
where it originates, how it travels, how the consumer validates it, and what
happens when it becomes stale.

Use a versioned `HostBootstrapPayload` when a host provides initial or live
context to an embedded surface. Define:

- schema version and stable identifiers;
- host/record context and a capability or authorization snapshot;
- transport and allowed origin(s);
- schema and origin validation before use;
- correlation ID plus sequence/version behavior for duplicate or stale updates;
- record-change reset, refresh, error, retry, and degraded UX;
- sensitive-data minimization and authorization enforcement; and
- the distinction between Redux store ownership and domain-state provenance.

Do not treat access to a shared store as authority to consume private host
slices. When the provider can inherit through a sandbox extension or scoped
context, describe that resolution path and hydrate through named actions rather
than assuming `preloadedState` applies; treat an explicit store-prop path as a
separate contract to prove. Do not use unbounded URL state as a substitute for
a validated contract.

## Completion review

Before handing off a plan, verify that it:

1. begins with the overall goal and vision rather than files or frameworks;
2. includes a decision with alternatives and a fact/proposal evidence ledger;
3. defines every cross-system boundary before implementation tasks;
4. makes task dependencies and parallel lanes explicit;
5. contains concrete acceptance evidence and exact verification for every task;
6. ends with rollout order, security, regression coverage, and open decisions;
   and
7. does not claim implementation, deployment, or test results that have not
   happened.

