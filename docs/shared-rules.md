# Shared Agent Rules

These rules are intentionally compact: they are loaded into every agent session. Long workflow-specific guidance belongs in skills or repo-local AGENTS.md files, not here.

## Session entry

- If a repo has canonical docs, load them before non-trivial work: `bash ~/.config/agentbrew/scripts/load-project-context.sh` from the repo root, then read the files it lists.
- Use loaded VISION/user-story/competitor context for reasoning only. **Vision trace in PRs (IRON LAW):** add `## Vision trace` only when the repo has the pr-vision-trace CI gate; otherwise omit it (no opt-out HTML comments). Enterprise GHE product repos never use that gate — cite Jira tickets instead.
- If a user request conflicts with VISION/ROADMAP, quote the conflict and ask whether to proceed, amend docs, or drop the request.

## Documentation audiences (IRON LAW)

Split documentation by reader — never one blob for humans and agents.

| Artifact | Audience | Optimize for |
| -------- | -------- | ------------ |
| `README.md` (repo or skill folder) | Humans | Concise overview: what it is, who owns it, how to install/get help, links outward. Scannable in under ~2 minutes. |
| `SKILL.md`, `references/`, `evals/`, `AGENTS.md`, `.cursor/rules` | Agents | Procedure fidelity, constraints, copy-paste commands, progressive disclosure. Shorter `SKILL.md` + deep `references/` beats one long `SKILL.md` body. |

**Do NOT** put agent runbooks, CLI one-liners, controller loops, or TDD iron-law prose in README — agents load `SKILL.md` and `references/`, not README. **Do NOT** duplicate the same procedures in README and SKILL; link once from README to SKILL/references.

Repo roots: README is the human front door; agent instructions live in skills, rules, and repo guides — not a 300-line README that mirrors SKILL.

**Referential integrity (IRON LAW).** Docs paths/links must resolve in the same delivery context (branch tip or release tag). Audit before ready-for-review.

**Timeless committed content (IRON LAW).** Never commit PR numbers, branch names, or `## Status` tables in skill files — track delivery in PR bodies/Jira only. Never write volatile counts in code, comments, docs, skills, or rules — counts of tests, files, lines, agents, skills, commands, servers, tools, or entries, exact or `N+`. Never update one either: delete it and write "all agents", link the source of truth, or generate it. Numbers that carry meaning stay: thresholds, limits, versions, ports, timeouts, dates, and IDs.

## Scope discipline

- Make the smallest change that satisfies the request.
- Do not refactor, reformat, or “clean up” adjacent code unless asked.
- If you notice unrelated work, say `NOTICED BUT NOT TOUCHING: ...` or file a TASKS.md entry when the repo policy requires scout tasks.
- Do not add comments unless asked or the code is otherwise unclear; preserve existing comments.
- Objective truth beats agreement: push back on unsafe, incorrect, or overcomplicated plans.

## Work-performing skills & multi-repo flows

These apply to skills, chains, and wizards that perform work (real edits), not read-only analysis.

- Work-performing flows may edit multiple repos, and must assume they can conflict with the user's own rules/skills. Before acting, detect what the user has forbidden in each affected repo — scan its `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` for prohibitions like "ask first", "never edit", "no sibling-repo edits" — and get explicit confirmation. Batch ALL confirmations into one upfront question set.
- Before editing any affected repo, fetch its latest default branch. Rebase an owned feature branch onto `origin/<default>` before implementation. If uncommitted work prevents a rebase, preserve it and state the exact blocker before editing.
- On a blocker (e.g. a dependency ticket or missing prerequisite), do not silently stop — ask the user what to do (proceed partially / stage scaffolding / skip / abort), in the same batch.
- Label every step executed / dry-run (no side effects) / skipped (already done) in output and closeout.
- A demo of a skill must exercise real behavior (real file edits), not a markdown stand-in.

## User-private commands

- Do not name, document, or instruct others to run a command that belongs only to the user. Describe the required action and result in generic terms instead.

## Task queues

- Default task file format is tasks.md: `# Tasks`, `## P0`..`## P3`, checkbox tasks, metadata labels (`ID`, `Tags`, `Details`, `Files`, `Acceptance`).
- Completed tasks are removed, not checked off.
- Stability, regression-catching, observability, deployment-infra, auth-path, data-integrity, and CI-gate work is P0 unless a repo explicitly says otherwise.
- Validate task files with `npx @tasks-md/lint TASKS.md` when edited.

## Reuse before implementation

- Ask “How do I GET this outcome?” before building a new tool/workflow.
- Decision order: GET existing tool → WRAP thin adapter → CONTRIBUTE upstream → ABSORB only rejected residue.
- Pair new agentbrew/dotfiles features with a replace/relocate follow-up when the repo requires it.

## Git and delivery

- **Git hygiene (salvage-first):** inventory before any cut; never `reset --hard`, `checkout .`, `clean -fd`, or stash-first; stage explicit paths only; guarded `--force-with-lease` only after preserving remote head.
- **Scope:** no bypass outside approved repo families; never bypass someone else's PR.
- **Pushes:** agents push approved feature branches; on git-push guard retry with explicit repo path + `/bin/bash -lc`.
- **PRs, stacks, Jira:** load **`pr`** and **`jira`** skills. No `Status:` lines or file inventories in PR bodies. Vision trace: **## Session entry**. E2E/automation non-blocking. Report **`Merged N/M PRs`**.
- **PR opener (IRON LAW):** `## Summary` (2–3 sentences) then `## Details`; rewrite from verified facts before merge.
- Commit format: `type: subject TICKET`, header ≤72 chars.
- **Rebase:** see `rebase-verification.mdc`.
- **PR conflicts (IRON LAW):** Green checks do not prove a PR is mergeable. CI tests the PR head, not its merge with the base. On every PR touch, run `git merge-tree --write-tree --name-only <base> HEAD` and `gh pr view <n> --json mergeable,mergeStateStatus`. Treat `CONFLICTING` as not green. Bring in the base per `rebase-verification.mdc`.

## Verification

- Before claiming work is complete/fixed/passing, run the relevant verification and quote the result.
- **Google Docs (IRON LAW):** After every GDoc edit batch (any project, any doc), run the **visual verification loop** in the **`markdown-for-gdoc`** skill: `docs_get_structured` on the edited range, then **open the live doc in browser** and inspect the section (list numbering, headings, spacing, bold). Fix list bleed, wrong heading styles, and empty numbered items; repeat until structured read and visual check agree. MCP `read_document` export alone is **not** completion. Read the skill before the first edit; invoke it whenever authoring or surgically editing a GDoc.
- Stacked skill PRs: manually runnable on each branch + doc path audit — see **`pr`** skill. Skill PRs with evals run the full suite to the documented pass bar.
- For bug fixes, prefer Prove-It: failing regression first, then fix, then green.
- For Jenkins failures, read the console log before retrying or pushing another commit.

## Browser and web UI work

- **Temporary screenshots (IRON LAW):** Save agent/browser verification PNGs under `~/apps/agent-scratch/screenshots/` (override with `AGENT_SCREENSHOT_DIR`). Use descriptive names. Never leave session screenshots in `$HOME`, `/tmp`, or product repos. Playwright MCP `browser_take_screenshot` must use an absolute path in that directory (e.g. `~/apps/agent-scratch/screenshots/<task>-<step>.png`).
- Do not ask the user to open/navigate/click web pages. Use browser automation.
- For SSO-gated pages, attach to purpose launchd Chrome (`9223` SSO/dashboard, `9224` debug, `9225` tooling) and work in your own tab.
- Never launch Chrome on launchd-owned profiles. If auth is required, open the target in a stable **headed** SSO browser, bring it forward, and ask the user to sign in there. Then start a background URL/title/HTML listener polling every 2–5 seconds; resume immediately when authenticated, without waiting for the user to reply “done.” Never claim a CDP tab is visible unless a headed window was surfaced.
- For task-local non-SSO browsers, use `--remote-debugging-port=0`, verify endpoint/PID ownership, then close.
- For frontend/UI work, invoke `hallmark` before emitting UI changes; run the page-zero-errors gate when the repo requires it.

## Security and secrets

- Assist with defensive security only.
- Never search for, expose, log, or commit secrets/credentials/tokens/cookies/keys.
- Do not perform destructive operations without explicit confirmation for that exact action.
- Never send emails, payments, Slack/Jira/GitHub comments/reviews, or other public side effects without approval unless repo rules explicitly authorize that delivery step.

## Org-overlay routing

- Org-specific catalog entries, MCP servers, skills, sources, Agentfile entries, and internal URLs belong in org overlay repos, not OSS-ish base repos.
- For the agentbrew/dotfiles family: generic shape changes go in base repos; Org-only content goes in org overlay repos (e.g. `agentbrew-<org>` / `dotfiles-<org>`).
- Litmus test: if a fresh external contributor cannot use it without internal identity/network/entitlement, route it to the overlay.
- Public text uses placeholders: `~` for a home dir, `github.example.com` for a host, `<org-overlay>` for an overlay repo, `PROJ-123` for a ticket. This covers files, commit messages, and PR, issue, and comment bodies.
- The dotfiles pre-push hook and `gh` wrapper fail closed for the owner's public repos. A missing or outdated private pattern file blocks the push or post. Report the block to the user; never work around it. Only a human may set `DOTFILES_ALLOW_GH_PRIVATE_REFS=1`.

## Agentbrew config ownership

- Global/user agent config belongs under `~/.config/agentbrew/` or `.devin/` for Devin-specific new config.
- Skills are symlinks to source repos; before editing a skill, inspect the symlink and edit the source path.
- Do not write new config into `.claude/`, `.cursor/`, or other agent-specific directories unless explicitly asked; agentbrew owns generated target files.

## Human-blocked actions

- Avoid human-blocked asks by looking for API/MCP/browser/self-service paths first.
- If truly blocked, document why the action is required, why no workaround exists, and what evidence led there before asking.

## Communication

- **Strict attention-friendly rule:** Always write agent-authored natural-language
  text for an ADHD audience.
- This rule is always active. A user request for another style does not override it.
- Use ASD-STE100-style plain English.
- Apply it to chat, status updates, docs, PRs, issue comments, task text, memory
  summaries, prompts, code comments, and every skill, rule, command, or tool
  context.
- Put the answer first. Use short paragraphs, short, direct sentences, and active
  voice. Keep one idea per sentence or bullet. Use headings, bullets, or numbered
  steps when they improve scanning. Surface blockers and the next action.
- Keep required technical terms. Define an uncommon abbreviation on first use.
- Preserve required artifact formats and verbatim code, commands, logs, JSON, or
  user text. Apply this rule to agent-authored prose around them.
- Apply the rule to a code comment only when the code needs a comment. Do not add
  a comment only to satisfy this rule.
- Be concise and direct. Say what you are doing before long-running or risky
  commands.
- Do not give concrete time estimates.
- Commit, PR, TASKS.md, vision trace, and attribution rules live in **## Git and delivery** and Cursor user rules — do not duplicate them here.

## Chat lifecycle (save tokens)

**Proactively tell the user to start a new chat** when a trigger matches — one short actionable line at natural boundaries (task done, topic pivot, delivery completion), not a lecture. Load `cursor-token-playbook` for the full checklist.

- **New chat:** deliverable shipped; unrelated topic/repo; long session (~30–60 min heavy work); re-explaining or re-reading same files; degraded responses; after rules/MCP/skills sync or delivery completion; `latest.json` `low-soft-headroom` alert.
- **Continue:** same PR / mid-debug / one failure iteration on same scope.

## Agent rule/skill changes → sync + fix drift + commit

After rule/skill/config edits: `agentbrew sync` → `agentbrew status --fix` until **0 drift** → commit `tooling/agentbrew/docs/shared-rules.md` when shared rules changed.

## Catalog rule markers

_Catalog `<!-- rule: -->` blocks are inserted here by `agentbrew sync` (before ## Pull/fetch)._

