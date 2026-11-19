# minsky deep harvest (2026-11-19)

minsky is archived. The first absorb pass (minsky `absorbed.md`) judged many
items by glob. This second pass gives each principle, rule, hook, skill, doc,
and script family its own verdict. Verdicts: PORT (moved here, or filed as a
task with an exact spec), ALREADY-THERE (the target path holds it), DROP
(orchestrator-only, with the reason).

Where this ledger and minsky `absorbed.md` disagree, this ledger wins. For example, the "repo-hygiene lint pack" rows (`check-filename-casing`, `check-test-file-colocation`, `check-no-repo-root-install-in-tests`, `check-otel-no-pii`) are DROP: they enforce minsky's own layout. Also dropped as minsky-only: `scripts/check-skill-rule-cap.mjs` (counts rules in minsky's spec-monitor) and `scripts/check-cross-repo-pr-rate.mjs` (reads minsky's experiment store).

## Where each PORT landed

| minsky item | Landed in |
|---|---|
| vision #18 Merge means MERGE, skill `pr-merge-no-shortcuts` | `docs/shared-rules.md` Git and delivery: "Merge means merge" |
| AGENTS.md hypothesis self-grade | `docs/shared-rules.md` Git and delivery: "Hypothesis self-grade" |
| `docs/rule-11-flake-detection.md` | `docs/shared-rules.md` Verification: "A flaky check is not evidence" |
| vision #13 item 4 (local bind) | `docs/shared-rules.md` Security and secrets: `127.0.0.1` default |
| `docs/agents/working-tasks.md` tool-call discipline | `skill-plugins/local-llm-warmup/SKILL.md` anti-pattern 13 |
| vision #19 operator-explicit-start | dotfiles `AGENTS.md`: heavy LaunchAgents are opt-in |
| skill `experiment-validate`, `check-pivot-success-margin`, `check-anchor-primary-source`, `check-measurement-inspects-output` | tasks.md `packages/lint/src/rule9.ts` `qualityWarningsIn()` (tasksmd/tasks.md#53); the output-inspection check is reduced to "Measurement has a command in backticks" |
| `check-orphan-tests.mjs` | task `check-tests-import-only-existing-exports` |
| `verify-squash-merge-completeness.mjs` | shipped: `scripts/verify-squash-merge-completeness.mjs` (agentbrew #1142) |
| `check-toolchain.mjs` + lefthook `piped: true` | shipped in the new-project scaffold (agentbrew #1144) |
| `check-readme-byte-budget.mjs` | task `readme-byte-budget` |
| `check-lockfile-integrity.mjs` (docs/security/supply-chain.md layer 1) | shipped (agentbrew #1149) |
| docs/security/dashboard-exposure.md per-run token | `docs/shared-rules.md` Security and secrets |
| `docs/user-tests/*` | task `readme-human-first-run-test` |
| `docs/validated-learnings.md`, `docs/experiment-tracker.md` | `docs/shared-rules.md` Task queues: re-check, Stances expire, Contract first |
| `check-no-hardcoded-user-paths.mjs`, `check-no-personal-paths-in-docs.mjs` | already there: the pre-push scanner catches both (agentbrew #1143) |
| working-tasks.md UI is P0-P1 | `docs/shared-rules.md` Task queues |
| skill `triage` out-of-scope memory | `skill-plugins/workflow/watch-issues/SKILL.md` step 3, eval 17 |
| skill `diagnose` feedback-loop ladder + ranked hypotheses | task `diagnose-loop-ladder-and-ranked-hypotheses` |
| hook `block-dangerous-bash.sh` (stash drop/clear, `gh pr merge --admin`, `gh repo delete`, `-c core.hooksPath` commit, `rm -rf` outside temp, branch switch in a shared checkout, `checkout <ref> -- .`, `restore :/`, `npm publish`) | task `block-remaining-dangerous-commands` |


## minsky harvest A — item-level pass (2026-11-19)

| Item | Verdict | Target path or reason |
|---|---|---|
| vision #1 Don't reinvent the wheel | ALREADY-THERE | agentbrew/docs/shared-rules.md "## Reuse before implementation"; dotfiles/docs/constitution.md rule 0 (GET, don't IMPLEMENT) |
| vision #2 Every dependency behind an interface | ALREADY-THERE | agentbrew/docs/shared-rules.md "## Reuse before implementation" (adapters); global CLAUDE.md "Keep new code behind adapters" |
| vision #3 Test-first, metric-first, doc-first | ALREADY-THERE | agentbrew/docs/shared-rules.md "## Verification" (red/green TDD); test-driven-development + spec-driven-development skills |
| vision #4 Everything measurable, everything visible | ALREADY-THERE | agentbrew/AGENTS.md + shared-rules (observability/telemetry); tooling telemetry live |
| vision #5 Theoretical grounding (CS anchor per term) | ALREADY-THERE | `Anchor` field required on every task (agentbrew shared-rules "## Task queues"; dotfiles constitution rule 11) |
| vision #6 Stay alive (let it crash, supervisor) | DROP | Daemon/supervisor resilience for the minsky loop; no long-running orchestrator in targets |
| vision #7 Chaos engineering | PORT (partial) | Per-failure-mode chaos tests are orchestrator-only (drop). "Silent retry that hides failure" → shared-rules Verification "No silent retries" |
| vision #8 Pattern conformance (row per artifact) | DROP | Heavy minsky-only bookkeeping; no target uses it; Anchor field covers the useful part |
| vision #9 Pre-registered hypothesis (iron) | ALREADY-THERE + PORT | Core: global CLAUDE.md, shared-rules "## Task queues", dotfiles constitution rule 11. NEEDS-CLARIFICATION inventory → shared-rules Task queues "Clarify first" |
| vision #10 Deterministic enforcement | ALREADY-THERE + PORT | hooks-over-agents-md.md, editing-rules.md, hooks/manifest.yaml. Ratchet sub-rule → shared-rules "Agent rule/skill changes" "Ratchet" |
| vision #11 No flaky metric is load-bearing | ALREADY-THERE | agentbrew/docs/ci.md "## Flake detection thresholds" (10% same-SHA) |
| vision #12 Scope discipline (stability before new scope) | ALREADY-THERE | agentbrew/docs/shared-rules.md "## Scope discipline"; global CLAUDE.md "Surgical changes" |
| vision #13 Security & privacy (8-item bar) | PORT (partial) | Secrets/PII/supply chain already in shared-rules "## Security and secrets" + secret-scan. Missing item 4: add to agentbrew/docs/shared-rules.md "## Security and secrets": "A local web UI or dashboard binds to 127.0.0.1 by default. Binding 0.0.0.0 needs an explicit opt-in flag and a doc note." Threat-model/cloud-audit items DROP (minsky packages). |
| vision #14 Delegate to agents; shrink to fit | ALREADY-THERE | agentbrew/AGENTS.md (shrink / native capabilities); dev-skills absorbed pattern |
| vision #15 Match machine-utilisation budget | ALREADY-THERE | dotfiles heavy-run queue (heavy_run_slots); global CLAUDE.md heavy-run rule |
| vision #16 Default by default (+ CLI flags-not-subcommands corollary) | ALREADY-THERE | dotfiles/docs/constitution.md rule 13; agentbrew/scripts/check-rule-16-defaults.mjs; agentbrew/skill-plugins/workflow/cli-design/SKILL.md |
| vision #17 Proactive healing (fix the class) | ALREADY-THERE | dotfiles/docs/constitution.md rule 12; dotfiles/AGENTS.md |
| vision #18 Merge means MERGE (no close-with-preservation) | PORT | agentbrew/docs/shared-rules.md "## Git and delivery": "Merge means the commit lands on the default branch. Close a PR as superseded or duplicate only with mechanical proof that its diff is already on the base (empty diff after rebase); never close a CONFLICTING PR before one rebase attempt. If closes outnumber merges in a drain, stop and ask." (dotfiles/docs/ship-it-reference.md only covers duplicate PRs.) |
| vision #19 Operator-explicit-start (no auto-launch of heavy processes) | PORT | dotfiles/docs/constitution.md (new rule) or dotfiles/AGENTS.md: "A LaunchAgent that holds much RAM/CPU or calls an LLM between runs is opt-in. Setup/apply never bootstraps it or sets RunAtLoad without an explicit owner setting; a doctor/test pins the gate." Only module-reference/architecture tables mention RunAtLoad today. |
| vision: Pattern conformance index (all ~ rows, as families: vision/docs, novel/* packages, adapters, scripts/check-rule-*, CI workflows, launchd/systemd, dashboard, experiments, personas) | DROP | Every row maps a minsky artifact to a pattern; artifacts are archived; the general method (anchor + declared deviation) is covered by the Anchor field |
| vision: Theoretical foundations table | DROP | Maps minsky layers (personas, blackboard, MAPE-K, OODA) to literature; orchestrator-specific |
| vision: Glossary + Retired terms | DROP | Minsky vocabulary; the general practice is the ubiquitous-language skill (agentbrew catalog) |
| vision: Success criteria (10 metrics) | DROP | Loop uptime, wrist dwell, tokens/story etc. are orchestrator metrics; per-task metrics already required |
| AGENTS.md: What this file is / is not frame | ALREADY-THERE | agentbrew/docs/agent-guide-baseline.md |
| AGENTS.md: Start here / Commands / Where to change what | DROP | minsky-specific commands and routing; pattern already in agent-guide-baseline |
| AGENTS.md: Constitutional rules table | ALREADY-THERE | See vision rows; dotfiles/docs/constitution.md is the projection |
| AGENTS.md / constitutional-rules.md 3a Runtime invariants | ALREADY-THERE | Prove-It pattern (shared-rules "## Verification") + dotfiles constitution rule 12 "fix the class" |
| AGENTS.md / constitutional-rules.md 3b Integration tests run the real binary | ALREADY-THERE | dotfiles Bats tests run real bin/*; agentbrew src/integration.test.ts |
| AGENTS.md / constitutional-rules.md 14b Dynamic settings (timeouts from history) | DROP | Iteration-history timeouts are daemon-specific; no target loop has that history |
| AGENTS.md 15 Milestone alignment gate | DROP | MILESTONES.md seven-surface gate is minsky-only |
| AGENTS.md Orchestrator discipline (max 2 agents per shared file) | ALREADY-THERE | Max 3 parallel gate agents feedback memory + parallel worktree rules; tasks.md claim-check |
| AGENTS.md Orchestrator discipline: Hypothesis self-grade block (Predicted/Observed/Match/Lesson) | PORT | agentbrew/docs/shared-rules.md "## Git and delivery" (and gh-pr-body hooks later): "When a PR closes a task with a pre-registered hypothesis, the PR body adds a short self-grade: Predicted, Observed (with the measurement output), Match yes/no, Lesson." Closes the pre-registration loop; today nothing checks the observed result. |
| AGENTS.md Touches field | ALREADY-THERE | tasks.md format (Touches field, 18 files) |
| AGENTS.md Test conventions / doc opens with why | ALREADY-THERE | agentbrew/docs/agent-guide-baseline.md |
| AGENTS.md Never (secrets, vision edits, Windsurf/Augment, autostart) | ALREADY-THERE | shared-rules Security; global CLAUDE.md Windsurf/Augment; autostart see vision #19 PORT |
| AGENTS.md Gotchas (commit before pnpm test, node pin, lefthook, README budget, frame lint) | DROP | minsky repo specifics |
| AGENTS.md Delivery | ALREADY-THERE | shared-rules "## Git and delivery"; ship-it |
| AGENTS.md Docs upkeep | ALREADY-THERE | global "Docs with every change"; gh-pr-body-requires-docs hook |
| docs/agents/constitutional-rules.md (rest) | ALREADY-THERE | Duplicates of vision rows above |
| docs/agents/conventions.md | DROP | novel/* layout, TS file conventions for minsky |
| docs/agents/operating-notes.md: What to do when stuck (no loop, mark blocked, move on) | ALREADY-THERE | shared-rules "## Human-blocked actions"; retry-failed-before-stop hook; systematic-debugging skill |
| docs/agents/operating-notes.md: Operator directive vocabulary | DROP | "Monitor it = keep shipping" readings conflict with surgical-change + approval rules |
| docs/agents/operating-notes.md: Touches / worktree pattern / frozen agents / pushback | ALREADY-THERE | tasks.md Touches; global "Pipeline-managed repos"; Augment frozen; Anti-sycophancy |
| docs/agents/operating-notes.md: vision size note, never-commit list | DROP / ALREADY-THERE | size note minsky-only; never-commit in shared-rules Security |
| docs/agents/running-minsky.md | DROP | minsky CLI and ~/.minsky config |
| docs/agents/working-tasks.md: Task hygiene | ALREADY-THERE | tasks.md linter + shared-rules "## Task queues" |
| docs/agents/working-tasks.md: Tool-call discipline for non-Claude models | PORT | agentbrew/skill-plugins/local-llm-warmup/SKILL.md: "Local models in agent frameworks (OpenHands, opencode) must attach a tool call to every reply; a prose-only 'Let me check X' ends the run. Put this line in the system brief and pin it with a test." Observed 13/13 dead runs with qwen3-coder. |
| docs/agents/working-tasks.md: OMC modes, personas | DROP | minsky persona/mode routing |
| docs/agents/working-tasks.md: UI is P0-P1 | PORT | `docs/shared-rules.md` Task queues: user-facing friction is P0 or P1; its sub-rules (one command per operation, sane no-args defaults) are already in the global "One command to start any app" and "Every action through CLI, agent, and UI" rules |
| RECURRING.md | DROP | observer-dogfood and other minsky cadence loops; dotfiles LaunchAgents doc covers its own jobs |
| ask-human.md | ALREADY-THERE | ask-human MCP was replaced by mcp-feedback-enhanced in src/catalog.yaml (2026-10-16); the ask-or-decide rule is covered by the global "Local autonomy" rule and shared-rules "Human-blocked actions" |
| templates/repo.yaml | ALREADY-THERE | tasks.md / Agentfile `task_backend` + .agents/tasks.config.yaml (rest is runner-only) |
| CONTRIBUTING.md | ALREADY-THERE | agentbrew/dotfiles CONTRIBUTING.md with "Report problems and ideas" |
| INSTALL.md | ALREADY-THERE | agentbrew/dotfiles INSTALL.md playbooks (doctor, audit, first run); OpenHands step DROP |
| hook block-dangerous-bash.sh | PORT (partial) | force-push, `--no-verify`, `reset --hard`, `clean -f`, `checkout .` already blocked (agentbrew no-force-push-protected, no-commit-no-verify; dotfiles agent-hooks/block-dangerous-git.sh). The rest is task `block-remaining-dangerous-commands` |
| hook block-vision-md-edit.sh | DROP | Protects minsky vision.md for MAPE-K loop |
| hook live-fire-smoke-post-edit.sh | DROP | Smoke test of minsky launchd/systemd scripts |
| hook post-edit.sh (single-file lint) | PORT (partial) | biome/tsc/markdownlint branches drop (each repo has its own gates); TASKS.md lint-on-edit branch → task `tasks-md-lint-on-edit` |
| hook spec-driven-precondition.sh | DROP | Keyed on novel/**/src paths; spec-driven-development skill covers the practice |
| hook stop-gate.sh | ALREADY-THERE | agentbrew hooks verify-before-completion, retry-failed-before-stop, goal-retro-before-stop |
| hook worker-uses-tmp-worktree.sh | ALREADY-THERE | global "Pipeline-managed repos" rule; parallel worktree rules |
| .claude/settings.json hook wiring | DROP | Wires the minsky hooks above; agentbrew hooks/manifest.yaml is the target wiring |

Total rows: 61

## Harvest B: minsky skills + docs (item level)

| Item | Verdict | Target path or reason |
|---|---|---|
| .claude/skills/brief-engineering | DROP | tick-loop worker brief curation; orchestrator-specific |
| .claude/skills/caveman | ALREADY-THERE | agentbrew/skill-plugins/workflow/caveman/SKILL.md |
| .claude/skills/ci-gate-check | DROP | predicts minsky's own 35 CI gates |
| .claude/skills/cli-consolidation | ALREADY-THERE | agentbrew/skill-plugins/workflow/cli-design/SKILL.md (default-behavior + fold-into-flags review) |
| .claude/skills/competitor-research | ALREADY-THERE | agentbrew/skill-plugins/dev/competitor-spot-check + workflow/companion-competitor-watch; M1.10 scorecard is minsky-specific |
| .claude/skills/diagnose | PORT | catalog systematic-debugging tests one hypothesis at a time; the feedback-loop ladder and 3-5 ranked falsifiable hypotheses are task `diagnose-loop-ladder-and-ranked-hypotheses` |
| .claude/skills/doubt-driven-development | ALREADY-THERE | catalog doubt-driven-development (addyosmani) |
| .claude/skills/experiment-validate | PORT | tasks.md/packages/lint/src/rule9.ts: today only checks field presence. Add opt-in quality checks from minsky's three lints: Measurement must contain a runnable command (backticked), Success and Pivot thresholds must differ (a margin, not the same number), Anchor must name a citation (author+year or URL) |
| .claude/skills/grill-task | ALREADY-THERE | catalog grill-with-docs (mattpocock) |
| .claude/skills/improve-codebase-architecture | ALREADY-THERE | catalog improve-codebase-architecture |
| .claude/skills/incremental-implementation | ALREADY-THERE | catalog executing-plans + test-driven-development + verification-before-completion |
| .claude/skills/karpathy-disciplines | ALREADY-THERE | agentbrew/skill-plugins/workflow/karpathy-disciplines/SKILL.md (same 4 disciplines; extra minsky length is worktree/MAPE-K specific) |
| .claude/skills/launchd-safe-paths | ALREADY-THERE | dotfiles/skills/launchd-safe-paths/SKILL.md |
| .claude/skills/live-fire-smoke | ALREADY-THERE | dotfiles/skills/launchd-safe-paths/SKILL.md "Smoke: run the script under a stripped env" (env -i) |
| .claude/skills/minsky-supervisor | DROP | daemon start/stop; minsky archived |
| .claude/skills/openhands-shim-knobs | DROP | OpenHands shim |
| .claude/skills/poll-merge | ALREADY-THERE | ship-it command (merge when green) + watch-issues |
| .claude/skills/pr-merge-no-shortcuts | PORT | shared-rules.md Git and delivery "Merge means merge"; squash file check → `scripts/verify-squash-merge-completeness.mjs` (#1142); `--admin` → task `block-remaining-dangerous-commands` |
| .claude/skills/reader-priority-docs | ALREADY-THERE | agentbrew/skill-plugins/workflow/readme/SKILL.md + shared "answer first" language rule + docs/agent-guide-baseline.md |
| .claude/skills/spec-driven-development | ALREADY-THERE | catalog spec-driven-development |
| .claude/skills/task-slice | ALREADY-THERE | catalog to-issues (vertical tracer-bullet slices) + writing-plans |
| .claude/skills/task-spec | ALREADY-THERE | catalog spec-driven-development + analyze; .minsky/specs path is minsky-specific |
| .claude/skills/triage | PORT (partial) | watch-issues covers triage; its out-of-scope memory (`.out-of-scope/<concept>.md`) is now in `skill-plugins/workflow/watch-issues/SKILL.md` step 3 |
| .claude/skills/worktree-handoff | ALREADY-THERE | agentbrew/skill-plugins/workflow/handoff + wrap-up |
| .claude/skills/zoom-out | ALREADY-THERE | catalog improve-codebase-architecture + ubiquitous-language (15-line prompt, no extra idea) |
| skill-plugins/observer/minsky/SKILL.md | DROP | launch + monitor minsky run loop |
| skill-plugins/observer/minsky/reference/swift-pr.md | DROP | minsky observer PR flow |
| skill-plugins/observer/minsky/reference/tips-and-tricks.md | DROP | minsky observer heal tips |
| docs/ARCHITECTURE.md | DROP | minsky architecture |
| docs/CHANGELOG-narrative-history.md | DROP | frozen history |
| docs/DEPRECATED.md | DROP | minsky code paths |
| docs/METRICS.md | DROP | minsky metric values; pattern already in new-project metrics scaffold |
| docs/PRACTICES.md | DROP | minsky practice index; practices already in shared-rules |
| docs/README-v1-detailed.md | DROP | old README |
| docs/README.md | DROP | minsky docs map |
| docs/auto-merge.md | DROP | daemon auto-merge; merge-when-green in ship-it |
| docs/bash-runner-observability.md | DROP | Path A runner |
| docs/cli-reference.md | DROP | minsky CLI |
| docs/commands/minsky-status.md | DROP | minsky command |
| docs/commands/minsky-stop.md | DROP | minsky command |
| docs/commands/minsky.md | DROP | minsky command |
| docs/commit-hook-toolchain.md | DROP | minsky lefthook chain |
| docs/competitive-comparison.md | DROP | minsky positioning |
| docs/configuration.md | DROP | ~/.minsky/config.json |
| docs/conflict-auto-resolution.md | PORT (task) | Mergiraf merge driver → dotfiles task `git-mergiraf-merge-driver-setup`; daemon-vs-daemon parts drop |
| docs/cost-tiers.md | DROP | minsky cost tiers |
| docs/cross-repo-portability/2026-05-04-classification-run.md | DROP | historic run output |
| docs/cross-repo-portability.md | DROP | minsky lint portability |
| docs/cross-repo-runner-proj-840-runbook.md | DROP | one-off runbook |
| docs/daemon-pre-pr-gate.md | DROP | daemon gate |
| docs/dependabot.md | DROP | minsky dependabot mechanics; owner rule: dependabot only if named |
| docs/dependency-policy.md | DROP | semver triage of dependabot PRs; owner scopes dependabot out |
| docs/edge-cases.md | DROP | daemon edge cases |
| docs/enterprise-deployment-options.md | DROP | minsky deployment audit |
| docs/example-config.json | DROP | minsky config |
| docs/experiment-runner.md | DROP | per-PR runner; quality lint idea captured under experiment-validate PORT |
| docs/experiment-tracker.md | PORT | `docs/shared-rules.md` Task queues: re-check at +7 and +30 days, regression only after two misses in a row; the replay scheduler itself is minsky-only |
| docs/heal-class-coverage-matrix.md | DROP | generated daemon report |
| docs/host-transformation-checklist.md | DROP | "make host follow minsky" checklist; new-project scorer covers |
| docs/language-strategy.md | DROP | minsky language decision |
| docs/local-llm-fallback.md | ALREADY-THERE | agentbrew/skill-plugins/local-llm-warmup/SKILL.md |
| docs/machine-budget.md | ALREADY-THERE | dotfiles heavy-run queue + global rules |
| docs/metrics-discipline.md | ALREADY-THERE | agentbrew/skill-plugins/workflow/new-project (metrics scaffold) + shared-rules "Measure in use" |
| docs/metrics-last-run.json | DROP | data |
| docs/observability-8h-run.md | DROP | minsky run measurement |
| docs/orchestrator-fanout.md | DROP | orchestrator role pinning |
| docs/plans/2026-05-22-path-c-openhands-reshape.md | DROP | historic plan |
| docs/plans/2026-05-24-path-a-aggressive-cut.md | DROP | historic plan |
| docs/plans/agents-can-self-heal-minsky-m1-13.md | DROP | historic plan |
| docs/plans/fleet-stability-centralized-reporting.md | DROP | historic plan |
| docs/plans/path-c-deletion-priorities.md | DROP | historic plan |
| docs/plans/self-metrics-competitive-benchmark.md | DROP | historic plan |
| docs/post-task-cto-audit.md | DROP | daemon second-pass; run-goal retro + strategic-review cover |
| docs/prior-art-and-name-collisions.md | DROP | minsky naming |
| docs/proof/README.md | DROP | minsky proof numbers |
| docs/proof/metrics.json | DROP | data |
| docs/release.md | DROP | minsky semantic-release |
| docs/research/claude-native-task-standard.md | ALREADY-THERE | tasks.md/spec.md (task-file format) |
| docs/research-a2a-mcp-2026-05-28.md | DROP | dated orchestrator research |
| docs/research-docker-sandbox-2026-06-02.md | DROP | @minsky/sandbox build/buy |
| docs/research-hooks-vs-rules-2026-05-27.md | ALREADY-THERE | agentbrew/docs/research/hooks-over-agents-md.md |
| docs/research-log.md | DROP | minsky dependency watch list |
| docs/rule-11-flake-detection.md | PORT | agentbrew/docs/shared-rules.md "## Verification": no flake rule there today. Add: "A flaky check is not evidence. When a gate passes and fails on the same commit, quarantine it with a task that names the flake rate; never count its green run as proof." |
| docs/security/audit-gate.md | DROP | minsky cloud-tier gate |
| docs/security/dashboard-exposure.md | PORT | `docs/shared-rules.md` Security and secrets: 127.0.0.1 default bind and per-run token |
| docs/security/otel-no-pii.md | ALREADY-THERE | global rule "no live auth material or customer payloads in logs" |
| docs/security/privacy-data-egress.md | ALREADY-THERE | agentbrew shared-rules org-overlay/leak gates |
| docs/security/secret-scanning.md | ALREADY-THERE | dotfiles leak gates + pre-push hook |
| docs/security/supervisor-sandbox.md | DROP | supervisor sandbox |
| docs/security/supply-chain.md | ALREADY-THERE | catalog supply-chain-risk-auditor + tool-setup preflight (pin versions) |
| docs/self-diagnose-authoring.md | PORT | five-rule check contract → shared-rules Verification "Doctor-check contract"; daemon wiring drops |
| .claude/shims/git | PORT (task) | task `git-path-shim`; dotfiles `bin/git-safe` is an opt-in alias, not a PATH shim |
| scripts/verify-pr-closure-is-lossless.mjs | PORT (task) | task `lossless-pr-close` |
| vision #13 "no silent security trade-offs" | PORT | shared-rules Security and secrets |
| MILESTONES.md "What Minsky will never do" | ALREADY-THERE + PORT | destructive-op approval, human-owned architecture and no hidden failure are in the global rules; security-critical code approval → shared-rules Security and secrets |
| docs/self-diagnose-throughput-invariants.md | DROP | daemon invariants |
| docs/session-ledger-schema.json | DROP | minsky ledger |
| docs/spec-advisories/2026-05-03-quarterly-audit.md | DROP | historic audit |
| docs/strategic-model-router.md | DROP | minsky router |
| docs/strategic-review-2026-05-22-continue-or-wrap-more.md | DROP | historic review |
| docs/uninstall.md | DROP | minsky uninstall |
| docs/updating.md | DROP | minsky update |
| docs/user-tests/README.md | PORT | task `readme-human-first-run-test` (3 strangers, README only, 5-minute median) |
| docs/user-tests/template.md | PORT | same task: the session log template |
| docs/validated-learnings.md | PORT | the log format is replaced by shared memory; its two lessons are in `docs/shared-rules.md` Task queues: "Stances expire" and "Contract first" |
| docs/visions/2026-05-22-openhands-fulfillment.md | DROP | OpenHands vision |

## minsky harvest C: file-family pass (2026-11-19, read-only)

| Family/file | Verdict | Target path or reason |
|---|---|---|
| scripts/check-pivot-success-margin.mjs | PORT | tasks.md/packages/lint/src/rule9.ts: under `--require-prereg`, flag blocks whose Pivot threshold equals or exceeds the Success threshold (no information). Pure fn + rule9.test.ts cases. |
| scripts/check-measurement-inspects-output.mjs | PORT | tasks.md/packages/lint/src/rule9.ts: flag a Measurement that only runs a command (exit code) without asserting/inspecting output (no `grep`/`jq`/`test`/threshold). Opt-in warning. |
| scripts/check-anchor-primary-source.mjs | PORT | tasks.md/packages/lint/src/rule9.ts: flag an Anchor that cites no primary source (no author+year, DOI, or URL; e.g. "best practice"). Opt-in warning. |
| scripts/check-toolchain.mjs (+ lefthook toolchain-first `piped: true`) | PORT | agentbrew/skill-plugins/workflow/new-project/templates (scripts + lefthook): toolchain barrier that checks `.node-version` match and per-arch native binaries (biome) resolve, printing one actionable line before other hooks. |
| scripts/verify-squash-merge-completeness.mjs | PORT | agentbrew/scripts/verify-squash-merge-completeness.mjs (call from ship-it after merge): compare PR head file list vs squash commit to catch silently dropped files. |
| scripts/check-readme-byte-budget.mjs | PORT | agentbrew/skill-plugins/workflow/readme/scripts/check-readme.py: add a ratchet byte budget (hard limit = baseline + headroom) so README compression does not decay. |
| scripts/check-no-hardcoded-user-paths.mjs, check-no-personal-paths-in-docs.mjs | ALREADY-THERE | the before-push scanner catches both planted paths (agentbrew #1143) |
| scripts/check-orphan-tests.mjs | PORT (task) | agentbrew task `check-tests-import-only-existing-exports` |
| scripts/check-lockfile-registry.mjs | ALREADY-THERE | agentbrew/scripts/check-locked-dependencies.mjs + dotfiles oss-readiness gate cover registry/leak; generic allowlist idea optional |
| scripts/check-lockfile-integrity.mjs | PORT | shipped in agentbrew #1149: `check-lockfile-sync.sh` only checks that package.json and the lockfile agree, not that a same-version entry kept its hash |
| scripts/check-sbom-shape.mjs | DROP | SBOM shape for minsky's pnpm publish pipeline |
| scripts/scan-secrets.mjs | ALREADY-THERE | dotfiles/lib/secret-scan.sh + .github/workflows/oss-readiness.yml |
| scripts/check-no-no-verify-bypass.mjs | ALREADY-THERE | agentbrew/hooks/checks/no-commit-no-verify.sh |
| scripts/check-bot-commit-hook-bypass.mjs | DROP | only matters for CI bots committing with lefthook; no such workflow in targets |
| scripts/gh-actions-flake-tracker.mjs, check-rule-11-no-flaky-gates.mjs | ALREADY-THERE | agentbrew/scripts/gh-actions-flake-tracker.mjs; docs/ci.md |
| scripts/check-pre-push-hook-fast.mjs | ALREADY-THERE | agentbrew/scripts/check-pre-push-budget.mjs |
| scripts/check-gitattributes-mergiraf.mjs, setup-mergiraf.mjs | ALREADY-THERE | dotfiles/modules/git/doctor.sh (mergiraf) |
| scripts/check-launchd-safe-paths.mjs | ALREADY-THERE | dotfiles/skills/launchd-safe-paths/SKILL.md |
| scripts/check-rule-9-tasksmd-fields.mjs | ALREADY-THERE | tasks.md/packages/lint/src/rule9.ts |
| scripts/check-rule-3-*, check-pr-vision-trace.mjs, check-vitest timeouts | ALREADY-THERE | agentbrew/scripts/check-rule-3-test-first.mjs, check-pr-vision-trace.mjs, check-vitest-timeouts.mjs |
| scripts/check-no-corporate-refs.mjs, check-privacy-data-egress.mjs, check-otel-no-pii.mjs | ALREADY-THERE | ~/.config/oss-readiness pattern gate + agentbrew/docs/plans/public-release-privacy-lints.md |
| scripts/tasks-md-stale-sweep.mjs, sweep-stale-task-blocks.mjs, check-no-delivered-retained-blocks.mjs | ALREADY-THERE / DROP | tasks.md lint.ts stale handling; DELIVERED-retained block format is minsky-only |
| scripts/check-touches-field.mjs, check-task-block-citations.mjs | DROP | Touches/citation invariants serve minsky's parallel scheduler |
| scripts/lint-md-diff.mjs, run-pre-pr-lint-stack.mjs | ALREADY-THERE | agentbrew/scripts/lint-changed.sh, verify-changed.sh |
| scripts/check-filename-casing.mjs, check-doc-why-first-paragraph.mjs, check-agents-md-coherence.mjs, check-docs-frame-coherence.mjs | DROP | tied to minsky cardinal-doc set and vision.md section numbers; agentbrew docs contract + baseline cover the generic part |
| scripts/check-no-hardcoded-timeouts.mjs | DROP | enforces minsky TimeoutPolicy constant |
| scripts/check-rule-{1,2,4,5,6,7,10,12,13,17}-*.mjs, check-vision-rule-13-* | DROP | each lints minsky vision.md rule numbers / novel/ layout |
| scripts/check-mape-k-*, check-tick-loop-*, check-supervisor-*, check-machine-budget, check-watch-surface-cap, check-omc-*, check-cadence-*, check-competitive-goal, check-milestone-alignment, check-ui-tasks-priority, check-pnpm-minsky-aliases, check-cloud-*, check-cto-audit-*, check-skill-*, check-brief-pr-instructions, check-dashboard-localhost-bind, check-claude-hooks-installed, check-adapter-conventions, check-cli-integration-test-coverage, check-gate-scratch-resolvable, check-corpus-freshness, check-metric(s)-freshness, check-pattern-index, check-research/changelog-md-update, check-deprecated-md-respect, check-security-docs-cohesion, check-threat-model-section, check-user-story-security-section, check-test-file-colocation, check-no-repo-root-install-in-tests, check-no-singleton-experiment, check-mlx-server, check-pr-self-grade, check-pr-security-review, check-tool-call-discipline, check-ledger.py, check-sbom-shape | DROP | orchestrator internals or minsky doc-structure invariants |
| scripts/chaos-* (10) | DROP | chaos tests for the minsky supervisor |
| scripts/runany-* (9) | DROP | minsky model-resolution layer |
| scripts/auto-merge-clean-prs, auto-rebase-dirty-prs, auto-close-orphan-prs | ALREADY-THERE | watch-issues + ship-it skills |
| scripts/dependabot-triage.mjs | DROP | owner rule: dependabot only on request; small semver fn not worth a port |
| scripts/minsky-*, m1-*, cto-*, orchestrate, spawn_*, pick_task, local-gate-merge, kill-stuck-iterations, restart-supervisor, daemon-*, fleet-*, observer-*, omc-*, heal-*, watchdog | DROP | orchestrator runtime |
| scripts/measure-*, metrics*, collect/compute/generate-metrics, telemetry, usage-events, stability-*, throughput-*, benchmark-*, runs-aggregate, run-summary, render-*, changelog-*, proof.mjs, replay/run-experiment, synth_experiment_yaml, transform_*, baseline_metrics, iteration_ship_rate | ALREADY-THERE / DROP | agentbrew scripts/metrics.sh, report-html.sh, perf-gate; dotfiles changelog.sh, proof.sh; rest minsky-run metrics |
| scripts/install-lefthook-best-effort, post-merge-auto-install, worktree-prepare.sh | ALREADY-THERE | agentbrew/scripts/worktree-deps.sh, install-e2e-if-needed.sh |
| scripts/resolve_gh_host.py, gh_issue_task_source.py, extract_pr_url.py, cost_tier_picker.py, dynamic_timeout.py, classify-spawn-failures.py | DROP | minsky task-source/spawn glue |
| novel/adapters/* | DROP | runtime adapters (ollama, sandbox, a2a, notifier) for the orchestrator |
| novel/experiment-record (schema.json, spec) | ALREADY-THERE | rule-#9 fields now in tasks.md rule9 + shared-rules |
| novel/mape-k-loop, tick-loop, observer, human-loop, sidecar-bootstrap, budget-guard, cross-repo-runner, bridges, handoff-spec, claude-handoff-spec, dashboard-web, competitive-benchmark | DROP | orchestrator internals; handoff is covered by the handoff skill |
| novel/personas/*.md | DROP | minsky worker prompts; agentbrew has agent definitions |
| bin/check-budget.sh | ALREADY-THERE | dotfiles agent-usage-guard |
| bin/minsky*, minsky-ollama | DROP | orchestrator CLI; dotfiles local-models covers Ollama |
| user-stories/ | DROP | empty |
| competitors/*.md (42) | ALREADY-THERE | agentbrew/scripts/sync-competition-docs.ts + verify-competition-claims.ts |
| experiments/*.yaml (33) | DROP | historical minsky experiment records |
| research/*.md (2) | DROP | crewai memory / delegation notes, orchestrator-specific |
| lefthook.yml | PORT (see check-toolchain row) | toolchain-first `piped: true` ordering only |
| biome.json, knip.json | DROP | repo-specific config; targets have their own |
| package.json scripts | DROP | deprecated aliases to bin/minsky |

Total rows: 51
