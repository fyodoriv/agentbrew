If the fatal-gap list has zero or one item, **stop writing the vision and tell
the user honestly**: the project may not need to exist. Dissolving into
upstream contributions is the right path.

### 4. Honest about user count

If the project has exactly one user (often the author, during pre-v1
development), **say so**. Breaking changes are free in that state. This unlocks
aggressive deletion without backwards-compat scaffolding. The discipline
reappears the day the user base grows past one — name that threshold.

## Scope

| This skill | Not this skill |
|---|---|
| Produces durable `docs/VISION.md` | One-time analysis document (use `strategic-review`) |
| Articulates per-competitor delegate/contribute/absorb verdicts | Code-level task generation (use `project-audit`) |
| Defines the permanent scope and the triggers that shrink it | Single-feature breakdown (use `plan`) |
| Works for new projects AND existing ones whose strategy shifted | PR-level review (use `review`) |
| Forces the 80%+ overlap test on every competitor | Pure architectural review of an in-house codebase |

## Phase 0 — Project identity

Before writing anything, establish what the project is. Read existing sources
(don't re-interview the user if the answers are already in the repo):

- `README.md`, `AGENTS.md`, existing `docs/VISION.md` if any
- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` — identity + deps
- `TASKS.md` if present — what the project already thinks it's doing

Then confirm or gather from the user (only ask what you couldn't extract):

1. **One-sentence problem**. What pain does this project solve for real users?
   Concrete pain, not marketing copy.
2. **One-paragraph solution**. What does the project do about that pain?
3. **One command or workflow**. What's the single thing a user types or runs?
4. **Primary user**. A specific person or role, not a persona. *"An X
   engineer at Y who does Z."*
5. **Current user count**. How many people use this today? If it's just the
   author, say so.
6. **Target state**. Is the project post-v1 with real external users, or
   pre-v1 with breaking-changes-are-free freedom?

Record these verbatim — they become the opening of the vision doc.

## Phase 1 — Market niche scan

Aggressively find every tool that overlaps with this project's scope. Skipping
this phase makes the vision a wish, not a decision framework.

### 1.1 Discover competitors

Search the ecosystem in at least three ways:

- **GitHub topic + keyword search**: what's the problem domain? Search
  `gh search repos "<keyword>"` or use the GitHub UI. Look at 50+ results.
- **Package ecosystem search**: npm / PyPI / crates.io / Homebrew for tools in
  the same category.
- **"Alternatives" links in existing tools**: many READMEs reference adjacent
  tools. Follow the graph.
- **Awesome lists**: `awesome-<domain>` repos enumerate competitors.

Target: **at least 15–30 candidates**. Go wide first, narrow in step 1.2.

### 1.2 Classify by overlap percentage

For each candidate, estimate what fraction of this project's scope it covers:

| Overlap | Classification | Action in vision doc |
|---|---|---|
| 80%+ | Direct competitor | Apply the 3-step test (§ 1.3). Explicit verdict required. |
| 30–79% | Partial overlap | Document as complementary or inspirational. May absorb design ideas. |
| < 30% | Adjacent / different layer | Note for context; no verdict required. |

Be honest. If something covers 85%, don't downgrade it because it's
uncomfortable. Covering 85% means this project is in that tool's territory,
full stop.

### 1.3 The 3-step test (direct competitors only)

For every 80%+ competitor, answer the three questions in order:

**Step 1 — Delegate?**

- Is upstream active (last commit < 30 days, responsive maintainers)?
- Same language ecosystem (runtime, platform, binary format)?
- Receptive to contributions (evidence from merged PRs, issue responses)?

If all three are yes: **verdict = Contribute → Delegate**. The project shells
out to upstream, shrinks native code, and files upstream PRs for the 20% gap.

**Step 2 — Contribute, if delegation is partially blocked**

If delegation isn't immediately viable but upstream is active:

- File an RFC issue upstream describing what's missing
- File a PR if the maintainers are responsive
- Set a **90-day engagement window**; silence past that = rejection

Verdict = **Contribute (pending upstream response)**.

**Step 3 — Keep separate, if blocked**

- Upstream explicitly rejected a contribution, or ignored it for 90+ days?
- Permanent scope-misalignment (e.g. upstream is rules-only, we need skills)?
- Ecosystem mismatch (e.g. upstream is Python, our users can't install Python)?
- Upstream is stagnant (no commits in 90+ days, unclear ownership)?

Verdict = **Keep separate** with a **specific, documented reason**. Vague
"complementary" is not a valid reason — the doc must name the blocker.

Record the verdicts in a table. This table goes directly into the vision doc
and/or `docs/COMPETITION.md` if the project has a separate competition doc.

### 1.4 Identify fatal gaps

After every direct competitor has a verdict, list everything in the project's
intended scope that **no upstream tool covers**. These fatal gaps are the
durable permanent scope — the reason the project exists.

Examples of real fatal gaps (from agentbrew's analysis):
- Multi-surface orchestration (no tool unifies skills + MCP + rules + commands)
- Organization-specific curation (no public tool serves internal needs)
- Ecosystem-mismatch glue (no tool bridges Node + Python + Go + Rust)
- Auto-repair / scheduling (no tool runs a daemon-based drift fix)
- Detect-and-register glue (no tool auto-configures on environment signals)

If the fatal-gap list has **zero or one item**, halt:

> *"The market niche scan found no durable gap. This project might not need
> to exist as a separate tool — the honest path is dissolving into upstream
> contributions. Do you want to continue writing a vision anyway, or
> reconsider the project's reason to exist?"*

Wait for the user to decide before proceeding.

## Phase 2 — Permanent vs temporary scope

Draw the line explicitly:

- **Permanent scope** = the fatal gaps from § 1.4. This is what the project
  owns regardless of what upstream does. Every line of code supporting
  permanent scope is defensible.
- **Temporary scope** = everything else. Every line outside permanent scope
  is a delegation candidate. When upstream catches up, these slices dissolve
  per the 3-step strategy.

The vision doc must name both. A reader looking at any feature must be able
to answer *"is this permanent or temporary scope?"* — if they can't, the line
isn't drawn clearly enough.

## Phase 3 — Assemble the vision doc

Produce `docs/VISION.md` with the following sections in order. Each has
non-negotiable content requirements.

### Required sections (in order)

1. **The Problem** — one paragraph. Concrete pain and who feels it. No
   marketing copy.
2. **The Solution** — one paragraph + one command. Must fit in a tweet-sized
   hook.
3. **Primary User** — actual person or role. Include the current user count
   if small.
4. **Today's user base: N** (optional but strongly encouraged if N is small) —
   if the user base is 1 or very few, say so explicitly. Explain that
   breaking changes are free until user count grows past a named threshold.
5. **Core Beliefs** — guiding principles. The **delegate → contribute → absorb**
   principle is always present. The "Curator, not host" principle (no
   content duplication) is common. Add project-specific beliefs.
6. **User Stories** — what users can do. Every feature must trace to a story;
   features with no story are deletion candidates.
7. **What We're Building** — capability table with shipped / in-progress
   status. Be specific about what works today.
8. **What We're NOT Building** — explicit non-scope. **Must include**:
   - "Absorbed features from competitors" — port-ins are forbidden unless
     upstream rejected the contribution upstream-first
   - "Backwards compatibility" — if user count is 1, state the suspension
     explicitly
   - Competitor categories that are complementary, not built-here
9. **Decision Framework** — numbered rules for accepting new features.
   Rule #1 is always: *"Does this fit the permanent scope, or is it a
   delegation candidate?"*
10. **Success Metrics** — measurable and honest. Always include: *"codebase
    shrinks over time,"* *"new contributor understands the niche in 5 minutes,"*
    *"every error message tells the user what to do next."*
11. **Permanent Scope** — the fatal-gap list from § 1.4 with one sentence per
    gap explaining why no upstream tool covers it.
12. **Competitor Verdicts** — summary table of the 3-step-test results from
    § 1.3. Link to `docs/COMPETITION.md` if detailed per-competitor analysis
    lives there.
13. **Current Positioning** (optional) — any time-boxed posture like
    *"we're X-first for now."* Must have a reversal path.
14. **Triggers for re-evaluation** — 4–8 concrete conditions that force
    reconsidering the strategy (see Phase 4).

### Optional sections

- **Reversal Path** — if Current Positioning is present, document exactly
  how to undo the posture. Mechanical, not a rewrite.
- **Moat** — strategic defensibility of the permanent scope.
- **Dissolution analysis** — if competitors are close, explicit analysis of
  when the project should retire.

### Style rules

- **Concise over comprehensive.** Every sentence earns its place. Target 200
  lines for a small project, 500 for a large one. A doc that would grow past ~500 lines for one project is
  probably trying to do two jobs.
- **Tables over prose** for comparison or enumeration.
- **Code or commands in examples** where behavior is described.
- **Specific numbers** — star counts, LOC, agent counts, not "many" or "large."
- **No marketing language**. "Revolutionary," "empowers," "seamlessly,"
  "best-in-class" — delete on sight.
- **Cross-references**. Link to `docs/COMPETITION.md`, `TASKS.md`, specific
  source files. Make the doc navigable.

## Phase 4 — Triggers for re-evaluation

The vision commits to a posture. It must also commit to reconsidering that
posture when specific signals fire.

Add a **"Triggers for re-evaluation"** section listing 4–8 concrete conditions.
Each trigger must be observable without a team meeting — the signal itself is
the trigger.

Examples (from agentbrew):

- An upstream competitor ships a feature that covers one of our fatal gaps
- A new competitor reaches 5K+ stars in our domain
- Our user base grows past 1 (reintroduce backwards-compat)
- Codebase grows past N LOC without commensurate user-story gains
- A language-ecosystem bridge tool emerges (removes an ecosystem-mismatch
  gap)
- An upstream PR we filed sits 90+ days without maintainer response
  (absorb back)

Pair the trigger list with a **quarterly re-evaluation cadence** — add a
recurring `quarterly-vision-pulse` task to `TASKS.md` that runs the triggers
and either accelerates dissolution or updates the vision.

## Phase 5 — TASKS.md alignment

The vision doc is useless without execution. For every `Contribute → Delegate`
and `Contribute (pending)` verdict in § 1.3, add a corresponding task to
`TASKS.md`:

| Verdict | Task priority | Task shape |
|---|---|---|
| Delegate | **P0** | *"Delegate \<slice\> to \<upstream\> — measure friction (1 hour on dev machine), then rip out the native implementation"* |
| Contribute (pending) | **P1–P2** | *"File RFC / PR for \<gap\> at \<upstream\>. 90-day engagement window."* |
| Keep separate (upstream stagnant) | N/A | Document the specific blocker in the vision; no active task |
| Keep separate (ecosystem mismatch) | N/A | Same — documented, no active task |

Add one **recurring P2 task** for the quarterly contribution pulse — checks
every open upstream contribution against the 90-day rule and absorbs what
silence has killed.

## Phase 6 — Handoff

After producing `docs/VISION.md`:

1. **Commit it separately**: `docs: write vision — \<one-line summary of
   the core insight\>` using conventional-commit style with ticket suffix if
   the repo convention requires one.
2. **Commit TASKS.md additions separately**: `chore(tasks): add delegation +
   contribution tasks flowing from vision`.
3. **Do NOT delete the vision doc.** Unlike `strategic-review`, this skill
   produces a durable artifact. The vision is the source of truth for
   every future feature decision.
4. **Offer a PR**: if the repo uses PR workflows, create a draft PR and hand
   it to the user. Otherwise leave the commits on the local branch and note
   the next step.

## Reference patterns that work

Study these before writing your own vision:

- [`agentbrew/docs/VISION.md`](../../docs/VISION.md) — reference implementation.
  Embodies all four doctrines: aggressive niche-finding, delegate-contribute-
  absorb (explicitly named as a Core Belief), permanent-scope list, single-
  user-reality section with breaking-changes-free posture, competitor
  verdicts, triggers for re-evaluation, reversal path.
- [`agentbrew/docs/competition/vercel-skills-cli-vs-agentbrew.md`](../../docs/competition/vercel-skills-cli-vs-agentbrew.md)
  — long-form per-competitor deep-dive that feeds into the summary verdict
  table in the vision doc. Pattern: vision = summary, competition folder =
  details.

## Constraints (Do NOT)

