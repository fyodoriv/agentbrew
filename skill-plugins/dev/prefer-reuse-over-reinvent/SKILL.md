---
name: prefer-reuse-over-reinvent
description: >
  Apply the "GET, don't IMPLEMENT" decision discipline before writing any new
  tool, script, lint, or workflow. Use whenever you're about to start a new
  feature, a new CI script, a new sync engine, a new catalog, a new abstraction,
  or any code that smells like it might already exist upstream. Also use when
  reviewing a task description that starts with "implement X" — the right
  question is "how do I GET this outcome?" not "how do I implement this in
  our tool?" Don't use for purely local fixes that are clearly bespoke to the
  current project (e.g. a typo in this repo's README) — only meaningful when
  a new capability / dependency / pattern is being added.
---

## When to invoke

**Yes:** about to add a new tool, script, workflow, catalog, abstraction, or capability;
reviewing a task that says "implement X"; choosing between GET/WRAP/CONTRIBUTE/ABSORB.

**No:** purely local one-line fixes (typo in README); implementing an already-approved ABSORB
step with written evidence; routine bugfix in existing code paths.

## Scope

This skill applies **reuse-first decision discipline** before new code lands. It searches
upstream tools, prefers install/call/shell-out, wraps with thin adapters, contributes gaps,
and absorbs only with evidence. It does not implement features or open PRs itself.

## Execution and verification safety

Do not recommend custom implementations without documenting why GET/WRAP/CONTRIBUTE failed.
Every ABSORB path needs an adapter boundary and a paired Replace?/Relocate? follow-up task.
Do not frame tasks as "implement X" without the GET evidence table. Do not add just-in-case
fallbacks that preserve duplicate native implementations.


## The principle

When you discover a new pattern, tool, library, idiom, or workflow, the first question is **"How do I GET this outcome?"** — not **"How do I implement this in our tool?"**

These produce very different answers:

| "How do I IMPLEMENT this?" | "How do I GET this outcome?" |
|---|---|
| Leads to weeks of code that ages out of sync with upstream | Leads to a 1-day integration with a pre-existing tool |
| Owns the maintenance burden forever | Inherits upstream improvements automatically |
| Drifts from the broader ecosystem | Stays interoperable as the ecosystem evolves |
| Optimizes for "we control it" | Optimizes for "it works and keeps working" |

**The wrong question makes you the implementer. The right question makes you the integrator.**

## The decision order

Always start at step 1. Only descend when the current step is genuinely blocked, with a written reason.

### 1. GET it

Install / call / shell out to the existing tool. If a thin adapter (≤20 lines) makes it fit, **stop here**. Most cases stop at this step.

- `npm install <thing>` and call its CLI
- `pnpm install <thing>` and import its lib
- Shell out via `child_process` to a binary that's already on the box
- `git submodule` or `vendor/` the upstream if it doesn't ship a package

### 2. WRAP it

If the upstream surface is close but doesn't quite match your interface, write a small integration layer behind a typed interface (see Minsky's adapter pattern: `novel/adapters/<name>.ts` interface + `<name>.<vendor>.ts` impl + `selfTest()`). Stop here.

The adapter is the boundary between "your code's vocabulary" and "the upstream tool's API". It's where translations happen. It is NOT where reimplementation happens.

### 3. CONTRIBUTE

If upstream has a real gap, **file an issue / PR there instead of forking**. Engage existing community PRs rather than racing them.

Every contribution has a **90-day engagement window**. Silence counts as rejection — at day 91 you escalate to step 4 with the contribution attempt documented as evidence.

### 4. ABSORB

Only when steps 1–3 are genuinely blocked: build the small unique layer yourself. **Design it as an extractable OSS package from day one** — the project structure, README, license, and tests should support extraction without rewrites. The burden of proof is "why ISN'T this already in someone else's tool?" — not "why should I use someone else's tool?"

## Mandatory follow-up

Every new feature that reaches step 4 (ABSORB) ships with a paired **"Replace? Relocate?"** research task. The candidate hosts default to: the relevant upstream project, `agentbrew`, `dotfiles`, `tasks.md`. The follow-up task lives in `TASKS.md`, gets revisited quarterly, and either closes with "still bespoke because X" or executes the relocation.

## Concrete examples from this codebase family

These are real cases where the decision-order produced clear answers:

| Capability we needed | What we did | Step | Lesson |
|---|---|---|---|
| MCP server sync for `MCP_INTERSECTION_AGENTS` | Delegate to `mcpm.sh` | 1 (GET) | One subprocess call replaced per-client adapter implementations |
| Skill sync across every agent | Delegate to `npx skills` | 1 (GET) | Saved ~3K LOC of native sync code |
| Rules sync | Delegate to `block/ai-rules` | 1+2+3 (GET, then CONTRIBUTE) | Filed PR upstream for `--source-dir` flag we needed |
| MCP catalog hand-curation | Should pull from `registry.modelcontextprotocol.io` | 1 (GET) | The catalog IS the upstream registry; hand-curation is duplicate work |
| `check-rule-9` HDD lint | Reuse Minsky's `scripts/check-rule-9-tasksmd-fields.mjs` | 1 (GET) | Minsky has 12 working `check-rule-*.mjs` scripts; reusing them avoids 12 reimplementations |
| Autonomous Stop-hook loop | Point at `anthropics/claude-code/plugins/ralph-wiggum` | 1 (GET) | The canonical implementation is in the official Anthropic marketplace |
| Lifecycle hook gates (Think → Ship) | Point at `right-hooks` npm package | 1 (GET) | Don't reimplement what `npm install` solves |
| Cross-source skill-name dedup | Delegate to `companion-skill-curate` (reads `state.yaml::skillSourceDirs`) | 1 (GET) | A per-registry `scripts/audit-cross-source-skills.sh` that scans sibling repos by `~/apps/<name>` convention encodes a personal workspace layout and runs nowhere predictable; agentbrew is the only place that knows the canonical source list |

## Anti-pattern detection

Watch for these phrases when planning or reviewing tasks — they almost always indicate you're at step 4 (ABSORB) without checking steps 1–3:

- "We need our own X"
- "Let's implement a custom Y"
- "Build a small Z to handle this"
- "Write a script to do W"
- "Add a new module for V"

Before any of these become code, ask:

1. **Is there an existing tool that does this?** (Search: GitHub trending, HN threads, the relevant package registry, agentbrew catalog, Minsky's `scripts/`, the project's existing dependencies.)
2. **If yes, why is GET (step 1) not the answer?** Write the reason down.
3. **If no, did I look hard enough?** Search again with different terms. Ask: "what tool would the ecosystem build for this exact need if it existed?" — that's the search query.
4. **If still no, can I file a `**Replace? Relocate?:**` research task** and proceed with the smallest possible implementation under an adapter interface?

## When the answer is genuinely "build it"

The 5% of cases where IMPLEMENT is right share these properties:

- The need is **truly unique to this codebase** — nobody else's project would benefit
- The need is **at the team's permanent scope** — the residue per VISION.md § "Strategy: delegate → contribute → absorb"
- The implementation is **small** — a few hundred lines, not a framework
- The implementation **lives behind an adapter** — the rest of the codebase imports the interface, not the impl

If any of these are violated, you're probably at step 1, 2, or 3 in disguise.

## Cross-references

- `agentbrew/VISION.md` § "Strategy: delegate → contribute → absorb" — the original three-step strategy this skill operationalizes
- `agentbrew/templates/AGENTS.md` § "Bias toward reuse — GET, don't IMPLEMENT" — the shared rule synced to every agent's instruction file
- `minsky/vision.md` § 1 "Don't reinvent the wheel" — Minsky's iron-rule statement of the same principle
- `minsky/ARCHITECTURE.md` § "The adapter pattern" — the canonical pattern for step 2 (WRAP it)
- Sibling skill `competitor-spot-check` — searches `competitors/` for prior art on a proposed feature (operationalizes the search phase of step 1)
