# Tasks

<!-- policy: Run tests before every commit. Never skip CI checks.
             `npm run verify` must pass before every commit (AGENTS.md rule #1).
     policy: Maintain 95%+ coverage on statements, functions, and lines. Branch coverage target is 95%.
     policy: Prefer fixing root causes over symptoms — add regression tests for every bug fix.
     policy: Tickets are prompts — write outcome-shaped tasks, not implementation-shaped issues.
             Describe the product outcome in 2 lines. Let the agent figure out subtasks.
             Break into smaller initiatives, not smaller issues. Include context that matters.
             (https://dheer.co/tickets-are-prompts/)
     policy: Branches MUST match the naming pattern enforced by the
             global pre-commit hook (`~/apps/dotfiles/git-hooks/pre-commit`):
             `type/TICKET-description` OR `type/description` where `type` is one
             of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
             `hotfix`, or `release/*`. Example: `chore/delete-team-command`.
             `main`, `master`, `develop` are always allowed; anything else is
             rejected at commit time. Agents creating branches from this queue
             MUST pick a branch name matching that pattern before the first
             commit lands. A ticket suffix is optional (AGENTS.md rule #12).
     policy: Commit message format (enforced by `~/apps/dotfiles/git-hooks/commit-msg`):
             `type: description` with the first line ≤72 characters. Add a
             ticket suffix only when a real ticket exists.
     policy: PUBLISHING REQUIRES EXPLICIT PER-ACTION APPROVAL (no exceptions).
             Any step that would publish, send, or broadcast to a destination OUTSIDE
             `fyodoriv/agentbrew` is blocked until the user explicitly
             approves THAT SPECIFIC publish action IN THE CURRENT SESSION. Covered:
             * `npm publish`, `gh release create`, any public-registry upload
             * Creating, commenting on, or reviewing a PR or issue at any external
               repo — public (vercel-labs/skills, mcpm.sh, block/ai-rules, caliber,
               bridle, warden, react-doctor, etc.) or private (any repo
               owned by another org or team)
             * Posting a Slack / Teams message, sending an email, triggering a
               notification workflow
             * Creating, commenting on, or transitioning a Jira ticket
             * Pushing to any public GitHub remote (github.com/*) other than
               `fyodoriv/agentbrew` itself
             * Registering agentbrew on `skills.sh` or any public catalog / directory
             Research, reading, monitoring, local testing, and drafting PR bodies or
             comment text are NOT publishing and may proceed without prior approval.
             The final submit / send / publish / push step is. Approval to CLAIM a
             task (e.g. "pick up contribute-engage-pr-630-skills-status") is NOT
             approval to PUBLISH the PR; the publish step needs fresh approval at
             the moment of publishing. Approvals do not carry across sessions.
             Agents MUST pause and ask "I'm about to <specific publish action> on
             <specific target> — okay to proceed?" immediately before the action
             runs. If the answer is ambiguous, default to BLOCKED. This policy
             applies INDEPENDENTLY of P0-P3 priority. Global context: the External
             Communication Ban in the global agent instructions (and agentbrew's
             AGENTS.md) covers the same ground; this TASKS.md policy exists as
             defense in depth at the queue level where agents pick up work. -->

<!-- Strategic direction: Delegate → Contribute → Absorb (only the rejected residue).
     See docs/VISION.md § "Delegate, contribute, absorb — in that order" for the full rules.
     1. Delegate immediately to upstream when they cover 80%+ of our need — skills CLI for skills,
        mcpm.sh for MCP, block/ai-rules for rules. With one user today (see VISION.md § "Today's
        user base"), friction measurement collapses to ~1 hour of dev-machine testing, not 1 day
        of production-parity checks. Rip native code; if it works locally, ship; if not, revert
        the same commit. No "just in case" fallbacks, no deprecated flags.
     2. Contribute the missing 20% upstream with a 90-day engagement window. Silence = rejection.
     3. Absorb only what upstream explicitly rejects or ignores for 90 days.
     Breaking changes are free today — no deprecation windows, no migration paths, no backwards
     compat. When a command / flag / subsystem is removed, it's gone in the same commit. This
     suspension ends the day the user base grows past one. Until then, every CHANGELOG entry
     notes breaking changes but doesn't defer them.
     Permanent agentbrew scope (no upstream home): commands / hooks / instructions sync,
     multi-surface drift detection, auto-repair scheduler, multi-surface Agentfile, and the
     ~100 LOC of team-overlay detect-and-register-one-source-repo glue.
     Team skills live in ONE dedicated repo per overlay;
     agentbrew detects + registers, does not host per-skill pointers in catalog-overlay.yaml.
     Before ANY new-feature PR, answer: "Why is this in agentbrew instead of upstream?" Valid
     answers: (a) dev-machine test proved upstream is blocked, (b) upstream rejected or ignored
     90+ days, (c) team-overlay detection / registration glue, (d) multi-surface glue. Everything else
     must be contributed, not built here.
     Codebase: ~23K non-test source lines; target ~3–5K as the minimum-viable orchestrator
     (docs/competition/vercel-skills-cli-vs-agentbrew.md § "Minimum viable agentbrew"). -->

<!-- Priority semantics — what each level MEANS, not just a queue of tickets.
     P0 — Strategic alignment with upstream. Every P0 task (a) deletes a feature,
          (b) delegates a subsystem to an upstream tool (skills CLI, mcpm.sh,
          block/ai-rules, a team skills repo), or (c) absorbs a feature from
          upstream that closes a known gap (e.g. `--copy` fallback, plugin
          manifest discovery, per-skill / per-agent granularity). Absorption
          tasks add code, but they close strategic gaps called out in
          docs/competition/vercel-skills-cli-vs-agentbrew.md § "What skills
          CLI has that agentbrew doesn't" — so they earn the priority slot.
          (d) raises the correctness, safety, or pedagogy of a Bucket-1
          agentbrew-hosted builtin skill (one with NO upstream home, e.g.
          learn-project) to a documented domain best practice, closing a
          named quality gap. Category (d) is the ONE P0 slot that adds a
          net-new feature to agentbrew's own surface, and it is bounded:
          enhancements to a skill that HAS an upstream home (e.g. tutor-setup /
          tutor in bevibing/tutor-skills) are contributed upstream, not built
          here (VISION "Delegate, contribute, absorb"), and only the
          orchestration / staging / selection glue stays agentbrew's per the
          permanent-scope list. Amended 2026-07-08 (learn-project pedagogy
          gap review).
          Absorption tasks blocked by an active delegation task are marked
          with `**Blocked by**:` so they become no-ops if the delegation lands
          first. End state: a thinner agentbrew sitting on top of upstream
          tools, with every upstream-parity feature either delegated or
          absorbed (never both).
     P1 — Correctness and clarity. Bug fixes, simplifications already paid for
          by the P0 deletions, aligning the code to the user stories,
          refreshing competition research when an external tool's trajectory
          could flip a P0 verdict, and documentation/clarity work where drift
          between code and docs costs the user. **All competitor deep-dives
          are P1 regardless of star count or immediate strategic relevance.**
          Even a 0-star competitor can reveal an absorbable idea, a
          dissolution trigger, or a reason to update the fatal-gap list.
          Parking them in P3 (intentionally blocked) was wrong — they are
          actionable research that feeds VISION.md's delegate-contribute-
          absorb strategy, and they belong in the active queue.
     P2 — Life improvements. Ergonomic polish, personal tooling decisions, and
          recurring strategic reviews that don't block any user outcome but
          pay off over quarters.
     P3 — Intentionally blocked. Do NOT claim or start a P3 task without
          explicit user permission, even if P0–P2 are empty. /next-task and
          the audit cascade MUST surface "all higher priorities empty — P3 is
          blocked" and stop. P3 holds (a) upstream contributions where we're
          waiting on maintainers (the 90-day window runs in the background,
          not as work queued here) and (b) speculative future features
          superseded by the delegate-first strategy. See the section policy
          comment under `## P3` for the strict pickup rule. -->

<!-- Recurring tasks live in `RECURRING.md` (sibling of this file), not here.
     Anything with a `**Cadence**:` field belongs there. The next-task
     workflow consults both files but skips a recurring task unless its
     cadence window has opened (`now() >= last-fired + cadence` or
     `now() >= next`). The validator in
     `src/docs/tasks-md-output-cadence.test.ts` enforces (a) no Cadence
     field appears in this file and (b) every Output value here is in the
     allowed set (`code`, `docs`, `mixed`, `audit-report`, `measurement`).
     The Output field is the schema autonomous runs filter on — a marathon
     limited to `--code-and-infra-only` skips pure-`docs` and `audit-report`
     tasks before claiming. -->

## P0

<!-- Added 2026-07-06 from the agentic-tooling landscape review (canvas:
     canvases/agentic-tooling-vs-agentbrew.canvas.tsx). Four moves that push
     agentbrew further into pure orchestration: two delegations that shrink the
     connector catalog, two content registrations that pull best-in-class MCP /
     skills in through the curator model (zero source LOC). Recurring "scan the
     landscape" + "watch Cursor Marketplace / Runlayer" folded into the existing
     RECURRING.md watch-lists (re-research-stale-competitors, quarterly-
     dissolution-reeval) instead of a duplicate task. -->

<!-- Added 2026-07-08 (learn-project pedagogy gap review). These are
     P0 category (d): raising a Bucket-1 no-upstream-home builtin skill
     (learn-project) to documented learning-science + agentic-RAG best
     practices. Scope is bounded to what agentbrew OWNS — the orchestration
     wrapper, the deterministic staging aggregator, the pre-quiz QA gate, and
     the mastery-selection layer. Teaching/quiz *mechanics* that live in the
     upstream tutor-setup / tutor skills (bevibing/tutor-skills) are routed to
     the single `contribute-tutor-pedagogy-upstream` task, not built here. Gap
     analysis grounded in: Chain-of-Verification (Meta), RAGAS/promptfoo evals,
     DeepWiki + NotebookLM, mastery learning (Bloom), retrieval practice
     (Roediger & Karpicke), Bloom's taxonomy / ICAP, Understanding by Design
     (Wiggins & McTighe). -->

- [ ] Contribute the tutor teaching/quiz mechanics upstream to bevibing/tutor-skills
  - **ID**: contribute-tutor-pedagogy-upstream
  - **Tags**: learn-project, tutor, contribute, upstream, p0, pedagogy-2026-07-08
  - **Output**: mixed
  - **Blocked**: needs-user-approval — opening PRs against the external `bevibing/tutor-skills` repo is a publish action (TASKS.md publishing policy + AGENTS.md external-comms ban). Local spec/draft prep may proceed; the PR-create/push step needs explicit per-action approval in the session it happens.
  - **Details**: The gap-review items that belong to the *teaching/quiz generator* — not agentbrew's orchestration — must be contributed upstream per delegate-contribute-absorb, since tutor-setup/tutor are hosted in bevibing/tutor-skills and learn-project's own constraint forbids modifying them locally. Bundle: (1) question-generation self-verification (CoVe) at author time; (2) free-recall / rubric-graded open answers; (3) Bloom-level tagging + laddering of questions; (4) confidence calibration (ask certainty; high-confidence-wrong = misconception flag); (5) misconception-based distractors; (6) explicit learning objectives + a prerequisite DAG. Run the 90-day contribution window; **absorb into learn-project only if upstream rejects/ignores** (then it converts to a P0(d) build task).
  - **Files**: (upstream) bevibing/tutor-skills PRs; (local) docs/learn-project-tutor-upstream-contribution.md — no tutor-setup/tutor edits in agentbrew
  - **Acceptance**: (a) a written spec of the six mechanics mapped to tutor-setup/tutor; (b) upstream PR(s) drafted (publish gated on approval); (c) 90-day window tracked; (d) absorb-if-rejected fallback noted; (e) no local edits to tutor-setup/tutor content.
  - **Research**: 2026-07-08 — local spec drafted at docs/learn-project-tutor-upstream-contribution.md (six mechanics, upstream PR split, agentbrew non-goals). Publish still gated.
  - **Last-enriched**: 2026-07-08
  - **Vision trace**: VISION "Delegate, contribute, absorb — in that order" — upstream-homed enhancements are contributed, never built in agentbrew. **User story**: no-hallucination, best-practice tutoring. **Competitor prior art**: CoVe, retrieval practice, Bloom's taxonomy, concept inventories (Force Concept Inventory), Understanding by Design.
  - **Anchor**: 2026-07-08 learn-project pedagogy gap review.

- [ ] Resolve catalog MCP pointers from the official MCP Registry as it reaches GA
  - **ID**: delegate-catalog-to-official-mcp-registry
  - **Tags**: delegate, mcp, catalog, upstream, p0, landscape-2026-07-06
  - **Blocked**: needs-upstream-ga — `registry.modelcontextprotocol.io` is still in preview (no durability/breaking-change guarantees as of 2026-07). Do the read-only integration spike now; flip catalog resolution to it only after GA (or pin a snapshot).
  - **Details**: The official MCP Registry (Anthropic + GitHub + Microsoft + PulseMCP) is the canonical metadata source for public MCP servers, with a stable namespace/trust model and an open API spec. agentbrew hand-maintains MCP pointer entries in `catalog.yaml`; that curation is exactly what the registry now owns upstream. Spike a resolver that, given a server name, fetches its canonical install metadata from the registry (with the local catalog as override/fallback for org-internal + not-yet-published servers), so agentbrew stops duplicating pointer metadata it can GET. Honors "curate, not host" and shrinks catalog maintenance. Guard behind a flag until the registry GAs; keep the local catalog authoritative for anything the registry can't verify.
  - **Files**: src/catalog/*.ts (registry resolver + fallback), src/catalog.yaml (thin to org-internal + unpublished servers over time), docs/COMPETITION.md + docs/competition-snapshot.json, README.md, CHANGELOG.md, tests
  - **Acceptance**: (a) a resolver fetches canonical MCP metadata from `registry.modelcontextprotocol.io` for a known server and installs it through the normal path; (b) local catalog entries override registry results and cover unpublished/org-internal servers; (c) offline / registry-down falls back to the local catalog with a one-line warning (never crashes); (d) the flip to registry-first is gated on GA; (e) `npm run verify` passes.
  - **Vision trace**: G1 (Curate, not host) — consume the canonical upstream instead of re-curating pointers. **User story**: US 03 (add MCP server), US 24 (browse catalog). **Competitor prior art**: docs/COMPETITION.md — MCP Community Registry / Smithery / mcpm.sh (already delegated); official registry is the upstream those build on.
  - **Anchor**: 2026-07-06 landscape review; modelcontextprotocol.io/registry (preview, GA pending).

<!-- Added 2026-07-06 (shrink pass): replace custom agentbrew code + skills with
     industry standards, per docs/VISION.md "Wrap, don't rewrite" / "Maintenance
     is the product" and docs/competition/vercel-skills-cli-vs-agentbrew.md
     § "Minimum viable agentbrew — the orchestrator fallback" (~5–7K LOC target).
     Current surface (measured 2026-07-06): ~38K non-test src lines; 68 dev
     skills × 68 evals.json. Each task below deletes native code/skills and
     leans on a standard: SKILL.md source repos, `npx skills validate`, the
     AGENTS.md standard, mcpm + official MCP Registry, ccusage/tokscale. -->

- [ ] Drop the custom SKILL.md validator + eval-coverage machinery; delegate to `npx skills validate`
  - **ID**: delegate-skill-validation-to-skills-cli
  - **Tags**: shrink, skills, delegate, delete, p0, landscape-2026-07-06
  - **Details**: The minimum-viable-agentbrew doc explicitly lists "custom SKILL.md validator (→ skills CLI)" as a drop target. agentbrew carries `src/skills/validate.ts` (459), `skill-structural.ts` (81), `skill-validate-display.ts` (77), `skill-versions.ts` (47), `skill-coverage.ts` (149) plus the `npm run skills:coverage` gate that forces an `evals/evals.json` on every in-repo skill. Once `delete-generic-skills-point-to-upstream-repos` removes the Bucket-2 catalog skills, most of that eval-coverage burden evaporates. Replace the native validator with `npx skills validate` (skills CLI is the SKILL.md-format standard we already delegate installs to) for structural validation, and keep only the thin agentbrew-specific checks that skills CLI can't do (if any). Delete the rest.
  - **Files**: src/skills/validate.ts, src/skills/skill-structural.ts, src/skills/skill-validate-display.ts, src/skills/skill-versions.ts, src/skills/skill-coverage.ts (delete/shrink), src/lint.ts + package.json (`skills:coverage` gate), README.md, CHANGELOG.md, tests
  - **Acceptance**: (a) `agentbrew lint` / validation runs `npx skills validate` for SKILL.md structure; (b) native validator LOC removed (record delta); (c) any remaining agentbrew-only check has a one-line justification for why skills CLI can't cover it; (d) `npm run verify` passes.
  - **Vision trace**: G1 + VISION § "Minimum viable agentbrew" (drop custom SKILL.md validator → skills CLI). **User story**: US 18 (lint/validate). **Competitor prior art**: vercel-labs/skills `skills validate` (PR #509 tracked in competition doc).
  - **Anchor**: 2026-07-06 shrink pass; competition doc "Drop: custom SKILL.md validator (→ skills CLI)".

- [ ] Push the remaining native MCP-sync carve-outs onto mcpm adapters + the official registry
  - **ID**: shrink-mcp-sync-to-mcpm-and-registry
  - **Tags**: shrink, mcp, delegate, upstream, p0, landscape-2026-07-06
  - **Details**: `src/sync/mcp-sync.ts` is still ~1,017 LOC (plus `mcp-delegate.ts` 601, `mcp-sync-commands.ts` 201) even after the 2026-04 mcpm delegation, because the split-intersection model kept native carve-outs (devin, overlay-desktop) and clients mcpm didn't yet support. The upstream adapter PRs agentbrew already filed (mcpm opencode #327, kiro #328, amp #329) plus the official MCP Registry (`delegate-catalog-to-official-mcp-registry`) are the standards that let more of this move. Re-run the delegation for each remaining native client: if mcpm now covers it (adapter merged), delete the native path; keep only the true carve-outs (Devin literal-env handling) with a one-line reason. Target: cut mcp-sync.ts substantially.
  - **Files**: src/sync/mcp-sync.ts, src/sync/mcp-delegate.ts, src/mcp/mcpm-hygiene.ts, docs/competition/mcpm-sh-vs-agentbrew.md, README.md (MCP sync row), CHANGELOG.md, tests
  - **Acceptance**: (a) every client mcpm now supports is delegated (no native writer); (b) each surviving native carve-out names the specific mcpm gap that keeps it; (c) mcp-sync.ts LOC drops (record delta); (d) MCP still deploys to all agents; (e) `npm run verify` passes.
  - **Blocked by**: delegate-catalog-to-official-mcp-registry
  - **Vision trace**: G1 + VISION § "Delegate, contribute, absorb". **User story**: US 03 (add MCP server). **Competitor prior art**: mcpm.sh (adapters #327–329); official MCP Registry.
  - **Anchor**: 2026-07-06 shrink pass; docs/competition/mcpm-sh-vs-agentbrew.md split-intersection model.

- [ ] Delegate context-budget measurement to ccusage / tokscale / openusage; delete the custom measure engine
  - **ID**: delegate-context-budget-to-standard-tools
  - **Tags**: shrink, measure, delegate, delete, p0, landscape-2026-07-06
  - **Details**: `src/measure/*` (~1,125 LOC: context-budget.ts 435, runtime 145, throttle 78, alerts 53, cursor-mdc-inventory 44, mdc-frontmatter 44) hand-rolls token/context measurement. The README already shells out to `ccusage` for Claude runtime and mentions tokscale/openusage. Standard token-measurement tools now cover most of this. Replace the custom static+runtime measurement with a thin wrapper that invokes the standard tools and normalizes their JSON into `~/.config/agentbrew/metrics/latest.json`; keep only the agentbrew-specific static inventory that no standard tool computes (deployed-rules token projection), and delete the rest. Reduces a whole module + the SessionStart measure hook complexity.
  - **Files**: src/measure/** (shrink to wrapper), src/measure/context-budget.ts, scripts/measure-context-budget.sh, README.md "Context budget measurement", docs, CHANGELOG.md, tests
  - **Acceptance**: (a) `agentbrew measure context` produces latest.json primarily from ccusage/tokscale/openusage output; (b) only genuinely agentbrew-specific metrics (deployed-rules projection) remain native, each justified; (c) measure LOC drops (record delta); (d) missing standard tools degrade gracefully (already the contract); (e) `npm run verify` passes.
  - **Vision trace**: G1 + VISION § "Wrap, don't rewrite". **User story**: context-budget hygiene (US 25 status/health adjacent). **Competitor prior art**: ccusage, tokscale, openusage — standard token-usage CLIs.
  - **Anchor**: 2026-07-06 shrink pass; README "Context budget measurement" already integrates ccusage.

- [ ] Delegate MCP health probing to `mcpm doctor`; keep only the multi-surface drift glue
  - **ID**: delegate-mcp-health-probe-to-mcpm-doctor
  - **Tags**: shrink, mcp, drift, delegate, p0, landscape-2026-07-06
  - **Details**: The MCP probe/heal machinery is heavy — `src/mcp/probe.ts` (519), `resilient-sweep.ts` (271), `heal-cycle.ts` (233), `playwright-isolated-sweep.ts` (194), `health-snapshot.ts` (157). Auto-repair across surfaces is the moat and stays, but the per-server *probing* primitive (is this server reachable / healthy?) is exactly what `mcpm doctor --json` provides (agentbrew already filed the UX PR #326 upstream). Delegate the reachability/health probe to `mcpm doctor` and keep only agentbrew's unique layer: the cross-surface drift comparison, the catalog `smokeCall` semantics that mcpm lacks, and the heal-action registry. Delete the native probe transport where mcpm covers it.
  - **Files**: src/mcp/probe.ts, src/mcp/probe-cli.ts, src/mcp/resilient-sweep.ts, src/mcp/heal-cycle.ts, src/mcp/health-snapshot.ts, docs/competition/mcpm-sh-vs-agentbrew.md, README.md (drift detection), CHANGELOG.md, tests
  - **Acceptance**: (a) health/reachability probing routes through `mcpm doctor --json` where available; (b) agentbrew-only logic (cross-surface drift, catalog smokeCall, heal registry) is what remains, each justified; (c) probe LOC drops (record delta); (d) drift auto-repair still detects + heals the documented failure classes; (e) `npm run verify` passes.
  - **Blocked**: needs-upstream — depends on `mcpm doctor --json` (PR #326) landing + a release; do the wrapper spike now, flip when it ships.
  - **Vision trace**: G5 (drift + auto-repair, the moat) — keep the glue, delegate the primitive. **User story**: US 06 (drift detection). **Competitor prior art**: mcpm.sh `doctor` (PR #326).
  - **Anchor**: 2026-07-06 shrink pass; docs/competition/mcpm-sh-vs-agentbrew.md.

- [ ] Reuse Minsky's `scripts/check-rule-*.mjs` linters via adapter — don't reimplement (coordination task)
  **ID**: reuse-minsky-check-rule-scripts
  **Tags**: scout, reuse-over-reinvent, ci-gate, adapters, parent-task
  **Blocked**: needs-user-approval — the next required sub-task is `reuse-minsky-check-rule-upstream-pr`, which requires creating a public PR against `github.com/fyodoriv/minsky`; agentbrew rule #14 requires explicit per-session approval before that publish action. See `docs/human-blocked-actions/reuse-minsky-check-rule-upstream-pr-2026-06-04.md`.
  **Research**: 2026-06-04 — parent pickability corrected
    The portability spike at `docs/research/minsky-check-rule-portability-spike.md` says 4/12 scripts are portable today, while the 8 scripts needed for the downstream rule tasks require upstream `--repo=` support. Sub-task C (`reuse-minsky-check-rule-adapter`) is explicitly `**Blocked by**: reuse-minsky-check-rule-upstream-pr`, so picking the P0 parent cannot produce an in-repo implementation slice until the public upstream PR step is approved and lands.
  **Last-enriched**: 2026-06-04
  **Details**: Coordination task. The Build was decomposed into 4 sub-tasks 2026-05-26 after a portability spike found that several Minsky check-* rules-rule scripts (rules 1, 6, 11, 17) are portable today; the other 8 (rules 2, 3, 4, 5, 7, 9, 12, 13) hardcode `REPO_ROOT = resolve(HERE, "..")` and need an upstream `--repo=` flag. See `docs/research/minsky-check-rule-portability-spike.md` for the full per-script classification and recommended patch shape. Sub-tasks: A (spike write-up, **shipped**), B (upstream `--repo` flag to Minsky, gated on user approval per rule #14), C (build adapter + runner once any rule is portable), D (CI gate + ARCHITECTURE + defer 6 downstream tasks). Closes when all four sub-tasks ship and the 6 `adopt-rule-N` tasks reference the adapter.
  **Files**: see each sub-task
  **Acceptance**: All four sub-tasks land. 6 dependent `adopt-rule-N` tasks edited to defer to this adapter. ARCHITECTURE.md dependency-table includes Minsky scripts. `node scripts/run-rule-lints.mjs --json` runs against agentbrew and reports per-rule pass/fail.
  **Hypothesis**: Wiring up Minsky scripts via an adapter saves ~1000 LOC of reimplementation and provides automatic propagation of Minsky's bug fixes. Cost: ~150 LOC adapter + ~80 LOC runner + 1 upstream Minsky PR. Net shrink: ~850 LOC + structural insurance against rule drift.
  **Pivot**: Empirical finding from sub-task A (`docs/research/minsky-check-rule-portability-spike.md`): 3 of 12 Minsky scripts (rules 1, 6, 17) accept `--repo=` today and rule 11 is data-driven (also portable). The other 8 (rules 2, 3, 4, 5, 7, 9, 12, 13) hardcode `REPO_ROOT = resolve(HERE, "..")` and need an upstream `--repo=` flag PR. If that upstream PR is rejected or sits >90 days, vendor each script with a `# vendored from minsky@<sha>` header. If vendoring drifts >2 releases behind Minsky's, fall back to implementing each rule locally (the original `adopt-rule-N` tasks).
  **Measurement**: `node scripts/run-rule-lints.mjs --json | jq '.rules | length'` ≥ 5; `grep -c 'Blocked by: reuse-minsky-check-rule-scripts' TASKS.md` ≥ 6.
  **Anchor**: Minsky `vision.md` § 1 "Don't reinvent the wheel"; agentbrew `VISION.md` § "Strategy: delegate → contribute → absorb"; Gamma et al. 1994 *Design Patterns* — Adapter pattern.

- [ ] Contribute `--repo` flag upstream to Minsky's check-rule scripts (sub-task B)
  - **ID**: reuse-minsky-check-rule-upstream-pr
  - **Tags**: upstream, public-publish, reuse-over-reinvent
  - **Parent**: reuse-minsky-check-rule-scripts
  - **Blocked**: needs-user-approval — opening a PR against `github.com/fyodoriv/minsky` is a public-publish action per agentbrew AGENTS.md rule #14. Awaiting per-session user approval. See `docs/human-blocked-actions/reuse-minsky-check-rule-upstream-pr-2026-06-04.md`.
  - **Research**: 2026-06-04 — public publish gate confirmed
    Research/local patching is allowed, but creating or pushing the upstream PR to `github.com/fyodoriv/minsky` is explicitly covered by the TASKS.md publishing policy and AGENTS.md rule #14 (`Pushing to any public GitHub remote` and creating PRs/issues outside `acme/agentbrew`). No browser workaround applies because this is not a web UI access problem; the gate is the repository's publish policy.
  - **Last-enriched**: 2026-06-04
  - **Details**: For each Minsky script that hardcodes `REPO_ROOT = resolve(HERE, "..")` (per spike findings in sub-task A), add a `--repo <path>` CLI arg with `process.cwd()` fallback, matching the pattern already used by `check-rule-1-novel-justification.mjs`. Don't break existing usage — default keeps `resolve(HERE, "..")` when no `--repo` is passed. Add a regression test that calls each script with `--repo <fixture>` and asserts it reads from the fixture, not the script's own repo.
  - **Files**: ~/apps/tooling/minsky/scripts/check-rule-{4,9,12,13,17}*.mjs and their .test.mjs files (upstream PR)
  - **Acceptance**: Upstream PR merged in Minsky; new release tagged; `node ~/apps/tooling/minsky/scripts/check-rule-9-tasksmd-fields.mjs --repo ~/apps/tooling/agentbrew` reads agentbrew's TASKS.md.

- [ ] Build agentbrew adapter `src/adapters/rule-lint.{ts,minsky.ts}` (sub-task C)
  - **ID**: reuse-minsky-check-rule-adapter
  - **Tags**: adapter, ci-gate
  - **Parent**: reuse-minsky-check-rule-scripts
  - **Details**: Add `src/adapters/rule-lint.ts` (interface — `{ ruleId: string; target: string }` → `Promise<RuleLintResult>`), `src/adapters/rule-lint.minsky.ts` (impl that spawns each Minsky script with `--repo <target>` per sub-task B's output), and `src/adapters/rule-lint.minsky.test.ts`. Include a `selfTest()` static method on the impl per the agentbrew adapter pattern in ARCHITECTURE.md.
  - **Files**: src/adapters/rule-lint.ts (new), src/adapters/rule-lint.minsky.ts (new), src/adapters/rule-lint.minsky.test.ts (new)
  - **Acceptance**: `npm test src/adapters/rule-lint.minsky.test.ts` passes; `selfTest()` runs at least one rule against the agentbrew repo and reports pass/fail.
  - **Blocked by**: reuse-minsky-check-rule-upstream-pr

- [ ] Wire runner + CI gate + ARCHITECTURE + defer 6 adopt-rule-N tasks (sub-task D)
  - **ID**: reuse-minsky-check-rule-ci-wireup
  - **Tags**: ci, architecture, task-coordination
  - **Parent**: reuse-minsky-check-rule-scripts
  - **Details**: Add `scripts/run-rule-lints.mjs` (iterates adapter, JSON output for CI). Wire a `.github/workflows/rule-lints.yml` (or extend existing) to run it on every PR. Add a row to `ARCHITECTURE.md`'s dependency table for `@minsky/check-rule-scripts`. Edit the 6 `adopt-rule-N` tasks (3, 8, 9, 10, 12, 16) so their **Build** section references this adapter and adds `**Blocked by**: reuse-minsky-check-rule-scripts`.
  - **Files**: scripts/run-rule-lints.mjs (new), .github/workflows/rule-lints.yml (new/edit), ARCHITECTURE.md, TASKS.md (6 task edits), CHANGELOG.md
  - **Acceptance**: `node scripts/run-rule-lints.mjs --json | jq '.rules | length'` ≥ 5; CI workflow runs on every PR and blocks merge on failing rules; ARCHITECTURE dependency table updated; all 6 `adopt-rule-N` tasks defer to this.
  - **Blocked by**: reuse-minsky-check-rule-adapter

- [ ] Awaiting upstream review: `block/ai-rules#96` adds `--source-dir`/`--target-dir` flags
  **ID**: delegate-rules-to-ai-rules-slice-6a-followup
  **Tags**: architecture, simplify, delegate, sub-task, upstream-pr, awaiting-review
  **Details**: **Filed 2026-05-13** as [block/ai-rules#96](https://github.com/block/ai-rules/pull/96). The 4-file diff + new regression tests landed cleanly on `fyodoriv/ai-rules:feat/source-target-dir-flags`. Test results: 327 passing, 1 ignored (documented v1 limitation re: agent-trait refactor for full source/target separation), 0 failing. The follow-up agentbrew change (~20 LOC in `src/sync/rules-delegate.ts` to use explicit `--source-dir`/`--target-dir` instead of `cwd:` option) is gated on the upstream PR landing. Once `block/ai-rules#96` merges + a new release ships, this task closes after: (a) updating `src/sync/rules-delegate.ts` to use the new flags, (b) recording the merged PR # in `docs/competition/block-ai-rules-vs-agentbrew.md` slice 6 (a).
  **Files**: src/sync/rules-delegate.ts (~20 LOC change once #96 lands); docs/competition/block-ai-rules-vs-agentbrew.md (table update).
  **Acceptance**: block/ai-rules#96 is merged + a new release exists; agentbrew's `delegateRulesGenerate` is updated to use `--source-dir`/`--target-dir` instead of `cwd:`; competition doc updated with merged PR number.
  **Blocked**: needs-upstream-merge — waiting on block/ai-rules maintainers.

<!-- Phase 1 (hooks-phase-1-cat-a-deterministic) COMPLETE 2026-06 — all 26 Cat A
     hooks shipped with scripts + manifest entries + per-hook fixture tests, and
     the production decision log (scripts/hook-observation.sh) confirms every one
     fired its enforcing verdict ≥1 time over a >7-day window. Removed per the
     tasks.md "completed tasks are deleted" rule; history is in git + PR. The
     observation gate that proved acceptance now lives in scripts/hook-observation.sh
     and is the precondition check Phase 3 re-runs before decommissioning rules. -->

## P1

- [ ] Remove stale Agentfile command and agent source dirs on sync
  - **ID**: prune-stale-agentfile-source-dirs
  - **Tags**: agentfile, sync, state, stability
  - **Details**: `mergeAgentfileCommandDirs` and `mergeAgentfileAgentDirs` in `src/agentfile-apply.ts` only add paths to `state.commandSourceDirs` and `state.agentSourceDirs`. When an Agentfile drops or moves a `commands:` path, the old entry stays in state, and sync keeps deploying commands from a directory that is gone or stale. Several Agentfiles (global, project, overlay) write the same lists, so each entry must record which Agentfile owns it before pruning is safe.
  - **Files**: src/agentfile-apply.ts, src/agentfile-apply.test.ts, src/core/state.ts
  - **Acceptance**: (1) every `origin: agentfile` entry records its owning Agentfile; (2) an apply removes entries owned by that Agentfile that it no longer declares; (3) entries owned by other Agentfiles or added by the user are never removed; (4) a regression test covers a moved `commands:` path.

- [ ] Clear dev-dependency audit findings
  - **ID**: dev-dependency-audit-findings
  - **Tags**: security, dependencies, stability
  - **Details**: `npm audit --omit=dev` is clean, so the published package is not affected. `npm audit` still reports 48 findings in dev-only dependencies (5 low, 18 moderate, 25 high), and GitHub Dependabot flags the default branch. Fix them with semver-compatible updates first, then handle any major bumps one package at a time.
  - **Files**: package.json, package-lock.json
  - **Acceptance**: (1) `npm audit` reports no high findings; (2) `npm ci` works with npm 11; (3) lint, build, and the full test suite pass.

- [ ] Fix or retire the LLM verifier tier — all 12 verifiers fail open and never enforce
  - **ID**: llm-verifier-tier-never-returns-verdict
  - **Tags**: scout, hooks, llm-verifier, verification, latency, stability
  - **Details**: Every `tier: verifier` hook routes through `hooks/lib/claude-verifier.sh`, which shells out to `claude --print`. On a Mac without a working verifier backend that call never returns: measured empty responses at 5s, 30s and 60s alarms, with Claude Code session env stripped (`CLAUDECODE`, `CLAUDE_CODE_*` unset) and with `--settings '{"hooks":{}}'`, so it is neither recursion nor a session-nesting artifact. The wrapper then hits the fail-safe at `claude-verifier.sh:93` and returns `ALLOW verifier-empty-response`, and because the call is wrapped in `2>/dev/null` nothing is ever surfaced — a permanently dead verifier is indistinguishable from a clean ALLOW. Transcript evidence over 5 sessions: 263 `PreToolUse:Bash` and 98/98 `UserPromptSubmit` hook runs recorded `timedOut: true`, `PreToolUse:Bash` ran to a 14.9s median (p90 58.6s, max 546.9s), and successful runs alone consumed 118 minutes of blocking time. Net effect: the tier costs ~15s per Bash call and ~30s per Edit while enforcing nothing. Two viable directions: (a) make the verifier runner work without spawning a full `claude` CLI (direct API call, or a long-lived warm process), or (b) retire the tier and re-express the highest-value checks deterministically. Either way the silent-failure mode must go: the runner needs a distinguishable health state and a self-check. Note `gtimeout`/`timeout` are absent on this machine so the `perl alarm` fallback branch is the one in use — that branch works correctly and is not the bug.
  - **Files**: hooks/lib/claude-verifier.sh, hooks/manifest.yaml, src/hooks/manifest.ts, scripts/hook-observation.sh, tests/hooks (verifier health fixture)
  - **Acceptance**: (1) a verifier that cannot reach its model reports a distinguishable state instead of a silent ALLOW; (2) a self-check or doctor surface flags "verifier never returns a verdict" within one run; (3) either `claude --print` returns a verdict inside the configured budget on a clean machine, or the verifier tier is disabled by default and its manifest entries say so; (4) a regression test asserts that an empty/failed model response is reported, not swallowed.
  - **Hypothesis**: The verifier tier currently delivers zero enforcement at a ~15s-per-tool-call cost, so making the failure visible (then fixing or retiring the runner) removes the whole cost with no loss of enforcement.
  - **Success**: median `PreToolUse:Bash` hook duration drops below 5000ms and no verifier-tier hook records `timedOut: true` across a 50-tool-call session.
  - **Pivot**: If `claude --print` proves healthy on other machines and this is personal-Mac-only, keep the tier but gate it behind a startup health probe that disables verifiers when the probe fails.
  - **Measurement**: `jq -r 'select(.type=="attachment") | .attachment | select(.hookName=="PreToolUse:Bash") | .durationMs' ~/.claude/projects/*/*.jsonl | sort -n | awk '{a[NR]=$1} END{print a[int(NR/2)]}'`
  - **Anchor**: VISION.md G5 drift-detection + auto-repair; Nielsen (1993) 1s/10s interaction-latency thresholds — a 15s blocking pre-tool hook is far past the point where the loop stalls.

- [ ] Stop false MCP heal records and repair the timed-out server/agent pairs
  - **ID**: mcp-windsurf-cluster-stale-failures-9-plus-days
  - **Tags**: scout, mcp, health, heal, copilot, opencode, stability
  - **Scope**: Windsurf and Devin are deprecated and frozen (owner decision 2026-10-02). Leave their pairs alone; do not count or fix them.
  - **Details**: Updated 2026-09-28: the failures are no longer windsurf-only. `~/.cache/agentbrew/mcp-health.json` lists failing server/agent pairs on several agents. `agentbrew status` shows 15, because 5 are suppressed on purpose (figma per-client OAuth x4, and `ask-human`/copilot, see `re-promote-ask-human-mcp-after-stdio-fix`). Of the 15: (a) 14 are launcher timeouts: `chrome-devtools`, `playwright`, `shadcn-mcp`, `github` and `tasks-mcp` on windsurf, devin, copilot and opencode. The same `chrome-devtools` and `playwright` servers are healthy on claude-code, so the per-agent launch config is the likely shared cause. (b) 1 is a login failure: `railway`/claude-code is not logged in. The heal history of the shown pairs holds 124 attempts. All 124 are recorded `healed: true`, but no pair recovered. Cause: `runMcpSyncHeal()` in `src/mcp/heal-actions.ts` returns `healed: true` after `syncMcpServers()` and does not re-probe. Steps: (1) record `healed: true` only when a re-probe after the heal action returns ok; (2) report a logged-out server as needs-login with its login command, and do not auto-heal it; (3) find and fix the shared launcher fault for class (a); (4) flag any pair that fails for more than 24h.
  - **Files**: src/mcp/heal-actions.ts, src/mcp/heal-cycle.ts, src/mcp/health-snapshot.ts, src/mcp/probe.ts, src/status.ts, src/core/mcp-agent-map.ts, src/health.ts, TASKS.md
  - **Acceptance**: (1) a unit test with a fake probe shows that a heal whose re-probe still fails is recorded `healed: false`; (2) a logged-out server shows as needs-login with its exact login command and is not counted as failing; (3) `agentbrew mcp probe --deep` returns ok or a documented skip for the 14 class-(a) pairs; (4) a staleness check flags any pair that fails for more than 24h.
  - **Hypothesis**: One per-agent launcher fault causes the 14 timeout pairs, and false `healed: true` records hide it (124 of 124 recorded heals fixed nothing). A re-probe gate plus a launcher fix takes non-login failing pairs from 14 to 0 and false heal records from 124 to 0.
  - **Success**: After `agentbrew mcp probe --deep`, the Measurement command prints 0, and no new heal record says `healed: true` when its re-probe failed.
  - **Pivot**: If the launcher fix clears fewer than 7 of the 14 timeout pairs, drop the shared-cause theory and triage each server. Keep the re-probe gate and the 24h staleness alarm in both cases.
  - **Measurement**: `jq '[.servers[] | select(.status != "ok" and (.status | startswith("skipped_") | not) and (.suppression == null) and ((.lastError // "") | test("401|403|logged in") | not))] | length' ~/.cache/agentbrew/mcp-health.json` prints 0 (baseline 2026-09-28: 14).
  - **Anchor**: VISION.md G5 drift-detection + auto-repair; DORA MTTR (Forsgren, Humble, Kim, *Accelerate*, 2018) for detect-to-repair time; Beyer et al., *Site Reliability Engineering*, 2016, Ch. 6 "Monitoring Distributed Systems" (monitor the symptom, not the cause).


  **ID**: context-budget-weekly-audit-active
  **Tags**: token-budget, metrics, context, p1
  **Details**: Infrastructure ships in `agentbrew measure context` + `~/.config/agentbrew/metrics/latest.json` + `context-budget` skill. Each week (or when token pressure is reported): run measure, diff history, run lint, triage TASKS.md trim tasks (`trim-shared-rules-md-to-under-8k-tokens`, etc.). Recurring cadence and acceptance criteria live in `RECURRING.md` → **context-budget-weekly-audit**. Cursor ring remains manual (`metrics/manual-snapshots/`).
  **Files**: `src/measure/context-budget.ts`, `scripts/measure-context-budget.sh`, `skill-plugins/dev/context-budget/SKILL.md`, `templates/rules/context-budget-hygiene.mdc`, `~/.config/agentbrew/metrics/latest.json`
  **Acceptance**: `agentbrew measure context --dry-run` exits 0 when lint clean; `latest.json` has `schemaVersion`, `static.projectedDeployedTokens`, `inventory.*`; agents invoke `context-budget` skill without manual metric setup.

- [ ] Raise Starship `scan_timeout` to stop directory-scan warnings
  - **ID**: dotfiles-starship-scan-timeout
  - **Tags**: scout, dotfiles, starship, p1
  - **Details**: `agentbrew status` / shell init may warn that Starship directory scans exceed default timeout on large trees. Increase `scan_timeout` in dotfiles starship config (or exclude heavy paths) so status/shell init stays quiet.
  - **Files**: external repo `dotfiles` starship.toml (or chezmoi source)
  - **Acceptance**: Fresh shell + `agentbrew status` show no Starship scan_timeout warning.

- [ ] Decide Claude Code MCP permission allowlist ownership
  - **ID**: decide-claude-code-mcp-permission-ownership
  - **Tags**: scout, mcp, permissions, claude-code, drift
  - **Details**: Scouted while adding declarative `mcpPermissionsConfig` sync for Cursor CLI and Devin. Claude Code also has a `permissions.allow` surface in `~/.claude/settings.json` that can contain `mcp__<server>__*` entries, but this patch intentionally stayed focused on the reported Cursor `cli-config.json` gap and existing Devin behavior. Decide whether agentbrew should own Claude Code's MCP permission entries through the same declarative surface or leave them to Claude Code / user-managed policy.
  - **Files**: `src/core/agents.yaml`, `src/sync/mcp-sync.ts`, `src/drift-checks/mcp.ts`, `docs/user-stories/03-add-mcp-server.md`, `docs/user-stories/06-drift-detection.md`
  - **Acceptance**: A researched decision is recorded in code/docs/tests: either Claude Code declares `mcpPermissionsConfig.file: ~/.claude/settings.json` with regression coverage for sync + drift, or documentation explains why Claude Code permission ownership remains out of scope and drift checks deliberately skip it.

- [ ] Classify remaining MCP heal churn cases before suppression
  - **ID**: mcp-heal-loop-classify-tasks-github-churn
  - **Tags**: scout, mcp, auto-heal, catalog, stability, p1
  - **Details**: Scouted while implementing `mcp-heal-loop-known-failure-taxonomy`. The original incident also named `tasks-mcp` tools/list timeouts and some `github` launch/smoke failures, but only `ask-human` currently has catalog metadata documenting a deterministic upstream launcher fault. Research the remaining churn patterns and add catalog `probeSuppression` only when the root cause is deterministic enough to avoid masking real regressions.
  - **Files**: `src/catalog.yaml`, `src/mcp/heal-cycle.ts`, `src/mcp/heal-actions.ts`, `src/mcp/health-snapshot.ts`, `TASKS.md`
  - **Acceptance**: `tasks-mcp` and `github` scheduler probe churn cases are either backed by precise catalog suppression metadata plus regression tests or documented as intentionally unsuppressed with a manual/auth/config remediation path.

- [ ] Align launchagent Node versions to stop recurring macOS permission prompts
  - **ID**: dotfiles-launchagent-node-version-sprawl
  - **Tags**: scout, dotfiles, launchagent, node, permissions, mcp, p1
  - **Details**: Scouted 2026-06-10 while diagnosing `agentbrew fix` browser probe churn. The scheduler tick launches a fleet of `npx`-spawned Node MCP servers that bind sockets, which re-triggers macOS "node would like to accept incoming connections / find devices on local network" prompts when the exact Node binary path changes. The host has multiple fnm Node installs (`v20.20.2`, `v24.14.0`, `v24.15.0`, `v24.16.0`); the LaunchAgent path pins `v24.14.0` while the interactive shell default has moved, so macOS sees distinct Node binaries and prompts again.
  - **Files**: external repo `dotfiles` LaunchAgent templates and fnm/node setup modules; agentbrew docs may cross-link once the dotfiles fix lands.
  - **Acceptance**: Dotfiles launchagents and shell defaults resolve to one stable managed Node binary for scheduler-launched MCPs; stale fnm Node versions are pruned or explicitly ignored; approving macOS network permission once covers subsequent `agentbrew fix` ticks.
  - **Hypothesis**: Settling launchagents and shells on one Node path removes repeated permission prompts caused by binary-path drift.
  - **Success**: After one macOS approval, three consecutive `agentbrew fix` ticks produce no new Node network-permission prompts.
  - **Pivot**: If macOS still prompts with a stable Node path, move MCP scheduler probes behind non-socket fast-tier probes or pre-approved signed wrapper binaries.
  - **Measurement**: Compare `ps -axo command | grep '/fnm/node-versions/.*/node'` during scheduler probes before/after; after the fix, all scheduler Node processes use one versioned path.
  - **Anchor**: 2026-06-10 scheduler tick diagnosis; dotfiles owns LaunchAgent and fnm policy, agentbrew owns the scheduler workload.

- [ ] Rules source hygiene auto-repair is covered by a fixture-backed real-e2e scenario
  **ID**: rules-source-hygiene-real-e2e
  **Tags**: scout, rules, drift, real-e2e
  **Details**: Scouted while adding marker-managed Agentfile rules and `agentbrew rules dedupe`. The new source-drift path is covered by unit tests (`rules-hygiene`, `drift`, `repair`, `rules-sync`), but the full `status --fix` behavior is not covered by a sandbox scenario that exercises the CLI end-to-end. The gap matters because `npm run verify` caught one missing partial mock only in the full suite; a fixture-backed scenario would catch future wiring regressions without depending on brittle mocks.
  **Files**: `real-e2e/scenarios/*rules*.test.ts`, `real-e2e/fixtures/**`, `src/real-e2e/scenario-fixture.ts`, `src/drift-checks/rules.ts`, `src/sync/rules-sync.ts`
  **Acceptance**: A real-e2e scenario seeds duplicate blocks in `~/.config/agentbrew/shared-rules.md`, runs `agentbrew status --fix` (or the scenario helper equivalent), proves the source file is deduped, proves managed agent rules are redeployed from the cleaned source, then proves a second status run has no `rules-source` drift.
  **Hypothesis**: Exercising duplicate source rules through the same CLI path users run will catch wiring regressions that isolated unit tests and mocks can miss.
  **Success**: `npm run test:real-e2e:selected -- <rules-source-hygiene-scenario>` exits 0 and fails if `dedupeSharedRulesFile()` is no longer called before rules sync in `fix()`.
  **Pivot**: If the existing real-e2e harness cannot mutate `shared-rules.md` safely, add an integration test under `src/integration-essential-core.test.ts` using a temporary HOME instead.
  **Measurement**: The selected scenario reports one failing assertion before removing the `fix()` dedupe call and passes after restoring it.
  **Anchor**: VISION.md G5 (drift detection + auto-repair), docs/user-stories/06-drift-detection.md (auto-repair only touches managed content), docs/user-stories/04-share-rules.md (one shared-rules source of truth).
- [ ] `sync --agentfile ... --no-prune` preserves existing Agentfile-managed state
  **ID**: sync-agentfile-no-prune-preserves-state
  **Tags**: scout, agentfile, sync, no-prune
  **Details**: Scouted while healing live rules from trimmed dotfiles overlays. `sync --agentfile <overlay> --no-prune --only rules,instructions` still calls `applyAgentfileAndInstall()` with `authoritative: true` before sync modules run, so state-backed lists can be pruned even though sync pruning is disabled. This caused MCP state to temporarily drop back to the overlay's narrow set during live repair. The CLI should propagate no-prune semantics into Agentfile application or provide a separate additive overlay path.
  **Files**: `src/cli.ts`, `src/commands/cli-install.ts`, `src/agentfile-apply.ts`, `src/commands/cli-install.test.ts`, `src/integration.test.ts`
  **Acceptance**: A regression test seeds state with MCP servers/sources/command dirs, runs `sync --agentfile <overlay> --no-prune`, and proves previously managed entries remain while overlay entries are added/updated. The same test proves default prune behavior remains authoritative.
  **Hypothesis**: Passing prune semantics through Agentfile application prevents overlay syncs from deleting unrelated managed state before the sync phase starts.
  **Success**: The regression fails on current main by showing a removed pre-existing state entry, then passes after the CLI/apply path honors `--no-prune`.
  **Pivot**: If preserving all state under `--no-prune` conflicts with documented Agentfile authority, split the command surface into explicit `--agentfile-mode authoritative|additive` and document the default.
  **Measurement**: `npx vitest run src/commands/cli-install.test.ts src/integration.test.ts -t no-prune` exits 0 and fails when `applyAgentfileAndInstall()` hard-codes authoritative application.
  **Anchor**: VISION.md G5 (drift detection + auto-repair), docs/user-stories/06-drift-detection.md (auto-repair preserves user-managed/manual content), README.md sync command docs (`--no-prune` keeps stale items).

- [ ] Expose a repo-only base catalog loader for static analyzers
  **ID**: base-catalog-loader-for-static-analyzers
  **Tags**: scout, catalog, agent-artifacts, static-analysis
  **Details**: Scouted while implementing `agent-artifact-inventory-static-gate`. `loadCatalog()` intentionally merges the machine-local team overlay from `state.team.catalogOverlayPath`, which is correct for install/catalog UX but wrong for repo-owned static analyzers that must inventory only `src/catalog.yaml`. The new agent-artifact inventory therefore has to parse `src/catalog.yaml` directly to stay deterministic and avoid org/team overlay bleed-through. Add a small exported loader, for example `loadBaseCatalog({ path? })`, that reuses the existing catalog parsing/schema shape but never consults state or overlays.
  **Files**: `src/catalog/types.ts`, `src/catalog/types.test.ts`, `src/agent-artifacts/inventory.ts`
  **Acceptance**: Static analyzers can load only the base repo catalog without reading `state.yaml`; tests prove `loadCatalog()` still merges a configured overlay while `loadBaseCatalog()` returns only `src/catalog.yaml`; `collectAgentArtifacts()` uses the new loader and still reports zero diagnostics for the current repo.
  **Hypothesis**: Separating "base repo catalog" from "runtime merged catalog" removes duplicated YAML parsing and prevents future static gates from accidentally linting private/team overlay entries.
  **Success**: A fixture with an overlay-only MCP appears in `loadCatalog()` but not in `loadBaseCatalog()` or the agent-artifact inventory.
  **Pivot**: If catalog loading needs more cleanup, extract a pure `loadCatalogFile(path)` helper and implement both public loaders on top of it.
  **Measurement**: `npx vitest run src/catalog/types.test.ts src/agent-artifacts` stays green with explicit overlay/base split assertions.
  **Anchor**: VISION.md G4 "single source of truth" and AGENTS.md rule #8 "team overlay lives in the team overlay repo".

- [ ] Agentfile rules edits converge shared-rules.md instead of stacking stale blob copies
  **ID**: agentfile-rules-replace-not-append
  **Tags**: scout, rules, agentfile, drift, data-integrity
  **Details**: `mergeAgentfileRules` (src/agentfile-apply.ts) appends the Agentfile's `rules:` blob to `~/.config/agentbrew/shared-rules.md` whenever `existing.includes(rulesContent)` is false. Every edit to a repo Agentfile's rules blob therefore appends a full fresh copy while stale generations stay behind — found live on 2026-06-09 with FOUR stacked generations of the dotfiles blob (shared-rules.md grew to stacked duplicate blobs (see wc -l on shared-rules.md); deployed agent rules carried contradictory old/new mandate text side by side). Manually surgically de-duplicated this time. Fix the mechanism: track each Agentfile-origin blob with begin/end markers keyed by source (like rules-sync's managed section), so an apply REPLACES its own previous blob and removes it when the Agentfile drops the `rules:` key. Include a one-time migration/dedupe for shared-rules.md files that already contain stacked generations, plus a lint check that flags repeated blob heads.
  **Files**: `src/agentfile-apply.ts` (mergeAgentfileRules), `src/agentfile-apply.test.ts`, `src/lint.ts` (shared-rules bloat findings), `README.md`
  **Acceptance**: editing a sentence inside an Agentfile `rules:` blob and re-running `agentbrew sync` leaves exactly one copy of that blob in shared-rules.md (old text gone); a regression test covers edit→re-apply convergence; `agentbrew lint` flags a shared-rules file containing two copies of the same blob head.
  **Output**: code

- [ ] `agentbrew sync --pull` applies Agentfile source changes before pulling
  **ID**: sync-pull-applies-agentfile-first
  **Tags**: scout, sync, agentfile, sources
  **Details**: `sync --pull` runs `update()` in `handleSyncEarlyExits` (src/cli.ts) BEFORE `prepareSync` applies the global Agentfile, so source edits in the Agentfile (e.g. correcting `your-org/example-repo` shorthand — which resolves to github.com — to the GHE `git@github.example.com:...` URL) are invisible to the pull pass: it fetches the stale state entry, fails, and exits before the corrected entry ever lands in state. Workaround today is running a plain `agentbrew sync` (or `agentbrew install <source>`) first. Reorder so the Agentfile applies to state before the pull, or make `update()` re-load state after apply.
  **Files**: `src/cli.ts` (handleSyncEarlyExits/handleSyncCommand), `src/update.ts`, `src/sync-runner.ts`
  **Acceptance**: with an Agentfile source URL edited and stale state, a single `agentbrew sync --pull` pulls from the corrected URL and prunes the stale source entry; a test pins the apply-before-pull ordering.
  **Output**: code

- [ ] Fix 2 pre-existing test failures unrelated to feature work
  **ID**: fix-stale-test-failures
  **Tags**: scout, tests, flake
  **Details**: Scouted 2026-05-11 while landing `fix/skill-sync-follow-symlinks`. Two tests fail on a clean `main` checkout (confirmed by running with the symlink-fix changes stashed):
    1. `src/commands/cli-install.test.ts > registerDefaultAction > keeps a failing exit code when the state file exists but could not be loaded` — assertion `expected +0 to be 1`. The exit code handling for unreadable-state.yaml regressed.
    2. `src/real-e2e/scenario-fixture.test.ts > runWithScenarioSandbox > seeds a default state with detected agents for CLI scenarios` — `spawn ~/.local/share/fnm/node-versions/v24.15.0/installation/bin/node ENOENT`. The e2e harness pins an absolute Node binary path that doesn't exist on this machine (and won't exist on CI runners with different fnm versions).

    Together these block agents from running `npm run test:all` as a green baseline before adding new tests — every diff looks like it introduced failures until you stash and confirm.
  **Files**: [`src/commands/cli-install.test.ts`](src/commands/cli-install.test.ts), [`src/commands/cli-install.ts`](src/commands/cli-install.ts), [`src/real-e2e/scenario-fixture.test.ts`](src/real-e2e/scenario-fixture.test.ts), [`src/real-e2e/scenario-fixture.ts`](src/real-e2e/scenario-fixture.ts)
  **Acceptance**: `npm run test:all` exits 0 — 3508/3508 pass.
  **Output**: code
  **Hypothesis**: The 2 test failures have independent root causes: (1) exit-code handling regression in `registerDefaultAction`, (2) hardcoded absolute Node path from fnm. Fixing both unblocks `npm run test:all` as a green baseline.
  **Success**: `npm run test:all` exits 0 with all tests passing.
  **Pivot**: If the e2e test's Node path issue is systemic (fnm version varies per machine), replace the absolute path with `process.execPath` or a `which node` probe. If the exit-code test is flaky (timing), add a retry or mock the exit handler.
  **Measurement**: `npm run test:all 2>&1 | tail -1` shows all tests pass with 0 failures.
  **Anchor**: agentbrew AGENTS.md rule #1 (test before committing requires a green baseline); vitest documentation on `process.execPath`.

- [ ] integration.test.ts MCP server lifecycle pollutes the user's real ~/.codeium/mcp_config.json

  - **ID**: integration-test-pollutes-real-mcp-config-2026-05-21
  - **Tags**: integration-test, leak, scout, p3
  - **Hypothesis**: The `MCP server lifecycle: add → list → sync → verify in agent configs → remove` test in `src/integration.test.ts` reads from `join(TEST_HOME, ".codeium", "mcp_config.json")` to assert that the test server was NOT written there (windsurf is mcpm-managed, intersection skip). On my workstation the test reproducibly fails with `expected { command: 'npx', …(2) } to be undefined` — meaning `readMcpJson` is returning the REAL `~/.codeium/mcp_config.json` content (which has the `test-db` server lingering from prior runs) instead of the fixture. Confirmed pre-existing on clean `origin/main` (no relation to. Likely the `TEST_HOME` swap isn't propagating to `readMcpJson` path resolution, OR a prior run leaked `test-db` into the real config.
  - **Success**: `npx vitest run src/integration.test.ts -t "MCP server lifecycle"` passes on a clean checkout without touching anything outside the tmp dir.
  - **Pivot**: If `readMcpJson` correctly reads only `TEST_HOME`, the failure is "prior-run leak" — sweep `~/.codeium/mcp_config.json` for stray `test-db` entries and add a `beforeAll` cleanup that asserts the fixture starts empty.
  - **Measurement**: `cd ~/apps/agentbrew && npx vitest run src/integration.test.ts -t "MCP server lifecycle"`
  - **Anchor**: Vitest docs, "Globals and Isolation", 2025 — Section "Pool isolation". <https://vitest.dev/guide/test-context.html>
  - **Details**: Reproduced both with and without the fix. Stashing my changes and running on plain `origin/main` shows the same failure with the same `command: 'npx', args: ['test-db-mcp']` content in the assertion. This means the user's real workstation `~/.codeium/mcp_config.json` may have a leftover `test-db` server from a prior aborted test run that wasn't cleaned up. The test fixture should either (a) prove it's reading from `TEST_HOME` exclusively, or (b) sweep that key from the real file before/after the test. Found via the `feat/mcp-keychain-fallback-` PR validation.
  - **Files**: `src/integration.test.ts` (the "MCP server lifecycle" test block), possibly `src/mcp/mcp.ts:readMcpJson` (verify it resolves paths via `TEST_HOME`).
  - **Acceptance**: The integration test passes on a clean checkout, and a fresh run after the test exits leaves `~/.codeium/mcp_config.json` exactly as it was before the test ran.


- [ ] Wire the advertised `agentbrew skills validate` command to the existing skill validator
  **ID**: wire-skills-validate-command
  **Tags**: scout, cli, validation, correctness, skill-eval, P1
  **Details**: While authoring the workflow/debugging eval batch on 2026-06-04, `npm run dev -- skills validate --help` showed only the `coverage` subcommand, but multiple user-facing diagnostics still tell users to run `agentbrew skills validate`: `src/drift-checks/skills.ts:104`, `src/health.ts:170`, and related tests. The validator already exists in `src/skills/validate.ts` and display code exists in `src/skills/skill-validate-display.ts`; the missing piece is CLI registration under `agentbrew skills validate`.
  **Files**: `src/commands/cli-skills.ts`, `src/skills/validate.ts`, `src/skills/skill-validate-display.ts`, `src/drift-checks/skills.ts`, `src/health.ts`, tests under `src/skills/` or `src/commands/`.
  **Acceptance**: `npm run dev -- skills validate --help` documents a validate subcommand; `npm run dev -- skills validate --builtins` or the chosen equivalent exits 0 on current built-ins and renders the existing validation display; diagnostics that say "Run: agentbrew skills validate" point to a command that actually exists; `npm run verify` passes.
  **Output**: code

- [ ] Make companion competitor watch honor repo-specific competition directory names
  **ID**: companion-competitor-watch-competition-dir-drift
  **Tags**: docs, skills, companion, competitor, P1
  **Hypothesis**: Teaching the lane to discover `docs/competition/` as well as `docs/competitors/` prevents it from creating a parallel stale competitor corpus in repos like agentbrew.
  **Success**: In a repo that has `docs/competition/` and no `docs/competitors/`, the skill refreshes or reports the existing competition corpus instead of creating a competing directory.
  **Pivot**: If cross-repo naming is too varied for heuristics, make the competitor-doc directory a required flag or project config field.
  **Measurement**: `grep -n "docs/competition" skill-plugins/dev/companion-competitor-watch/SKILL.md`
  **Anchor**: agentbrew VISION.md G1 "Curate, not host" + companion-competitor-watch SKILL.md "Identify competitors" / "Where they live".
  **Details**: The current skill repeatedly names `docs/competitors/<NAME>.md`, but this repo's canonical competitor corpus is `docs/competition/*.md`. Running the lane as written can create a second directory and split prior art away from the docs the PR template and competitor-spot-check flow already read.
  **Files**: `skill-plugins/dev/companion-competitor-watch/SKILL.md`, `docs/competition/`, `TASKS.md`.
  **Acceptance**: The skill documents how to detect `docs/competition/` vs `docs/competitors/`, its task template links to the detected directory, and a dry-run in this repo does not propose creating `docs/competitors/`.

- [ ] Establish a numbered constitutional rules section in `VISION.md` (Minsky-style)
  **ID**: establish-vision-constitutional-rules
  **Tags**: scout, constitution, vision-alignment
  **Details**: Minsky's `vision.md` ships 17 numbered, CS-anchored, CI-enforced constitutional rules. agentbrew's VISION.md has principles ("delegate → contribute → absorb", "curator, not host") but they're prose — not numbered, not CS-anchored, not individually CI-enforced. Adopting Minsky's structure makes every PR review able to cite "violates rule N".

  Build: add a `## Constitutional rules` section to `VISION.md`. Number 1–N, each with: (a) one-paragraph statement, (b) CS / engineering literature anchor (e.g. Gamma 1994 for adapters, Beer 1972 for VSM, Armstrong 2007 for let-it-crash), (c) link to its deterministic CI lint at `scripts/check-rule-<N>-<name>.mjs`, (d) escape hatch (when explicit deviation is allowed). Starter set inferred from existing AGENTS.md rules:

  1. Curator, not host (delegate → contribute → absorb) — anchored to Minsky rule #1, Gamma Adapter pattern
  2. Every external dependency behind an interface (`src/adapters/`) — Minsky rule #2
  3. Test-first, doc-first — Minsky rule #3
  4. Tickets are prompts (outcome-shaped, not implementation-shaped) — dheer.co/tickets-are-prompts
  5. Always scout and record (every PR carries scouted tasks) — agentbrew AGENTS.md rule #11
  6. Hypothesis-driven (every task ships H/S/P/M/A fields) — Minsky rule #9
  7. Deterministic enforcement (every rule has a CI lint) — Minsky rule #10
  8. Default by default (new behavior is the default, not opt-in) — Minsky rule #16
  9. Proactive healing (observation IS the fix) — Minsky rule #17
  10. Multi-agent git safety (no `reset --hard`, no `add -A`) — agentbrew AGENTS.md
  11. Publishing requires per-action approval — agentbrew AGENTS.md rule #14
  12. README drift is a bug (CI-enforced sync) — agentbrew AGENTS.md
  13. No org-specific content in shared paths (overlay-only) — agentbrew AGENTS.md rule #8

  Each rule lands with: (a) row in VISION.md table, (b) sentence in CHANGELOG, (c) a `scripts/check-rule-<N>-<name>.mjs` (or pointer to existing lint), (d) for "iron" rules: PR template gate.

  This is the meta-task that legitimises the four follow-up rules (`adopt-rule-9-iron-hdd`, `-rule-10-deterministic-enforcement`, `-rule-12-proactive-healing`, `-rule-3-doc-first`).
  **Files**: VISION.md (new `## Constitutional rules` section), scripts/check-rule-* (one per rule, port shapes from Minsky), CHANGELOG.md, .github/pull_request_template.md (extend Vision-trace block with "Rule violations:" line)
  **Acceptance**: `VISION.md` has a numbered constitutional rules section with ≥10 rules, each with: anchor, CI lint path, escape hatch. Every rule has either a working `scripts/check-rule-<N>-<name>.mjs` OR a documented "advisory only" classification. PR template surfaces rule citations.
  **Hypothesis**: Numbering + CS-anchoring + CI-enforcing the existing soft principles makes drift visible in review and removes the "but the spirit said…" debate class.
  **Success**: Within 30 days of shipping, ≥3 PRs are rejected or changed in review citing a specific rule number (vs the current "feels wrong" review pattern).
  **Pivot**: If numbered rules calcify into bureaucracy (PRs take 2x longer to review because reviewers cite rules nitpickingly), shrink to ≤5 iron rules and demote the rest to soft guidance.
  **Measurement**: `grep -c '^### [0-9]\+\.' VISION.md ≥ 10` AND `ls scripts/check-rule-*.mjs | wc -l ≥ 5`.
  **Anchor**: Minsky `vision.md` § "The constitution" (17 numbered rules); Havelund & Goldberg 2008 *Runtime Verification* (the project specification + runtime monitor pattern); Lessig 2006 *Code is Law* (norms-as-code argument for why this works).

- [ ] Make hypothesis-driven development an iron rule (rule #9) — CI-required H/S/P/M/A on every P0/P1
  **ID**: adopt-rule-9-iron-hdd
  **Tags**: scout, rule-9, ci-gate, constitution
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: agentbrew already uses Minsky-style Hypothesis / Success / Pivot / Measurement / Anchor fields on many tasks (see `agentbrew-tasks-rule9-fill-sweep` for the existing partial-coverage state). But they're voluntary. Minsky's rule #9 is iron: no exemption for small fixes, obvious bugs, or refactors. Every change declares — before code is written — its hypothesis, success threshold, pivot threshold, measurement command, and literature anchor. Vanity metrics and post-hoc metrics are forbidden.

  Build:
  1. Promote H/S/P/M/A to REQUIRED for `## P0` and `## P1` tasks via `src/docs/tasks-md-output-cadence.test.ts` (extend the existing validator).
  2. Add `scripts/check-rule-9-hdd-fields.mjs` matching Minsky's `pickHostTask` regex shape (`^\*\*<Field>\*\*:\s*(.+)$` per line — single-line values).
  3. Make the agentbrew task-picker (whichever workflow picks next-task) reject P0/P1 tasks missing any of the 5 fields.
  4. Extend the `add-task.sh` helper to prompt for each field if missing.
  5. Sweep the 12 existing P0/P1 tasks missing fields (already tracked in `agentbrew-tasks-rule9-fill-sweep`) — close that task by completing the sweep within this PR's scope.
  6. Add escape hatch: `**Replace? Relocate?:**` answer can be `N/A — <reason ≥3 chars>` if genuinely not applicable, same as Minsky's pattern.

  Cross-link: `agentbrew-tasks-rule9-fill-sweep` (existing P1) becomes a subtask of this — completes when the rule lands.
  **Files**: src/docs/tasks-md-output-cadence.test.ts (extend), scripts/check-rule-9-hdd-fields.mjs (new), scripts/add-task.sh (prompt for fields), TASKS.md (sweep the 12 violators), .github/pull_request_template.md (mention rule #9 enforcement)
  **Acceptance**: (a) `node scripts/check-rule-9-hdd-fields.mjs` returns 0 errors on every P0/P1 task; (b) the validator runs in CI on every PR; (c) `add-task.sh --priority P1` prompts for all 5 fields and refuses to insert without them; (d) the existing 12-task sweep is complete.
  **Hypothesis**: Making H/S/P/M/A iron (required, CI-gated, no exemption) forces "is this change actually worth doing?" thinking before code is written — same effect as Minsky's rule #9 achieves.
  **Success**: After 30 days, the next 10 P1 tasks all ship with all 5 fields populated. Mean time from task-claim to pivot-decision drops because pivot thresholds are written down up-front.
  **Pivot**: If field-prompting blocks legitimate small fixes (e.g. "fix typo in README" can't honestly produce a measurable hypothesis), add a `**Iron-exemption-justified-by:**` field that requires a one-line argument and is reviewer-checked. Don't drop the rule.
  **Measurement**: `node scripts/check-rule-9-hdd-fields.mjs --json | jq '.violations | length'` returns 0; `gh pr view <N> --json statusCheckRollup | jq '.statusCheckRollup[] | select(.name=="rule-9-hdd")'` returns pass on every PR.
  **Anchor**: Minsky `vision.md` § 9 "Pre-registered hypothesis-driven development (iron rule)"; Basili/Caldiera/Rombach 1994 *Goal-Question-Metric*; Popper 1959 *Logic of Scientific Discovery* (falsifiability — pivot threshold IS the falsifier).

- [ ] Make deterministic enforcement an iron rule (rule #10) — every constitutional rule has a CI lint
  **ID**: adopt-rule-10-deterministic-enforcement
  **Tags**: scout, rule-10, ci-gate, constitution
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: Minsky's rule #10: "Every constitutional rule must be enforced by a deterministic CI check — not a Skill, not an LLM, not 'the agent will remember'. LLM-driven checks are advisory only; never load-bearing." When a rule resists mechanisation, split into deterministic substrate + explicit human-judgement layer. When a deterministic linter ships, any prior Skill-based enforcement is removed in the same PR (the ratchet rule).

  agentbrew has ~rules in AGENTS.md that match Cat A/B.md but mostly relies on the reviewer noticing violations. Examples of rules that should be CI-lints but aren't:
  - Rule #8 "team overlay lives in team overlay repo" — has `tests/no-internal-refs.bats` style coverage but not an end-to-end gate
  - Rule #11 "Always scout and record" — has no CI lint; reviewers eyeball PR diff for new TASKS.md entries
  - Rule #12 "A ticket is optional" — no CI check (github.com has no Jira check)
  - Rule #14 "Publishing requires per-action approval" — purely operator-side, no agentbrew lint
  - Rule #15 (Minsky terms — agentbrew doesn't have one yet) "Milestone alignment gate before picking tasks" — not enforced

  Build:
  1. Audit every numbered rule in VISION.md (after `establish-vision-constitutional-rules` lands) and map each to either: (a) existing CI lint, (b) new `scripts/check-rule-<N>-<name>.mjs`, (c) declared "advisory only" with rationale.
  2. Add `scripts/check-rule-10-coverage.mjs` (meta-lint) that parses VISION.md, finds every numbered rule, and asserts each row points at an existing lint OR is explicitly marked advisory.
  3. CHANGELOG entry naming the substrate vs human-judgement split for each rule that can't be fully mechanised.
  4. Ratchet rule: any PR that adds a new LLM-judged enforcement (e.g. "the reviewer agent checks for X") is rejected — must add deterministic gate alongside.
  **Files**: scripts/check-rule-10-coverage.mjs (new), scripts/check-rule-*.mjs (audit + extend per rule), VISION.md (cross-link each rule to its lint), CHANGELOG.md, .github/pull_request_template.md (require "rule-lint coverage" checklist for new constitutional rules)
  **Acceptance**: every numbered rule in VISION.md has a row pointing at either a passing CI lint or a "ADVISORY ONLY — <reason>" declaration; `scripts/check-rule-10-coverage.mjs` returns 0; the meta-lint runs in CI on every PR.
  **Hypothesis**: Forcing every rule into either deterministic enforcement OR explicit advisory removes the silent "I forgot the rule existed" failure mode that prose-only rules suffer from.
  **Success**: After 30 days, ≥80% of constitutional rules have working CI lints; the remaining ≤20% are explicitly marked advisory with rationale.
  **Pivot**: If certain rules genuinely cannot be mechanised (e.g. "code is clean") and the advisory-only carve-out grows past 50% of rules, the constitution itself is too aspirational — narrow it to enforceable rules and move soft guidance to a separate `docs/style.md`.
  **Measurement**: `node scripts/check-rule-10-coverage.mjs --json | jq '[.rules[] | select(.lint == null and .advisory == false)] | length'` returns 0.
  **Anchor**: Minsky `vision.md` § 10 "Deterministic enforcement (iron rule)"; Havelund & Goldberg 2008 *Runtime Verification* (specification monitor pattern); Lessig 2006 *Code is Law* (code-as-norm).

- [ ] Make proactive healing an iron rule (rule #12 / Minsky rule #17) — observation IS the fix
  **ID**: adopt-rule-12-proactive-healing
  **Tags**: scout, rule-12, ci-gate, constitution
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: Minsky's rule #17 (their highest-numbered, iron): "Observation IS the fix. Every error you see — `spawn-failed`, `scope-leak`, `ETIMEDOUT`, stack traces, hung processes, flaky tests, red CI checks — is treated as work to ship in the SAME session, the SAME PR if possible. 'Observe and report' is forbidden. 'Mental note for later' is forbidden."

  Four mandatory parts:
  1. **Same-session action.** The agent who observed the error owns the fix before its session ends. If the fix needs an external action, file a `TASKS.md` block with `**Blocked**: <one-word-code>` and the unblock path on the first line — never both fix-attempted and silently-moved-on.
  2. **Fix the class, not the instance.** Land the lint or invariant that prevents the entire category (rule #10 shape). A 401 today means the auth path is fragile — add a CI lint, not just a retry.
  3. **Heal before reporting.** Every status message to the operator must carry an active verb: `fixed`, `patched`, `rolled out`, or `filed-blocked-because`. A bulleted summary of failures with zero merged fixes is the exact pattern this rule forbids.
  4. **Deterministic gate.** `scripts/check-rule-12-proactive-heal.mjs` runs on every PR: if observed-error tokens > 0 in the PR body or diff comments AND `(prs-opened + tasks-filed + commits-landed) == 0`, the PR is rejected.

  agentbrew today has the `scout and record` rule (#11 in AGENTS.md) which is the WEAKER form — "file a task for follow-up". Rule #12 is stronger: file AND fix what you can, in the same PR.

  Build:
  1. `scripts/check-rule-12-proactive-heal.mjs` that parses the PR body + diff for error-token regex (`spawn-failed`, `ETIMEDOUT`, `401`, `404`, stack trace lines, red CI markers, etc.) and asserts at least one fix marker (`fixed:`, `patched:`, `filed-blocked-because:`, or matching TASKS.md `**Blocked**:` line).
  2. PR template extension: add "Scout log" section that explicitly lists every error/anomaly observed during this PR's work, with the disposition for each.
  3. AGENTS.md: replace the weaker "scout and record" rule #11 with rule #12 (same-PR fix-class-not-instance).
  4. Trigger phrases that activate this rule (per Minsky): "fix bugs before they happen", "be proactive", "make sure agentbrew picks them up", "make it persist", "make it iron rule". When the operator uses these, the agent must demonstrate same-session fixes, not just file tasks.

  Cross-link: replaces / strengthens existing AGENTS.md rule #11.
  **Files**: scripts/check-rule-12-proactive-heal.mjs (new), .github/pull_request_template.md (add Scout log section), AGENTS.md (replace rule #11 with rule #12), VISION.md (cross-link to constitution table)
  **Acceptance**: (a) lint runs on every PR; (b) PRs that observe errors without shipping fixes OR explicit `Blocked: <code>` tasks are rejected; (c) PR template Scout log section is filled on every non-trivial PR; (d) AGENTS.md rule #11 is upgraded to rule #12 shape.
  **Hypothesis**: Forcing same-PR fix-class-not-instance prevents the "I noticed but didn't fix" pattern that lets bugs survive across sessions.
  **Success**: After 30 days, ≥50% of PRs include at least one same-session fix beyond the PR's primary scope (scouted findings shipped in the same commit).
  **Pivot**: If "must fix same session" causes scope creep that delays PRs by >50%, weaken to "must file same PR" (matching current rule #11) and shift the iron-discipline to a follow-up session that picks up scouted tasks within 24h.
  **Measurement**: `node scripts/check-rule-12-proactive-heal.mjs --json | jq '.violations | length'` returns 0 on shipped PRs; PR-body word count of fix markers averages ≥1 per PR.
  **Anchor**: Minsky `vision.md` § 17 "Proactive healing (rule #17 — iron, no exemption)"; Erlang/OTP "let-it-crash" supervisor pattern (Armstrong 2007); Beck 2002 *Test-Driven Development* (fix-it-when-you-see-it discipline).

- [ ] Adopt Minsky-style adapter discipline — `src/adapters/`, dependency table, Replace? Relocate? gate
  **ID**: adopt-minsky-adapter-discipline
  **Tags**: scout, architecture, vision-alignment
  **Details**: Minsky's `vision.md` rules #1 and #2 codify what agentbrew's VISION.md says softly: every external dependency lives behind an interface in `novel/adapters/<name>.ts` with a vendor impl `<name>.<vendor>.ts`, a `selfTest()` method, and a row in a load-bearing dependency table parsed by CI (`scripts/check-rule-2-dep-coverage.mjs`). Every new feature ships paired with a "Replace? Relocate?" research task. Quarterly: scan whether each novel layer is now solvable upstream and replace yourself. See `~/apps/tooling/minsky/ARCHITECTURE.md` § "The adapter pattern" and § "The dependency table".

  agentbrew already delegates well (vercel/skills, mcpm.sh, block/ai-rules) but has no iron discipline behind it. Three concrete gaps surfaced by the 2026-05-25 ecosystem audit:

  1. **No `src/adapters/` layer.** Sync engines import vendor concepts directly (`src/sync/mcp-sync.ts` knows about `mcpm`, `src/sync/rules-sync.ts` knows about `ai-rules`, `src/sync/skills-sync.ts` knows about `skills` CLI). A future swap (e.g. replacing mcpm.sh with the official MCP Registry — see `mcp-registry-pull-aggregator` task) requires touching every consumer.

  2. **No dependency table.** ARCHITECTURE.md has prose mentions of delegated tools but no machine-parseable table that a CI lint can check. Compare Minsky's `ARCHITECTURE.md` § "The dependency table" — load-bearing, CI-enforced.

  3. **No "Replace? Relocate?" research-task pattern.** Per Minsky rule #1: "Every new feature ships with a paired 'Replace? Relocate?' research task (default candidate hosts: agentbrew, dotfiles, tasks.md)." agentbrew has the `delegate → contribute → absorb` strategy but no required-pairing rule. Result: features ship without asking whether the ecosystem now solves it (e.g. the MCP catalog hand-curation should have been a Replace task once `modelcontextprotocol/registry` shipped its v0.1 API freeze in Oct 2025).

  Concrete build:
  - Create `src/adapters/` with `task-queue.ts`, `mcp-registry.ts`, `skill-source.ts`, `rules-engine.ts`, `command-engine.ts` interfaces — mirroring Minsky's adapter shape
  - Move existing delegation logic into `<name>.<vendor>.ts` implementations (e.g. `mcp-registry.mcpm.ts`, `skill-source.vercel.ts`, `rules-engine.airules.ts`)
  - Add `**Replace? Relocate?:**` required-field gate to TASKS.md schema for new P1+ tasks (extend `src/docs/tasks-md-output-cadence.test.ts`)
  - Add `ARCHITECTURE.md` dependency table + CI lint at `scripts/check-rule-2-dep-coverage.mjs` (port from Minsky)
  - Add quarterly `RECURRING.md` entry: "Scan novel layers for upstream replacement candidates"
  **Files**: src/adapters/ (new), src/sync/*.ts (refactor to use adapter interfaces), ARCHITECTURE.md (new dependency table section), scripts/check-rule-2-dep-coverage.mjs (new), src/docs/tasks-md-output-cadence.test.ts (extend with Replace? Relocate? field), RECURRING.md (new quarterly scan entry)
  **Acceptance**: (a) `src/adapters/` exists with ≥the interface files listed below matching Minsky's pattern; (b) every external dependency in agentbrew (mcpm, vercel/skills, ai-rules, registry.modelcontextprotocol.io, lefthook, etc.) has a corresponding `<name>.<vendor>.ts` impl with `selfTest()`; (c) ARCHITECTURE.md has a machine-parseable dependency table; (d) `scripts/check-rule-2-dep-coverage.mjs` runs on every PR and fails when a new dep lands without a row; (e) every new P1/P2 task block has a `**Replace? Relocate?:**` field with answer or `N/A — <reason ≥3 chars>`; (f) RECURRING.md has a quarterly scan task.
  **Hypothesis**: Codifying Minsky's adapter discipline (interface + impl + selfTest + dep-table + quarterly scan) reduces agentbrew's vendor-lock-in risk and surfaces "this is now upstream" opportunities ~3x faster than the current implicit `delegate → contribute → absorb` strategy.
  **Success**: ≥80% of agentbrew's external deps have an adapter pair within 1 sprint after the lint lands; the first quarterly scan surfaces ≥2 candidate Replace/Relocate tasks not already in TASKS.md.
  **Pivot**: If after 1 sprint the adapter layer adds friction without surfacing upstream-replacement candidates (i.e. ≤1 candidate from the scan), revert to the current implicit strategy and document why agentbrew's curator-not-host posture doesn't need Minsky's iron rules.
  **Measurement**: `find src/adapters -name '*.ts' -type f | wc -l ≥ 10` AND `node scripts/check-rule-2-dep-coverage.mjs` returns 0 AND `grep -c 'Replace? Relocate?:' TASKS.md ≥ 5`
  **Anchor**: Minsky `vision.md` § "1. Don't reinvent the wheel" + § "2. Every dependency behind an interface" (~/apps/tooling/minsky/vision.md); Gamma et al., *Design Patterns*, 1994 (Adapter + Strategy patterns); agentbrew VISION.md § "Strategy: delegate → contribute → absorb" (the soft precursor).

- [ ] Pull catalog from upstream MCP Registry (`registry.modelcontextprotocol.io`)
  **ID**: mcp-registry-pull-aggregator
  **Tags**: scout, mcp, ecosystem-alignment, vision-curator-not-host
  **Details**: The official MCP Registry (`modelcontextprotocol/registry`, 6.7k stars) froze its API at v0.1 in October 2025. Anthropic, GitHub, PulseMCP, and Microsoft back it. The registry explicitly expects downstream aggregators to scrape `GET /v0.1/servers` hourly and persist a local cache. Filter params: `updated_since` (RFC3339), `search`, `version=latest`, `include_deleted`. See https://modelcontextprotocol.io/registry/about and https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md.

  agentbrew's current MCP catalog is hand-curated in `src/catalog.yaml` (196 items as of 2026-05-25). This is honest curation but doesn't scale — the upstream registry will outgrow the hand-list within months. Per VISION.md "Curator, not host", agentbrew is supposed to BE a downstream aggregator. Pulling from the registry is the literal definition of that role.

  Concrete build:
  - New module `src/catalog/mcp-registry-aggregator.ts` that fetches `GET /v0.1/servers?version=latest` hourly
  - Cache in `~/.config/agentbrew/cache/mcp-registry.json` with TTL + `If-Modified-Since` revalidation
  - Merge into in-memory catalog with `source: upstream-registry` tag (vs `source: agentbrew-curated`)
  - Add `agentbrew browse mcp --source=upstream|curated|all` flag
  - Surface upstream MCPs in `agentbrew install <name>` (preferring upstream when names collide, with a `--curated` override)
  - Add `src/catalog/mcp-registry-aggregator.test.ts` with HTTP fixture covering pagination, `updated_since`, deleted-server handling
  - Document in README under "Catalog sources" section

  This integrates with the `adopt-minsky-adapter-discipline` task — the registry client should be `src/adapters/mcp-registry.ts` (interface) + `src/adapters/mcp-registry.modelcontextprotocol.ts` (impl).
  **Files**: src/catalog/mcp-registry-aggregator.ts (new), src/catalog/mcp-registry-aggregator.test.ts (new), src/adapters/mcp-registry.ts (new, per Minsky-discipline task), src/cli.ts (add `browse mcp --source` flag), README.md (Catalog sources section)
  **Acceptance**: (a) `agentbrew browse mcp` shows upstream MCPs alongside curated ones with source provenance; (b) hourly cache refresh works with `If-Modified-Since`; (c) `agentbrew install` resolves to upstream entry by default when names collide; (d) tests cover pagination + incremental sync; (e) `agentbrew status --verbose` shows last upstream sync timestamp + count.
  **Hypothesis**: Wiring agentbrew to the upstream MCP Registry reduces hand-curation work to ~zero for MCPs that exist upstream while preserving agentbrew's value-add (per-agent carve-outs, sync engine, drift detection).
  **Success**: After 30 days, ≥70% of MCPs installed by agentbrew users resolve via the upstream registry path (not hand-curated catalog). `src/catalog.yaml` MCP entries shrink by ≥50% as hand-curated ones get marked upstream-equivalent and deleted.
  **Pivot**: If the upstream registry's metadata quality is materially worse than agentbrew's curation (e.g., missing per-agent install args, broken `env:` specs, no tested DC vs Cloud parity), keep hand-curated as the primary and use upstream only for discovery (`browse mcp --source=upstream` lists, but `install` defaults to curated).
  **Measurement**: `curl https://registry.modelcontextprotocol.io/v0.1/servers?version=latest | jq '.servers | length'` returns ≥100; `agentbrew browse mcp | grep -c 'source: upstream-registry' ≥ 50`; `grep -c 'mcpServers:' src/catalog.yaml` drops ≥50% after migration.
  **Anchor**: MCP Registry API freeze announcement (2025-10-24), https://modelcontextprotocol.io/registry/about; agentbrew VISION.md § "Curator, not host"; Minsky rule #1 (don't reinvent the wheel) — registry IS the wheel.

- [ ] Introduce "plugin bundle" catalog primitive — install N catalog items as one unit
  **ID**: catalog-plugin-bundle-primitive
  **Tags**: scout, catalog, ecosystem-alignment, ux
  **Details**: The Claude Code plugin ecosystem (15.9k stars on `anthropics/claude-plugins-official`) has converged on "plugin = installable bundle". A plugin folder contains a `plugin.json` manifest + optional `commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/`. Users `/plugin install <name>` to get the whole experience. claudepluginhub.com (April 2026): 32,019 active plugins, 282,325 components, 13,151 authors. Skills are 57.2% of components, commands 20.6%, agents 17.0%, MCP servers 2.5%, hooks 2.4%.

  agentbrew's catalog lists catalog items (skills + MCP + rules) (skills + MCP servers + rules). To get "the Frontend Design experience" a user has to know which skills, MCP servers, and rules to install. The ecosystem solved this with the plugin bundle. agentbrew should adopt the same primitive — `src/catalog.yaml` gains a `bundles:` section listing groups of catalog items; `agentbrew install <bundle-name>` installs all members.

  This is NOT skill hosting (agentbrew remains a curator). A bundle is a reference list — it points at existing catalog entries (which themselves point at source repos / upstream registries). The bundle metadata adds: title, description, recommended for (audit-focused / dev-focused / WORKSPACE-specific), members `[skill-id, mcp-id, rule-id, ...]`, optional `recommended_by_default: true` for the Tier 1 set.

  Concrete build:
  - Extend `src/catalog.yaml` schema with `bundles:` section
  - Add `BundleManifest` type to `src/types.ts`
  - Add `agentbrew install <bundle-name>` resolver that fans out to each member's install path
  - Add `agentbrew browse bundles` command
  - Seed with 3-5 starter bundles: `verify-everything` (verification-before-completion + doubt + code-smells-aware + tdd skills), `mcp-essentials` (top 5 MCPs by install volume), `frontend-design`, `dotfiles-aware`
  - Add tests: bundle resolves to existing catalog items, missing member fails loudly, bundle install is idempotent
  **Files**: src/catalog.yaml (new `bundles:` section), src/types.ts (BundleManifest type), src/catalog/bundle-resolver.ts (new), src/catalog/bundle-resolver.test.ts (new), src/cli.ts (add `install <bundle>` + `browse bundles`), README.md (Bundles section)
  **Acceptance**: (a) `agentbrew install verify-everything` installs all verification skills in the catalog + relevant rules in one command; (b) `agentbrew browse bundles` lists available bundles with description + member count; (c) bundle members reference existing catalog entries (no skill content duplicated); (d) tests cover happy path + missing-member rejection + idempotent reinstall.
  **Hypothesis**: Bundles reduce "I want the X experience" from a a small set of command dance to a single command, matching what the Claude Code marketplace, claudepluginhub, and tonsofskills have all converged on.
  **Success**: ≥3 starter bundles ship; `agentbrew install <bundle>` is the most-used install command within 30 days (vs individual `install <item>`).
  **Pivot**: If users prefer hand-picking individual items (the curatorial discipline) and bundles see <10% usage, deprecate the bundle primitive and instead ship "recommended starter pack" docs that list the manual commands.
  **Measurement**: `node -e "const c = require('js-yaml').load(require('fs').readFileSync('src/catalog.yaml','utf8')); console.log(c.bundles?.length ?? 0)"` returns ≥3; `agentbrew browse bundles --json | jq 'length' ≥ 3`.
  **Anchor**: `anthropics/claude-plugins-official` README — bundle structure (`commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/`); claudepluginhub.com April 2026 stats (282,325 components, bundle is the install unit); Claude Code docs https://code.claude.com/docs/en/discover-plugins.md.

- [ ] Extend `hooks-sync.ts` to deploy SessionStart hooks to Cursor (not just Claude Code)
  **ID**: extend-hooks-sync-beyond-claude-code
  **Tags**: scout, tier-3, hooks-sync, cursor-rules
  **Scope**: Cursor only. Devin is deprecated and frozen (owner decision 2026-10-02); skip every Devin step below.
  **Hypothesis**: today's `SessionStart` hook only fires in Claude Code. Extending hooks-sync.ts to also deploy equivalent hooks to Devin (`.devin/hooks/session-start.sh`) and Cursor (via a persistent rule with `run-first` directive) converts soft enforcement (rule text says "load context") to hard enforcement (script runs deterministically) for the the most-used agents in this user's setup.
  **Success**: When a fresh session opens in any of {Claude Code, Devin, Cursor}, the `load-project-context.sh` script runs and dumps canonical-doc content into context BEFORE the agent's first response. Verified by inspecting session transcripts for each agent.
  **Pivot**: If Devin doesn't support pre-first-response hooks (its `.devin/hooks/` model might be different from Claude Code's `SessionStart`), fall back to a `~/.config/devin/AGENTS.md` opening section that explicitly says "run this script first" — soft but at least loud.
  **Measurement**: For each of {Claude Code, Devin, Cursor}: open a fresh session in any of the 7 solo-project repos and confirm the inventory output appears in the first response without manual invocation.
  **Anchor**: Tier 3 of the strategy memo at end of the `feat: canonicalize project doc structure` PR thread (#1034, merged 2026-05-23). Today's hooks-sync.ts only targets `~/.claude/settings.json`.
  **Details**: Three sub-tasks:
    1. **Devin**: research what `.devin/hooks/` supports (session-start? per-tool? prompt-submit?). Add Devin to `hooks-sync.ts`'s output targets. Test with a fresh Devin session.
    2. **Cursor**: Cursor has Rules with `alwaysApply: true` but not session-start hooks per se. Workaround: write a special-case rule that opens with "Before your first response, run `bash ~/.config/agentbrew/scripts/load-project-context.sh` and report findings." Sync it.
    3. **Documentation**: update `templates/AGENTS.md` and the `load-project-context` catalog rule to mention which agents have hard-enforcement vs soft.
  **Files**: `src/sync/hooks-sync.ts`, `src/core/agents.yaml` (if a new `hooksKey` per-agent is needed), tests in `src/sync/hooks-sync.test.ts`, plus a new `~/.config/agentbrew/Agentfile.yaml` hook entry for each agent.
  **Acceptance**: hooks-sync.ts deploys a working SessionStart-equivalent for all those agents; integration test demonstrates the script fires in each.

- [ ] Add YAML front-matter to every VISION.md so vision-conformance can be checked programmatically (Tier 4)
  **ID**: vision-as-dsl-yaml-frontmatter
  **Tags**: scout, tier-4, vision-as-dsl, programmatic-verification
  **Hypothesis**: today's VISION.md is prose; an agent can't programmatically check "does proposal X violate VISION constraint Y." Adding a YAML front-matter block with `goals: [{id, name, measurable}]`, `constraints: [{id, name, enforced_by}]`, `nongoals: [<string>]` turns VISION into a queryable DSL. A new `verify-vision-trace` skill (built on the same `competitor-spot-check` pattern) takes a diff + the YAML, returns "this change satisfies G1, doesn't touch C1, doesn't conflict with any nongoal." That's enforceable; today's prose vision isn't.
  **Success**: Each of the 7 solo-project repos' VISION.md has a YAML front-matter block. The new `verify-vision-trace` skill in agentbrew skill-plugins/dev/ takes a diff + the YAML, returns a structured PASS/FAIL with reasoning.
  **Pivot**: If YAML front-matter conflicts with how the file is rendered (e.g. some markdown renderers don't strip front-matter), use a fenced ```yaml constraints``` code block instead.
  **Measurement**: `yaml-validator < VISION.md` passes on each repo. `skill invoke verify-vision-trace --diff <path>` returns structured JSON.
  **Anchor**: Tier 4 of the strategy memo at end of #1034.
  **Details**: Sequencing matters:
    1. Design the schema (small — goals, constraints, nongoals) and document it as a catalog rule (`vision-frontmatter`)
    2. Roll it out to one pilot repo (agentbrew itself or minsky)
    3. Build the `verify-vision-trace` skill that consumes it
    4. Roll out to the other 5 repos
    5. (Optional) wire into the pr-vision-trace CI gate: if the PR body's `Vision goal` field cites a goal id, verify it exists in the YAML
  **Files**: each `VISION.md` (front-matter), `src/catalog.yaml` (vision-frontmatter rule), `skill-plugins/dev/verify-vision-trace/SKILL.md` (new skill), optional updates to `scripts/check-pr-vision-trace.mjs` to verify goal ids.
  **Acceptance**: schema documented, pilot repo updated, skill ships, ≥1 PR uses goal-id verification.

- [ ] Schedule `companion-competitor-watch` to run weekly per repo (Tier 5)
  **ID**: schedule-companion-competitor-watch-weekly
  **Tags**: scout, tier-5, competitor-corpus, scheduling, launchagent
  **Hypothesis**: the `companion-competitor-watch` skill already exists in skill-plugins/dev/ but is opt-in and rarely run. Scheduling it weekly per repo via a launchagent keeps the competitive corpus living, not snapshotted. When a competitor ships in your space, a P3 TASKS.md entry shows up within 7 days.
  **Success**: launchagent runs weekly, invokes the skill for each of the 7 solo-project repos, files P3 TASKS.md entries when prior art is found. Logs to `~/.config/agentbrew/competitor-watch.log`.
  **Pivot**: If weekly is too noisy (>10 P3 tasks/week per repo), tune to bi-weekly or monthly. If competitor docs become repetitive, gate the file-task step on "is this novel relative to the last 90 days of P3 tasks under the same `**Tags**: competitor-watch`."
  **Measurement**: `launchctl list | grep competitor-watch` shows the agent loaded. `cat ~/.config/agentbrew/competitor-watch.log` shows weekly entries. Per-repo TASKS.md grows.
  **Anchor**: Tier 5 of the strategy memo at end of #1034.
  **Details**: Use launchd (macOS) initially; portability to Linux comes later. The three canonical files:
    1. `~/Library/LaunchAgents/com.agentbrew.competitor-watch.plist` — schedule + invocation
    2. `~/.config/agentbrew/scripts/competitor-watch-runner.sh` — iterates over the 7 repos, invokes the skill per repo
    3. `modules/agentbrew/doctor.sh` addition — verify launchagent is loaded
  **Files**: as above plus a `templates/launchagents/competitor-watch.plist.tmpl` if dotfiles owns the deploy.
  **Acceptance**: launchagent loaded, first run logs an entry per repo, ≥1 P3 task auto-filed within 4 weeks.

- [ ] `agentbrew install` MCP env-sanitize drops `${VAR}` placeholders and strips npx `-y`
  **ID**: install-mcp-env-sanitize-strips-vars-and-y-flag
  **Tags**: scout, mcp, install, env-sanitize
  **Blocked**: needs-decomposition — verification 2026-05-26: both reported issues have nuanced root causes that DIFFER from the original task body's diagnosis. The task should be split into two focused follow-ups before implementation. Verified empirically by replaying the exact arg pattern from the task body against `commander/esm.mjs` + tracing `src/mcp/env-vars.ts:259-269,344-378`:

    **Issue 1 — `-y` is NOT stripped by env-sanitize; it's consumed by Commander's variadic-option parser.** Commander binds `-y` to `--yes` at the top level of `agentbrew install`. When the user passes `--args "--registry" "..." "-y" "@pkg"`, Commander's `--args <args...>` variadic terminates at the second `-y` (which it reads as the global `--yes` option) — args end up as `['--registry', '...']` and `@pkg` is silently dropped too. Confirmed by isolated repro at `commander/esm.mjs` parser level. The `parseKeyValuePairs` (`src/utils.ts:147`) and `addMcpServer` (`src/sync/mcp-sync-commands.ts:81`) code paths pass args through cleanly; no filter is removing `-y`. **Fix shape**: either (a) document the `--` separator collision prominently in `agentbrew install --help`, (b) detect-and-warn when `--args` doesn't include a package-name-shaped final entry, or (c) reconfigure Commander to disable known-flag-recognition mid-variadic (research required — Commander 11+ may have `argParser` hooks that allow this).

    **Issue 2 — `${VAR}` placeholders are CONDITIONALLY omitted, not unconditionally dropped.** `src/mcp/env-vars.ts:344-378` (`getInheritedServerEnvKeys` + `convertServerEnvVars`) omits `${VAR}` entries for Devin's literal-format ONLY when `isShellEnvResolved(varName)` returns true (i.e. when the current process's `process.env[varName]` is set). The intentional behavior: avoid persisting secrets into `~/.config/devin/config.json` because Devin inherits the launching shell's env. The user's bug report from 2026-05-21 hit this trap because their interactive shell HAD `JIRA_PERSONAL_TOKEN` set (gh-token / keychain auto-load), but Devin's MCP runtime (launchd-spawned) DOESN'T inherit interactive-shell env — only launchd's env, which doesn't include shell-loaded secrets. **Fix shape**: emit a CLI warning at install time naming the omitted keys + explaining the inherit-from-shell contract, OR add a `--persist-placeholders` flag for users who want literal `${VAR}` preserved in the config (Devin then needs to interpolate at MCP launch). Both options require a decision about Devin's literal-format contract; the task body's "preserve the placeholder reference" framing is one design choice but not the only correct one.

    **Unblock path**: split into two tasks, one per issue. Each gets its own fix-shape decision (UX vs config) made by the user before implementation.
  **Details (original)**: Scouted 2026-05-21 while installing `@acme/jira-mcp` for Devin. Ran:
    ```
    agentbrew install jira-mcp -y \
      --command npx \
      --args "--registry" "https://registry.npmjs.example.com/" "-y" "@acme/jira-mcp@latest" \
      --env "JIRA_PERSONAL_TOKEN=\${JIRA_PERSONAL_TOKEN}" "JIRA_EMAIL=developer@company.example" "JIRA_BASE_URL=..." "PROJECT_FILTER=PROJ"
    ```
    Resulting `~/.config/devin/config.json` entry:
    1. **`-y` flag silently dropped from args** — the deployed args end up as `["--registry", "...", "@acme/jira-mcp@latest"]` (no `-y`). npx with no `-y` prompts interactively for confirmation on first run, which blocks every MCP startup since Devin/Claude/Cursor never see the prompt. The user has to hand-edit `config.json` to add `-y` back, defeating the point of `agentbrew install`.
    2. **`${JIRA_PERSONAL_TOKEN}` env entry silently dropped** — the env block ends up with only the 3 non-`${...}` values; the secret-ref placeholder is gone. The agent then connects without auth and every Jira call 401s. Forces the user to either hardcode the token (security risk) or hand-edit the config to re-add the placeholder.
    
    Suspected location: `src/core/env-sanitize.ts` (per AGENTS.md "core infra" section). Likely a defensive filter intended to strip secrets from logs is also being applied to the stored config. The filter needs a 3-way distinction:
    - literal secret values (e.g. `"ATATT3xFf..."`) → reject/redact
    - placeholder references (e.g. `"${JIRA_PERSONAL_TOKEN}"`) → preserve, MCP runtime will expand from shell env
    - non-secret strings (e.g. `"PROJ"`) → preserve
    
    For the `-y` strip, suspect args-merging code is deduplicating against a "known flags" list and incorrectly treating `-y` as a shell-internal flag rather than an npx arg.
  **Files**: `src/core/env-sanitize.ts`, `src/mcp/mcp-sync.ts` (the args/env writer), `src/install.ts` or wherever `install --env` is parsed.
  **Acceptance**: `agentbrew install jira-mcp -y --command npx --args "-y" "pkg" --env "TOKEN=\${TOKEN}"` produces a per-agent config where `args` contains `-y` AND `env.TOKEN === "${TOKEN}"`. Add a test in `src/mcp/mcp-sync.test.ts` (or wherever the deploy step is tested) that asserts placeholder env vars round-trip unchanged and `-y` survives the args pipeline. The Jira MCP install scenario is the regression test — a fresh `agentbrew install jira-mcp ...` should be usable without hand-editing.
  **Hypothesis**: Env sanitize was authored to prevent secret leakage into logs/snapshots, but it doesn't distinguish `${VAR}` placeholders from literal secrets. Adding a `^\$\{[A-Z_][A-Z0-9_]*\}$` allowlist preserves the placeholder path without weakening leak protection.
  **Success**: `node dist/cli.js install <test-mcp> --env "T=\${T}" --args "-y" "x"` produces an agent config with both `-y` and `${T}` intact; new unit test in mcp-sync.test.ts asserts the round-trip.
  **Pivot**: If the `-y` strip turns out to be a Devin-config-specific quirk (e.g. Devin's mcpServers schema rejects `-y`), narrow the task to env-sanitize only and add a separate `-y` task. Verify by reading `src/agents/devin.ts` or equivalent adapter.
  **Measurement**: `git grep -nE '\\$\\{[A-Z_]+\\}' src/core/env-sanitize.ts` returns ≥1 hit (the allowlist branch) and `npm test -- --grep "env-sanitize.*placeholder"` passes.
  **Anchor**: 2026-05-21 Devin/jira-mcp install (the incident); shared-rules.md Mode (0) "PREFER the API/MCP path" rule (the broader user goal that this defect blocks).

- [ ] Integration test coverage: 88% → 95% (cover uncovered sync surfaces)
  - **ID**: integration-test-coverage-95
  - **Tags**: testing, coverage, integration
  - **Details**: Current surface coverage is 88% (30/user-facing sync surfaces). Target: 95% (33/34). Several surfaces have zero test files. File-level coverage is 88% (110/sync source files have co-located .test.ts). The sub-tasks below each add one test file.
  - **Acceptance**: `npm test` passes, all surfaces have dedicated test files, surface coverage ≥95%.

- [ ] Test commands-sync (slash command deployment to agents)
  - **ID**: test-commands-sync
  - **Tags**: testing, coverage, sync
  - **Details**: New `src/sync/commands-sync.test.ts`. Test: deploy sample commands to claude-code + cursor + gemini-cli, verify files created in correct format per agent, prune stale commands, preserve user-created commands. Mock filesystem.
  - **Files**: src/sync/commands-sync.test.ts (new)
  - **Blocked by**: integration-test-coverage-95

- [ ] Test drift-checks/ modules (drift check modules with no dedicated test files)
  - **ID**: test-drift-checks
  - **Tags**: testing, coverage, drift
  - **Details**: New test files for `src/drift-checks/{agents,commands,instructions,mcp,rules,skills}.ts`. Each drift check compares desired state vs actual agent config and reports mismatches. Test: inject a known mismatch and verify the check reports it; inject no mismatch and verify clean. Can be one test file `src/drift-checks/drift-checks.test.ts` covering all 6.
  - **Files**: src/drift-checks/drift-checks.test.ts (new)
  - **Blocked by**: integration-test-coverage-95

- [ ] Test agentbrew export (portable config bundles)
  - **ID**: test-export
  - **Tags**: testing, coverage, portable
  - **Details**: `src/portable.ts` already has `portable.test.ts` for import but export path may lack integration coverage. Verify: `agentbrew export` produces a valid bundle with MCP servers, skills, rules, and sources; the bundle can be re-imported on a clean state and produces identical config.
  - **Files**: src/portable.test.ts (extend or new export-focused file)
  - **Blocked by**: integration-test-coverage-95

- [ ] Test catalog install-skill + install-other (catalog install paths)
  - **ID**: test-catalog-install-paths
  - **Tags**: testing, coverage, catalog
  - **Details**: `src/catalog/install-skill.ts` and `install-other.ts` have no co-located test files. Test: install a mock catalog skill, verify state.yaml updated and skill symlinked; install a mock MCP server from catalog, verify state.yaml + agent configs updated. Mock network + registry.
  - **Files**: src/catalog/install-skill.test.ts (new), src/catalog/install-other.test.ts (new)
  - **Blocked by**: integration-test-coverage-95

- [ ] Fix opencode MCP adapter — `JsonAdapter.toEntry()` writes old stdio format rejected by opencode 1.14+
  **ID**: fix-opencode-adapter-format
  **Tags**: bug, mcp, opencode, adapters, correctness
  **Details**: `JsonAdapter.toEntry()` in [`src/mcp/adapters.ts:100-101`](src/mcp/adapters.ts) writes the old MCP stdio format for every agent it handles:

    ```typescript
    const entry: JsonEntry = { command: server.command };
    if (server.args.length > 0) entry.args = server.args;
    ```

    opencode 1.14+ (changed in v1.14.x) requires a different schema:

    ```json
    { "type": "local", "command": ["npx", "-y", "...args-merged"] }
    ```

    and uses `"environment"` (not `"env"`) for env vars. The old format causes opencode-serve to crash immediately with `Expected { type: "local", ... } | { type: "remote", ... }, got {"command":"npx","args":[...]}`. Because `agentbrew sync` runs this adapter on every apply, it silently re-breaks `~/.config/opencode/opencode.json` after every `chezmoi apply`, even after the operator has manually fixed the file.

    The other agents that fall through to `JsonAdapter` (devin, copilot, kiro, amp) still expect the old format — so the fix must be opencode-specific. The cleanest shape:

    1. Add `mcpFormat: "opencode"` to `src/core/agents.yaml` for the opencode agent entry (currently it uses the default `json` format, line ~200).
    2. Create `OpenCodeAdapter` that extends `JsonAdapter` and overrides `toEntry()` to emit `{ type: "local", command: [server.command, ...server.args] }` with `environment` instead of `env`.
    3. Override `entriesMatch()` in `OpenCodeAdapter` to compare the array-command format (current `entriesMatch` checks `existing.command !== desired.command` and `existing.args`, which would never match the new format and cause spurious re-writes on every sync).
    4. Wire `getAdapter()` to return the `OpenCodeAdapter` for `mcpFormat === "opencode"`.

    Regression test: add a fixture in `src/mcp/adapters.test.ts` that asserts the opencode adapter's `toEntry()` output round-trips through `readEntries()` on a real `opencode.json` fixture, and that `entriesMatch()` returns `true` on unchanged config (so sync is idempotent).
  **Files**: `src/mcp/adapters.ts` (new `OpenCodeAdapter` class + `getAdapter` branch), `src/core/agents.yaml` (add `mcpFormat: opencode` to opencode entry), `src/mcp/adapters.test.ts` (new opencode format fixture + idempotency test)
  **Acceptance**: (a) `agentbrew sync` on a machine with opencode 1.14+ writes `{ type: "local", command: [...] }` entries to `~/.config/opencode/opencode.json`; (b) a second `agentbrew sync` is a no-op (idempotent — `entriesMatch` returns true); (c) the other agents (devin, copilot, kiro, amp) are unaffected — still use old format; (d) `npm run verify` is green.
  **Output**: code
  **Hypothesis**: Adding an `OpenCodeAdapter` that emits the opencode 1.14+ schema (`{ type: "local", command: [...] }`) will make `agentbrew sync` produce a valid `opencode.json` without breaking the other agents that share `JsonAdapter`.
  **Success**: `agentbrew sync` writes valid opencode 1.14+ entries AND a second sync is a no-op (idempotent). `npm run verify` green.
  **Pivot**: If opencode changes schema again in the next release (1.15+), the adapter pattern still works — just update `toEntry()`. If they stabilize on the old format, revert.
  **Measurement**: `npm run verify && node -e "const j=require(process.env.HOME+'/.config/opencode/opencode.json'); const e=Object.values(j.mcpServers||{})[0]; console.log(e.type==='local' && Array.isArray(e.command) ? 'PASS' : 'FAIL')"` — must print PASS.
  **Anchor**: opencode 1.14 changelog (schema change); Martin 2017 adapter pattern; agentbrew AGENTS.md rule §8 (agent definitions in agents.yaml).
  **Surfaced-by**: 2026-05-15 setup session — opencode 1.14.46 changed MCP schema; `agentbrew sync` ran during `chezmoi apply` and re-broke `opencode.json` every time it ran. Operator had to manually fix the file, only to have it reverted on next sync. Companion doctor check in dotfiles P0 `doctor-opencode-mcp-format` surfaces the symptom until this is fixed.

- [ ] Catalog entry for the Minsky observer skill — `agentbrew install minsky-observer` resolves
  **ID**: catalog-minsky-observer-skill
  **Tags**: catalog, minsky, observer, curator-not-host
  **Details**: Surfaced by Minsky's observer-plugin distribution work (PR #493, merged 2026-05-12). The skill lives at `fyodoriv/minsky` under `skill-plugins/observer/minsky/SKILL.md`. Today operators install it by cloning the Minsky repo, running `distribution/install-observer.sh`, then running `agentbrew sync --agentfile ~/apps/tooling/minsky/Agentfile.yaml`. That's three manual steps per machine.

    Per `docs/VISION.md` ("Curator, not host") and `src/catalog.yaml`'s header comment, the right answer is a single `catalog.yaml` entry pointing at the upstream repo, so the operator runs `agentbrew install minsky-observer` and the resolution + symlinking + agent-fan-out is handled by the existing skill-source pipeline.

    Implementation hints (not load-bearing):
    - Add an entry under `skills:` in `src/catalog.yaml` with `name: minsky-observer`, `source: github:fyodoriv/minsky/skill-plugins/observer`, `description: "Observer protocol for the Minsky autonomous runner — watches the loop, safe-heals bounded failures, files draft PRs upstream on escalation"`, `keywords: [minsky, observer, autonomous-coding, supervisor, perrow-1984]`.
    - The `repo_sources:` machinery for fetching + caching to `~/.cache/agentbrew/sources/` already exists (rules-sync uses it); reuse rather than reinvent.
    - Once `agentfile-command-sources` (the sibling P1 above) lands, the catalog entry can also declare `commands: ./commands/minsky*.md` so the slash commands install with the skill in one step.
  **Files**: `src/catalog.yaml`, team overlay `catalog-overlay.yaml` (mention only — Minsky is upstream-public, not team-overlay), `docs/competition/` (if a competition page mentions Minsky), `README.md` if the catalog roster gets a README section.
  **Acceptance**: (a) `agentbrew install minsky-observer` resolves + downloads the skill from `fyodoriv/minsky`; (b) `agentbrew sync` symlinks `SKILL.md` into every detected agent's `skillsDir`; (c) `agentbrew search minsky` returns the observer entry; (d) the catalog-team overlay is untouched.
  **Hypothesis**: A single `catalog.yaml` entry for `minsky-observer` will reduce the 3-step manual install to `agentbrew install minsky-observer` (one command, zero git clones).
  **Success**: `agentbrew install minsky-observer && agentbrew sync` deploys the skill to all agents. `agentbrew search minsky` lists the entry.
  **Pivot**: If the `repo_sources:` machinery doesn't handle subdirectory skill paths (`skill-plugins/observer/`), the skill needs a top-level `SKILL.md` pointer in the Minsky repo — file the change upstream rather than patching agentbrew.
  **Measurement**: `agentbrew install minsky-observer 2>&1 | grep -c 'installed'` returns 1; `ls ~/.claude/skills/minsky/SKILL.md` exists.
  **Anchor**: agentbrew VISION.md § "Curator, not host"; existing catalog.yaml skill entries as reference pattern.
  **Surfaced-by**: Minsky observer plugin (fyodoriv/minsky PR #493) — current install path bypasses agentbrew's catalog entirely.

- [ ] Workspace-aware `agentbrew sync` — discover and process per-repo Agentfiles across **one or more workspaces** on one host
  **ID**: workspace-aware-sync
  **Tags**: architecture, agentfile, workspace, multi-repo, multi-workspace, curator-not-host
  **Details**: Companion to `tasksmd/tasks.md` task `workspace-mode-nested-repos` (filed 2026-05-12 PR upstream). Operators frequently have **multiple** workspace folders on the same host — the operator at 2026-05-12 has 5 workspaces under `~/apps/` (`tooling`, `acme`, `learning`, `_inventory`, `docs`), several containing their own per-repo `Agentfile.yaml`. Today `agentbrew sync` takes either no Agentfile (uses global `~/.config/agentbrew/Agentfile.yaml`) or an explicit `--agentfile <path>` flag — both single-Agentfile shapes. There's no first-class way to compose one global manifest + N workspaces × M per-repo manifests.

    The operator's mental model is "I have these workspaces; agentbrew should know what every repo in every workspace wants and reconcile that into the target agent configs." Today that requires running `agentbrew sync --agentfile <path>` once per repo across N workspaces — friction that scales with workspace count × repo count.

    **Outcome-shaped** (multi-workspace, N=1 is just a degenerate case):

    1. Operator runs `agentbrew sync` (no flag) — if `workspaceRoots:` is declared in the global Agentfile, agentbrew iterates **every declared workspace** and processes every per-repo Agentfile within each. If no workspaces are declared, behaviour is unchanged (single-Agentfile, backwards compat).
    2. Explicit scoping: `agentbrew sync --workspaces ~/apps/tooling,~/apps/acme` (comma list) OR `agentbrew sync --workspace-name tooling` (config-name lookup, mirrors the `tasks` CLI's flag shape from the foundation task).
    3. `agentbrew status` reports per-workspace, per-repo: discovered Agentfiles, declared sources, deployed targets, collision warnings.
    4. Skills/commands/rules/MCPs are namespaced by `<workspace>::<repo>` so collisions across workspaces (two repos declaring the same MCP from different versions, etc.) surface as actionable diagnostics rather than silent last-write-wins.

    Implementation hints (not load-bearing):
    - Adds `workspaceRoots: [<path1>, <path2>, ...]` to the global `Agentfile.yaml` schema (plural; single-workspace setups declare a 1-element list). Schema validation rejects mixed `workspaceRoot:` (singular) + `workspaceRoots:` (plural).
    - Adds `--workspaces <path1,path2,...>` (plural, comma-separated) + `--workspace-name <name>` flags on `sync`, `status`, `lint`, `health`. The singular `--workspace <path>` flag is shorthand for a 1-element list (kept for ergonomics).
    - Reads the same `~/.config/tasks-md/workspaces.yaml` config the `tasks` CLI uses (foundation task) — so adding a workspace via `tasks workspaces add` automatically picks it up here. Don't reinvent the discovery layer.
    - Reuses the `.tasks-md-workspace` sentinel from `tasksmd/tasks.md`.
    - Composes with `agentfile-command-sources` (sibling P1 above): in multi-workspace mode, every workspace × every repo's `commandSources:` declaration aggregates.
    - Composes with `catalog-minsky-observer-skill` (sibling P1 above): once Minsky has a catalog entry, the per-repo Agentfile in `~/apps/tooling/minsky/` declares it via `skills: [minsky-observer]` instead of `skillSources: [...]`, and the workspace-sync picks it up like any other.
  **Files**: `src/cli.ts` (workspace + workspaces + workspace-name flags + Agentfile-discovery), `src/sync/skills-sync.ts`, `src/sync/command-sync.ts`, `src/sync/rules-sync.ts`, `src/sync/mcp-sync.ts` (all extended to handle the merged-from-N-workspaces-×-M-Agentfiles input), `src/health.ts` (per-workspace + per-repo health rollup), `src/core/workspaces.ts` (new — reads `~/.config/tasks-md/workspaces.yaml`), `templates/AGENTS.md` (multi-workspace docs), `docs/VISION.md` (multi-workspace as a first-class concept), tests.
  **Acceptance**: (a) `agentbrew sync --workspaces ~/apps/tooling,~/apps/acme` exits 0 + deploys every per-repo Agentfile's declarations across both workspaces; (b) per-workspace × per-repo sources are namespaced (collision reports `<workspace>::<repo>` for both sides); (c) `agentbrew status` lists discovered Agentfiles + deployed targets, grouped by workspace; (d) multi-workspace mode is backwards-compatible (zero workspaces declared → single-Agentfile behaviour unchanged); (e) reads `~/.config/tasks-md/workspaces.yaml` if present (shared with the `tasks` CLI); (f) tests cover the cross-workspace merge-conflict path.
  **Surfaced-by**: Operator multi-workspace setup at `~/apps/` containing 5 workspaces (`tooling`, `acme`, `learning`, `_inventory`, `docs`) as of 2026-05-12. Foundation task in `tasksmd/tasks.md` (workspace-mode-nested-repos) ships the spec + parser + shared config-file surface; this task closes the agentbrew side.

- [ ] Sweep agentbrew P0/P1 tasks and add the 5 rule-#9 fields to every task that is currently missing any of them, so minsky's task picker stops silently dropping them
  **ID**: agentbrew-tasks-rule9-fill-sweep
  **Tags**: scout, task-queue, minsky-integration, rule-9
  **Surfaced-by**: 2026-05-20 audit — `agentbrew/.minsky/repo.yaml` exists (bootstrapped for minsky-run), so minsky's `pickHostTask` applies the rule-#9 5-field requirement. Programmatic count via `parseTasksMd`: `{ all: 36, p0p1: 17, rule9: 9, eligible: 5 }`. Net effect: **12 of 17 P0/P1 tasks are invisible to the autonomous picker** — they get listed in TASKS.md but never claimed when minsky runs on this host. The dropping is silent (no warning, no log line), so the operator sees "queue empty after 5 tasks" while the file is full.
  **Details**: every P0/P1 task in this file MUST carry **Hypothesis**, **Success**, **Pivot**, **Measurement**, **Anchor** (each on a single line — the picker's parser is `^\*\*<Field>\*\*:\s*(.+)$` and continuation lines orphan the value). Many older tasks shipped with only `**Acceptance**:` and `**Details**:` — those need the rule-9 set added. (a) Write a one-shot script `scripts/audit-tasks-rule9.mjs` that reuses `parseTasksMd` from `~/apps/tooling/minsky/novel/cross-repo-runner/dist/index.js` to print every P0/P1 task missing any of the 5 fields and the specific field(s) missing. (b) For each task, fill the missing fields with project-specific content (not boilerplate — the Hypothesis must be falsifiable, the Measurement must be a runnable shell command). (c) Re-run the audit script; assert eligible == p0p1 - claimed - blocked. (d) Add the script to `npm run verify` (or to a dedicated `lint:tasks-rule9` script) so the gate is permanent — any new P0/P1 task lacking a field hard-fails CI. Make this idempotent: re-running on an already-compliant TASKS.md is a no-op.
  **Files**: `TASKS.md` (the existing 12 non-compliant P0/P1 blocks — sweep in-place), `scripts/audit-tasks-rule9.mjs` (new — uses minsky's parser), `scripts/audit-tasks-rule9.test.ts` (new — fixture-driven), `package.json` (wire `verify`), `AGENTS.md` (document the gate so future task authors don't reproduce the bug).
  **Acceptance**: (a) `node scripts/audit-tasks-rule9.mjs` exits 0 with `eligible == p0p1 - claimed - blocked` against current `TASKS.md`; (b) deliberately omitting any field on a new P0/P1 task makes `npm run verify` fail with the offending task ID + missing field name; (c) the existing 5 picker-eligible tasks remain pickable (regression guard).
  **Output**: mixed
  **Hypothesis**: Filling the 5 rule-#9 fields on the 12 missing tasks increases agentbrew's autonomous-picker eligibility from 5 → 17 (P0/P1 minus claimed/blocked). After the sweep, minsky runs on agentbrew produce iterations on tasks the operator authored without anyone manually re-formatting them. Falsifiable: replay one full multi-host walk with the launchd daemon (after `minsky-daemon-plist-multi-host` lands) and verify ≥10 distinct task IDs appear in `~/.minsky/daemon.log` "iter" lines within 24h.
  **Success**: `node -e "const {parseTasksMd}=await import('~/apps/tooling/minsky/novel/cross-repo-runner/dist/index.js'); const fs=await import('node:fs'); const t=parseTasksMd(fs.readFileSync('TASKS.md','utf8')); const p=t.filter(x=>x.priority==='P0'||x.priority==='P1'); const r9=p.filter(x=>x.hypothesis&&x.success&&x.pivot&&x.measurement&&x.anchor); console.log({p0p1:p.length, rule9:r9.length})"` prints `rule9 == p0p1` (currently 9/17, target 17/17).
  **Pivot**: if filling the 12 missing-field tasks reveals that many P1 entries are actually scope-overshoots (the absence of a measurable Hypothesis hints the task isn't well-formed), demote them to P3 ("refactor when you have a measurable outcome") rather than inventing fake metrics — the picker rejection is doing real triage work and the right answer may be fewer P1s, not more.
  **Measurement**: `node scripts/audit-tasks-rule9.mjs --json | jq '.eligible == .p0p1 - .claimed - .blocked'` returns `true`; `npm run verify` exits 0 with `audit-tasks-rule9` in the chain.
  **Anchor**: minsky's `pickHostTask` (the load-bearing gate); global_rules.md "Minsky-managed repos add rule-#9 fields" (the contract this task implements); Basili/Caldiera/Rombach 1994 *Goal-Question-Metric* (the conceptual frame minsky's rule #9 instantiates).

## P2

- [ ] Re-probe only the failed servers after a heal, not every server
  - **ID**: heal-cycle-reprobe-failed-only
  - **Tags**: scout, mcp, heal, scheduler, performance
  - **Details**: `runMcpHealCycle` in `src/mcp/heal-cycle.ts` probes every server, heals, then probes every server again when anything failed. On this Mac the last snapshot shows playwright, chrome-devtools and shadcn timing out, so every 30-minute tick starts each MCP server twice, browser servers included. Re-probe only the servers that failed the first pass.
  - **Files**: src/mcp/heal-cycle.ts, src/mcp/heal-cycle.test.ts
  - **Acceptance**: with one failing and one healthy server, a tick starts the healthy server once and the failing one twice; a test covers it.

- [ ] Make LaunchAgent PATH drift checks independent of the running checkout's Node location
  - **ID**: launchagent-path-drift-check-no-running-node
  - **Tags**: launchagents, drift, node, doctor, false-positive
  - **Details**: `src/drift-checks/launchagent-path.ts` derives its expected LaunchAgent PATH from `getNodeBinDir()`. That value can point at the development checkout or a different Node installation even when the applied checkout and deployed plist are correct. Derive the expected PATH from the applied LaunchAgent contract instead.
  - **Files**: src/drift-checks/launchagent-path.ts, related tests
  - **Acceptance**: a test with different development and applied Node paths accepts the deployed applied path and still flags a genuinely stale path.

- [ ] Surface Claude Desktop MCP startup failures in `agentbrew status`
  - **ID**: status-surface-claude-desktop-mcp-failures
  - **Tags**: scout, mcp, claude-desktop, status, plugins
  - **Details**: On 2026-09-27 Claude Desktop showed an MCP startup error on
    every launch for weeks, and `agentbrew status` stayed silent. Desktop's own
    log named both causes: `Skipped invalid MCP server config entries: figma`
    (fixed in PR #23) and `[LocalMcpServerManager] Failed to connect to
    plugin:prisma:Prisma-Local`. The second comes from the account-synced
    prisma plugin: `npx -y prisma mcp` now resolves npm `latest` =
    8.0.0-rc.17, which has no `mcp` command. Desktop reads plugin on/off from
    the account, so agentbrew cannot repair it; it can only report it. Read the
    recent Desktop startup lines from `~/Library/Logs/Claude/main.log` and
    report each failing server with its log line and the fix path (config entry
    → agentbrew sync; synced plugin → Customize → Plugins). Also report the
    prisma break upstream (the plugin should pin `prisma@7`); that report is a
    public write and needs explicit operator approval first.
  - **Files**: `src/drift-checks/`, `src/status.ts`, `docs/user-stories/25-status-and-health.md`
  - **Acceptance**: With a fixture log holding one invalid-entry line and one
    plugin connect failure, `agentbrew status` lists both with their fix
    paths, and `agentbrew status --ci` exits 1. With a clean log, or with no
    Desktop installed, it reports nothing and exits 0. Only log lines from the
    latest Desktop start count, so old failures do not keep firing.

- [ ] Measure plain-language output across managed agent surfaces
  - **ID**: measure-plain-language-output-across-managed-agents
  - **Tags**: scout, prompts, accessibility, rules, quality
  - **Details**: The new global plain-language rule has deterministic coverage
    for its presence in shared rules, the instruction template, and the
    always-applied Cursor rule. That proves deployment, not behavior. Add a
    small sampled evaluation that checks chat, documentation, PR, code-comment,
    and skill-wrapper output from each primary agent. Record whether each output
    uses plain, short, active sentences and follows the applicable
    outcome-first or code-comment brevity rule. Keep the evaluator generic and
    opt-in. Do not add a hosted scoring service.
  - **Files**: `agent-artifact-evals/`, `docs/testing-agent-artifacts.md`,
    `README.md`
  - **Acceptance**: One repeatable evaluation runs against chat,
    documentation, PR, code-comment, and skill-wrapper fixtures for Claude
    Code, Cursor, Windsurf, Devin, and Codex. The report identifies a failing
    output and its rule gap. `npm run verify` remains deterministic and does
    not require a live model.

- [ ] Remove stale references to deleted Jira workflow skills
  - **ID**: remove-stale-deleted-jira-skill-references
  - **Tags**: scout, skills, docs, jira, referential-integrity
  - **Details**: Scouted while adding the product-doc/Jira reconciliation protocol. The 2026-07 shrink removed `jira`, `jira-task`, and `find-jira-task`, but remaining built-in skills, plans, and global guidance still name them as callable dependencies. This violates the referential-integrity rule and can route agents to missing skills. Audit every reference, replace it with a currently installed source skill or MCP-backed workflow, and keep org-only Jira content in the team overlay.
  - **Files**: `skill-plugins/dev/**`, `docs/**`, `templates/**`, `src/catalog.yaml`, `skill-plugins/dev/README.md`
  - **Acceptance**: Every active reference to `jira`, `jira-task`, or `find-jira-task` resolves to an installed catalog/source skill or is replaced with a valid MCP/repo workflow; historical changelog/task text remains untouched; `npm run verify` passes.

- [ ] Restore a clean full-verify baseline after catalog and scheduler changes
  - **ID**: restore-clean-verify-baseline-after-catalog-scheduler-changes
  - **Tags**: scout, verification, biome, complexity
  - **Details**: Scouted while repairing the content gate. `npm run verify` reaches Biome and reports pre-existing formatting, import-order, unused-import, and cognitive-complexity failures across catalog, scheduler-path, measurement, and update code. The focused mirror and learn-project contract tests pass, but the repository-wide gate is not currently a reliable completion signal.
  - **Files**: `src/catalog/`, `src/drift-checks/`, `src/commands/cli-ops.ts`, `src/learn/stage-learn-sources.ts`, `src/update.ts`
  - **Acceptance**: `npm run verify` reaches the test phase without Biome errors or warnings; complexity fixes preserve behavior with focused tests; formatting/import-only changes remain separate from behavior changes where practical.

- [ ] Trim shared-rules.md from ~11.3k to <8k tokens (Sources, Critical rules, Companion skill)
  - **ID**: trim-shared-rules-sources-criticalrules-companionskill-to-8k
  - **Tags**: scout, instructions-file-size, token-budget, shared-rules
  - **Details**: The synced instructions file still measures ~11.3k tokens against the documented <8k target. A per-section measurement shows the dominant contributors are now Sources (~4k, the literature-citation block), Critical rules (~1.9k), and Companion skill (~1.7k). The Sources/citation block is reference material that need not sit in every agent's always-loaded context — moving it behind a conditional/lazy catalog rule or a one-line pointer should reclaim the bulk of the ~3.3k overage.
  - **Files**: ~/.config/agentbrew/shared-rules.md, src/catalog.yaml, src/measure/context-budget.ts, README.md, TASKS.md
  - **Acceptance**: `agentbrew sync 2>&1 | rg 'Instructions file'` reports <8k tokens; extracted content becomes conditional catalog rules with a documented opt-in; `agentbrew measure context --dry-run` is green; no opted-in agent loses content it relied on.
  - **Hypothesis**: Extracting the Sources citation block (the largest non-rule section) plus compressing Critical rules / Companion skill reclaims the ~3.3k overage and brings the always-loaded file under 8k.
  - **Success**: deployed instructions file <8k tokens; `agentbrew measure context --dry-run` green.
  - **Pivot**: If Sources cannot be safely lazy-loaded without breaking PR literature-anchor citations, stop and compress the rule sections instead; if still over, raise the target with a written rationale rather than stripping load-bearing rules.
  - **Measurement**: `agentbrew measure context --dry-run` projected deployed tokens for the shared-rules surface is <8000.
  - **Anchor**: VISION.md G5; the always-loaded budget follows the attention-window rationale documented on the hooks decommission rules.

- [ ] Extract shared helpers for #2134-style skill contract tests
  - **ID**: extract-shared-2134-skill-contract-test-helpers
  - **Tags**: p2, skills, tests, deterministic-tests, scout
  - **Details**: The first deterministic #2134-style skill contract specs (`agentbrew-add-catalog-source`, `agentbrew-add-command`, `agentbrew-add-mcp`, `agentbrew-add-skill`, `agentbrew-manage-permissions`, `agentbrew-status`, `agentfile-init`, `analyze`, `arch`, `autoresearch`, `caveman`, `clarify`, `cli-design`, `commit`, `companion-competitor-watch`, `companion-docs-sync`, `companion-researcher`, `companion-skill-curate`, `companion-task-groom`, `companion-test-gaps`, `competitor-spot-check`, `composition-patterns`, `debug`, `design-review`, `detect-task-backend`, `diagnose`, `doc-check`, `docs-coverage`, `doubt`, `find-jira-task`, `fix-styles`, `git-diagnose-codebase`, `github-actions-debugging`, `grill`, `grind`, `grind-report`, `handoff`, `iterate`, and `jira`) now duplicate local helpers for reading SKILL.md/evals, grouped term assertions, and eval scenario lookup. Extract a small shared helper in the skill-test harness so future specs stay focused on each skill contract instead of parser/diagnostic plumbing.
  - **Files**: src/skills/*contract.test.ts, optional src/skills/skill-contract-test-helpers.ts
  - **Acceptance**: At least two #2134-style skill contract specs use a shared helper for SKILL.md/evals loading and diagnostic term/scenario assertions; existing focused specs still pass; helper names keep failure messages actionable.

- [ ] Document #2134 pressure-eval conventions for skill contracts
  - **ID**: document-2134-pressure-eval-conventions
  - **Tags**: p2, skills, tests, deterministic-tests, docs, scout
  - **Details**: While adding the `analyze` contract spec, the eval pressure cases were self-evident only after reading the spec file. Add a short reusable convention doc for #2134 skill-contract evals that names common pressure-case categories: positive workflow, ambiguity/refusal, wrong-tool routing, read-only/no-side-effect boundary, verification/approval gates, safety-gate pressure (for example, `autoresearch` refusing skipped confirmation/batched changes/skipped guard checks), communication-safety pressure (for example, `caveman` preserving warnings/code/decision points while compressing), human-attention / incremental-save pressure (for example, `clarify` refusing bundled follow-up questions and saving after each accepted answer), CLI default-behavior pressure (for example, `cli-design` flipping user-wanted opt-ins into defaults without claiming implementation), commit-safety pressure (for example, `commit` refusing main-branch commits, `git add .`, skipped verification/hooks, and NIH/reuse shortcuts), competitor-watch safety/backend pressure (for example, `companion-competitor-watch` refusing VISION rewrites, fabricated feature gaps, generated-backend TASKS.md appends, and unbounded P3 task floods), docs-sync safety/backend pressure (for example, `companion-docs-sync` deferring worker-active docs, using `tasks create` for generated backends, refusing source/config/package edits, limiting direct edits to surgical doc changes, and avoiding unearned synced claims), companion-researcher umbrella safety pressure (for example, `companion-researcher` enforcing commit allow-lists, refusing source/config leftovers, delegating lanes instead of running them in-process, refusing watch/dev commands, avoiding direct-main pushes, snapshotting worker-active files, and reporting cooldown/status), skill-catalog curation safety pressure (for example, `companion-skill-curate` filing through generated task backends, falling back to `/tmp/` for gitignored reports, refusing install/uninstall/fetch mutations, checking candidate quality before recommendations, refusing unread skill proposals, preserving dirty caches and agentbrew-managed mirrors, and filing one consolidated follow-up), task-groom safety pressure (for example, `companion-task-groom` skipping generated GitHub Issues backends, skipping worker-active TASKS.md, refusing delete/reorder/rewrite/unclaim requests, classifying unreadable external paths as unverified instead of dead, treating Acceptance as optional, batching findings into one meta-task, using safe heredoc append, limiting TASKS-AUDIT to sweep repos, validating only its own append, and respecting cooldown), test-gap safety pressure (for example, `companion-test-gaps` filing through generated task backends, refusing coverage dependency installs and manifest mutations, refusing watch mode and test writing, skipping worker-active and generated files, exiting conservatively on failing suites/timeouts, cross-referencing churn with coverage, capping P2 findings at ten, preserving report-first evidence, and validating only new entries), competitor prior-art pressure (for example, `competitor-spot-check` refusing unchecked `N/A`, rejecting invalid/stopword-only queries, refusing fabricated citations, routing broad strategy and corpus refresh to the right skills, avoiding corpus mutation, preserving citation line shape, reporting honest no-match/no-corpus outcomes, capping high-match output with refine guidance, and preserving the pr-vision-trace CI-gate relationship), composition-patterns pressure (for example, `composition-patterns` routing performance and IDS questions to the right skills, refusing boolean mode flags, preserving compound/provider/context boundaries, decoupling UI from state implementations, avoiding prop drilling, preserving render-prop data-passing escape hatches, and refusing React 19 APIs unless the project targets React 19+), debug pressure (for example, `debug` quoting literal error fields before theory, refusing symptom hotfixes and swallowed errors, adding surgical observability for opaque errors, tracing to source, requiring failing regressions, changing one variable at a time, stopping after three failed fixes, and fetching working reference apps before declaring a platform bug), design-review pressure (for example, `design-review` routing single style fixes, greenfield UI, PR review, and code/deps/docs audits to the right skills; refusing one-page/one-theme/one-viewport shortcuts; requiring deterministic theme verification, screenshot-backed route/theme/viewport coverage, source file/line root causes, deduped lint-clean TASKS.md entries, and no inline source edits), detect-task-backend pressure (for example, `detect-task-backend` treating `resolveTaskBackend(repoPath)` descriptors as authoritative over stale TASKS.md files, refusing generated-backend TASKS.md appends, preserving Agentfile/.agents fallback order, distinguishing malformed explicit GitHub Issues config from absent config, rejecting stale `.tasksmd.json` contract drift, and avoiding live GitHub access claims in local config detection), diagnose pressure (for example, `diagnose` refusing hypotheses or patches without a usable loop/captured artifact, exhausting loop-construction strategies before declaring blocked, requesting environment access/HAR/log/core dump/screen recording/instrumentation permission, rejecting shallow helper-only regressions that do not exercise the real call-site bug, documenting no-correct-seam findings, considering `/arch` when architecture prevents locking the bug down, and rerunning the original Phase 1 loop after the fix), doc-check pressure (for example, `doc-check` routing PR/code review to `review` and RFC authoring to `rfc`, refusing incremental surprise edits before the full categorized line-referenced issue list is presented, enforcing automated `<details>` balance and code-line-length checks before/after fixes, preserving clarity over brevity, keeping TL;DRs fresh after material body changes, and applying accepted fixes in one pass), docs-coverage pressure (for example, `docs-coverage` refusing README-vs-code-only shortcuts, requiring README/user-story/implementation/instructions matrix coverage for every feature discovered in any layer, treating instruction-token overhead and duplicated managed rules as first-class drift, refusing aspirational `coming soon`/`planned`/`Status:` claims for absent behavior, and verifying README counts, user-story tables, CLI `.command()` references, and instruction overhead after fixes), doubt pressure (for example, `doubt` refusing trivial rename/formatting/file-move/tooling-operation use, requiring ARTIFACT + CONTRACT only without passing author claims or proof, using adversarial prompts to disprove rather than validate, classifying reviewer findings as contract misread / valid actionable / valid trade-off / noise, stopping after trivial findings, three cycles, or explicit user override, and escalating unresolved substantive issues instead of grinding a fourth cycle alone), find-jira-task pressure (for example, `find-jira-task` stopping at branch/commit/PR keys without slow Jira searches, refusing to guess or transition To Do tickets when confidence is low, limiting Jira searches to assigned tickets with summary/status fields and small limits, routing full-ticket reading to `jira-task` and ticket creation to `jira`, returning a single plain key rather than a URL/object, and asking a focused top-3–5 choice on ambiguity), fix-styles pressure (for example, `fix-styles` refusing to declare visual fixes done from code inspection alone, requiring baseline and after screenshots plus DOM snapshots and visual diffs, changing one visual dimension at a time, removing failed attempts instead of stacking compensating CSS, rejecting `!important`/magic-number shortcuts, tracing parent/theme/global style sources before component overrides, and verifying dark mode/mobile/interaction states), git-history diagnostic pressure (for example, `git-diagnose-codebase` refusing to open source files before the five-command history pass, scoping churn and bug-cluster queries away from noisy repo-root lockfiles/config/docs, refusing to overinterpret repos with fewer than 50 commits, preserving churn×bug intersection as the primary deliverable, applying squash-merge/commit-message/zero-firefighting caveats before bus-factor or stability claims, routing code review/fixes/debugging/visual audit to the right skills, and framing history as signal rather than final decisions), GitHub Actions debugging pressure (for example, `github-actions-debugging` refusing grep-only/no-log shortcuts, rejecting `continue-on-error: true` and blind might-fix-it pushes, requiring exact job/step/log context plus recent-run history before flake claims, reproducing the same failing check locally before workflow edits or pushes, routing local-only test failures to debug and code-style failures to formatting/style workflows, and fixing root causes instead of masking red pipelines), pre-implementation grilling pressure (for example, `grill` refusing bundled multi-question checklists, checking docs/code before asking answerable questions, asking exactly one focused question with a recommended answer before waiting for feedback, refusing implementation during the grill session, creating/updating CONTEXT.md only after durable domain decisions crystallize, excluding implementation details from glossary entries, and offering ADRs only when hard-to-reverse/surprising/real-trade-off criteria all hold), autonomous grind-loop pressure (for example, `grind` refusing to sweep around hard unblocked tasks, decomposing oversized P0 work instead of generating busywork, using browser automation instead of marking portal tasks blocked, preserving state in TASKS.md and git rather than conversation memory, running the full verify gate before task completion, merging PRs immediately within repo policy, syncing back to main before exit, and printing the structured session report), post-mortem evidence pressure (for example, `grind-report` refusing partial-tail diagnosis, separating fixture logs from real grinds, quoting log evidence for every root cause, saying inconclusive when evidence is missing, refusing to run grinds or implement fixes during reporting, routing taskgrind/grind/repo cleanup tasks to the owning repo, deduplicating against existing TASKS.md entries, and writing outcome-shaped tasks with impact-based priority), handoff continuation pressure (for example, `handoff` refusing full-transcript/PR-body/TASKS.md dumps, writing to a temp markdown path via mktemp/read-before-write, referencing artifacts by path/SHA/PR/task/spec instead of duplicating them, keeping accomplishments to 1-3 bullets, preserving branch/PR/task/working-tree/verification/blocker/gotcha state, tailoring next steps to the user's requested focus, and not writing repo handoff files unless explicitly requested), iterate metric-loop pressure (for example, `iterate` refusing subjective/no-metric goals, routing structural refactors to refactor and one-shot bugs to debug, requiring numeric metric/direction/verify/guard/scope/target before starting, establishing baseline and green guard before edits, confirming with Go before autonomous looping, enforcing one hypothesis and one atomic change per iteration, creating a rollback point before verification, keeping only metric-improved guard-passing changes, refusing guard-command weakening, applying refine/pivot/stop thresholds, and summarizing final metric plus kept/discarded iterations), jira ticket-hygiene and publication pressure (for example, `jira` requiring exact first-block ## Context with motivation not implementation, short tag-free titles with requirement IDs in labels/links, flat Epic → Story/Task hierarchy without agent-created Sub-tasks or single-child Epics, minimum viable Context/Scope-or-Plan/Acceptance tickets, no duplicate structural metadata, closed blocker links treated as valid history, PM-owned content above --- preserved, Jira MCP as API executor, explicit approval before write-side effects, and first issue verification before batch creation), and metadata completeness. Link it from future skill-contract plans or helper docs so new specs converge without each task rediscovering the taxonomy.
  - **Files**: docs/testing/ or docs/skills/, src/skills/*contract.test.ts, skill-plugins/dev/*/evals/evals.json
  - **Acceptance**: A concise doc describes the pressure-eval categories with examples from at least four existing contract specs, including one iterative-loop safety-gate example, one communication-safety example, one human-attention / incremental-save example, and one CLI default-behavior example; it explains when an optional `evals/README.md` is useful; no existing tests regress.

- [ ] Recommended catalog rule updates refresh installed marked blocks
  - **ID**: recommended-rules-refresh-marked-blocks
  - **Tags**: scout, rules, catalog, sync-pull, shared-rules
  - **Details**: Scouted while shrinking recommended rule bodies after `sync --pull` re-expanded live deployed instruction files above the 40k budget. Catalog rule installs are marker-based: if `<!-- rule: <name> -->` already exists in `shared-rules.md`, `install --recommended` skips it even when `src/catalog.yaml` now has a smaller or corrected body. That preserves user edits, but it also means recommended catalog rule fixes do not reach existing installs without a manual `rules remove <name>` + reinstall. Add an explicit refresh path for catalog-owned marked blocks, likely limited to rules originally installed from the recommended set and gated by a dry-run diff, so stale bulky rule bodies can be replaced without duplicate append or silent user-content clobbering.
  - **Files**: `src/catalog/install.ts`, `src/catalog/install-other.ts`, `src/sync/rules-sync.ts`, `src/catalog/install.test.ts`, `README.md`
  - **Acceptance**: A test seeds `shared-rules.md` with an old marked recommended rule body, changes the catalog body in fixture, runs the refresh path, and proves the marked block is replaced exactly once; a hand-authored marker with local edits is either preserved with a clear warning or only updated after an explicit `--refresh-rules`/equivalent flag; docs explain how users update catalog rule text.
  - **Hypothesis**: Marker-only idempotence prevents duplicate bloat but blocks safe catalog-rule updates; separating "install if absent" from "refresh catalog-owned body" preserves both safety and upgrade hygiene.
  - **Success**: `agentbrew sync --pull` or the documented refresh command can shrink stale recommended rule bodies without manual shared-rules surgery and without touching unrelated user-authored rules.
  - **Pivot**: If ownership cannot be inferred safely, keep default behavior unchanged and add a `rules refresh --catalog <name|--recommended>` command that always shows a diff before rewriting.
  - **Measurement**: A fixture reproducing the old `load-project-context` bulky body is under the deployed-size budget after one refresh run; a second run is no-op.
  - **Anchor**: VISION.md G5 (drift detection + auto-repair), docs/user-stories/04-share-rules.md (one shared-rules source of truth), docs/user-stories/14-recommended-changes.md (recommended installs are safe to re-run).

- [ ] Spike FrontierCode-style negative controls for skill evals
  - **ID**: frontiercode-skill-eval-rubric-hardening
  - **Tags**: skill-eval, evals, quality, frontiercode, scout
  - **Hypothesis**: Adding a small FrontierCode-inspired rubric-hardening layer to the existing skill eval loop will reduce false-positive skill evals by catching prompts where an eval passes without the skill, an agent freehands instead of using the paved path, or assertions reward prose that does not prove the intended behavior.
  - **Success**: One pilot built-in skill's eval package distinguishes blocker vs non-blocker assertions, includes at least one reverse/negative-control scenario, and documents a hack-report pass; the guide explains when to keep the pattern lightweight vs when to defer it.
  - **Pivot**: If the agentskills.io schema or current runner cannot express blocker/non-blocker and reverse controls without custom infrastructure, stop at a docs-only checklist plus one manually-scored pilot instead of building a new runner.
  - **Measurement**: `npm run dev -- skills coverage --ci --builtins && npm run verify` exits 0 after the pilot update; the pilot PR body includes a with-skill / without-skill / negative-control table.
  - **Anchor**: Cognition FrontierCode (2026-06-08) describes mergeability grading with blockers vs weighted non-blockers, reverse-classical tests, scope checks, and adversarial hack reports; agentbrew VISION.md G1 "Curate, not host" means this should adapt the pattern, not clone a private benchmark.
  - **Details**: Source evidence: FrontierCode measures whether a maintainer would merge a PR and grades correctness, regression safety, mechanical cleanliness, test correctness, scope, and code quality; it treats blocker failures as zero-score and hardens rubrics through adversarial/lazy-programmer hack reports plus false-positive/false-negative checks. Local evidence: `skill-plugins/dev/skill-eval-loop/SKILL.md:20-24` already runs and scores `evals/evals.json`, `skill-plugins/dev/skill-eval-loop/SKILL.md:139-158` already compares with-skill vs without-skill arms and sets pass bars, and `skill-plugins/dev/skill-eval-loop/SKILL.md:181-187` already requires live-source and mirrored deterministic/agent scenarios for paved-path skills. The concrete gap is a modest next layer: add negative/reverse controls and blocker/non-blocker language where they improve signal without inventing an agentbrew-owned FrontierCode clone. Out of scope / future candidates: do not build a hidden benchmark service, model leaderboard, adaptive-grading system, or `mutagent` clone here; if the pilot works, a separate task can enforce the pattern in `gh-pr-skill-requires-evals`.
  - **Files**: `skill-plugins/dev/skill-eval-loop/SKILL.md`, one pilot `skill-plugins/dev/<skill>/evals/evals.json`, optional pilot deterministic fixture if the skill wraps a script.
  - **Acceptance**: (a) the skill-eval guide documents blocker vs non-blocker assertions, reverse/negative controls, and hack-report review with FrontierCode cited as methodology evidence; (b) one pilot skill demonstrates the pattern without changing global schema requirements; (c) the pilot captures at least one false-positive or false-negative risk that the old with/without table alone would miss, or records why none was found; (d) `npm run verify` remains green.

- [ ] Users can see default-model drift in `agentbrew status` before repair
  **ID**: model-drift-check-in-status
  **Tags**: scout, models, drift, status
  **Details**: `model-sync.ts` reapplies the Agentfile's `defaultModel` on every sync/auto-repair tick, but `agentbrew status` / `collectDrift()` does not report a manually flipped model as drift — the repair is silent. Once the drift-checks framework refactor in flight on `test-complete-builtin-skill-evals` lands, add a `models` drift check so a changed model shows in the Drift summary (and counts toward `--ci` exit codes) instead of only being healed invisibly.
  **Files**: `src/drift.ts` (or `src/drift-checks/` post-refactor), `src/sync/model-sync.ts`
  **Acceptance**: with `defaultModel` set and an agent's config manually flipped to another model, `agentbrew status` shows 1 drift issue naming the agent and the expected model; `agentbrew status --fix` repairs it.
  **Output**: code

- [ ] Default-model parity for Cursor (G6 gap — no file surface today)
  **ID**: model-default-parity-cursor-windsurf
  **Tags**: scout, models, parity, cursor
  **Scope**: Cursor only. Windsurf is deprecated and frozen (owner decision 2026-10-02).
  **Details**: The model surface ships for claude-code/devin/codex but two primary agents have no declarative surface: Cursor stores the model in app-managed account state (`~/.cursor/cli-config.json`'s `model` object is written by the app; `cursor-agent models` is account-gated) and Windsurf picks the model per-conversation in the Cascade UI with no public config file. Per VISION G6 a sync surface that skips primary agents needs a tracked gap. Follow the delegate→contribute path: file/locate upstream feature requests for a config-file default-model setting in both products, link them here, and revisit quarterly with the competitor sweep. If a surface appears, extend `modelConfig` in agents.yaml and delete the N/A comment in `per-agent-features.matrix.test.ts`.
  **Files**: `src/core/agents.yaml`, `src/sync/per-agent-features.matrix.test.ts`, `RECURRING.md`
  **Acceptance**: either (a) Cursor/Windsurf gain `modelConfig` entries backed by a documented upstream setting, or (b) upstream issue links are recorded here and the matrix-test comment cites them.
  **Output**: code

- [ ] Add CLI parser coverage for `agentbrew install --recommended --dry-run`
  **ID**: cli-install-recommended-dry-run-parser-coverage
  **Tags**: scout, tests, cli, dry-run
  **Details**: While fixing `install-recommended-dry-run-propagation`, `src/commands/cli-install.test.ts` had separate coverage for `install --recommended` and named `install <name> --dry-run`, but no assertion for the combined `install --recommended --dry-run` shape. The catalog-layer regression test now protects mutation behavior, but the CLI parser should also lock that both flags are forwarded together and autoSync stays skipped.
  **Files**: `src/commands/cli-install.test.ts`, `src/commands/cli-install.ts`
  **Acceptance**: A CLI test parses `["node", "test", "install", "--recommended", "--dry-run"]`, asserts `install(undefined, { recommended: true, dryRun: true, ... })`, and asserts `autoSync` is not called.
  **Output**: code

- [ ] Make `npm run verify` work from agentbrew `.worktrees/*` checkouts
  **ID**: verify-biome-worktree-root
  **Tags**: verify, biome, worktree, developer-experience
  **Details**: Running `npm run verify` from `~/apps/tooling/agentbrew/.worktrees/fix-agentfile-source-drift` fails before tests at `biome check . --error-on-warnings` with "No files were processed" because `biome.json` excludes `!**/.worktrees`, and Biome treats the current checkout path as ignored. Targeted Biome checks against explicit files still pass, but the full repo gate is unusable from standard agentbrew worktrees.
  **Files**: `biome.json`, `package.json`
  **Acceptance**: From an agentbrew `.worktrees/<branch>` checkout, `npm run verify` gets past the `biome check . --error-on-warnings` step and still excludes generated worktree directories when run from the main checkout.

- [ ] Make catalog MCP pin policy data-driven instead of source-hardcoded
  - **ID**: catalog-mcp-pin-policy-data-driven
  - **Tags**: scout, mcp, catalog, config-drift
  - **Details**: The `tasks-mcp@latest` production failure is now guarded by a catalog-pin sweep, but the package-name mapping lives in source as a narrow allowlist. Move the policy into catalog metadata once another MCP package needs the same treatment so drift detection can reconcile future pinned npm servers without a code change.
  - **Files**: `src/catalog.yaml`, `src/catalog/types.ts`, `src/mcp/catalog-pin-sweep.ts`
  - **Acceptance**: at least one MCP server can declare its npm package identity and pinned-version behavior in catalog data; `sweepCatalogPins()` consumes that metadata without a source-level server allowlist.

- [ ] Enforce a fixture test per `hooks/checks/*.sh` (coverage gate)
  - **ID**: hooks-fixture-coverage-gate
  - **Tags**: scout, hooks, test-coverage, feedback-loop
  - **Details**: `scripts/run-hook-fixtures.sh` runs whatever `hooks/checks/*.test.sh` exist but nothing enforces that EVERY check script has one — that gap let ~25 hooks ship without fixtures until hooks-phase-1. Add a gate (extend `run-hook-fixtures.sh`, or a vitest in `src/oss/` / `src/sync/`) that fails when a `hooks/checks/<id>.sh` has no sibling `<id>.test.sh`. Per the feedback-loop principle (linters enforce, instructions suggest) this makes the Phase-1 discipline mechanical so a future hook can't merge testless.
  - **Files**: `scripts/run-hook-fixtures.sh` (or a new `src/sync/hooks-fixture-coverage.test.ts`)
  - **Acceptance**: adding a `hooks/checks/foo.sh` with no `foo.test.sh` fails `npm run verify`; the message names the missing fixture.

- [ ] Reconcile manifest `verdict: mutate` vs `verdict_warn` for the two attribution hooks
  - **ID**: hooks-attribution-verdict-mutate-vs-warn
  - **Tags**: scout, hooks, manifest, consistency
  - **Details**: `hooks/manifest.yaml` declares `verdict: mutate` for `gh-pr-body-attribution` and `git-strip-agent-attribution`, but both scripts actually call `verdict_warn` (exit 0 + stderr) — the real attribution rewrite happens downstream in dotfiles `bin/gh` + `git-hooks/commit-msg`, not in the hook. The manifest field is misleading. Either (a) change the manifest verdict to `warn` and document that the mutation is delegated downstream, or (b) implement real PostToolUse mutate via `verdict_mutate`. Surfaced while writing the Phase-1 fixtures (the tests assert exit 0 + stderr, matching the actual `warn` behavior).
  - **Files**: `hooks/manifest.yaml` (entries) and/or the 2 scripts; update their `.test.sh` if behavior changes.
  - **Acceptance**: the manifest `verdict` field matches the script's actual verdict function for both hooks.

- [ ] Audit hook scripts for unguarded grep pipelines under `set -euo pipefail`
  - **ID**: hooks-grep-pipefail-audit
  - **Tags**: scout, hooks, bug-class, robustness
  - **Details**: Two hooks exited 1 (neither allow=0 nor block=2) when an unconditional `VAR=$(... | grep ... )` found no match — `grep` returns 1, the pipeline fails under `set -euo pipefail`, and the script aborts before reaching its intended `verdict_*`. Fixed in this PR for `a-pr-is-not-ready.sh` (PR_NUM + REPO) and `skill-names-user-facing-verbs.sh` (NAME_VALUE) by appending `|| true`. Audit the rest: any UNCONDITIONAL command-substitution whose grep/awk can legitimately match nothing (candidate seen: `async-human-comms-blocks.sh` STATUS line when the ask_human.md has no `status:` line). Guard each with `|| true` and add the missing-match case to its fixture.
  - **Files**: `hooks/checks/*.sh` (audit all), corresponding `.test.sh` (add no-match cases)
  - **Acceptance**: no `hooks/checks/*.sh` exits non-{0,2} on a well-formed input that simply contains no match; a fixture covers each guarded line.

- [ ] Make competitor spot-check support an explicit repo root for cwd-constrained agents
  - **ID**: competitor-spot-check-explicit-repo-root
  - **Tags**: bug, dx, pr-vision-trace, skill-quality
  - **Details**: The `competitor-spot-check` helper currently assumes the process cwd is the target repo root. In terminal sandboxes where `cd` is blocked or the shell cwd is stale, the helper can scan the wrong repo and produce an invalid PR-body prior-art line. Add an explicit repo-root option or documented invocation pattern so agents can target the intended repository deterministically.
  - **Files**: `skill-plugins/dev/competitor-spot-check/SKILL.md`, `~/.config/agentbrew/scripts/competitor-spot-check.sh`
  - **Acceptance**: An agent can invoke the spot check for a repo by absolute path without changing shell cwd; the skill docs show the explicit-root form; a regression test or documented smoke case covers scanning a non-cwd repo.


<!-- Nested catalog skill install shipped 2026-06-11 (fix/nested-skill-cache-lookup:
     copySkillFromCache/findSkillDirInCache deep-scan resolves anthropics/trailofbits/ext-apps plugin layouts.
     Closes sync --pull "not found in source" for build-mcp-server, semgrep, create-mcp-app, etc. -->

- [ ] Adopt rule #3 — test-first + doc-first across all behavior changes
  **ID**: adopt-rule-3-doc-first-discipline
  **Tags**: scout, rule-3, constitution
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: Minsky's rule #3: "Every change starts with: a failing test (red); a metric in the relevant `user-stories/*.md` file with a numeric threshold and an SLI source; updated documentation in the same commit as the code change. Then write the minimum code to pass (green). Then refactor. No exceptions." Plus the spec-kit Article III gate: GWT acceptance scenarios in `user-stories/<id>.md` or `.minsky/specs/<task-id>.md` BEFORE the test file is written.

  agentbrew has the test tree and ~2600 tests — test-first is already cultural. Doc-first is weaker: many PRs ship code + maybe-README. The independent-testability test ("If I implement just this one story, do I have a viable demonstrable unit of value?") is not applied. Adopt by: (a) extend `.github/pull_request_template.md` with a "Test added first?" checkbox + "Story file path" field; (b) `scripts/check-rule-3-test-first.mjs` checks that the diff includes either `*.test.ts` additions OR an explicit `**Test-first-exemption:**` line in the PR body; (c) `docs/user-stories/<id>.md` must exist for any feature PR (CI lint checks the link in PR body resolves to a file in the repo).
  **Files**: scripts/check-rule-3-test-first.mjs (new), .github/pull_request_template.md (extend), docs/user-stories/README.md (clarify the GWT + independent-testability gates), CHANGELOG.md
  **Acceptance**: lint runs on every PR; PRs without a test file diff OR an exemption line are rejected; user-story-link resolution check runs and passes for feature PRs.
  **Hypothesis**: Making doc-first as iron as test-first prevents the "I'll document later" drift that makes README claims diverge from code.
  **Success**: After 30 days, 0 PRs land without either a test diff OR an exemption line; ≤2 PRs land without a user-story link for feature scope.
  **Pivot**: If lint blocks legitimate refactors that don't change behavior (no test needed), allow `**Refactor-only:**` exemption with a `git diff` proof that public API didn't change.
  **Measurement**: `node scripts/check-rule-3-test-first.mjs --json | jq '.violations | length'` returns 0 on shipped PRs.
  **Anchor**: Minsky `vision.md` § 3 "Test-first, metric-first, doc-first"; Beck 2002 *Test-Driven Development*; Wynne & Hellesøy 2012 *The Cucumber Book* (GWT acceptance scenarios); Cockburn 2004 *Crystal Clear* Ch. 3 (vertical-slice delivery).

- [ ] Extend skill validator to accept verified Claude Code frontmatter fields (effort, shell, when_to_use)
  **ID**: skill-validator-claude-effort-shell-fields
  **Tags**: scout, skill-validator, claude-frontmatter, docs/research/claude-code-undocumented-config.md
  **Details**: The skill validator in `src/skills/validate.ts` currently flags `effort`, `shell`, and `when_to_use` as "unknown frontmatter fields". Binary verification against Claude Code 2.1.138 confirms these are real fields: `effort` (low/medium/high/max), `shell` (for shell-specific skills), and `when_to_use` are present in the embedded string literals. Extend the validator's frontmatter schema to accept these fields as valid instead of emitting warnings.
  **Files**: `src/skills/validate.ts`, `src/skills/validate.test.ts`
  **Acceptance**: `agentbrew skills validate` on a skill with `effort: medium`, `shell: true`, or `when_to_use: ...` passes without "unknown field" warnings.

- [ ] Preserve Agentfile hook targeting and verified Claude Code control fields
  **ID**: agentfile-hooks-async-rewake-control-fields
  **Tags**: scout, agentfile, hooks, claude-frontmatter, docs/research/claude-code-undocumented-config.md
  **Details**: The `ManagedHook` and `ClaudeHookItem` types in the Agentfile schema currently drop the verified Claude Code hook control fields: `async`, `asyncRewake`, `once`, `if`, `statusMessage`. Binary verification confirms these are real fields in Claude Code 2.1.138: `asyncRewake` runs in background but exits 2 wakes the model and blocks; `once` fires once then auto-removes. The parser also declares `AgentfileHookEntry.agents` but `parseSingleHookEntry()` silently drops it, so a machine manifest cannot scope lifecycle hooks to compatible agents. Preserve both the control fields and `agents` through parse, merge, state, and native sync.
  **Files**: `src/agentfile.ts`, `src/types.ts`, `src/sync/hooks-sync.ts`, `src/agentfile.test.ts`, `src/sync/hooks-sync.test.ts`
  **Acceptance**: An Agentfile with `hooks: [{ agents: [claude-code], asyncRewake: true, once: true }]` parses and syncs without type errors or dropped fields, and other detected hook targets do not receive that entry.

- [ ] Restore agentbrew release automation and npm authentication
  **ID**: restore-agentbrew-release-automation
  **Tags**: release, github-actions, npm, human-blocked
  **Details**: The Auto-release workflow did not run after the merged delivery. `github.com/fyodoriv/agentbrew` is now the only canonical home, and GitHub Actions is disabled there. The documented manual fallback was blocked by `npm whoami` returning `ENEEDAUTH`. The workflow already has a `workflow_dispatch` fallback. Release stays blocked until Actions is enabled on `fyodoriv/agentbrew` (or a reviewed manual release path exists) and npm credentials are available. See `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`.
  **Files**: `.github/workflows/auto-publish.yml`, `scripts/publish-latest.sh`, `docs/human-blocked-actions/agentbrew-release-auth-2026-07-20.md`
  **Acceptance**: A merge to `main` on `fyodoriv/agentbrew` creates the version commit and tag through the documented workflow; `npm run publish:latest` publishes that version; `npx agentbrew@latest --version` matches the tag.

## P3

- [ ] Replace the "open each once" hint for a missing command folder with a fix that works
  - **ID**: commands-dir-missing-hint-actionable
  - **Tags**: commands, sync, ux, docs
  - **Details**: When an agent's `commandsDir` is missing, `agentbrew sync` prints "open each once to create it" (`src/sync/command-sync.ts`) and the drift check says "open <agent> once to create it" (`src/drift-checks/commands.ts`). On 2026-09-28 Windsurf, Devin and OpenCode had config folders but no command folder. The apps were not in `/Applications`, so the hint was a dead end. `mkdir -p` on the three `commandsDir` paths plus `agentbrew sync` deployed the commands to the agents that had no command folder. Make the hint name the exact `mkdir -p <commandsDir>` command, or create the folder when the agent's config root already exists.
  - **Files**: src/sync/command-sync.ts, src/drift-checks/commands.ts, their tests
  - **Acceptance**: (1) the hint names the exact folder and a command that creates it; (2) when the agent's config root exists, sync creates the command folder and deploys; (3) tests cover both.
  - **Hypothesis**: Detected agents miss commands only because the folder is missing. Creating it when the config root exists raises command deployment to every detected agent that has a `commandsDir`.
  - **Success**: `agentbrew status --verbose` shows commands deployed to every detected agent that has a `commandsDir`.
  - **Pivot**: If an agent ignores files in the created folder (wrong folder name for its version), stop auto-creating for that agent and fix its `commandsDir` in `src/core/agents.yaml`.
  - **Measurement**: `agentbrew status --verbose 2>&1 | rg -o 'deployed to [0-9]+/[0-9]+ agents'`
  - **Anchor**: Nielsen, "10 Usability Heuristics for User Interface Design", 1994, heuristic 9 (error messages state the problem and suggest a solution).

- [ ] Re-evaluate the update-tooling catalog pointer against a generic upstream workflow
  **ID**: replace-relocate-update-tooling-catalog-pointer
  **Tags**: scout, catalog, skills, delegation, dotfiles
  **Details**: The catalog points to dotfiles for the host-aware `update-tooling` skill because AgentBrew must remain a curator and cannot own machine configuration. Revisit whether an upstream generic tooling-update workflow can safely replace the pointer, or whether the host-specific applied-checkout and LaunchAgent responsibilities remain the reason it belongs in dotfiles.
  **Files**: `src/catalog.yaml`, `src/catalog/catalog.test.ts`, dotfiles `skills/update-tooling/SKILL.md`
  **Acceptance**: Record one decision with current evidence: retain the dotfiles pointer because host ownership is unique, contribute a generic portion upstream, or replace the pointer with an upstream source. The catalog must continue to avoid duplicating skill content.

- [ ] Pull request checks run `npm run lint`
  **ID**: pr-check-runs-lint
  **Tags**: ci, lint
  **Details**: A biome complexity regression from #1445 merged unseen because no pull request check runs biome; #1447 fixed it. A check that runs `npm run lint` on every pull request stops the next one.
  **Files**: `.github/workflows/ci.yml`
  **Acceptance**: A pull request that fails `npm run lint` shows a failing check.
  **Output**: code

- [ ] Out-of-repo agentbrew LaunchAgents are generated with a locale
  **ID**: out-of-repo-launchagents-set-locale
  **Tags**: scout, launchagents, locale
  **Details**: Scouted while adding a locale to LaunchAgents: `com.agentbrew.competitor-watch` and `com.agentbrew.session-start-aux` are written by untracked scripts under `~/.config/agentbrew/scripts/`, not by `src/`. `agentbrew fix` now adds `LANG=C.UTF-8` after the fact, but each regeneration drops it again until the next fix tick. Generate these plists from `src/` (or a tracked template) with the same environment as `buildPlistContent`.
  **Files**: `src/sync/launchagent.ts`, `src/drift-checks/launchagent-path.ts`, `~/.config/agentbrew/scripts/`
  **Acceptance**: A freshly generated competitor-watch or session-start-aux plist has `EnvironmentVariables.LANG` without waiting for `agentbrew fix`.
  **Output**: code

- [ ] Index remaining garrytan/gstack niche skills in catalog.yaml
  - **ID**: index-gstack-niche-skills
  - **Tags**: scout, catalog, skills, curate, p3, landscape-2026-07-06
  - **Details**: `register-superpowers-ce-gstack-sources` indexed gstack sprint-pipeline skills from `garrytan/gstack`; ~35 remain (iOS suite, design-shotgun/consultation, OpenClaw adapters, pair-agent, gstack-upgrade, etc.). Users can already `agentbrew install garrytan/gstack` to index all skills — this task adds catalog pointers for niche entries users search for by name.
  - **Files**: src/catalog.yaml, CHANGELOG.md, src/catalog/catalog.test.ts
  - **Acceptance**: Remaining high-demand gstack skills have catalog entries with disambiguation text; `npm run verify` passes.

- [ ] Extract shared PR-body parsing helpers for deterministic PR hooks
  **ID**: extract-pr-hook-body-parser
  **Tags**: scout, hooks, shell, maintainability
  **Details**: Scouted while implementing `agent-artifact-pr-test-guard`: `gh-pr-skill-requires-evals.sh` and `gh-pr-agent-artifacts-require-tests.sh` both parse `gh pr create/edit` commands for `--body-file` and fallback command text. The logic is small today but duplicated across PR-time hooks; extract a shared helper under `hooks/lib/` before adding another PR-body hook so quoting/body-file edge cases have one fixture suite.
  **Files**: `hooks/lib/`, `hooks/checks/gh-pr-skill-requires-evals.sh`, `hooks/checks/gh-pr-agent-artifacts-require-tests.sh`, adjacent `.test.sh` fixtures
  **Acceptance**: Both hooks source one body parser helper; existing hook fixtures still pass; new helper fixtures cover quoted `--body-file`, unquoted `--body-file`, inline body fallback, and missing body.
  **Output**: code

- [ ] Unify `agentbrew setup opencode --model` with the Agentfile `defaultModel` surface
  **ID**: unify-opencode-bootstrap-model-with-default-model
  **Tags**: scout, models, opencode, api-surface
  **Details**: Scouted while adding model-sync: `agentbrew setup opencode --model <id>` (src/mcp/opencode-bootstrap.ts) configures OpenCode's model independently of the new Agentfile `defaultModel`/`modelOverrides` mechanism, so two entry points now set "which model an agent uses." OpenCode's `~/.config/opencode/opencode.json` top-level `model` key ("provider/model") is a valid `modelConfig` surface; consider declaring it in agents.yaml and making the bootstrap flow read/write the same override map, keeping one mental model per rule #9 (small external API).
  **Files**: `src/mcp/opencode-bootstrap.ts`, `src/core/agents.yaml`, `src/sync/model-sync.ts`
  **Acceptance**: either opencode declares `modelConfig` and the bootstrap flow routes through it (with `modelOverrides.opencode` as the id source), or a code comment in opencode-bootstrap.ts documents why the surfaces stay separate.
  **Output**: code

- [ ] Reconcile `skillSourceDirs` legacy semantics with Agentfile `sources`
  **ID**: reconcile-skill-source-dirs-with-agentfile-sources
  **Tags**: scout, skills-sync, agentfile, docs
  **Details**: `state.sources` now models indexed skill registries whose deployment is gated by `skillsInstalled`, while legacy `skillSourceDirs` still means "deploy every skill in this directory." That distinction is documented but still subtle and easy to misuse in hand-edited state. Decide whether to keep `skillSourceDirs` as an advanced opt-in escape hatch, migrate it to an explicit `optInSourceDirs` name, or replace it with Agentfile-local skill install flows.
  **Files**: `src/sync/skills-sync.ts`, `src/agentfile.ts`, `README.md`, `AGENTS.md`
  **Acceptance**: Source semantics are represented by one clear schema field or by docs plus lint/validation that flags accidental registry paths in `skillSourceDirs`; `agentbrew lint` or an equivalent test catches the ambiguous configuration.

- [ ] Re-promote or replace the ask-human MCP after upstream stdio init is fixed

  - **ID**: re-promote-ask-human-mcp-after-stdio-fix
  - **Tags**: mcp, catalog, upstream, scout
  - **Details**: `ask-human-mcp` 0.1.0 and 0.1.1 currently fail before MCP initialize in stdio mode with `RuntimeError: Already running asyncio in this thread` from `FastMCP.run()` / `anyio.run()` under the package's `asyncio.run(async_main())` launcher. The catalog entry was demoted from `recommended: true` to `recommended: false` while adding deep-smoke metadata, because `agentbrew mcp probe --deep` must not install/probe a known-broken recommended MCP. Re-check upstream issue Masony817/ask-human-mcp#3, test any new release with an initialize + `list_pending_questions` smoke call, then either restore `recommended: true` or replace the entry with a maintained human-in-the-loop MCP.
  - **Files**: `src/catalog.yaml`, `src/catalog/catalog.test.ts`
  - **Acceptance**: A direct stdio probe of the chosen ask-human MCP returns `status: "ok"` with `deepTool: "list_pending_questions"` or equivalent; the catalog entry is recommended only if the live smoke passes on a clean install.

- [ ] Make `npm run verify` work when the repo checkout lives under `.worktrees/`

  - **ID**: verify-biome-worktree-path-ignore
  - **Tags**: biome, verify, worktree, scout
  - **Details**: Running `npm run verify` from `~/apps/tooling/agentbrew/.worktrees/fix-agentfile-source-drift` fails at `biome check . --error-on-warnings` with "No files were processed" because `biome.json` excludes `!**/.worktrees`, and Biome appears to match that against the checkout's absolute path. Explicit checks such as `npx biome check src/catalog/catalog.test.ts` still work. The full verify gate should not fail solely because the agent is using a git worktree.
  - **Files**: `biome.json`, `package.json`
  - **Acceptance**: `npm run verify` processes source files and reaches the later verify stages from both the primary checkout and a `.worktrees/<branch>` checkout, while the primary checkout still does not lint nested sibling worktree contents.

- [ ] Refresh hook deploy helper comments after verifier lib growth
  - **ID**: refresh-hook-deploy-lib-comment
  - **Tags**: scout, hooks, docs, comment-drift
  - **Details**: `src/hooks/deploy.ts` says the hook `lib/` directory is "several files today", but the directory already has more helper files and Phase 2 verifier work grows it further. This is low-risk comment drift, but stale counts make future agents question whether deploy is intentionally copying only a subset. Replace the hardcoded count with count-free wording.
  - **Files**: `src/hooks/deploy.ts`
  - **Acceptance**: Hook deploy comments describe copying the flat `hooks/lib/` helper directory without a stale hardcoded file count; tests still pass.

- [ ] Remove dead `replaceAllText` empty-match branch in `gdoc-surgical-edit-only.sh`
  - **ID**: gdoc-surgical-dead-replacealltext-branch
  - **Tags**: scout, hooks, dead-code, gdoc
  - **Details**: The block branch matching `replaceAllText.*containsText[^"]*""` can never fire on well-formed JSON — the closing `"` after the `containsText` key immediately ends the `[^"]*` class before it can reach `""`. Verified empirically while writing the fixture (the hook's reachable block paths are `mode:full`, `replaceMode:replace`, and the >8 KB body size guard). Either fix the regex to detect a genuinely-empty `containsText` value or delete the dead branch and document the real coverage.
  - **Files**: `hooks/checks/gdoc-surgical-edit-only.sh`, `hooks/checks/gdoc-surgical-edit-only.test.sh`
  - **Acceptance**: every block branch in the script is reachable and covered by a fixture case; no dead regex remains.

- [ ] `gh-pr-body-requires-rationale` bypasses on multi-line PR bodies (single-line `--body` extraction)
  - **ID**: gh-pr-body-rationale-multiline-extraction
  - **Tags**: scout, hooks, gh-pr, false-negative
  - **Details**: The hook extracts `--body` with a single-line `sed`, so a `gh pr create --body $'...\n...'` (a real newline) makes extraction fail and the hook bypasses ("no --body arg detected") instead of evaluating the rationale — a silent false-negative for exactly the realistic multi-line-body case. Surfaced while writing the fixture (escaped-`\n` bodies evaluate; real-newline bodies bypass). Parse the body robustly (handle multi-line / `--body-file`) so the rationale check actually runs on real PR bodies.
  - **Files**: `hooks/checks/gh-pr-body-requires-rationale.sh`, `hooks/checks/gh-pr-body-requires-rationale.test.sh`
  - **Acceptance**: a multi-line `--body` with no rationale is blocked; one with a rationale is allowed; the fixture covers both multi-line shapes.

- [ ] Re-evaluate source-manifest bootstrap glue for relocation to upstream skills CLI or overlay-owned scripts
  - **ID**: replace-relocate-source-manifest-bootstrap
  - **Tags**: replace-relocate, source-manifest, bootstrap, delegation
  - **Details**: The generic `bootstrap:` source-manifest block is intentionally small agentbrew glue for overlay one-time setup. Per VISION.md's delegate → contribute → absorb rule, revisit whether this belongs permanently in agentbrew, should be contributed to `vercel-labs/skills` as source-manifest lifecycle support, or should move fully into overlay repos as explicit scripts invoked by their quickstart. Include evidence from at least one real overlay using it and from upstream skills CLI source-manifest capabilities at the time of review.
  - **Files**: `src/catalog/index-source.ts`, `src/bootstrap.ts`, `src/commands/cli-bootstrap.ts`, `README.md`, `docs/competition/vercel-skills-cli-vs-agentbrew.md`
  - **Acceptance**: A short decision note is added to this task or a linked doc with one of: keep in agentbrew because no upstream/tool-owned host covers generic source bootstrap; contribute upstream with issue/PR link; relocate to overlay quickstart scripts and remove the agentbrew command. If the decision is keep, set a next quarterly review date.

- [ ] Explore whether Agentfile should sync Claude Code session settings (autoMemoryEnabled, autoDreamEnabled, autoMode)
  **ID**: agentfile-claude-session-settings-sync
  **Tags**: scout, agentfile, claude-settings, exploratory, docs/research/claude-code-undocumented-config.md
  **Details**: Claude Code has session-level settings in `~/.claude/settings.json`: `autoMemoryEnabled` (auto-extract memories per session), `autoDreamEnabled` (consolidate memories across sessions), and `autoMode` (allow/soft_deny/hard_deny/environment classifier). Binary verification confirms these are real in 2.1.138. Explore whether the Agentfile should be able to declare these settings and sync them like the existing hooks key. This is exploratory — the research doc notes this as P3 to avoid building load-bearing infra on unstable fields (e.g., `criticalSystemReminder_EXPERIMENTAL` is explicitly flagged).
  **Files**: `src/sync/settings-sync.ts` (new, if approved), `src/cli.ts` (register sync target)
  **Acceptance**: A decision document in `docs/research/agentfile-claude-settings-sync-decision.md` that either (a) approves the feature with implementation path OR (b) rejects with rationale (e.g., settings are user-preference, not project-level).

- [ ] Adopt rule #8 — pattern conformance index in `VISION.md`
  **ID**: adopt-rule-8-pattern-conformance-index
  **Tags**: scout, rule-8, constitution, architecture
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: Minsky's rule #8: "Every artifact (file, package, interface, architectural decision, process step) traces to a named, published pattern. New artifacts add a row to `vision.md` § 'Pattern conformance index' in the same commit. Deviations from the published pattern are declared explicitly. Identifiers match pattern names when the match is total. Silent deviation is itself a constitutional violation."

  agentbrew's `getAdapter()` factory IS the Adapter pattern (Gamma 1994). The drift-detection runs every 30 min — that's MAPE-K (IBM 2003). The state.yaml + Agentfile pair is Repository + Specification (Evans 2003, Fowler 2002). But none are CITED in code or VISION.md. New contributors don't know which patterns are load-bearing.

  Build: (a) `VISION.md` gains a `## Pattern conformance index` table — rows: artifact path, pattern name, source citation, conformance (full/partial/declared deviation), notes. (b) Top-of-file JSDoc on key types (`Adapter`, `SyncEngine`, `DriftCheck`) names the pattern. (c) `scripts/check-rule-8-pattern-conformance.mjs` parses the index and verifies every claimed-pattern row points at a real file. (d) PR template "What pattern does this conform to?" field.

  This is groundwork for `establish-vision-constitutional-rules` — rule #8 is one of the iron rules listed there. Lands together or sequentially.
  **Files**: VISION.md (new `## Pattern conformance index` section), src/**/*.ts (add pattern citations to top-of-file JSDoc on key modules), scripts/check-rule-8-pattern-conformance.mjs (new), .github/pull_request_template.md (extend)
  **Acceptance**: VISION.md has a pattern conformance index with ≥15 rows; ≥key source files carry top-of-file pattern citations; lint passes on every PR.
  **Hypothesis**: Naming the patterns makes architectural drift visible at PR time (vs the current "I think this is how we do it" review pattern).
  **Success**: After 30 days, ≥3 PRs cite a specific pattern row in review and either conform or declare deviation.
  **Pivot**: If naming patterns adds review friction with no quality gain, downgrade to "pattern citation encouraged in top-of-file JSDoc, not required" and drop the lint.
  **Measurement**: `grep -c '^| .* |' VISION.md` in the pattern-conformance section returns ≥15.
  **Anchor**: Minsky `vision.md` § 8 "Pattern conformance"; Gamma et al. 1994 *Design Patterns* (canonical reference); Alexander 1977 *A Pattern Language* (the original pattern-language idea); Hohpe & Woolf 2003 *Enterprise Integration Patterns* (for agentbrew's adapter family).

- [ ] Adopt rule #16 — default by default (new behavior IS the default, not opt-in)
  **ID**: adopt-rule-16-default-by-default
  **Tags**: scout, rule-16, constitution
  **Blocked by**: reuse-minsky-check-rule-scripts (try the GET path first; if Minsky scripts don't generalize, this task unblocks as the local impl fallback)
  **Details**: Minsky's rule #16: "When you implement a new behaviour or fix, make it the default immediately — not an opt-in flag behind an env var. Every new default ships with (1) an experiment in `.minsky/experiments/<id>.yaml`, (2) a runnable measurement, (3) a documented opt-out for debugging only. Burden of proof: 'why ISN'T this the default?'"

  agentbrew has accumulated opt-in flags (`--prune`, `--dry-run`, `--verbose`, `--source`, `--curated`) that should perhaps be defaults. The audit found 3 cases where a fix landed behind a flag instead of as the default behavior (e.g. the recent opencode fix in `import.ts`).

  Build: (a) `scripts/check-rule-16-defaults.mjs` parses `src/cli.ts` for new flags added in a PR and asserts each is justified in the PR body with one of: "behavior change too disruptive", "debug-only exit hatch", "user-config knob". (b) PR template extension: "Why is this not the default?" field for every new flag. (c) Audit existing flags and either flip to default OR add an experiment file documenting why they remain opt-in.
  **Files**: scripts/check-rule-16-defaults.mjs (new), .github/pull_request_template.md (extend), docs/cli-flags-audit.md (new — one row per existing flag with justification), src/cli.ts (flip ≥1 flag to default as the canary)
  **Acceptance**: lint runs on every PR; new flags require justification; existing flags audited; at least 1 flag flipped to default with measurement showing no regression.
  **Hypothesis**: Forcing "why isn't this the default?" surfaces accidental opt-in features that should just be the new behavior.
  **Success**: After 30 days, ≥3 existing flags flipped to default; ≤1 new flag added without "why isn't this default" justification.
  **Pivot**: If burdensome flag-justification slows feature work, narrow to "any new env-var-toggled behavior requires the justification" (drop CLI flag scrutiny).
  **Measurement**: `node scripts/check-rule-16-defaults.mjs --json | jq '.unjustified_flags | length'` returns 0; flag count in `src/cli.ts` trends down.
  **Anchor**: Minsky `vision.md` § 16 "Default by default"; Spolsky 2001 *Joel on Software* (the "configuration is debt" essay); Conway 1968 (Conway's Law — flags often externalize team boundaries).

- [ ] team overlay detection observability — surface in `agentbrew status --verbose`
  **ID**: org-overlay-detection-observability
  **Tags**: scout, observability, org-overlay, audit-2026-05-25
  **Blocked**: obsolete — premise removed by PR #988 (2026-05-13 "feat: extract remaining org content to overlay"). That PR deleted `src/core/team-detect.ts` and `src/core/team-detect.test.ts` (that test file) entirely. The host-based auto-detection model the task assumes ("`gh` config moves, env-var rename, registry URL change") was replaced with explicit team-subscription via `agentbrew team set <overlay-url>` (see `src/team/team-catalog-overlay.test.ts` + `src/catalog/types.ts` § "Add an entry to the overlay's catalog-overlay.yaml"). Under the new model there is no implicit detection to observe — `agentbrew status` already lists the registered team overlay path (`agentbrew team show`) and which catalog entries came from it. The "team overlay silently fails to load" failure mode the task tried to instrument cannot happen anymore — failure is now noisy (`team set` either succeeds or returns a non-zero exit with a clear error). Re-validate before unblocking: if there's a NEW silent-failure mode in the team-overlay-loading code path (`loadCatalog` merging the overlay catalog), file a fresh task scoped to THAT failure mode. The original framing no longer applies.
  **Details**: `src/core/team-detect.ts` runs on every sync but has no corresponding status output. If detection breaks (e.g. `gh` config moves, env-var rename, registry URL change), the team overlay silently fails to load and users notice when expected skills are missing. Add a clearly-visible `agentbrew status --verbose` block: "team overlay: detected via <signal-name> | NOT detected (signals checked: <list>)". Add tests for detection edge cases (missing `gh` config, partial org signals, env-var with empty value).
  **Files**: src/core/team-detect.ts (add `getDetectionTrace()` exported helper), src/cli.ts (extend status command), src/core/team-detect.test.ts (add edge-case coverage), VISION.md § "Team overlays" (cross-reference the observability output)
  **Acceptance**: `agentbrew status --verbose` shows detection result + signal source on org hosts; `--json` includes structured detection trace; tests cover all detection signals + 3 negative cases.
  **Surfaced-by**: 2026-05-25 ecosystem audit (subagent report § 12).

- [ ] Cursor rules delegation completeness — per-file rules path
  **ID**: cursor-rules-delegation-completeness
  **Tags**: scout, sync-engine, cursor, audit-2026-05-25
  **Details**: Cursor's global rules delegate to `ai-rules` (via `rules-delegate.ts`) but per-file rules in `~/.codeium/windsurf/rules/` (Cursor's actual config path) are NOT delegated. This creates a split: global rules go through ai-rules, per-file rules are native. A user adding a per-file rule manually has no agentbrew tracking; future `sync --prune` could delete it OR drift undetected. Resolve by either (a) extending delegation to per-file rules (preferred), or (b) adding per-file rules to the native carve-out list and documenting the split clearly.
  **Files**: src/sync/rules-delegate.ts, src/sync/rules-sync.ts, ARCHITECTURE.md § "Data Flow" (clarify the Cursor row)
  **Acceptance**: per-file Cursor rules are either delegated (preferred) or explicitly carved-out with documentation + tests; sync round-trip preserves user-added per-file rules; ARCHITECTURE.md "Data Flow" table reflects reality.
  **Surfaced-by**: 2026-05-25 ecosystem audit (subagent report § 8).

- [ ] First-run experience — detect offline + auto-warm `npx skills` cache
  **ID**: first-run-offline-warmup
  **Tags**: scout, ux, onboarding, audit-2026-05-25
  **Details**: README mentions "Before going offline, run `npx --yes skills --version` once" but this is a footgun — users forget, then `agentbrew init` fails with `ENOTCACHED` and they're confused. Build: `agentbrew init` detects offline mode (probe network with a 2s timeout) and either (a) auto-warms the cache before going offline OR (b) gives an actionable error: "Run `npx --yes skills --version` once on a connected machine, then retry `agentbrew init`."
  **Files**: src/init.ts (add network probe + warmup path), src/init.test.ts (extend with offline scenarios), README.md § "Offline installs" (mention the new behavior)
  **Acceptance**: init succeeds on a connected machine that has never run `npx skills` (auto-warms); init on offline machine without cache prints actionable error with the exact command to run; tests cover both paths.
  **Surfaced-by**: 2026-05-25 ecosystem audit (subagent report § 15).

- [ ] Track install events + surface popularity signal in `agentbrew browse`
  **ID**: catalog-install-popularity-signal
  **Tags**: scout, catalog, ux, ecosystem-alignment
  **Details**: Skill discovery is the #1 UX complaint in the ecosystem. The official `skills.sh` registry paginates many public skills alphabetically with no install-rank. orangebot.ai/skills built a ranked index of install-ranked public skills sorted by weekly install volume because nobody else did. claudepluginhub.com (32k+ plugins) tracks "1,730 installs in the last 7 days" per plugin. agentbrew's `browse` command has no popularity signal — Tier 1/2/3 is editorial-curated, not data-driven.

  Concrete build:
  - Local event log at `~/.config/agentbrew/install-events.jsonl` — append on every successful `agentbrew install <id>` (skill / mcp / rule / bundle)
  - Each event: `{ timestamp, item_type, item_id, source, version, agent_target }` — no PII, no telemetry over the wire
  - Aggregation: `src/catalog/popularity.ts` reads the log, computes 7d/30d/all-time install counts per item
  - `agentbrew browse --sort=trending|popular|alphabetical` (default: alphabetical, but interactive `agentbrew browse` shows top-5 trending at top)
  - `agentbrew browse <id>` shows install count history sparkline
  - Strictly local — no opt-out needed since no data leaves the machine. Optional `agentbrew telemetry export` produces an anonymized summary for users who WANT to share aggregate stats upstream (off by default)

  Integrates with the Minsky-discipline task: `src/adapters/popularity-store.ts` interface + `src/adapters/popularity-store.jsonl.ts` impl, so the storage backend is swappable (e.g. SQLite later, or a shared community endpoint if ecosystem demand emerges).
  **Files**: src/catalog/popularity.ts (new), src/catalog/popularity.test.ts (new), src/adapters/popularity-store.ts (new), src/adapters/popularity-store.jsonl.ts (new), src/cli.ts (add `--sort` flag to browse + sparkline rendering), src/install.ts (append install events), README.md (Popularity tracking section)
  **Acceptance**: (a) every successful `agentbrew install` appends a JSONL row; (b) `agentbrew browse --sort=trending` returns items sorted by 7d install count; (c) no network call is made by the popularity layer (verified by test with network mock); (d) `agentbrew browse <id>` shows a 30-day install history sparkline; (e) tests cover empty-log + corrupted-row + concurrent-write scenarios.
  **Hypothesis**: A local install-count signal converts agentbrew's editorial Tier system into an empirically-validated signal — users see which items are actually used vs which were just recommended.
  **Success**: Within 30 days of shipping, the `--sort=trending` view surfaces ≥3 items that are NOT in the current Tier 1 set, suggesting the editorial picks miss real usage patterns.
  **Pivot**: If single-user install counts produce too-thin signal (Fyodor installs each thing once), pivot to a "session-frequency" signal — count how often each skill/MCP/rule is mentioned in the agent's tool-call logs (requires hooks-sync extension to capture tool-call events).
  **Measurement**: `wc -l ~/.config/agentbrew/install-events.jsonl` increases monotonically with installs; `agentbrew browse --sort=trending --json | jq '. | length' ≥ 5`.
  **Anchor**: orangebot.ai/skills (2026-05) — install-volume ranking for install-ranked public skills; claudepluginhub.com (April 2026 stats) — per-plugin install counters; agentbrew VISION.md § "Curator, not host" — editorial picks + empirical signal is stronger than either alone.

- [ ] (Publish-only step) File the staged upstream issue at `neiii/bridle` (upstream relocated 2026-05-02 from `superwall/bridle`) noting `harness-locate` uses singular `skill/` and `command/` for OpenCode but the official OpenCode docs use plural.
  **ID**: bridle-opencode-path-issue
  **Tags**: upstream-contribution, bridle, scout, blocked-explicit-permission, publish-only
  **Details**: Surfaced from the 2026-04-26 `audit-harness-locate-paths` audit (see [`docs/audits/harness-locate-cross-check.md`](docs/audits/harness-locate-cross-check.md)). Bridle's `harness-locate::opencode` returns `~/.config/opencode/skill/` (singular) and `~/.config/opencode/command/` (singular). Per [OpenCode docs](https://opencode.ai/docs/skills) (2026-04-26), the actual paths are plural: `~/.config/opencode/skills/<name>/SKILL.md` and `~/.config/opencode/commands/<name>.md`.

    **Draft staged 2026-04-26 (PR #814)** in [`docs/audits/bridle-opencode-issue-draft.md`](docs/audits/bridle-opencode-issue-draft.md). The draft includes the title, body, source-code line references (`opencode.rs:41-46` for `commands_dir`, `opencode.rs:73-78` for `skills_dir`), suggested diff, and a filing checklist for the publish step.

    **Publishing hold**: posting the issue at `neiii/bridle` is a public-write action under the file-level publishing policy and requires explicit per-action approval at the moment of filing. The draft is ready (URL/branch references corrected after the 2026-05-02 upstream relocation, see `refresh-bridle-audit-docs-after-upstream-relocation` above); the only remaining step is `gh issue create` once approved.

    Outcome: a short, factual issue body referencing both OpenCode doc URLs and the two specific Bridle source-code lines. If accepted upstream: a Bridle patch lands; agentbrew users on `harness-locate`-backed tooling see correct paths. If rejected: closes a future-noise channel for next-session audits.

    Scope when approved: ~5 minutes — read the draft, confirm line ranges still match Bridle's `master` branch on `neiii/bridle`, run `gh issue create --repo neiii/bridle ...`, paste the URL into the audit report's "Scout output" section.

    Publishing scope: cross-org (Bridle is `neiii/bridle` on github.com — relocated 2026-05-02 from `superwall/bridle`). REQUIRES EXPLICIT PER-ACTION USER APPROVAL.
  **Files**: [`docs/audits/bridle-opencode-issue-draft.md`](docs/audits/bridle-opencode-issue-draft.md) (the staged draft); when filed, [`docs/audits/harness-locate-cross-check.md`](docs/audits/harness-locate-cross-check.md) gets the issue URL appended under "Scout output".
  **Acceptance**: ~~(a) the issue draft is recorded in the commit body or a sibling `docs/audits/bridle-opencode-issue-draft.md`~~ DONE 2026-04-26 (PR #814 — draft staged at `docs/audits/bridle-opencode-issue-draft.md`); (b) post-approval, the issue is filed and the URL recorded in the audit report's "scout output" section; (c) if Bridle merges a fix, the audit report and `agents-yaml-honor-env-overrides` task get a one-line update.
  **Output**: docs
  **Human-approval-required**: external-issue
  **Blocked**: needs-user-approval — posting the upstream `neiii/bridle` issue is a public write and requires explicit current-session approval for that exact action.
  **Research**: 2026-05-02 — upstream target refresh.
    `superwall/bridle` no longer resolves through GitHub, but GitHub repo search finds the Bridle harness project at `neiii/bridle` (`https://github.com/neiii/bridle`, default branch `master`). The current `crates/harness-locate/src/harness/opencode.rs` still documents and joins singular `command`/`skill` at the OpenCode command/skill helpers, and an all-state issue search on `neiii/bridle` for the OpenCode plural/singular terms returned no existing issue. Before the approved publish step, update the draft's target repo and line links from `superwall/bridle`/`main` to `neiii/bridle`/`master`, then file there if the user approves that exact public write.

    2026-05-02 (later) — draft prep shipped via `refresh-bridle-audit-docs-after-upstream-relocation`. `docs/audits/bridle-opencode-issue-draft.md` and `docs/audits/harness-locate-cross-check.md` now point at `neiii/bridle@master`, the `gh issue create` invocation targets `neiii/bridle`, and a re-fetch of `crates/harness-locate/src/harness/opencode.rs` from `neiii/bridle@master` confirmed the singular `"skill"` / `"command"` joins still exist at the documented line ranges (43-45 / 75-77; function blocks 41-46 / 73-78). The draft is now publish-ready end-to-end; the only remaining step is the still-blocked `gh issue create` at `neiii/bridle`.
  **Last-enriched**: 2026-05-02

- [ ] Bump hardcoded agent counts from 56 → qodo agent registry drift landed (5 cascading test failures)
  **ID**: fix-agent-count-drift-after-qodo
  **Tags**: scout, tests, stale-assertions, agents-yaml
  **Details**: PR #3 `feat(agents): add qodo agent definition` added qodo as the 57th entry in `src/core/agents.yaml`, but five downstream tests/docs still hardcode 56:

    1. `src/types.test.ts > AGENT_DEFINITIONS > defines the full agent registry` — `expected [Array(57)] to have a length of 56 but got 57`.
    2. `src/core/agents.test.ts > loadAgentDefinitions > loads all agents from YAML` — `expected 57 to be 56`.
    3. `src/core/agents.test.ts > loadAgentDefinitions > marks skills-only agents as experimental` — likely the same root cause (qodo not classified in the experimental allowlist).
    4. `src/core/agent-name-map.test.ts > coverage invariant — every agent in agents.yaml is classified` — qodo is in `agents.yaml` but not in skills CLI intersection, renames, or carve-outs.
    5. `src/docs/agent-matrix.test.ts > README agent matrix freshness > README.md content between <!-- agent-matrix:* --> matches the generated output` — the README agent matrix table is missing the qodo row.

    Together these are the largest single cluster (5 of 14) of `npm run test:all` failures on `origin/main` as of 2026-05-20. They've blocked agents from using `npm run test:all` as a green baseline for two weeks — every PR looks like it introduces failures until you stash and confirm.

    Fix is mostly mechanical: bump the hardcoded `56` to `57` in `types.test.ts` (prefer `expect(AGENT_DEFINITIONS.length).toBe(loadAgentDefinitions().length)` to make this self-healing), bump the same in `agents.test.ts`, classify qodo in `src/core/agent-name-map.ts` (intersection / rename / carve-out — qodo is an IDE skill agent so probably intersection), and regenerate `README.md`'s agent matrix block via the existing template generator (or `npm run -s build:readme-matrix` if that script exists).
  **Files**: `src/types.test.ts`, `src/core/agents.test.ts`, `src/core/agent-name-map.ts`, `src/core/agent-name-map.test.ts`, `README.md` (the section between `<!-- agent-matrix:start -->` and `<!-- agent-matrix:end -->`)
  **Acceptance**: (a) `npx vitest run src/types.test.ts src/core/agents.test.ts src/core/agent-name-map.test.ts src/docs/agent-matrix.test.ts` exits 0; (b) prefer self-healing assertions over hardcoded counts so the next agent addition doesn't repeat this work; (c) the `agent-name-map` classification rationale is added for qodo if it's a carve-out.
  **Output**: code
  **Hypothesis**: All 5 failures share a single root cause — qodo (57th agent) was added without updating the downstream count assertions + classification map + README matrix. Replacing hardcoded counts with `loadAgentDefinitions().length` and adding qodo's classification entry will fix all 5 in one PR.
  **Success**: 5/listed tests pass; `npm run test:all` drops from 14 → 9 failures.
  **Pivot**: If qodo turns out to need a carve-out (agentbrew-only, not in skills CLI), the rationale text under `AGENTBREW_ONLY_AGENTS_RATIONALE` must explain why — same pattern as the existing carve-out agents.
  **Measurement**: `npx vitest run src/types.test.ts src/core/agents.test.ts src/core/agent-name-map.test.ts src/docs/agent-matrix.test.ts 2>&1 | tail -3` shows `Tests  X passed (X)` with 0 failed.
  **Anchor**: agentbrew AGENTS.md rule #1 (test before committing requires a green baseline); the `feedback-loop-guardrails` cursor rule's "every bug becomes a rule" — replacing hardcoded counts with derived assertions IS the rule that prevents this recurring.
  **Surfaced-by**: 2026-05-20 PR #1015 (`collapse-mcpformat-dispatch-to-adapter`) `npm run test:all` baseline check. Caused by PR #3 `feat(agents): add qodo agent definition` (the only commit touching agents.yaml between PR #934 and HEAD); the downstream tests/docs were never updated.

- [ ] Investigate `MCP server lifecycle add → list → sync → verify in agent configs → remove` integration test failure
  **ID**: investigate-mcp-lifecycle-integration-test
  **Tags**: scout, tests, integration, mcp, needs-investigation
  **Details**: `src/integration.test.ts > MCP server lifecycle > add → list → sync → verify in agent configs → remove` fails on `origin/main` as of 2026-05-20. The root cause is unknown — it could be (a) interaction with the `windsurf` carve-out change in `ebb87617 test: fix windsurf carve-out + 97% surface coverage`, (b) interaction with mcpm's stateful registry (the `agentbrew-test-smoke-*` orphans tracked by the P1 task `cleanup-mcpm-test-smoke-pollution`), or (c) something else entirely.

    First step: run with `--reporter=verbose` to see the actual assertion failure and the step that fails:
    ```
    npx vitest run src/integration.test.ts -t "MCP server lifecycle" --reporter=verbose 2>&1 | tail -60
    ```

    Then determine whether the failure is pre-existing (stash all changes, re-run — confirms the failure is on `main`), or a new regression. If pre-existing, find the commit that introduced it via `git bisect`.

    Likely candidates given the timing (2026-05-19/20):
    - `ebb87617 test: fix windsurf carve-out + 97% surface coverage` (most recent test-touching commit before this PR)
    - `e2e96de0 fix: move windsurf from mcpm to native carve-out` (the underlying carve-out change)
    - `1e440e3e feat(security): identity-rewrite mirror + widened regex (#1002)` (if the regex change affected an MCP transform path)
  **Files**: `src/integration.test.ts` (the failing test), plus whichever production file the bisect identifies.
  **Acceptance**: (a) root cause documented in a follow-up commit body; (b) `npx vitest run src/integration.test.ts -t "MCP server lifecycle"` exits 0.
  **Output**: mixed
  **Surfaced-by**: 2026-05-20 PR #1015 `npm run test:all` baseline check.

- [ ] Remove or wire up dead `src/fetch-sources.ts` — only referenced by its own test
  - **ID**: dead-code-fetch-sources
  - **Tags**: scout, dead-code, cleanup
  - **Blocked**: needs-revalidation — premise contradicted 2026-05-26 by reading `src/init.ts:140` which calls `await fetchSources()` from the `agentbrew init` command path. The blocking commit is fc41da15 "feat(init): make init idempotent — install recommended + sync (#10)" which explicitly re-wired fetchSources into init. `src/integration-essential-core.test.ts`, `src/integration-infra.test.ts`, and `src/init.test.ts` all also mock the module, confirming it's a known dependency of init. So the task's "NOT called from any live code path" claim no longer holds — deleting fetch-sources.ts would break `agentbrew init`. Re-validate before unblocking: either (a) re-state the task as "extract the disk-write semantics fetchSources adds vs scanSkillDirs and consolidate" if there's still drift between the two; or (b) mark as completed if the disk-write side IS load-bearing for init and the dead-code claim is no longer relevant.
  - **Details**: While fixing `unify-skill-scanner-paths` on 2026-05-25, confirmed that `src/fetch-sources.ts`'s exported `fetchSources()` function is NOT called from any live code path — only `src/fetch-sources.test.ts` exercises it. The scanner unification fix added the deep-scan fallback directly to `sync/skills-sync.ts` `scanSkillDirs`, which now matches the catalog code path's behavior. So `fetch-sources.ts` is now redundant (and possibly was always dead — it appears to have been an attempted extraction that never got wired into `sync.ts`'s call chain). Two options: (a) delete the file + its test if no callers want its specific behavior; (b) wire it into `sync` if there's a reason to keep it (rebuilds `availableItems` on disk vs in-memory, perhaps for `agentbrew status` reporting). Pick (a) unless something concrete justifies the keep.
  - **Files**: `src/fetch-sources.ts` (delete), `src/fetch-sources.test.ts` (delete), `src/cli.ts` or wherever an import would land (verify no stale references)
  - **Acceptance**: After this PR, `grep -r "from.*fetch-sources" src/ | grep -v fetch-sources` returns 0 matches. `knip` and `npm run verify` exit clean.
  - **Hypothesis**: `fetch-sources` was an aborted extraction now superseded by the deep-scan fallback in `scanSkillDirs`; removing it keeps the codebase smaller and prevents future contributors from accidentally calling it.
  - **Success**: `knip --no-progress` reports `fetchSources` as unused before; reports nothing about it after.
  - **Pivot**: If `fetchSources` has a meaningful semantic difference from `scanSkillDirs` (e.g. writes to disk vs only scans), wire it into a `agentbrew refresh-sources` subcommand instead of deleting.
  - **Measurement**: `grep -rn "fetchSources\b" src/ | wc -l` returns 0 after the change (currently 4 — module export, test import, function definition).
  - **Anchor**: Knip's job is to surface dead exports; `fetch-sources` appears in its output but hasn't been deleted yet.

- [ ] Migrate the migration-candidate built-in skills out of `skill-plugins/dev/`
  **ID**: migrate-builtin-skills-to-source-repos
  **Tags**: scout, vision-curator-not-host, codebase-shrink, audit-2026-05-25
  **Details**: Per VISION.md § "Curator, not host", only built-in skills that stay in-repo should remain permanently in `skill-plugins/dev/`: `agentbrew-*` family (skills that document agentbrew itself), `agentfile-init`, `sync-agent-config`, `load-project-context` — anything that has no other natural home. The other remaining built-in skills are migration candidates that should move to source repos (their own GitHub repos or grouped into thematic repos like `companion-*`, `grind-*`, `skill-*`), with catalog references replacing the built-in entries. `skill-plugins/dev/README.md` already has a bucket list classifying each.

  This is a multi-PR program of work, not a single commit. Decompose by bucket:
  - **Bucket A** — `companion-*` family (companion skills): create `agentbrew-companion-skills` source repo, move all 6, update catalog
  - **Bucket B** — `grind-*` family (grind skills): create `agentbrew-grind-skills` source repo or merge into companion-skills if scope overlaps
  - **Bucket C** — `skill-*` family (skill-creator, skill-rewriter, skill-eval-loop): create `agentbrew-skill-tooling` source repo
  - **Bucket D** — Remaining one-offs (remaining one-off skills): triage per skill — either find a natural source repo upstream, create a small thematic repo, or mark as agentbrew-permanent if genuinely scope-aligned

  Each bucket is its own PR: (1) create source repo with proper README/AGENTS.md/CHANGELOG, (2) copy skills with `git mv` + history rewrite if needed, (3) add catalog `source_repo` entries pointing at the new repo, (4) delete from `skill-plugins/dev/`, (5) update `skill-plugins/dev/README.md` to remove the migrated entries from the bucket list.

  Cross-link: this task is the concrete instance of `adopt-rule-1-don't-reinvent` from the constitutional rules — every skill that's actually a "shared dev tool", not "agentbrew internals", should be a source repo.
  **Files**: skill-plugins/dev/README.md (track progress), src/catalog.yaml (add `source_repo` entries as buckets land), CHANGELOG.md per bucket
  **Acceptance**: by end of program — `skill-plugins/dev/` contains only agentbrew-permanent skills (only the agentbrew-permanent set); `src/catalog.yaml` has ≥4 new `source_repo` references pointing at the new repos; the codebase non-test LOC target (<20K per VISION rule #7) is materially closer.
  **Surfaced-by**: 2026-05-25 ecosystem audit (subagent report § 13); existing `skill-plugins/dev/README.md` bucket list.

- [ ] Add catalog refs for upstream lifecycle/loop primitives — Ralph Wiggum + right-hooks
  **ID**: catalog-refs-ralph-and-right-hooks
  **Tags**: scout, catalog, ecosystem-alignment
  **Details**: Two upstream primitives that the AI dev ecosystem has converged on are missing from agentbrew's catalog as direct references:

  1. **Ralph Wiggum loop** (Geoffrey Huntley) — official Anthropic plugin at `anthropics/claude-code/plugins/ralph-wiggum`. Uses Claude Code's Stop hook to make the agent self-loop in the same session until a completion promise fires. Boris Cherny (Claude Code creator) endorsed it. The pattern is the dominant "fire-and-forget" autonomous-loop idiom; agentbrew's `companion-researcher` umbrella is the parallel-lane pattern, not the Ralph pattern. Catalog entry should point at `anthropics/claude-code/plugins/ralph-wiggum` as Tier 2, with a one-line description and the install command.

  2. **right-hooks** (npm `right-hooks`, https://registry.npmjs.org/right-hooks) — lifecycle enforcement hooks for autonomous Claude Code agents. Implements the `Think → Plan → Build → Review → Test → Ship → Reflect` lifecycle with mechanical gates that block the agent from skipping phases. Multi-runtime support (Codex, Cursor, Aider) on roadmap. Catalog entry should add this as Tier 2 for users running autonomous loops.

  Both are pure references — agentbrew adds catalog rows that point at the upstream package; install handler delegates to `npm install -g right-hooks` and `/plugin install ralph-wiggum@claude-plugins-official` respectively. No skill content duplicated, no maintenance burden.

  Integrates with bundles task (`catalog-plugin-bundle-primitive`): add an `autonomous-loop` bundle that pairs `ralph-wiggum` + `right-hooks` + `verify-everything` bundle members. Integrates with adapter discipline (`adopt-minsky-adapter-discipline`): adding these is itself a "Replace? Relocate?" instance — agentbrew's prior implicit work on autonomous loops (the companion-researcher umbrella) should be re-evaluated against Ralph.
  **Files**: src/catalog.yaml (new catalog entries under existing skills/MCPs section + 1 new bundle), src/cli.ts (install handler for the `/plugin install` path), README.md (mention in Catalog sources)
  **Acceptance**: (a) `agentbrew browse | grep -E '(ralph-wiggum|right-hooks)'` returns entries; (b) `agentbrew install ralph-wiggum` runs `/plugin install ralph-wiggum@claude-plugins-official` for Claude Code; (c) `agentbrew install right-hooks` runs `npm install -g right-hooks`; (d) `autonomous-loop` bundle exists and installs both + verify bundle.
  **Hypothesis**: Linking the two dominant ecosystem primitives saves the curator effort of building Ralph/lifecycle-loop skills in-house and matches "delegate before contribute" from VISION.
  **Success**: After 30 days, the `autonomous-loop` bundle has been installed at least once and `right-hooks` ships an updated version that agentbrew picks up via the upstream-version flow.
  **Pivot**: If either primitive turns out to be Claude-Code-only and can't be adapted to Cursor/Devin/etc., scope the catalog entry to `agent_target: claude-code` only rather than dropping it.
  **Measurement**: `grep -c '^  - id: ralph-wiggum' src/catalog.yaml` and `grep -c '^  - id: right-hooks' src/catalog.yaml` both return 1.
  **Anchor**: `anthropics/claude-code/plugins/ralph-wiggum` README — official Anthropic implementation; Boris Cherny endorsement (Claude Code creator); registry.npmjs.org/right-hooks — Think→Plan→Build→Review→Test→Ship→Reflect lifecycle; Geoffrey Huntley original "Ralph is a Bash loop" essay.

- [ ] Two pre-existing TASKS.md entries have invalid **Output**: values — validator red on main
  **ID**: fix-tasks-md-output-cadence-preexisting-violations
  **Tags**: scout,tasks-md,validator,p3
  **Details**: Scouted 2026-05-25 while adding jira-mcp-delete-edit-comment-tools via scripts/add-task.sh. The post-insert validator (`npx vitest run src/docs/tasks-md-output-cadence.test.ts`) is RED on plain origin/main with two pre-existing violations: `agentbrew-tasks-rule9-fill-sweep` uses Output value `code + docs` instead of an allowed value, and `investigate-mcp-lifecycle-integration-test` uses a free-form Output value. The validator at src/docs/tasks-md-output-cadence.test.ts:163 fails both. This means the scripts/add-task.sh helper currently exits with code 1 for every new task author, even though the new entry is valid — a false-positive that erodes trust in the validator. Either fix the two offending entries (`code + docs` → `mixed`; the free-form integration-test value → `mixed`), widen the allowed set, or make the helper diff-aware so it only flags newly introduced violations.
  **Files**: TASKS.md (the two offending task entries), src/docs/tasks-md-output-cadence.test.ts (validator), scripts/add-task.sh (helper that runs the validator post-insert)
  **Acceptance**: npx vitest run src/docs/tasks-md-output-cadence.test.ts passes on main without warnings. Either the two offending tasks are fixed to use an allowed Output value, or the allowed set is expanded with rationale documented in the test file, or the post-insert helper script becomes diff-aware (only flags newly-introduced violations).
<!-- P3 is intentionally blocked — see the "Priority semantics" comment at the top of this file
     for the full rule. /next-task MUST NOT claim P3 without explicit user permission. -->

- [ ] Propose managed-section marker convention as an ecosystem-wide spec (upstream contribution).
  **ID**: ecosystem-contrib-managed-section-convention
  **Tags**: ecosystem, contribution, standards
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    Multiple tools now write to the same agent config files (CLAUDE.md, AGENTS.md, `.cursor/rules/`). Without a shared convention, they collide. agentbrew uses `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->`. Caliber uses `<!-- caliber:managed:<name> -->` / `<!-- /caliber:managed:<name> -->`. React Doctor writes directly without markers. No standard exists.
    File a lightweight spec proposal — a gist or small repo — documenting: (a) marker format (`<!-- <tool-name>:managed:<section-name> -->`), (b) ownership semantics (only the owning tool may modify content inside its markers; other tools must preserve the block verbatim), (c) marker placement (top-level sections in markdown, can contain valid markdown), (d) nesting (disallowed — markers must be section-siblings, not nested), (e) test patterns (regex + examples). Link from agentbrew's VISION.md and file a drive-by PR on Caliber / Warden / React Doctor repos linking to the spec with a one-sentence "we'd like to align on this marker convention."
    This is low-priority, low-investment, ecosystem-hygiene work. Skip if Caliber or another tool beats us to it — the goal is alignment, not authorship.
  **Files**: `docs/specs/managed-section-markers.md` (new) or a gist / standalone repo, upstream PRs to Caliber / other tools.
  **Acceptance**: (a) spec document exists with the 5 sections above; (b) VISION.md links to it; (c) at least one upstream PR filed linking to the spec — accept the result whether merged or not (author goodwill + visibility matters more than the merge).
  **Human-approval-required**: external-pr

- [ ] Contribute interactive multi-select UX to skills CLI (not absorb from Bridle).
  **ID**: contribute-interactive-multiselect-to-skills-cli
  **Tags**: contribute-upstream, ux, skills-cli
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    Bridle's whole-harness install UX uses a ratatui TUI multi-select picker for "which of these N discovered skills/agents/commands do I want from this GitHub repo?". Instead of absorbing that logic into agentbrew (which would grow our surface — forbidden by the delegate→contribute→absorb strategy in VISION.md), the right move is to contribute an interactive multi-select picker to skills CLI.
    Scope of the contribution:
    1. `npx skills add <repo>` without `--skill` or `--all` today prints a non-interactive list and requires re-invocation. Propose `-i` / `--interactive` flag that presents a checkbox-select UI.
    2. Use a lightweight dependency (e.g. `@clack/prompts`, already used by parts of skills CLI) — no heavy TUI library.
    3. Must work in non-TTY environments (CI) by refusing `-i` with a helpful error pointing at `--all` or `--skill <name>`.
    Receptivity signal: this matches the kind of UX polish Andrew Qu has merged historically (see PR #558 `--json` flag). Small, focused, doesn't expand scope. Good trust-building PR.
    Explicit non-goal: **do not implement an equivalent in agentbrew.** If this contribution gets rejected / ignored 90 days, close the task — agentbrew users can always pass `--skill <name>` or `--all` to `npx skills add`.
  **Files**: issue + PR at vercel-labs/skills; if accepted, agentbrew docs may reference the flag.
  **Acceptance**: (a) an issue is filed at vercel-labs/skills proposing `-i` / `--interactive` with a concrete UX sketch; (b) if the issue gets maintainer engagement, follow up with the implementation PR; (c) after 90 days with no engagement, close this task with a note in docs/competition/vercel-skills-cli-vs-agentbrew.md that the contribution was attempted and upstream did not accept it within the window.
  **Human-approval-required**: external-issue, external-pr

- [ ] Engage on vercel-labs/skills [PR #630](https://github.com/vercel-labs/skills/pull/630) — add `--fix` to `skills status` per Elliot Liu's review.
  **ID**: contribute-engage-pr-630-skills-status
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Research (2026-04-19) found skills CLI PR #630 adds `skills status` (drift detection between installed and lockfile). Elliot Liu (collaborator) approved it and commented specifically: *"lockfile drift is a real pain point... `--fix` would make CI smoother."* This is a concrete, maintainer-invited contribution window — lands drift detection upstream AND positions us to contribute `--fix` in a follow-up PR, reducing what agentbrew eventually needs to keep.
    Outcome when unblocked: (a) follow PR #630 to merge; (b) once merged, open a follow-up PR adding `--fix` to the `skills status` command that auto-repairs lockfile drift; (c) if `--fix` lands upstream, agentbrew's equivalent auto-repair for skills moves into the delegated path and the native implementation shrinks further (feeds `delegate-skill-install-to-skills-cli` P0 residue-reduction).
    Why P3 not P0: the 90-day engagement window from VISION.md is already running for PR #630 (approved, not merged — we wait). Queuing this as work would duplicate that passive wait. When user says "pick up the skills CLI contribution opportunity," this is the one.
  **Files**: upstream PR at vercel-labs/skills (no agentbrew files).
  **Acceptance**: (a) a follow-up PR is filed at vercel-labs/skills proposing `--fix` for `skills status` with a concrete design note citing Elliot Liu's comment; (b) the PR builds on top of #630 once it merges; (c) if rejected / ignored 90 days, close this task with a note in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" — counts as absorbed residue.
  **Human-approval-required**: external-pr

- [ ] Engage on vercel-labs/skills [PR #509](https://github.com/vercel-labs/skills/pull/509) — skill validator stalled 47+ days.
  **ID**: contribute-review-pr-509-validator
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Research (2026-04-19) found PR #509 (skill validator) has been open with no review for 47+ days. The functionality overlaps agentbrew's `src/skills/validate.ts` — a reviewed, merged validator upstream would absorb the equivalent surface here. Zero maintainer activity for 47 days is a signal for us to help, not a signal to replicate.
    Outcome when unblocked: (a) review the PR ourselves, leave a thoughtful comment on the design, ask concrete questions Andrew Qu / Elliot Liu can answer quickly, and offer to split the PR into smaller reviewable slices if that's the blocker; (b) if author is responsive, pair on trimming the PR to a mergeable core; (c) if PR moves, agentbrew's `validate.ts` becomes a candidate for deletion in a subsequent delegation task.
  **Files**: upstream PR at vercel-labs/skills (no agentbrew files).
  **Acceptance**: (a) a substantive review comment is posted on #509; (b) author engagement is recorded in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity"; (c) if the PR merges, a follow-up task is filed to delete agentbrew's native validator.
  **Human-approval-required**: external-pr

- [ ] Support vercel-labs/skills [issue #283](https://github.com/vercel-labs/skills/issues/283) + [issue #729](https://github.com/vercel-labs/skills/issues/729) — declarative manifest (Andrew Qu said "great idea! WIP").
  **ID**: contribute-support-issue-283-declarative-manifest
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Research (2026-04-19) found two upstream threads on this capability: [issue #283](https://github.com/vercel-labs/skills/issues/283) (install-from-lockfile) where Andrew Qu (primary maintainer) commented *"great idea! WIP"* on 2026-02-18, and [issue #729](https://github.com/vercel-labs/skills/issues/729) (Skillfile declarative manifest) which is the community's explicit manifest request. This is the single largest strategic opportunity in the skills CLI: if either ships, agentbrew's per-project Agentfile `skills:` block becomes a direct delegation target (parse Agentfile → translate to manifest → hand to `npx skills install`). It collapses a meaningful chunk of `src/agentfile.ts`.
    Outcome when unblocked: (a) comment on both issues with a concrete proposal referencing agentbrew's Agentfile `skills:` block as a prior-art example (not as "please copy this" — as "here's one shape that already works"); (b) ask Andrew Qu whether the Feb 2026 WIP on #283 is still active — non-racing, non-duplicative posture; (c) if Andrew engages with a specific shape, offer to prototype the RFC shape in a draft PR; (d) watch [Anthony Fu's PR #937](https://github.com/vercel-labs/skills/pull/937) ("config system for the CLI as a whole") — if it generalizes to multi-surface state, the manifest story lands through it; (e) if the manifest ships, delete agentbrew's per-project skills resolution code in the same quarter.
  **Files**: upstream issue at vercel-labs/skills (no agentbrew files).
  **Acceptance**: (a) a substantive comment is posted on BOTH #283 and #729 referencing Agentfile's `skills:` shape as prior art, with the explicit "is Feb WIP still progressing?" question on #283; (b) if Andrew Qu engages with a specific shape, a draft PR is filed; (c) if the manifest lands upstream (via #283 WIP, #729 community proposal, or Anthony Fu's #937), agentbrew's per-project skills resolution is queued for deletion in the following delegation task.
  **Human-approval-required**: external-issue, external-pr

- [ ] Trust-building PRs on vercel-labs/skills — 15 drafts staged in `fyodoriv/skills` + next-batch candidates.
  **ID**: contribute-trust-building-pr-skills-cli
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, bug-fix
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).

    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Contribution roadmap"](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered) + [§ Fork draft inventory (2026-04-24)](../docs/competition/vercel-skills-cli-vs-agentbrew.md#fork-draft-inventory-2026-04-24).

    **Current state (2026-04-24 night #6)**: 22 draft PRs staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls), targeting 19 distinct open upstream bugs. Combined: +3,463 / −194 LOC. All draft, all OPEN, all awaiting user review before upstream submission:

    - fork#1 + fork#4 — two alternative approaches to [#806](https://github.com/vercel-labs/skills/issues/806) (hash verification mismatch). Pick one for upstream.
    - fork#2 — [#781](https://github.com/vercel-labs/skills/issues/781) (Windows line endings in hash)
    - fork#3 — [#808](https://github.com/vercel-labs/skills/issues/808) (remove-doesn't-clean-lock for project scope; supersedes the later duplicate #977)
    - fork#5 — [#1005](https://github.com/vercel-labs/skills/issues/1005) (subpath stripped from lock write-back)
    - fork#6 — [#1001](https://github.com/vercel-labs/skills/issues/1001) (suppress ASCII banner in `find`)
    - fork#7 — [#999](https://github.com/vercel-labs/skills/issues/999) (well-known URL truncated in lock)
    - fork#8 — [#954](https://github.com/vercel-labs/skills/issues/954) (`skills check` should be read-only)
    - fork#9 — [#960](https://github.com/vercel-labs/skills/issues/960) (subcommand `--help` executes the subcommand)
    - fork#10 — [#982](https://github.com/vercel-labs/skills/issues/982) (project-scope `update -p <name>` installs all skills)
    - fork#11 — [#1010](https://github.com/vercel-labs/skills/issues/1010) error-UX half (`spawn git ENOENT` → actionable install hint)
    - fork#12 — [#941](https://github.com/vercel-labs/skills/issues/941) (Windows execPath with spaces — silent update failure)
    - fork#13 — [#916](https://github.com/vercel-labs/skills/issues/916) (`update -p -y` creates `skills/` at project root)
    - fork#14 — [#953](https://github.com/vercel-labs/skills/issues/953) (binary file corruption from well-known endpoints)
    - fork#15 — [#886](https://github.com/vercel-labs/skills/issues/886) (data-loss: `add ./.agents/skills` deletes source SKILL.md when source overlaps canonical)
    - fork#16 — [#793](https://github.com/vercel-labs/skills/issues/793) (`-yg` combined short flags silently dropped — same class as closed #195)
    - fork#17 — [#666](https://github.com/vercel-labs/skills/issues/666) (`experimental_install` fails for well-known sources — local lock loses URL scheme)
    - fork#18 — [#745](https://github.com/vercel-labs/skills/issues/745) (`-g -y -a <agent>` silently flips to copy mode, skips canonical `~/.agents/skills/`)
    - fork#19 — [#561](https://github.com/vercel-labs/skills/issues/561) (local-source absolute paths leak into checked-in `skills-lock.json`, breaking teammates' `experimental_install`)
    - fork#20 — [#840](https://github.com/vercel-labs/skills/issues/840) (`skills update` swallows subprocess stderr — every Windows failure shows just `✗ Failed to update <skill>` with no diagnostic info, even at `--verbose`/`DEBUG=1`) — NEW 2026-04-24 night #5
    - fork#21 — [#523](https://github.com/vercel-labs/skills/issues/523) + [#328](https://github.com/vercel-labs/skills/issues/328) (skips `gh auth token` invocation via a `SKILLS_NO_GH_AUTH=1` opt-out)
    - fork#22 — [#985](https://github.com/vercel-labs/skills/issues/985) + [#949](https://github.com/vercel-labs/skills/issues/949) (well-known v0.2.0 discovery schema rejected by `WellKnownProvider.isValidSkillEntry`; `mockaton.com` and `createos.nodeops.network` both publish valid v0.2.0 indexes per Cloudflare RFC 0.2 spec and existing users see "No skills found at this URL" — adds schema-aware dispatch with SHA-256 digest verification per spec §Integrity and Verification, lands `type: "skill-md"` half, skips `type: "archive"` half with a console warning naming the skill; archive half tracked as follow-up requiring tar/zip extraction with §Archive Safety defenses) — NEW 2026-04-24 night #6

    All prior fork-draft targets issues confirmed still OPEN on vercel-labs/skills as of 2026-04-24 night #6 refresh. Zero auto-closures across all 6 night refreshes; zero maintainer activity on PR #630 / #509 / issue #283.

    When upstream submission is approved: promote in priority order — fork#15 first (data-loss bug, highest user impact), fork#21 (corporate-blocker; users literally cannot use the CLI without disabling it; backward-compat opt-out), fork#22 (every v0.2.0 well-known endpoint blocked, real users hitting #985 + #949 today, new upstream tests, no breaking change for v0.1.0 consumers — workaround does not exist for v0.2.0-only servers), fork#20 (diagnostic enabler; unblocks self-diagnosis for #840 reporters and any future silent-failure thread), fork#17 (data-recovery bug, breaks `experimental_install` end-to-end for well-known sources, fully backward-compat), fork#18 (data-correctness: silent copy mode skips canonical dir; pure-helper test coverage), fork#19 (collaboration-correctness: local-source paths leak into checked-in lock; backward-compat), fork#6 (smallest, zero controversy), fork#16 (POSIX-standard parser fix, upstream tests, zero behavior change for non-combined invocations), then fork#12 + fork#13 (mechanical fixes with strong tests), then fork#9 + fork#10 + fork#11 (small, user-reported, mechanical fixes), then fork#14 (binary-files; high impact, well-tested), then fork#7 + fork#17 + fork#19 (lock-file source-shape preservation bundle, plausibly one upstream PR), fork#5 (lock-file subpath, similar territory), then fork#2 (Windows compat), then fork#3, then fork#8, then fork#4 (or fork#1, whichever the user picks for #806). Every upstream PR description cites agentbrew's contribution roadmap so reviewers see the pattern. Bug #806 is a hash verification mismatch that blocks PR #630's lockfile-vs-disk check — landing it accelerates the drift-detection landing we care about most.

    **Future-batch draft candidates** (reviewed 2026-04-24 night but not pursued; stage in fork only after user review of the current 22):

    | Upstream issue | Shape | Why deferred |
    |---|---|---|
    | [#974](https://github.com/vercel-labs/skills/issues/974) | `-g` combined with `-a` overrides symlinking | Spans 20+ `installGlobally` call sites in `src/add.ts`; not a drive-by. |
    | [#1010](https://github.com/vercel-labs/skills/issues/1010) (allowlist half) | Blob fast path is org-allowlisted | Policy change, not mechanical. Ask upstream in the issue which they'd accept. Error-UX half already covered by fork#11. |
    | [#969](https://github.com/vercel-labs/skills/issues/969) | Multiselect prompt shows duplicate options | Fix is `@clack/prompts` 0.11 → 1.2 upgrade; major version bump with breaking-changes surface. PR #971 attempts the upgrade — watch for landing. |
    | [#997](https://github.com/vercel-labs/skills/issues/997) | `npx skills update` fails for self-hosted GitLab | Needs a real self-hosted GitLab instance to reproduce. |
    | [#923](https://github.com/vercel-labs/skills/issues/923) | `skills update` reports success without updating contents | Triage-needed: bug shape unclear; need a reliable repro before drafting. |
    | [#915](https://github.com/vercel-labs/skills/issues/915) | `skills update <skill-name>` adds all other skills | Likely same root cause as fork#10. If fork#10 lands and #915 doesn't auto-close, revisit. |
    | [#537](https://github.com/vercel-labs/skills/issues/537) | Global install leaves agent skill dir missing for non-universal agents (`~/.cursor/skills/`) | `isUniversalAgent` is decided by project skillsDir but applied to global installs; needs a `isGlobalUniversal` distinction with broader testing. Not drive-by. |
    | [#225](https://github.com/vercel-labs/skills/issues/225) | Incorrect agents detected during `list`/`remove` (OpenClaw attributed to skills in `.agents/skills/`) | Detection logic conflates project and global skillsDirs. PR #965 partially addresses one symlink subcase. Whole class needs deeper refactor. |
    | [#870](https://github.com/vercel-labs/skills/issues/870) | Can't Interrupt Git Clone (Ctrl+C ignored) | SIGINT handling through @clack/prompts and simple-git is non-trivial; not a drive-by. |

    Items no longer candidates: #983 (npx-side bug, not skills-CLI); #977 (duplicate of #808 / fork#3); #960 (now fork#9); #982 (now fork#10); #1010 error-UX half (now fork#11); #941 (now fork#12); #916 (now fork#13); #953 (now fork#14); #886 (now fork#15); #793 (now fork#16); #666 (now fork#17); #745 (now fork#18); #561 (now fork#19); #840 (now fork#20); #523 + #328 (now fork#21); #985 + #949 (now fork#22).

    If any target issue is already fixed by the time the task is picked up: skip it and pick another bug from the open-issues list, preferring any that unblock PR #630 or appear in agentbrew user reports. Use the pattern already established in fork#1–#22 — failing test then minimal fix, ≤250 LOC where possible (helper-extracted with bounded behavior, like fork#20's 20-line/240-char output cap, often warrants a slightly larger LOC budget). For larger surface like fork#22 (v0.2.0 schema; 1,033 LOC including new upstream tests across multiple upstream files), the budget is justified when the fix unblocks an entire class of broken endpoints AND ships with a pure-helper module that lets a follow-up PR (e.g. archive support) reuse the validation/digest logic without re-litigating it.
  **Files**: upstream PR at vercel-labs/skills (no agentbrew files); document the outcome in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" once filed.
  **Acceptance**: (a) one or more PRs promoted from `fyodoriv/skills` to `vercel-labs/skills:main` with a failing regression test and the minimal fix, scope ≤100 LOC each (or ≤250 LOC for the binary-files / data-loss classes with full test coverage); (b) the PR description cites agentbrew's contribution roadmap and the drift-detection dependency where applicable; (c) outcome (merged / stuck / rejected) is documented in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity"; (d) subsequent contribution tasks reference the merged PRs as trust-established context.
  **Human-approval-required**: external-pr

- [ ] RFC comment on vercel-labs/skills [issue #268](https://github.com/vercel-labs/skills/issues/268) + [issue #455](https://github.com/vercel-labs/skills/issues/455) — user-created skill preservation classifier.
  **ID**: contribute-rfc-comment-issues-268-455-user-safety-classifier
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, data-safety
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Feature 7: User-created skill preservation"](../docs/competition/vercel-skills-cli-vs-agentbrew.md#7-user-created-skill-preservation--4-competing-bug-fix-prs-in-flight) and [Contribution roadmap row 3](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered). Research (2026-04-19) found the user-safety direction has **4 competing bug-fix PRs already open** ([#609](https://github.com/vercel-labs/skills/pull/609), [#611](https://github.com/vercel-labs/skills/pull/611), [#869](https://github.com/vercel-labs/skills/pull/869), [#944](https://github.com/vercel-labs/skills/pull/944)) plus related bug reports ([#268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455), [#606](https://github.com/vercel-labs/skills/issues/606)). Filing a 5th implementation hurts: the queue is saturated and maintainers haven't merged any of them yet. The right move is RFC input on the design, not another competing PR.
    Outcome when unblocked: (a) post agentbrew's 5-case `cleanEntry()` classifier taxonomy as a comment on [issue #268](https://github.com/vercel-labs/skills/issues/268) (the foundational issue) to inform how maintainers architect the eventual fix — managed symlink / broken symlink / user symlink to valid non-managed path / user directory without `.agentbrew-managed` sentinel / user directory with sentinel; (b) cross-post a short summary on [issue #455](https://github.com/vercel-labs/skills/issues/455) tying the agentbrew taxonomy to skills CLI's `preserve-local` mode request; (c) include the specific invariant: *"The user's own files are preserved forever; `--prune`, auto-repair, and sync all treat user-created directories as sacrosanct"*; (d) link to [`src/sync/skills-sync.ts:122-148`](../src/sync/skills-sync.ts#L122) for the implementation reference; (e) explicitly say agentbrew is NOT filing a PR, so maintainers know this is design input not queue-noise.
    If any of the 4 open PRs merges with the classifier design, close this task — the contribution has landed. If none merge and the queue grows further (a 5th community PR appears), escalate by commenting on issue #268 asking Andrew Qu / Elliot Liu for architectural direction on which PR they'd be willing to review.
  **Files**: upstream issues at vercel-labs/skills (no agentbrew files).
  **Acceptance**: (a) a substantive RFC-style comment is posted on BOTH #268 and #455 with the 5-case taxonomy and the invariant statement; (b) the comment links to the exact `src/sync/skills-sync.ts:122-148` agentbrew reference and explicitly states "not filing a PR"; (c) if any of the 4 open PRs (#609, #611, #869, #944) subsequently merges with a classifier design, close this task with a link to the merge in the commit message; (d) if the queue stays stuck for another 4 weeks post-comment, the escalation comment on #268 asking for architectural direction is posted.
  **Human-approval-required**: external-issue

- [ ] Watch vercel-labs/skills [PR #937](https://github.com/vercel-labs/skills/pull/937) — Anthony Fu's "config system for the CLI as a whole".
  **ID**: contribute-watch-pr-937-anthony-fu-config-system
  **Tags**: upstream-contribution, skills-cli, blocked-explicit-permission, monitoring
  **Details**: **Publishing hold**: the final publish step (filing the PR, posting the comment, sending any external message) is a SEPARATE approval from approval to claim or research — it requires explicit per-action user approval in the session that performs it, per the file-level publishing policy. Drafting PR text and comment bodies locally is fine; the `gh pr create` / `gh issue comment` / `gh pr review` action itself is blocked until approved.
    **DO NOT claim this task without explicit user approval** (P3 policy).
    Source: [docs/competition/vercel-skills-cli-vs-agentbrew.md § "Contribution roadmap" row 6](../docs/competition/vercel-skills-cli-vs-agentbrew.md#contribution-roadmap--priority-ordered) + [Upstream receptivity research](../docs/competition/vercel-skills-cli-vs-agentbrew.md#upstream-receptivity--what-skills-cli-maintainers-have-said). Anthony Fu (antfu — Vite, Vitest, UnoCSS) filed [PR #937](https://github.com/vercel-labs/skills/pull/937) merging `skills-npm` into `experimental_sync` and mentioned "config system for the CLI as a whole." Two strategic signals depend on this PR: (1) does high-profile OSS contributor status translate to faster skills-CLI review (informs agentbrew's future contribution posture)? (2) if the "config system" generalizes to multi-surface state, it covers the fatal-gap #4 from the dissolution analysis ("multi-surface declarative state") and accelerates agentbrew's dissolution trajectory.
    This task is a **monitoring task**, not an implementation — actively watch PR #937 monthly and record what happens.
    Monthly checklist when picked up with user approval:
    1. Fetch current state of PR #937: merged / closed / approved / pending-review / stalled (weeks since last maintainer comment).
    2. Check the PR description for "config system for the CLI as a whole" evolution — has it grown to cover multi-surface (rules, commands, MCP)? Stayed skills-only?
    3. Check Anthony Fu's merge velocity on other skills-CLI PRs since last check — any trust signal?
    4. If PR #937 merges and the config system is multi-surface: open a new P0 task `evaluate-delegate-multi-surface-state-to-skills-cli` — this would unblock deleting agentbrew's `agentfile.ts` + `state.ts` surface-specific logic.
    5. If PR #937 merges and the config system is skills-only: update `contribute-support-issue-283-declarative-manifest` with the landed shape; delegation happens through that task.
    6. If PR #937 stalls 90+ days: note the signal in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" — maintainer queue neglect is systemic, not about contributor identity.
    Recurring cadence: tied to the P2 `quarterly-dissolution-reeval` task. This monitoring doesn't need its own schedule — the quarterly review includes "check PR #937 status" in its acceptance criteria.
  **Files**: observation notes in `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" per quarter; new P0 task opened only if PR #937 merges with multi-surface scope.
  **Acceptance**: (a) at each quarterly dissolution review, the PR #937 status is recorded under `docs/competition/vercel-skills-cli-vs-agentbrew.md` § "Upstream receptivity" with the 6 checklist items; (b) if PR #937 merges with multi-surface scope, a new P0 evaluation task is opened in the same commit; (c) if PR #937 closes / stalls 90+ days, the receptivity section is updated with the systemic-neglect note; (d) this task never closes — it's a recurring monitor feeding the quarterly reeval.
  **Human-approval-required**: monitoring-only

- [ ] Fix `--no-prune` to actually disable authoritative state replacement on overlay Agentfile syncs

  - **ID**: no-prune-does-not-prevent-authoritative-state-replacement
  - **Tags**: bug, agentfile, p2, mcp-sync
  - **Why**: The chezmoi lifecycle script `run_after_agentbrew-sync.sh` in
    dotfiles applies the base Agentfile first, then the overlay Agentfile
    with `--no-prune` (e.g. `~/apps/dotfiles-<org>/Agentfile.yaml`). The
    intent — documented in the overlay's header comment — is "additive on
    top of the canonical dotfiles Agentfile state". But `--no-prune`
    currently only affects the per-agent-config prune step (deleting from
    `~/.cursor/mcp.json` etc. when state drops a server). Inside
    `sync-runner.ts` the `applyAgentfile()` call passes
    `authoritative: true` unconditionally, which makes the overlay
    Agentfile replace the state's mcpServers list instead of adding to
    it. Result: base Agentfile servers (context7, playwright, tasks-mcp,
    atlassian, jenkins) get removed when the overlay applies.
  - **Repro**:
    ```
    cd /tmp
    agentbrew sync --agentfile ~/apps/dotfiles/Agentfile.yaml
    # State has multiple servers from dotfiles base
    agentbrew sync --agentfile ~/apps/dotfiles-<org>/Agentfile.yaml --no-prune
    # State now has ONLY the overlay servers — base servers stripped
    ```
  - **Files**: `src/sync-runner.ts` (lines around `authoritative: true`),
    `src/agentfile-apply.ts` (the `authoritative` parameter), plus
    tests under `src/agentfile-apply.test.ts` (add a test that
    `prune=false` keeps the existing state)
  - **Acceptance**: `agentbrew sync --agentfile <overlay> --no-prune`
    preserves servers in state that were added by previous Agentfile
    applies; the dotfiles lifecycle script `--no-prune` overlay sync
    leaves the base Agentfile's servers intact.
  - **Details-cont**: Design decision: either `--no-prune` should also flip `authoritative: false` for the merge, OR introduce a separate `--additive` / `--overlay` mode that signals "merge, don't replace". The latter is clearer; the former is back-compat-preserving.

- [ ] Dedupe `Always scout and record` between local `AGENTS.md` rule #11 and the new global template subsection

  - **ID**: dedupe-scout-and-record-agentbrew-local-vs-global
  - **Tags**: docs, agents-rules, agentbrew-template, dedupe
  - **Details**: After hoisting "Always scout and record" into
    `templates/AGENTS.md` (the file that propagates to every agent's
    global rules via `instructions-sync.ts`), the local agentbrew
    `AGENTS.md` rule #11 ("Always scout and record — every PR must
    include scouted tasks…") restates the same rule with slightly
    different wording. Two near-identical rules drift over time and
    confuse contributors about which one is canonical. Replace the
    local rule #11 with a one-line pointer: `Always scout and record
    — see the global Always scout and record rule in
    templates/AGENTS.md / your agent's global rules.` Keep
    agentbrew-specific addenda (if any) but cut the redundant
    body. Same treatment for any other agentbrew-local rule that's
    now a verbatim subset of the global template — sweep them in the
    same PR so the dedupe is atomic.
  - **Files**: `AGENTS.md` (root of agentbrew repo) — rule #11 area;
    audit any other rules that overlap the new global subsections
    (`Local Project Autonomy`, `Always scout and record`).
  - **Acceptance**:
    - `AGENTS.md` rule #11 is replaced with a one-line pointer to the
      global rule, no functional drift.
    - `grep -n "Always scout and record" AGENTS.md` returns one line
      (the pointer), not the full restated rule body.
    - `npm run verify` still passes.
    - Commit message references the PR that introduced the global
      rule to make the dedupe traceable.
  - **Found via**: 2026-05-15 sweep while updating
    `templates/AGENTS.md` to hoist "Always scout and record" to the
    global template (this PR).

- [ ] Fix malformed `**Blocked by**:` value on `--no-prune` task causing `@tasks-md/lint` failure on master

  - **ID**: fix-tasks-md-lint-blocked-by-no-prune-task
  - **Tags**: docs, tasks-md, lint, master-failing
  - **Details**: `TASKS.md:498` currently reads
    `**Blocked by**: nothing — autonomous-doable. Decide what the right
    semantic is: …`. Per the
    [tasks.md spec](https://github.com/tasksmd/tasks.md/blob/main/spec.md),
    `**Blocked by**:` expects a comma-separated list of task **IDs** of
    blockers, not free-form English. The current value makes
    `npx @tasks-md/lint TASKS.md` fail on master with
    `ERROR: TASKS.md:498: blocked-by references unknown ID 'nothing — autonomous-doable. Decide what the right'`,
    which means **every PR currently fails the `tasks-md` lint
    invariant on master**, and the failure mode is invisible because
    nothing runs it in the verify gate. Fix: replace the malformed
    value with either `**Blocked by**:` (empty value) or drop the
    field entirely — the prose belongs in the task body or a
    `**Decision**:` field, not in `**Blocked by**:`. Also consider
    wiring `npx @tasks-md/lint TASKS.md` into `npm run verify` so this
    class of error can't reach master again
    (`feedback-loop-guardrails`: linters enforce, instructions
    suggest).
  - **Files**: `TASKS.md` (line ~498, the `--no-prune` task block),
    `package.json` (add `tasks-md:lint` script + chain into `verify`).
  - **Acceptance**:
    - `npx @tasks-md/lint TASKS.md` exits 0 on master.
    - `npm run verify` runs `@tasks-md/lint` as part of the gate and
      fails if any task is malformed.
    - The `--no-prune` task's prose context is preserved either in
      `**Details**` or a new `**Decision**` field so no information is
      lost.
  - **Found via**: 2026-05-15 sweep — `@tasks-md/lint TASKS.md`
    invoked before committing the global "Always scout and record"
    template update; the failure was already present on master.
- [ ] Curate skill catalog (companion 2026-05-21 sweep)
  - **ID**: skill-curate-2026-05-21-companion
  - **Tags**: skills, agentbrew, curation, companion
  - **Details**: Generated by `companion-skill-curate` on 2026-05-21.
    Full report: [`docs/skill-curation/2026-05-21.md`](docs/skill-curation/2026-05-21.md).
    Inventory: SKILL.md inventory from agentbrew status (unique names and detected agents).
    Findings:
    1 exact-name duplicate (`page-zero-errors` in both `builtin-dev` and `fyodoriv_page-zero-errors` cache — byte-identical, but the cache copy has 2 unstaged edits that desync risk losing).
    0 outdated sources (all 5 cached repos are at upstream HEAD; `fyodoriv/page-zero-errors` returns HTTP 404 from `gh api`, may be private/deleted).
    3 orphan stub dirs in `~/.config/agentbrew/installed-skills/` (`debug`, `my-custom-skill`, `test-driven-development` have no SKILL.md — leftover from aborted installs).
    5 high-confidence new candidate sources, all already cached locally so zero-fetch to activate: `anthropics/skills` (fills pdf/xlsx gap), `obra/superpowers` (TDD/debugging/git-worktrees), `openai/skills` (security-threat-model + screenshot + Codex tooling), `supabase/agent-skills` (niche Supabase skills), `huggingface/skills` (ML/AI niche).
    1 near-duplicate cluster worth defer notes: skill-authoring (`skill-creator`/`skill-rewriter`/`skill-eval-loop` builtin + `skill-improver`/`designing-workflow-skills` from trailofbits). Adding `anthropic` and `openai` skill-creators will compound this.
    Highest-priority action: resolve the `page-zero-errors` dupe by picking one canonical source and capturing the 2 cache-side edits before they're lost.
  - **Files**: docs/skill-curation/2026-05-21.md
  - **Acceptance**: Each recommended action in the report is either executed (and a follow-up commit removes this task) or explicitly deferred with a one-line reason appended here. At minimum, the `page-zero-errors` exact-name duplicate is resolved and the 3 empty `installed-skills` stub directories are either filled or removed.

- [ ] Audit remaining custom skills in skillSourceDirs for boundary clarity + 3rd-party overlap
  - **ID**: skill-boundary-audit-2026-05-21
  - **Tags**: skills, audit, boundaries, 3rd-party, companion
  - **Details**: Followup to 2026-05-21 companion-researcher session that
    sharpened 7 muddy descriptions (plan, spec, clarify, analyze, tdd,
    skill-creator, skill-rewriter) and added activation pointers for
    `anthropics/skills` (canonical skill-creator) and
    `obra/superpowers/writing-skills` (TDD-driven authoring). Real
    remaining work, batched here so a future session can pick it up:

    A. **Verified 3rd-party overlaps we have NOT yet activated** (skills
       are already cached at `~/.cache/agentbrew/sources/` for some, or
       fetchable via `gh repo clone`; activation = adding to
       `~/.config/agentbrew/state.yaml::skillSourceDirs` then
       `agentbrew sync`):
       - `obra/superpowers/systematic-debugging` shares the Iron Law
         philosophy with our `debug`. Consider activating obra and
         narrowing our `debug` to repo-specific conventions, or keep
         both as peers and just cross-reference.
       - `obra/superpowers/test-driven-development` overlaps with our
         `tdd`. Same call: keep, cross-ref, or narrow.
       - `obra/superpowers/dispatching-parallel-agents` may overlap with
         `companion-researcher` and `minsky` — needs comparison.
       - `obra/superpowers/receiving-code-review` and
         `requesting-code-review` overlap with `pr-comments` and `review`.
       - `anthropics/skills/mcp-builder` overlaps with `agentbrew-add-mcp`
         (different scope — anthropic builds MCP servers, agentbrew adds
         them to the catalog — but a cross-ref note in our description
         would help).

    B. **Internal pairs that still need a Don't-use clause sharpened**
       (skipped this round because the boundary is already roughly
       sharp; revisit if user reports confusion):
       - `debug` / `diagnose` — already cross-references each other.
       - `commit` / `pr` / `jira-task` — three git skills with partial
         overlap. jira-task is end-to-end, pr is push+PR, commit is
         conventional-commit + pre-commit checks. Document the
         hierarchy explicitly.
       - `review` / `doubt` — review evaluates artifacts, doubt
         pre-empts decisions. Already noted in `doubt`'s "NOT for
         renames, formatting" clause; could be sharper.
       - `arch` / `refactor` / `composition-patterns` — arch surfaces
         friction, refactor restructures, composition-patterns is
         React-specific reference. Cross-ref each.
       - `sweep` / `project-audit` / `strategic-review` — sweep is
         parallel-safe, project-audit is deep on one repo,
         strategic-review evaluates direction. Already cross-refed in
         project-audit; could be sharper.

    C. **Voice / spec compliance scan**: per Anthropic's spec
       (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices),
       descriptions MUST be third person. Run a grep for `\\byou\\b` and
       `\\bI\\b` across all 62 custom descriptions and rewrite any
       offenders to third person. Initial spot-check showed most are
       already compliant; this is a low-priority sweep.

    D. **Naming gerund-form sweep**: Anthropic recommends gerund form
       (`processing-pdfs`) or noun phrases (`pdf-processing`) over
       single-word verbs. Our short names (`debug`, `plan`, `commit`,
       `pr`, `review`, `arch`, `taste`, `grind`, `clarify`, `iterate`,
       `analyze`, `refactor`, `sweep`, `tdd`, `spec`, `grill`, `doubt`,
       `prototype`, `handoff`, `caveman`) are spec-compliant but
       flagged as "vague" by the spec. DO NOT rename without explicit
       user approval — these names are deeply embedded in muscle memory
       and chat history. The right move is to add an `aliases:` field
       to frontmatter if/when agentbrew supports it (it doesn't yet).

    E. **Source repo migration**: per `agentbrew/AGENTS.md` rule 8a,
       skills in `skill-plugins/dev/` should be Bucket 1 (agentbrew-
       specific) only. Bucket 2 migration candidates need to move to
       source repos. Top candidates that are clean enough to migrate
       today: the 6 companion-* skills, the 4 grind-* skills, the
       skill-* family (creator/rewriter/eval-loop). Each migration is
       its own task.

  - **Files**: skill-plugins/dev/* (entire directory), README.md,
    docs/skill-curation/2026-05-21.md (the curate-round report from
    the same companion session)
  - **Acceptance**: This task gets decomposed into 5 sub-tasks (one
    per section A-E above), each of which produces concrete edits or
    a documented "keep as is with rationale". The decomposition
    happens when a future companion session or skill-rewriter session
    picks this up.

- [ ] Companion-researcher needs working-tree branch-stomp protection
  - **ID**: companion-branch-stomp-protection
  - **Tags**: skills, companion, git-safety, multi-agent
  - **Details**: In the 2026-05-21 companion-researcher session, the
    worker's session called `git checkout <their-branch>` in the
    shared agentbrew working tree TWICE while the companion agent
    was mid-edit. Each time, the companion's next `git commit`
    landed on the worker's branch instead of the intended companion
    branch (and once even pushed to the worker's PR before being
    caught).

    Recovery steps that worked (cherry-pick + revert):
    1. `git checkout <my-companion-branch>`
    2. `git cherry-pick <bad-commit-on-worker-branch>` → lands on
       my branch.
    3. `git checkout <worker-branch>`
    4. `git revert --no-edit <bad-commit>` → adds a revert commit
       on the worker's branch so net diff is zero.
    5. `git push` both branches.
    6. `git checkout <my-companion-branch>` to resume work.

    This works but: (a) requires the companion to NOTICE the wrong
    branch before pushing, (b) leaves two unexplained commits on the
    worker's PR, (c) the worker may force-push and lose the revert.

    Real fix: companion-researcher SKILL.md should require
    re-verifying `git branch --show-current` BEFORE every `git
    commit` and `git push`, not just at session start. Add this as
    a hard rule in the umbrella's Safety Rules section ("Verify
    branch before every commit and push — `git branch --show-current`
    is cheap and catches branch-stomps").

    Better fix (longer-term): the companion should operate in a
    git worktree (separate filesystem location) rather than the
    shared working tree. The `obra/superpowers/using-git-worktrees`
    skill describes the pattern. Worktrees give each agent its own
    HEAD pointer, eliminating the branch-stomp class of bug
    entirely. Tradeoff: extra disk space (~one full checkout per
    companion session) and slightly more setup. For active
    multi-agent workflows the disk cost is worth it.

  - **Files**:
    skill-plugins/dev/companion-researcher/SKILL.md (add the branch-
    verification rule); optionally skill-plugins/dev/companion-*/
    SKILL.md (each sub-skill could also assert the branch before
    write operations).
  - **Acceptance**:
    Either (a) every companion-* SKILL.md has an explicit "verify
    branch before commit + push" step in its Safety Rules section,
    AND a pressure-test subagent can be shown the trap (worker
    switches branch mid-edit) and recover correctly. Or (b) the
    companion-researcher umbrella migrates to using `git worktree
    add` for its session checkout, isolating it from the worker
    entirely.

- [ ] Enforce the tag-free Jira title convention with a check, not just prose

  - **ID**: jira-title-convention-enforcement-2026-05-29
  - **Tags**: jira-skill, feedback-loop, scout, p3
  - **Details**: The `jira` skill now documents a tag-free title convention (no leading `[X.Y]` / `[skill]` bracket tags, no `R#X.Y -` requirement-ID prefix, no `Deliver:` / `Short-term:` / `Long-term:` filler prefix; the requirement mapping belongs in a `req-X-Y` label) in `skill-plugins/dev/jira/SKILL.md` under "Title Format". That rule lives only in prose, so violations still slip through when an agent creates a ticket. Per the feedback-loop principle (linters enforce, instructions suggest — zernie.com/blog/feedback-loop-is-all-you-need), add a lightweight check that flags a proposed Jira title containing a leading bracket tag, an `R#X.Y -` prefix, or a filler prefix, and surface it from the jira skill's pre-create step (or a small standalone validator). Scouted while rewriting 53 ticket titles to this convention.
  - **Files**: `skill-plugins/dev/jira/SKILL.md` (the "Title Format" section is the spec); plus wherever the check would live (a new `src/skills/*` validator or a jira-skill self-check step).
  - **Acceptance**: A clean descriptive title passes; a title with a leading bracket tag, `R#X.Y -` prefix, or `Deliver:` prefix is flagged with the reason before the ticket is created.

- [ ] Fix 9 biome complexity warnings and non-hermetic integration tests

  - **ID**: biome-complexity-and-hermetic-integration-tests-2026-05-31
  - **Tags**: biome, complexity, integration-test, hermetic, scout, p3
  - **Details**: Pre-existing technical debt unrelated to overlay work. Biome reports 9 complexity warnings (max allowed is 15): page-zero-errors cdp-capture.mjs:152 (18), cli.ts:192 (17), hooks/deploy.ts:72 (26), hooks/manifest.ts:131 (16), mcp/opencode-bootstrap.ts:42 (17) and :437 (23), mcp/playwright-isolated-sweep.ts:90 (16), sync/hooks-sync.ts:337 (16) and :378 (23). Two integration tests may read real machine state: clean.test.ts mocks expandHome but uses `process.env.HOME` which could read the real homedir, and integration.test.ts is a large integration test with complex mocks that may have gaps. Scouted during Phase 3 overlay extraction verification.
  - **Files**: files with complexity warnings (see details above), src/clean.test.ts (verify expandHome mocking), src/integration.test.ts (review mock coverage for process.env.HOME reads)
  - **Acceptance**: All biome complexity warnings resolved (refactor functions to stay under 15 complexity), all integration tests verified as hermetic (no real machine state reads), `npm run verify` passes with zero warnings.

- [ ] Enforce the cross-workspace-publish guardrail with a deterministic hook
  - **ID**: enforce-cross-workspace-publish-hook
  - **Tags**: scout, hooks, guardrail, feedback-loop
  - **Details**: The "Cross-workspace publishing is human-blocked" rule added to `templates/AGENTS.md` (and `~/.config/agentbrew/shared-rules.md`) is prose-only — an autonomous agent can still ignore it. Per the feedback-loop principle (linters enforce, instructions suggest — zernie.com/blog/feedback-loop-is-all-you-need), add a PreToolUse deterministic hook that blocks `gh pr create`, `gh repo fork`, `git push` to a remote whose repo root is OUTSIDE the session's workspace roots, and `gh pr merge --auto` on such repos. Model it on the existing `no-force-push-protected` / `no-git-add-all` checks. Scouted while writing the prose rule after an autonomous Devin run opened `acme/sdd-meta-registry` PR #54 from a personal fork without approval.
  - **Files**: `hooks/checks/no-cross-workspace-publish.sh` (+ `.test.sh` fixture), `hooks/manifest.yaml` (register), `docs/research/hooks-over-agents-md.md` (document)
  - **Acceptance**: `gh pr create` / `git push <new-remote>` against a repo whose root is outside the workspace roots is blocked with a message naming the approval requirement; the same commands inside the workspace pass; a shell fixture covers both cases.

- [ ] Fix incomplete `../state.js` mock in `src/mcp/mcp-git.test.ts` (missing `loadState`)
  - **ID**: fix-mcp-git-test-state-mock-loadstate
  - **Tags**: scout, test-hygiene, mcp
  - **Details**: `src/mcp/mcp-git.test.ts` mocks `../state.js` but omits the `loadState` export, so the overlay-agent load path hits a caught error and logs `Failed to load overlay agents: No "loadState" export is defined on the "../state.js" mock` to stderr on every run. Tests pass, but the noisy stderr hides real failures and the mock is silently exercising the error path instead of the intended path. Add `loadState` to the `vi.mock("../state.js", …)` factory (return a minimal state) so the overlay path runs cleanly. Scouted while fixing `agentbrew-sync-clear-stale-mcp-fields`.
  - **Files**: `src/mcp/mcp-git.test.ts`
  - **Acceptance**: `vitest run src/mcp/mcp-git.test.ts` emits no "No \"loadState\" export" stderr line; all tests still pass.

- [ ] Consolidate deterministic and Cat B comment-proportionality hook surfaces
  - **ID**: consolidate-comment-proportionality-hook-surfaces
  - **Tags**: scout, hooks, llm-verifier, cleanup
  - **Details**: Cat B slice 2 added `comment-proportionality-verifier` under `hooks/verifiers/` while the older deterministic `comment-proportionality` hook remains under `hooks/checks/`. That is safe in warn mode but can double-warn on comment-heavy `Write` calls and splits rule #38 observation across two hook IDs. After the Cat B verifier has enough decision-log evidence, decide whether to retire the deterministic hook, keep it as a cheap prefilter, or merge its ratio heuristic into the verifier's candidate gate.
  - **Files**: `hooks/checks/comment-proportionality.sh`, `hooks/checks/comment-proportionality.test.sh`, `hooks/verifiers/comment-proportionality.sh`, `hooks/verifiers/comment-proportionality.test.sh`, `hooks/manifest.yaml`
  - **Acceptance**: Exactly one intentional policy is documented and implemented for rule #38: either one hook remains, or both remain with manifest descriptions/tests explaining why the deterministic prefilter and semantic verifier are complementary; `bash scripts/run-hook-fixtures.sh` stays green.

- [ ] Refresh competitor research: block-ai-rules-vs-agentbrew
  - **ID**: refresh-competitor-block-ai-rules-vs-agentbrew
  - **Tags**: research, competitor, p3
  - **Details**: `docs/competition/block-ai-rules-vs-agentbrew.md` last updated 35 days ago (stale threshold: 30 days). Refresh: check the competitor's blog, changelog, recent releases, and pricing page for changes since the last edit. Use the `companion-competitor-watch` skill for guidance.
  - **Files**: docs/competition/block-ai-rules-vs-agentbrew.md
  - **Acceptance**: docs/competition/block-ai-rules-vs-agentbrew.md has at least one new bullet point referencing post-last-edit material, and the file's last-commit date is within the past 7 days.

- [ ] Refresh competitor research: mcpm-sh-vs-agentbrew
  - **ID**: refresh-competitor-mcpm-sh-vs-agentbrew
  - **Tags**: research, competitor, p3
  - **Details**: `docs/competition/mcpm-sh-vs-agentbrew.md` last updated 34 days ago (stale threshold: 30 days). Refresh: check the competitor's blog, changelog, recent releases, and pricing page for changes since the last edit. Use the `companion-competitor-watch` skill for guidance.
  - **Files**: docs/competition/mcpm-sh-vs-agentbrew.md
  - **Acceptance**: docs/competition/mcpm-sh-vs-agentbrew.md has at least one new bullet point referencing post-last-edit material, and the file's last-commit date is within the past 7 days.

- [ ] Refresh competitor research: vercel-skills-cli-vs-agentbrew
  - **ID**: refresh-competitor-vercel-skills-cli-vs-agentbrew
  - **Tags**: research, competitor, p3
  - **Details**: `docs/competition/vercel-skills-cli-vs-agentbrew.md` last updated 31 days ago (stale threshold: 30 days). Refresh: check the competitor's blog, changelog, recent releases, and pricing page for changes since the last edit. Use the `companion-competitor-watch` skill for guidance.
  - **Files**: docs/competition/vercel-skills-cli-vs-agentbrew.md
  - **Acceptance**: docs/competition/vercel-skills-cli-vs-agentbrew.md has at least one new bullet point referencing post-last-edit material, and the file's last-commit date is within the past 7 days.

- [ ] Refresh competitor research: readme
  - **ID**: refresh-competitor-readme
  - **Tags**: research, competitor, p3
  - **Details**: `docs/competition/README.md` last updated 33 days ago (stale threshold: 30 days). Refresh: check the competitor's blog, changelog, recent releases, and pricing page for changes since the last edit. Use the `companion-competitor-watch` skill for guidance.
  - **Files**: docs/competition/README.md
  - **Acceptance**: docs/competition/README.md has at least one new bullet point referencing post-last-edit material, and the file's last-commit date is within the past 7 days.

- [ ] Refresh competitor research: token-usage-tools
  - **ID**: refresh-competitor-token-usage-tools
  - **Tags**: research, competitor, p3
  - **Details**: `docs/competition/token-usage-tools.md` last updated 32 days ago (stale threshold: 30 days). Refresh: check the competitor's blog, changelog, recent releases, and pricing page for changes since the last edit. Use the `companion-competitor-watch` skill for guidance.
  - **Files**: docs/competition/token-usage-tools.md
  - **Acceptance**: docs/competition/token-usage-tools.md has at least one new bullet point referencing post-last-edit material, and the file's last-commit date is within the past 7 days.
