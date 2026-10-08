## Phase 0 — Live UX Walkthrough (run the project, open in browser)

Before reading any code, **run the project and experience it as a user**. This surfaces UX/UI signals that are invisible in the source.

### 0.1 Start the Project

Detect and run the dev server:
- Look for `dev`, `start`, `serve` scripts in `package.json` → run with `npm run dev` / `yarn dev` / `pnpm dev`
- Look for `Makefile` targets → `make dev` / `make serve`
- Look for `main.py`, `app.py`, `server.py` → `python -m uvicorn …` or `python app.py`
- Look for `Cargo.toml` → `cargo run`
- Note the local URL printed in the output (typically `http://localhost:3000` or similar)

If the project can't be started (backend-only, CLI-only, library), skip to Phase 1 and note "no UI to walk through" in your findings.

### 0.2 Walk Through the UI With the Browser

Use the `agent-browser` skill to open the running app and interact with it:

1. **Open the root URL** — take a screenshot. Note: first impression, visual hierarchy, empty states.
2. **Navigate every page** — don't sample; visit every route/screen reachable from the nav, sidebar, and footer. Take a screenshot of each.
3. **Navigate the primary user flows** — complete 3-5 end-to-end flows a real user would perform. Click every significant button and link.
4. **Interact with forms and inputs** — fill fields, trigger validation, submit forms. Note: error messages, loading states, feedback quality.
5. **Check edge cases in the UI** — empty data states, long content, error states if triggerable.
6. **Resize to mobile width** (375px) — note: layout breakage, overflow, unreadable text.
7. **Verify help text and docs in the UI** — tooltips, info modals, onboarding guides, setup wizards. Do they match actual behavior?
8. **Check rendered documentation pages** — if the project serves docs (Storybook, API docs, help pages), open every page, verify content is current.

### 0.3 Capture UX/UI Signals

For each issue found, record:
- **What**: the specific problem (e.g. "no loading indicator on form submit", "empty state shows raw JSON")
- **Where**: URL path + element description
- **Severity**: critical (broken, data loss) / major (confusing, user will fail) / minor (polish)
- **Screenshot**: take one per significant issue

These signals feed into Phase 2 strategic questions and Phase 3 analysis.

---

## Phase 1 — Silent Scan (code-only, no user input needed)

Gather structural signals from the codebase before asking the user anything. This makes your questions sharper.

### 1.1 Project Identity

**First, run `git-diagnose-codebase`.** Five `git log` commands plus the churn × bug-keyword cross-reference give you bus factor, velocity trend, firefighting frequency, and the highest-risk files in 5 minutes — without opening any source. The velocity-over-time and firefighting outputs sharpen the strategic questions you'll ask in Phase 2 (acceleration vs decline → "is this still actively developed?"; firefighting > 12/year → "is the team in stabilization mode?"). The cross-reference (top 5 churn ∩ top 20 bug clusters) is also the seed list for §1.3 Complexity Hotspots — same files, less repeated git work.

If `git-diagnose-codebase` is unavailable, run its commands inline (see [`piechowski.io`](https://piechowski.io/post/git-commands-before-reading-code/) for the recipe).

Read these files (skip those that don't exist):
- `README.md`, `AGENTS.md` — stated purpose and scope
- `docs/VISION.md` — project direction, decision framework, what we're NOT building
- `TASKS.md` — what's planned, what's stalled
- `CHANGELOG.md` or `git log --oneline -50` — recent trajectory (redundant with `git-diagnose-codebase` step 4 above; skip when its output is fresh)
- `package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` — identity and deps

**Also find and read all secondary docs:**
```bash
fd -e md -e mdx --no-ignore | grep -iE "vision|competition|story|guide|rfc|design|roadmap"
fd -t d user-stories docs/user-stories
```

Read every user story, RFC, and design doc. Build a map of:
- Stated goals vs implemented features (alignment score)
- User stories with no implementation (aspirational)
- Implemented features with no user story (undocumented)
- Competition claims that need verification

Record: **What does this project claim to be?**

### 1.2 Architecture Shape

Map the high-level structure:
- **Module boundaries** — list top-level directories and their responsibilities
- **Dependency graph** — which modules import from which? Are there circular dependencies?
- **Entry points** — how many ways in? (CLI, API, web, worker, cron)
- **Data flow** — where does data enter, how does it transform, where does it persist?
- **State management** — where does state live? (files, DB, in-memory, external service)

Record: **Draw the architecture in your head. What shape is it? Monolith, layered, microservices, pipeline, plugin system?**

### 1.3 Complexity Hotspots

The churn list from §1.1's `git-diagnose-codebase` covers the first analysis below — reuse it, don't re-run. The other two analyses are strategic-review-specific:

```bash
# Largest files (complexity magnets)
fd -e ts -e py -e go -e rs | xargs wc -l | sort -rn | head -20

# Files with most contributors (coordination cost)
for f in $(git log --since="6 months ago" --name-only --pretty=format: | sort -u | head -30); do
  echo "$(git log --since='6 months ago' --pretty=format:'%ae' -- "$f" | sort -u | wc -l | tr -d ' ') $f"
done | sort -rn | head -15
```

Cross-reference: files that appear in the churn × bug-cluster intersection AND the largest-files list AND the most-contributors list are the **highest-coordination-cost code in the repo**. Those are the strategic risks worth highlighting in Phase 3.

Record: **Where is complexity concentrating? Is it where it should be?**

### 1.4 Growth Trajectory

The velocity-over-time and firefighting outputs from §1.1's `git-diagnose-codebase` answer the bulk of this — reuse them. Add only the PR-size trend (which the standalone diagnostic skill doesn't cover):

```bash
# Average PR/commit size trend (are changes getting harder?)
git log --oneline --shortstat -20 | grep "files changed"
```

Read `git-diagnose-codebase`'s velocity table alongside this output:
- Velocity climbing + commit size shrinking → healthy refactor cadence
- Velocity flat + commit size growing → changes getting harder, refactor needed
- Velocity declining + commit size growing → team is firefighting, not building

Record: **Is the codebase getting easier or harder to change?**

### 1.5 Architecture Smell Detection

Look for these patterns:

- **God modules** — one directory/file that everything depends on
- **Shotgun surgery** — a single logical change requires touching many unrelated modules (rough guide: over 5)
- **Feature envy** — module A constantly reaching into module B's internals
- **Abstraction inversion** — high-level modules implementing low-level details, or low-level modules making policy decisions
- **Config explosion** — growing config/options that paper over architectural decisions
- **Adapter proliferation** — many thin wrappers suggesting the core abstraction doesn't fit
- **Test mocking depth** — tests that require 3+ levels of mocking suggest tight coupling

Record: **Which smells are present? How severe?**

### 1.6 Data Model Fitness

- Does the data model match the domain? Or are there lots of mapping/transformation layers?
- Are there denormalization patterns that suggest the schema doesn't fit the queries?
- Is there schema evolution (migrations, version fields) that suggests the model is being stretched?
- Are there parallel data structures (same concept modeled differently in different places)?

Record: **Is the data model helping or fighting the product?**

### 1.7 Code-vs-Vision Alignment

If `docs/VISION.md` or README states goals:
- **Which goals have working code behind them?**
- **Which goals have no code at all?** (aspirational)
- **Which code has no goal?** (legacy, abandoned features, scope creep)
- **Where is engineering effort concentrated vs where the vision says it should be?**

Record: **Alignment score: tight / drifting / disconnected**

### 1.8 Documentation Coverage Audit

Evaluate whether the project's documentation can sustain adoption and onboarding:

- **User stories**: read every story in `docs/user-stories/`. For each, verify there's working code. Produce a coverage table (story → status: implemented / partial / missing).
- **README completeness**: does the README cover install, quickstart, all commands, configuration, troubleshooting? Compare against what the code actually supports.
- **AGENTS.md freshness**: does the repo layout match reality? Are file descriptions accurate? Sample 10 and verify.
- **Competition docs**: if `docs/COMPETITION.md` exists, are competitor comparisons accurate and dated?
- **Missing docs**: are there complex subsystems with zero documentation? Flag any directory with more than a handful of source files (rough guide: over 5) and no README or doc reference.
- **Rendered docs**: if the project serves docs (dashboard, Storybook, API docs), open every page with `agent-browser` and verify content is current.

Record: **Documentation coverage: comprehensive / adequate / gaps / critically missing**

## Phase 2 — Strategic Questions (interactive)

Based on Phase 1 signals, ask the user **5-8 targeted questions**. Don't ask generic questions — use what you found to make them specific.

### Question Framework

Always ask these core questions, tailored to what you found:

1. **Direction** — "The codebase suggests [X] is the core value. Is that still where you want to invest, or is the direction shifting?"

2. **Architecture pain** — "I see [specific signal — e.g., high churn in module X, god module Y, adapter proliferation around Z]. Is this felt pain that's slowing you down, or manageable complexity?"

3. **Scale horizon** — "What does the next 6-12 months look like? More features on the current architecture, or a fundamentally different scale/scope?"

4. **Build/buy regrets** — "Are there subsystems you wish you hadn't built custom? Or external dependencies you wish you owned?"

5. **Team and constraints** — "What are your biggest constraints right now — team size, time, technical debt, unclear direction, or something else?"

6. **UX fitness** — If Phase 0 found issues: "Walking through the app I noticed [specific UX issues — e.g., no loading states, broken mobile layout, confusing empty states]. Are these known? Is UX quality a strategic priority, or is it intentionally deferred?"

Then add **2-3 signal-specific questions** based on what Phase 1 revealed. Examples:

- If you found code with no vision alignment: "I see [module] which doesn't map to any stated goal. Is this actively used, or a candidate for removal?"
- If you found high churn in one area: "[Module] has changed N times in 6 months with K contributors. Is this a feature area under active development, or a sign of instability?"
- If you found multiple entry points: "The project has [N] entry points (CLI, API, web). Are all of these strategic, or should some be deprecated?"
- If you found config explosion: "There are [N] configuration options. Is this intentional flexibility, or are config flags masking architectural decisions that should be made?"

**Format**: Present all questions at once in a numbered list. Wait for answers before proceeding.

## Phase 3 — Strategic Analysis

Combine Phase 1 signals with Phase 2 answers to produce a structured analysis document.

### Output: `docs/VISION.md`

(Or print inline if the user prefers — ask.)

```markdown
# Vision — [Project Name]

> Reviewed: [date] | Reviewer: AI Strategic Review | Codebase: [commit hash]

## Executive Summary

[3-5 sentences. What is this project, where is it, and what are the 2-3 biggest strategic decisions it faces?]

## UX Assessment

[Include only if Phase 0 produced findings. Skip if project has no UI.]

| Screen / Flow | Issue | Severity | Screenshot |
|---------------|-------|----------|-----------|
| [path or description] | [what's wrong] | critical / major / minor | [attached] |

[Commentary: Is UX quality a strategic liability? Which flows need investment?]

## Architecture Assessment

### Current Shape
[Describe the architecture as-is. What pattern does it follow? Where does it deviate?]

### Fitness Score
| Dimension | Score | Signal |
|-----------|-------|--------|
| Modularity | 🟢/🟡/🔴 | [evidence] |
| Data model fit | 🟢/🟡/🔴 | [evidence] |
| Scalability headroom | 🟢/🟡/🔴 | [evidence] |
| Change velocity | 🟢/🟡/🔴 | [evidence from churn analysis] |
| Code-vision alignment | 🟢/🟡/🔴 | [evidence] |

### Architecture Smells
[List detected smells with severity and specific file/module references]

## Complexity Hotspot Map

| File/Module | Churn (6mo) | Size | Contributors | Verdict |
|-------------|-------------|------|--------------|---------|
| ... | ... | ... | ... | Healthy / Needs attention / Restructure |

[Commentary: is complexity where it should be?]

## Pivot Signals

Patterns in the codebase that suggest the project may be outgrowing its assumptions:

- **[Signal]** — [evidence from code] + [user context]. Severity: [high/medium/low]
- ...
