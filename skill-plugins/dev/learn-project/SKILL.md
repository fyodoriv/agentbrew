---
name: learn-project
description: >
  Single entrypoint that teaches you a software project (or any body of knowledge)
  end-to-end and then quizzes you. Gathers sources — local folders/repos, remote
  enterprise repos + PRs/issues (GitHub MCP), Google Docs incl. all tabs (Drive MCP),
  Jira issues/epics/initiatives (Jira MCP), loose local files (PDF/MD/…), and web
  pages — stages them into one grounded StudyVault, then drives /tutor-setup (teach)
  and /tutor (exam). Stage-aware: resumes wherever prep left off. Asks questions when
  inputs are missing. Use when the user says "tutor me", "teach me this project",
  "learn this project/repo", "study these repos/docs", "onboard me on X", or
  "quiz me on X". Don't use for a trivial single README (run /tutor-setup directly).
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch
---

# Learn Project — teach me, then quiz me

> **User guide:** [`docs/learn-project.md`](../../../docs/learn-project.md) — prerequisites, quick starts, pipeline, troubleshooting.

You are the single orchestrator. The user invokes you once ("tutor me on X"); you run
the whole pipeline: **ensure tools → detect stage → intake → gather sources → stage →
teach (/tutor-setup) → quiz (/tutor)**. Teaching and quiz logic live in the upstream
`tutor-setup` / `tutor` skills — you drive them, you do not reimplement them.

**Default staging root:** `./.learn-project/` in the current working directory (stable
and resumable). The StudyVault is generated under the staged `sources/` tree.

Copy this checklist and track progress:

```
- [ ] Phase 0: tutor-setup + tutor installed; MCPs checked
- [ ] Phase 1: detected current stage (fresh / staged / vault-exists)
- [ ] Phase 2: intake complete (sources + focus + depth) — asked only for what's missing
- [ ] Phase 3: sources gathered to staging inputs
- [ ] Phase 4: aggregator run → manifest.json
- [ ] Phase 5: /tutor-setup → StudyVault
- [ ] Phase 5a: Mermaid concept + architecture maps embedded in vault
- [ ] Phase 5b: concise learning brief presented (teach before testing)
- [ ] Phase 5c: verification gate passed (questions + claims grounded)
- [ ] Phase 6: /tutor session(s) — mastery-tracked, weakest-first, big-picture-first
```

## Phase 0 — Ensure prerequisites

1. Check the two upstream skills are installed (look for `~/.claude/skills/tutor-setup`
   and `~/.claude/skills/tutor`, or the current agent's skills dir).
2. If either is missing, install both, preferring agentbrew's native path (avoids the
   `npx skills` corporate-TLS failure):

   ```bash
   agentbrew install tutor-setup --from bevibing/tutor-skills
   agentbrew install tutor --from bevibing/tutor-skills
   ```

   If `agentbrew` is unavailable, fall back to `npx skills add bevibing/tutor-skills`.
   If both fail, tell the user exactly what to run and stop — do not fake the vault.
3. Note which source MCPs are available (you'll only need the ones the user's sources
   require): `user-github` (remote repos, PRs, issues), `user-google-drive-mcp`
   (Google Docs + tabs), `user-jira-mcp` (issues, epics, initiatives). Read a tool's
   JSON schema before calling it.

## Phase 1 — Detect the current stage (resume, don't restart)

Pick the staging root (default `./.learn-project/`). Then branch:

| Observed state | Start at |
|----------------|----------|
| A StudyVault already exists (e.g. `**/00-Dashboard/` or `StudyVault/`) | **Phase 6** — go straight to /tutor (re-run /tutor-setup only if `manifest.freshness.changed` is non-empty or sources were re-gathered) |
| `<root>/manifest.json` exists but no StudyVault | **Phase 5** — run /tutor-setup against `manifest.tutorSetupCwd` |
| Staging inputs gathered but no manifest | **Phase 4** — run the aggregator |
| Nothing staged yet | **Phase 2** — intake |

Always tell the user the detected stage and what you're about to do before doing it.
If the user explicitly says "start over", clear the staging root first.

## Phase 2 — Intake (ask only for what's missing)

Infer everything you can from the user's message and the current directory (e.g. if
they're inside a repo and say "teach me this project", the local repo is a source).
Then ask — concisely, batched — for anything still unknown across these six source
types. Never invent private repo names, Google Doc IDs, or Jira keys.

| Source type | What to ask / infer | Gathered via |
|-------------|---------------------|--------------|
| Local folder/repo | Path(s); default = current dir if it's a repo; may scan a parent like `~/apps` and pick repos matching the topic | copy |
| Remote enterprise repo | `owner/repo` or full git URL; branch if not default | git clone or GitHub MCP |
| PRs / issues | PR/issue URL, `owner/repo#123`, issue keys | GitHub MCP |
| Google Doc | Doc URL or file ID (**all tabs**, not just the open one) | Drive MCP |
| Jira issue/epic/initiative | Issue key or URL (e.g. `PROJ-123`); pull children for epics/initiatives | Jira MCP |
| Loose files | Paths to PDF/MD/TXT/HTML in or near cwd | copy |
| Web pages | URLs | WebFetch |

Also capture (with sensible defaults, don't over-ask):
- **Focus areas** — what they most want to understand (default: whole project).
- **Depth** — quick / standard / deep (default: standard).

If a required private source (enterprise repo, Doc ID, Jira key) is missing and cannot
be inferred, stage what you have, proceed, and list the missing items in your summary.

## Phase 3 — Gather sources into staging inputs

Fetch each source with the right tool and write it to a temp inputs area
(`<root>/inputs/…`). The deterministic aggregator does NOT call MCPs — you fetch
first, then hand it file paths.

- **Local folders/repos** → pass paths directly with `--local`. To pick from a
  directory of repos (e.g. `~/apps`), `ls` it, match names to the topic, and confirm
  the shortlist with the user before staging many large repos.
- **Remote repos** → either let the aggregator clone or pull key files via GitHub MCP
  `get_file_contents` into `inputs/repos/<name>/`. **Enterprise caveat:** an
  `owner/repo` shorthand resolves to **public github.com** — for `ghe.example.com`
  (or any enterprise host) pass the **full git URL** to `--repo`
  (`--repo https://ghe.example.com/owner/repo.git`), or fetch via GitHub MCP.
- **PRs/issues** → GitHub MCP (`get_pull_request`, `get_pull_request_files`,
  `get_pull_request_comments`, `get_issue`). When the PR *is* the document (e.g. a
  draft RFC), pull the changed files' **content**, not just metadata — the RFC markdown
  is the knowledge. Write a markdown summary (title, state, problem, decision, key
  files/diffs, links) to `inputs/context/<name>.md` → pass with `--context "<name>:<path>"`.
- **Google Docs (all tabs)** → resolve the ID from the URL, `list_document_tabs`, then
  `read_document` (or `export_document_as_md`) for **each tab** and concatenate under
  tab headings; never stage only the currently-open tab. Save to
  `inputs/docs/<title>.md` → pass with `--doc "<title>:<path>"`.
- **Jira** → `jira_search_issues` with `issueKeys:["KEY"]` for the item itself; for an
  **epic or initiative** also call with `parentKeys:["KEY"]` to pull child issues, and
  recurse one level for initiatives (initiative → epics → stories). Summarise
  hierarchy, status, and descriptions to `inputs/context/<key>.md` → pass with
  `--context "<key>:<path>"`.
- **Loose files** → pass with `--file "<label>:<path>"` (extension preserved; tutor-setup
  extracts PDFs itself).
- **Web pages** → WebFetch each URL, save the markdown to `inputs/web/<slug>.md` →
  pass with `--web "<url>:<path>"`.

If any MCP fails with a non-recoverable error, treat that source as unfetchable, skip
it, and note it in the summary. Never reconfigure or "repair" an MCP server. If a
source lands on SSO/login instead of content, follow the background-and-poll pattern
rather than idling — stage the reachable sources first and report the blocked one.

## Phase 4 — Run the aggregator (deterministic)

From an agentbrew checkout (the script lives there):

```bash
cd /path/to/agentbrew
npm run stage-learn-sources -- ./.learn-project \
  --local /path/to/current-repo \
  --repo https://ghe.example.com/owner/enterprise-repo.git \
  --doc "Design Doc:./.learn-project/inputs/docs/design-doc.md" \
  --file "Spec PDF:./.learn-project/inputs/files/spec.pdf" \
  --web "https://example.com/guide:./.learn-project/inputs/web/guide.md" \
  --context "PR-77:./.learn-project/inputs/context/pr-77.md" \
  --context "PROJ-123:./.learn-project/inputs/context/proj-123.md"
```

It writes `manifest.json` and:

```
.learn-project/
  manifest.json            # tutorSetupMode, tutorSetupCwd, source inventory
  sources/
    LEARN_PROJECT.md
    repos/<name>/          # clone or copy (node_modules/.git/dist excluded)
    docs/                  # exported Google Docs + harvested repo README/AGENTS/…
    files/                 # loose files, extension preserved
    web/                   # fetched web pages as markdown
    context/               # PR/issue/Jira summaries
```

Read `manifest.json` → note `tutorSetupMode`, `tutorSetupCwd`, and **`freshness`** (`changed` /
`unchanged` source keys with per-source `contentHash`). On re-run the aggregator compares
hashes to the previous manifest and **re-stages only changed sources**; unchanged inputs are
skipped. When `freshness.changed` is non-empty and a StudyVault already exists, treat vault
notes derived from those sources as **stale** and re-run /tutor-setup for the affected sections
only.

## Phase 5 — Teach (/tutor-setup)

`cd` to `manifest.tutorSetupCwd`, then invoke **tutor-setup**:

| tutorSetupMode | tutor-setup mode |
|----------------|------------------|
| `codebase` | Codebase Mode (single repo) |
| `document` | Document Mode (docs/files/web/context only) |
| `mixed` | Document Mode (harvested repo docs + docs/files/web/context all under `sources/`) |

Follow tutor-setup's verified source-mapping and self-review phases (D9/C9) — do not
skip the quality checklist. Weight coverage toward the user's stated focus areas.

### Grounding addendum (cite-or-refuse)

- Every factual claim in a note must cite a staged path (e.g.
  `sources/docs/repos/<name>/ARCHITECTURE.md`) or a doc section.
- If a claim cannot be traced to staged material, mark it `source: unverified` or omit it.
- Quiz questions must be answerable from vault notes that themselves cite staged sources.

This supplements tutor-setup's mapping; it does not replace the skill.

### Generate concept + architecture maps (Mermaid)

After /tutor-setup creates the StudyVault, emit **Mermaid** diagrams grounded in staged
material (cite-or-refuse — only nodes and edges traceable to vault notes or staged paths):

1. **Concept map per section** — one diagram per area folder: nodes = concept notes in that
   section; edges = `[[wikilinks]]` between notes or an explicit prerequisite order stated in
   the vault.
2. **Architecture diagram** (codebase or mixed runs) — major modules/components from staged
   repos + architecture notes; edges = dependencies or data flow described in staged docs.

Embed diagrams in `StudyVault/00-Dashboard/MOC.md` (overview linking sections) and each
section's index or lead note. Use fenced ` ```mermaid ` blocks. If a relationship cannot be
cited, omit the edge — never invent structure.

### Present a concise learning brief (teach before testing)

This skill is "teach me, **then** quiz me" — never quiz cold. After the vault exists and
**before** starting /tutor, present the user a **refined, concise learning brief** drawn from
the vault (not a raw dump):

- Lead with the **big picture** (the core idea / how it fits together), then the handful of
  concepts that matter most — distilled, in the user's own reading order, major-first.
- Keep it tight: short paragraphs, tables, and bullets over walls of text; cut restatement.
- **Ground every claim** in a staged source (cite-or-refuse); link to the vault note that
  covers each concept so the user can go deeper.
- End by confirming the user has read it / asking what to focus on — then move to the quiz.

The vault is the durable artifact; this brief is the fast on-ramp that makes the quiz fair.

### Verification gate (answer from vault only)

Cite-or-refuse is a guideline until you **check** it. After the vault exists and the learning
brief is presented, **before** starting /tutor, run a grounding verification pass
(Chain-of-Verification / RAGAS-faithfulness pattern):

1. **Question verification.** For each practice/diagnostic question in the vault, attempt to
   answer it using **only** the vault notes — not staged sources directly, not general knowledge.
   The correct answer must be uniquely supported. If the vault cannot answer it, **discard** the
   question and regenerate a meaning-based replacement grounded in notes that cite staged sources.
2. **Claim verification.** For each factual claim in vault notes, read the cited staged
   path/section. If the citation does not entail the claim, mark it `source: unverified` or omit
   the claim.
3. **Report and proceed.** Briefly note how many questions passed, how many were
   discarded/regenerated, and any claims flagged. Write or update
   `StudyVault/00-Dashboard/Verification Log.md` with the audit table (questions,
   claims, practice recall %). Do not start the quiz until every surviving question
   passes verification.

Generation-time self-check inside the question generator is upstream (`tutor`); this gate is
orchestration-layer QA agentbrew owns.

## Phase 6 — Quiz (/tutor)

Once a StudyVault exists, invoke **tutor**:

1. Start with a **Diagnostic**: big-picture concepts spanning every section, to seed each
   section's mastery %.
2. Then **adaptively drill**: keep pulling the next question from the lowest-known section
   (big-picture before detail) until sections reach mastery — see *Mastery tracking* below.
3. Offer **hard-mode** reinforcement once a section is green.
4. For **codebase** or **mixed** runs, add **applied / transfer tasks** once a section's
   concepts meet the mastery threshold — see below.

After every round, report the updated per-section mastery % and what remains; at the end,
point to the weak-area notes in the vault.

### Mastery tracking drives question selection (know what's left)

Treat the vault's tracker (Learning Dashboard + `concepts/*.md`) as **live state**: read it
before every question, update it after every answer. You must always know each section's
mastery and which concepts are still unanswered, and draw the next question from what the user
does **not** yet know.

- **Enumerate concepts per section.** Each area note lists its key concepts (from tutor-setup).
  A concept is **not known** when untested ⬜ or missed / "I don't know" 🔴. It is **in progress**
  🟡 after partial progress. It is **known** 🟢 only after meeting the mastery threshold below.
- **Mastery threshold before 🟢.** A single correct MCQ is recognition, not mastery. Flip 🟢 only
  after **two correct answers**, including at least one **applied/analysis** question (scenario,
  consequence, or "what if" — not pure recall). Record one recall-only correct as 🟡 until the
  threshold is met.
- **Within-session retention re-test.** After a concept first meets the threshold, **re-test it
  later in the same session** after intervening questions on other concepts (spacing effect). If
  the re-test fails, downgrade to 🔴, teach again, and do not count it toward section coverage.
  No cross-session scheduler — artifact-only within this vault.
- **Interleave mode.** Default: blocked weakest-first drilling. Once every section's
  big-picture concepts are past basics (🟢 or user opts in), switch to **interleaved** questions
  that mix sections — improves durable retention (desirable difficulties). Announce when switching.
- **Show a mastery % per section.** In the Learning Dashboard record, per section,
  `known % = mastered concepts / total concepts` (coverage, not just accuracy) plus the list of
  **remaining** (untested + missed) concepts. Recompute after each answer so the map stays
  current; a section reads 100% only when every one of its concepts is 🟢.
- **Select weakest-first, big-picture-first.** Draw the next question from the section with the
  lowest known %; within it, ask the most **fundamental, big-picture** not-known concept before
  any detail or edge case. Descend into a section's details only once its core concepts are
  known. Never re-ask a mastered concept while not-known ones remain, except in explicit
  hard-mode reinforcement.
- **Stop condition.** A section is done at 100% known (or when the user opts out); the session
  is done when every in-scope section is covered. Never spend questions on already-known areas
  while unknown areas remain.

### Applied / transfer tasks (do, don't just recall)

For **codebase** or **mixed** runs (staged repos under `sources/repos/`), the strongest test is
*applying* knowledge, not MCQs alone. After a section's concepts meet the mastery threshold,
assign **applied tasks** graded against the **staged repo** (cite-or-refuse — answers must point
to real staged file paths):

| Type | What you ask | Graded against |
|------|--------------|----------------|
| **locate-owner** | Which file/module owns X? | Staged paths under `sources/repos/` |
| **where-to-add** | Where would you add feature Y? | Repo structure + architecture notes |
| **trace-the-bug** | Trace this symptom to the responsible function | Staged code + vault notes |
| **blast-radius** | What breaks if Z changes? | Staged dependencies + docs |

Wrong answers → teach from vault notes + staged files; do not score until the user locates the
right path. Execution/grading inside the tutor engine is upstream; **task-type definitions and
when to assign them** stay in this skill.

### Quiz-quality addendum (test understanding, not trivia)

tutor drives the mechanics; this raises the question bar. Every question must:

- **Test meaning, not memorization.** Probe *why / how / what-follows* — consequences,
  trade-offs, and applying a concept to a scenario. Do **not** ask the user to recall a
  label, a name for a list ("what are the three X called"), or a spec/requirement ID
  (e.g. "what does B3.1 mandate"). IDs and exact names are addressing, not knowledge.
- **Be self-contained and unambiguous.** The question must be answerable without guessing
  what it means; define any term it leans on. No underspecified phrasing (e.g. "what does
  Increment 1 ship?" → "the RFC's first increment delivers agent-generated UI on the web app — what
  must the frontend team change?"). One correct option; distractors are plausible, not
  jokey.
- **Phrase it in clean, natural English.** Short, grammatical sentences; re-read each
  question and option as a careful reader would and fix any awkward or broken wording before
  presenting. A confusing sentence is a bad question even if the concept is good.
- **Order major-first.** Start the diagnostic with the big-picture, highest-importance
  concepts (the core idea/architecture), then progress to supporting details and edge cases —
  never a random or details-first order.
- **Randomize the correct option's position.** For each question, place the correct answer in
  a genuinely random slot. Never fall into a positional pattern (e.g. the correct answer is
  always the first option) — that lets the user pass by pattern-matching instead of knowing.
  Vary positions across the set and re-check the distribution before presenting.
- **Always offer "I don't know — teach me."** Every question includes an explicit
  *don't-know* choice so the user surfaces a blind spot instead of guessing. When they pick
  it, treat it as a not-known signal (not a wrong guess): teach the concept concisely and
  grounded, mark it for review in the tracker, and revisit it in a later drill.
- **Stay grounded.** The correct answer must trace to a staged source (cite-or-refuse); a
  question the vault can't answer is a bad question, not a hard one.

If the user says a question is bad (tests trivia, is unclear, or is badly worded), treat it
as a signal: discard it, regenerate a meaning-based, cleanly-worded version, and prefer
application/analysis over recall.

### Practice-file quality (tutor-setup output)

After /tutor-setup writes `* Practice.md` files, **audit and rewrite** before quizzing:

- **Cap list-recall at ~30%.** No more than ~30% of practice questions may be pure
  list/name/ID recall ("name the four X", "list the three Y"). Prefer application and
  analysis scenarios grounded in staged sources.
- **Rewrite bad patterns.** Replace "Name the four rendering modes" with Increment-1 scope
  scenarios; replace "List child epics" with outcome/ownership scenarios.
- **Short concept tracker labels.** In `concepts/*.md`, use canonical short names (link to
  notes for detail) — not full-sentence concept rows.
- **Keep MOC Weak Areas live.** After diagnostic, mirror the Learning Dashboard weakest
  sections in `00-Dashboard/MOC.md` §Weak Areas.
- **Rendering modes ≠ delivery ladder.** Add to Exam Traps when both appear in architecture
  notes; never use a rendering-mode distractor for a delivery-ladder question.
- **Quiz-fix loop.** After a critical quiz review surfaces gaps (wrong practice answers,
  recall-cap violations, ungrounded applied tasks), fix vault notes + practice files,
  re-run Phase 5c, update Verification Log, then re-quiz. Repeat until audit finds zero
  P0/P1 issues.
- **Split coarse concept trackers.** When a single tracker row spans many buckets (e.g.
  B5–B11), split into teachable units (B5–B9 vs B10–B11) so mastery % reflects real gaps.
- **Ground applied tasks.** For codebase/mixed runs, add a vault note citing staged
  `sources/repos/` paths for each applied-task prompt before assigning them.

## Constraints

- Do **not** modify `tutor-setup` / `tutor` content — orchestrate and stage only.
- Do **not** reconfigure MCP servers on failure — report unfetchable sources.
- Do **not** guess private repo names, Google Doc IDs, or Jira keys — ask or skip-and-report.
- Keep the staging root stable so re-invocations resume instead of restarting.
