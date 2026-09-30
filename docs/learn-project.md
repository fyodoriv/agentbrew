# Learn Project — user guide

**One command to learn anything:** gather sources → build a grounded StudyVault → teach → quiz.

The `learn-project` skill is agentbrew's orchestrator over upstream [`tutor-setup`](https://github.com/bevibing/tutor-skills) (teach) and [`tutor`](https://github.com/bevibing/tutor-skills) (quiz). You invoke it once; the agent runs the full pipeline and resumes where it left off.

**Skill source:** `skill-plugins/dev/learn-project/SKILL.md`  

---

## Who this is for

- Engineers onboarding to a repo, RFC, or multi-repo initiative
- Anyone studying a body of knowledge spread across docs, Jira, PRs, and code
- Teams who want **cite-or-refuse** tutoring — answers trace to staged sources, not model memory

**Not for:** a single README in one repo with no extra sources → run `/tutor-setup` directly instead.

---

## Prerequisites

### 1. Install agentbrew skills

```bash
# From an agentbrew checkout (dev) or after agentbrew sync (deployed)
agentbrew install learn-project    # built-in — synced with agentbrew
agentbrew install tutor-setup --from bevibing/tutor-skills
agentbrew install tutor --from bevibing/tutor-skills
```

`learn-project` **auto-installs** `tutor-setup` + `tutor` on first run if they are missing.

### 2. Use a supported agent

Works in **Cursor**, **Claude Code**, and other agents agentbrew syncs skills to. Invoke with natural language (see [How to invoke](#how-to-invoke)).

### 3. MCP servers (only what your sources need)

| Source type | MCP server | When required |
|-------------|------------|---------------|
| Remote GitHub / GHE repos, PRs, issues | `user-github` | `--repo`, PR/issue context |
| Google Docs (all tabs) | `user-google-drive-mcp` | Doc URLs / IDs |
| Jira issues, epics, initiatives | `user-jira-mcp` | Jira keys / URLs |
| Local repos, files, web | — | Agent reads disk or WebFetch |

If an MCP is blocked (SSO, auth), the agent stages reachable sources first and reports what failed — it does not idle or reconfigure MCPs.

### 4. Staging script (optional manual step)

Agents run this automatically in Phase 4. Humans can run it from an agentbrew checkout:

```bash
cd /path/to/agentbrew
npm run stage-learn-sources -- ./.learn-project [flags…]
```

---

## How to invoke

Say any of these in chat (with the `learn-project` skill available):

| Intent | Example phrases |
|--------|-----------------|
| Full pipeline | "Tutor me on this project", "Teach me the billing service", "Learn this repo" |
| Resume quiz | "Just quiz me now" (when `.learn-project` + StudyVault already exist) |
| Focus area | "Focus only on authentication — skip billing sections" |
| Mixed sources | "Teach me this repo plus the PRD and the Jira epic PROJ-123" |
| Start over | "Wipe `.learn-project` and tutor me fresh on just this repo" |
| Fix bad questions | "The practice files are all list-recall — fix before you quiz me" |

Attach `/learn-project` or select the skill if your agent supports explicit skill invocation.

---

## Quick start

### A — Current repo only

```text
Teach me this project and quiz me when ready.
```

The agent uses the cwd as `--local`, runs tutor-setup in **codebase** mode, presents a learning brief, verifies questions, then starts `/tutor`.

### B — Repo + Google Doc + Jira

```text
Tutor me on the billing service: this repo, RFC PR #77, the PRD Google Doc,
and Jira initiative PROJ-123.
```

The agent gathers each source via MCP/disk, stages under `.learn-project/`, builds the vault, then quizzes weakest-first.

### C — Resume after prep

```text
I already ran prep in ./.learn-project — just quiz me now.
```

Stage detection skips to **Phase 6** when a StudyVault exists.

### D — Manual staging then tutor

```bash
npm run stage-learn-sources -- ./.learn-project \
  --local ~/apps/my-service \
  --doc "PRD:./.learn-project/inputs/docs/prd.md" \
  --context "RFC:./.learn-project/inputs/context/rfc.md"
```

Then in chat: "Run tutor-setup and tutor on `./.learn-project`."

---

## Pipeline (what the agent does)

```
Phase 0  Ensure tutor-setup + tutor installed; check MCPs
Phase 1  Detect stage (fresh / staged / vault exists) — resume, don't restart
Phase 2  Intake — sources, focus areas, depth (ask only for gaps)
Phase 3  Gather sources into .learn-project/inputs/
Phase 4  stage-learn-sources → manifest.json (v3 freshness hashes)
Phase 5  /tutor-setup → StudyVault
  5a     Mermaid concept + architecture maps in vault
  5b     Concise learning brief (teach before test)
  5c     Verification gate → Verification Log.md
Phase 6  /tutor — diagnostic, adaptive drill, applied tasks
```

**Default staging root:** `./.learn-project/` in the current working directory (stable across sessions).

---

## Six source types

| Type | Examples | Staged under |
|------|----------|--------------|
| **Local repo** | cwd, `~/apps/foo` | `sources/repos/<name>/` |
| **Remote repo** | `ghe.example.com/org/repo` | clone → `sources/repos/` |
| **Google Doc** | URL or ID (all tabs) | `sources/docs/` |
| **Loose file** | PDF, MD, HTML | `sources/files/` |
| **Web page** | wiki, blog (WebFetch) | `sources/web/` |
| **Context** | PR summary, Jira export | `sources/context/` |

**Modes** (set in `manifest.json`):

| `tutorSetupMode` | Meaning |
|------------------|---------|
| `codebase` | Single repo — Codebase Mode |
| `document` | Docs/files/web/context only |
| `mixed` | Repo harvest + external docs |

---

## StudyVault layout (output)

After tutor-setup, expect something like:

```text
.learn-project/sources/StudyVault/
  00-Dashboard/
    MOC.md                 # map of content + architecture Mermaid
    Exam Traps.md          # common confusions
    Verification Log.md    # Phase 5c audit record
    Quick Reference.md
  01-<Section>/…           # concept notes per topic area
  …/
  * Practice.md            # practice questions per section
  Learning Dashboard.md    # live mastery % + weak areas
  concepts/*.md            # per-section concept trackers
```

Open the vault in Obsidian (or any markdown editor). The **Learning Dashboard** drives what gets asked next.

---

## Pedagogy (agentbrew-owned)

These behaviors live in `learn-project` — not in upstream tutor:

| Feature | What it does |
|---------|----------------|
| **Cite-or-refuse** | Claims cite staged paths; unverified claims are omitted or flagged |
| **Verification gate (5c)** | Re-answer every practice question from vault-only before quizzing |
| **Quiz-fix loop** | After critical review: fix vault → re-verify → re-quiz until clean |
| **Practice audit** | ≤30% pure list-recall per `* Practice.md`; prefer scenarios |
| **Teach before test** | Learning brief before `/tutor` — never quiz cold |
| **Mastery tracking** | Per-section coverage %; 🟢 only after 2 corrects (incl. one applied) |
| **Weakest-first** | Next question from lowest-mastery section, big-picture concepts first |
| **Retention re-test** | Re-ask mastered concepts later in the same session |
| **Interleave mode** | Cross-section questions once basics are green |
| **Applied tasks** | locate-owner, where-to-add, trace-the-bug, blast-radius on staged repos |
| **Source freshness** | Re-stage only changed inputs; patch vault sections when docs update |
| **Mermaid maps** | Section concept maps + architecture diagram in MOC |

- Upstream tutor improvements (open-answer, Bloom tags, confidence calibration) are spec'd in [`learn-project-tutor-upstream-contribution.md`](learn-project-tutor-upstream-contribution.md) — not shipped in tutor-skills yet. Ready-to-paste upstream PR bodies: [`learn-project-tutor-upstream-pr-drafts/`](learn-project-tutor-upstream-pr-drafts/README.md).

---

## manifest.json and freshness

After Phase 4, read `.learn-project/manifest.json`:

- `tutorSetupMode` — codebase | document | mixed
- `tutorSetupCwd` — directory to run tutor-setup from
- `freshness.changed` / `freshness.unchanged` — per-source content hashes (v3)

When `freshness.changed` is non-empty and a StudyVault exists, the agent re-runs tutor-setup for **affected sections only** — not a full regather from scratch.

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| "tutor-setup not installed" | Run `agentbrew install tutor-setup --from bevibing/tutor-skills` (and `tutor`) |
| SSO blocked GitHub/Jira/Drive | Complete auth in browser; agent backgrounds and continues other work |
| Bad / trivia questions | Say "that question is bad" — agent discards and regenerates; or run quiz-fix loop |
| Stale vault after doc update | Re-invoke learn-project — freshness detects changed sources |
| Want only quiz | "Just quiz me" with existing StudyVault |
| Wrong focus | State focus areas at intake or mid-session |
| Start clean | "Wipe `.learn-project` and start over" |

---

## For skill authors and maintainers

| Artifact | Purpose |
|----------|---------|
| `skill-plugins/dev/learn-project/SKILL.md` | Orchestrator spec (phases, pedagogy, constraints) |
| `skill-plugins/dev/learn-project/evals/evals.json` | 20 behavioral eval scenarios |
| `src/skills/learn-project-contract.test.ts` | Pins SKILL + evals (run with `npm test`) |
| `src/learn/stage-learn-sources.ts` | Deterministic aggregator (STAGE_VERSION = 3) |
| `docs/learn-project-tutor-upstream-contribution.md` | Upstream PR draft spec |

```bash
npm test src/skills/learn-project-contract.test.ts
npm test src/learn/stage-learn-sources.test.ts   # if present
```

---

## Related links

- [README § Learn-a-project workflow](../README.md#learn-a-project-workflow-tutor-me-then-quiz-me)
- [Upstream tutor-skills](https://github.com/bevibing/tutor-skills)
- [Upstream contribution spec](learn-project-tutor-upstream-contribution.md)
