# Process


### Step 0: Detect task backend and project type

**Task backend:** Check for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, use the GitHub Issues backend (file findings as issues via `tasks create`). Otherwise, use TASKS.md backend (stage findings in TASKS-AUDIT.md, then drain to TASKS.md P3).

**Project type:** Identify what kind of repo this is. Check for these markers:

| Marker file | Type | Verify command | Test command |
|-------------|------|----------------|--------------|
| `package.json` + `tsconfig.json` | TypeScript/Node | `npx tsc --noEmit && npx biome check .` | `npm test` (or `npx vitest run`) |
| `package.json` (no TS) | JavaScript/Node | `npx eslint .` | `npm test` |
| `Cargo.toml` | Rust | `cargo check && cargo clippy` | `cargo test` |
| `go.mod` | Go | `go vet ./...` | `go test ./...` |
| `pyproject.toml` / `setup.py` | Python | `ruff check . && mypy .` | `pytest` |
| `Makefile` + `*.sh` | Shell scripts | `make lint` (or `shellcheck`) | `make test` (or `bats`) |
| `Gemfile` | Ruby | `bundle exec rubocop` | `bundle exec rspec` |

Store the detected type and commands — every tier uses them. If the project has a
`Makefile` with `check`/`verify`/`lint`/`test` targets, or package scripts such as
`test:affected` and `test:all`, prefer those over raw tool commands.

Also detect:
- **Has README?** → enables the doc checks (Tier 4)
- **Has VISION.md or docs/?** → enables Tier 8 vision alignment
- **Has user stories?** → enables Tier 8 story-code alignment
- **Has UI/frontend?** → enables the UX checks (Tier 7; look for `src/components/`, `src/pages/`, `*.tsx`, `*.jsx`, `*.html`)
- **Has CLI?** → enables the CLI polish checks (Tier 7; look for `bin/`, `src/cli`, commander/yargs/clap imports)

### Step 0.5: Diagnostic snapshot

Run `git-diagnose-codebase` before the audit tiers. The five `git log` commands plus the churn × bug-keyword cross-reference produce a 5-minute, read-only map of where bugs cluster, who owns the code, and whether the team is in firefighting mode. Sweep is parallel-safe (read-only, never modifies source) — `git-diagnose-codebase` is also read-only, so this step preserves that property.

The output **biases the per-tier subagents toward the highest-risk files**. Each tier subagent (Tier 1 verify gate, Tier 2 stability, Tier 5 dead code, Tier 6 doc drift, etc.) reads the cross-reference list (top 5 churn ∩ top 20 bug clusters) and prioritizes those files when sampling. Files outside the cross-reference get sampled only if budget remains.

If `git-diagnose-codebase` is unavailable, run its commands inline (see [`piechowski.io`](https://piechowski.io/post/git-commands-before-reading-code/) for the recipe) and pass the cross-reference list to the per-tier subagents in their prompt.

### Step 0.6: Queue-pressure check (deliver vs add)

Before launching any tier subagents, count unclaimed tasks in `TASKS.md` and decide how aggressive to be.

```bash
P012=$(awk '/^## P0$/{f=1; next} /^## P3$/{f=0} f && /^- \[ \]/ && !/\(@/{c++} END{print c+0}' TASKS.md)
P3=$(awk   '/^## P3$/{f=1; next} /^## /{f=0}    f && /^- \[ \]/ && !/\(@/{c++} END{print c+0}' TASKS.md)
echo "P012=$P012 P3=$P3"
```

| Pressure | Trigger | Sweep depth | Tiers to run |
|---|---|---|---|
| **HIGH — deliver mode** | `P012 > 10` | **Minimal** — sweep is overhead while the queue is already full. Don't generate net-new audit tasks; instead, run only the verify gate and a quick check that the existing queue isn't rotting. | Tier 1 only (verify gate). Skip Tiers 2–8. The user's primary need is delivery, not more findings. |
| **LOW — add mode** | `P012 ≤ 10` AND `P3 > 0` | **Standard** — the queue is quiet enough to absorb new findings. Run the full audit cascade. | All 8 tiers (or whatever the focus argument selected). |
| **EMPTY** | `P012 == 0` AND `P3 == 0` | **Standard, then exit** | All 8 tiers; if the sweep yields < 3 new findings, the codebase is genuinely clean. Report "sweep clean" and stop. |

Print the chosen mode at session start so the operator can see the decision:

```bash
if [ "$P012" -gt 10 ]; then
  echo "Mode: DELIVER (P012=$P012 > 10) — running Tier 1 only; skipping Tiers 2–8."
  TIERS_TO_RUN="1"
else
  echo "Mode: ADD (P012=$P012, P3=$P3) — running full audit."
  TIERS_TO_RUN="all"
fi
```

**Exception — opportunistic adding always allowed.** If during Tier 1 (verify gate) you uncover something that's clearly a P0 bug (security regression, test that's been failing for weeks, deps audit warning the queue doesn't already track), file it as a task. The pressure rule throttles *proactive* sweeping (Tiers 2–8), not *reactive* note-taking when something jumps out during the always-on Tier 1.

The threshold (`> 10` for P0–P2 unclaimed) matches the [taskgrind prompt template](https://github.com/tasksmd/tasks.md/blob/main/taskgrind/prompt-template.md) and the equivalent fleet-grind skill in your orchestrator overlay (if you ship one). All surfaces share one threshold so an operator running grind in one repo and sweep in another sees consistent behavior. Don't tune per session — only edit if a pattern across multiple repos demands it.

### Step 1: Capture baseline

```bash
git checkout main && git pull --rebase
git checkout -b chore/sweep-drain-$(date +%Y-%m-%d)
```

Record these numbers at the top of TASKS-AUDIT.md (adapt to detected project type):
- File count (source, test, docs)
- Test count and pass rate
- Verify gate status (typecheck, lint, security)
- Line count (source only, excluding tests and generated files)

### Step 2: Read existing tasks

```bash
grep "^- \[ \]" TASKS.md | sed 's/- \[ \] //'
```

Keep this list in memory. **Never create a duplicate** — if a finding is already tracked, skip it.

### Step 3: Run 8 audit tiers in parallel

Launch up to 8 background subagents simultaneously, one per tier. Each subagent is read-only.
Pass each subagent: (a) the existing task list, (b) the detected project type, (c) the verify commands.
Skip tiers that don't apply to this project type (e.g., skip the vision checks (Tier 8) if no VISION.md exists).

---

**Tier 1 — Verify gate** (P0 findings — these are bugs)
- Run the project's full verify suite (typecheck + lint + test + security)
- Every failure is a task. Group related failures into one task.
- Check for: compiler/type errors, lint violations with `error` severity, failing tests, known vulnerabilities
- For security: `npm audit` / `cargo audit` / `pip-audit` / `safety check` as appropriate

**Tier 2 — Stability & error handling** (P0 findings)

Modeled on production stability patterns — apply these checks to ANY codebase:

- **Silent error swallowing**: `catch {}`, `catch (_)` with empty body, `.catch(() => {})`. Every catch must log, propagate, or emit a degraded event. Grep: `catch\s*\{?\s*\}`, `catch.*\/\*`, `.catch\(\s*\(\)\s*=>`
- **String-based error classification**: code that matches error messages with regex instead of using typed error classes. Grep: `/error\.message\.match\(|\.includes\(.*error|isAuthError.*regex/`. These break when messages change.
- **Missing pre-condition checks**: functions that start expensive operations (network calls, subprocess launches, file writes) without verifying preconditions first. Look for patterns where errors are discovered reactively instead of checked proactively.
- **Inconsistent error handling across parallel paths**: multiple code paths doing the same thing (retry, resume, reconnect) with different error handling. If 5 retry paths exist and just 2 verify health first, the other 3 are bugs.
- **Unhandled promise rejections**: `async` functions without try/catch at call boundaries. Fire-and-forget: `void someAsyncFn()` or `.then(...)` without `.catch()`. One unhandled rejection shouldn't crash the whole process.
- **Missing timeouts**: network calls, exec/spawn, file watchers, subprocess communication without timeout. Grep: `fetch\(`, `execFileSync\(`, `spawn\(` — check for timeout option.
- **Missing graceful shutdown**: SIGINT/SIGTERM handlers that don't stop active work, don't flush state, or can be called twice (double-shutdown race). Check: is there a `shuttingDown` guard? Does shutdown have a hard timeout?
- **Resource leaks**: file descriptors never closed, child processes never reaped, event listeners added without removal, caches/queues that grow without bounds. Look for `on(` without corresponding `off(`, `createReadStream` without `.close()`.
- **Missing health checks**: `isAvailable()` or `isReady()` methods that only check binary existence, not actual functionality (auth, connectivity, capacity). Shallow checks that pass but the next real operation fails.
- **Crash-retry loops**: failed operations retried blindly without checking if conditions changed. No circuit breakers. Log noise from futile retries. Look for retry loops that don't check system health between attempts.
- **Missing validation between stages**: output from one stage fed to the next without quality checks. Garbage-in-garbage-out cascading through a pipeline.
- **Crash paths**: divide-by-zero, null dereference on user input, unchecked array access
- **Missing input validation** on public API surfaces (CLI args, HTTP endpoints, function params)

**Tier 3 — Test depth & quality** (P2 findings)
- Source files with no corresponding test file
- Test files with low assertion density (< 2 assertions per test on average)
- Missing edge case tests: empty input, null, undefined, boundary values, unicode, large input
- Integration test gaps: are cross-module interactions tested?
- Flaky test indicators: `setTimeout` in tests, date-dependent assertions, order-dependent tests
- Mock overuse: tests that mock so much they test nothing real
- Snapshot tests without complementary behavioral tests

**Tier 4 — Documentation fidelity** (P2 findings)
- README accuracy:
  - Feature lists match actual exports/commands
  - Installation instructions actually work (check if referenced commands exist)
  - Code examples use current API (not deprecated functions)
  - Badge URLs resolve (if any)
  - Links (internal and external) are not broken: `grep -oP '\[.*?\]\(.*?\)' README.md`
  - **Volatile counts** — an inventory count in docs (agents, skills, tests, packages) goes stale, even as `N+`. Never file tasks to re-count it. File one task to delete the count, link its source of truth, or generate it.
- AGENTS.md / CLAUDE.md: layout section matches actual directory structure
- CHANGELOG: has entry for recent commits (compare `git log --oneline -20` vs CHANGELOG)
- JSDoc/docstring coverage on public exports
- Diagrams match actual architecture (if any mermaid/ascii diagrams exist)
- Instructions token overhead: check deployed AGENTS.md / CLAUDE.md size (`wc -c` / 4 = approx tokens). Flag if instructions + rules exceed 8K tokens. See `docs/instructions-analysis.md`.
- Cross-section duplication: same heading in both instructions template and managed rules section = wasted always-on context

**Tier 5 — Code health** (P2-P3 findings)
- Large files: any source file > 300 lines (candidates for splitting)
- High complexity: functions with deep nesting (> 4 levels) or many branches (> 10)
- Duplicate patterns: similar code blocks across files (copy-paste smell)
- Dead code: exported functions never imported, unused variables, unreachable branches
- Magic numbers and hardcoded strings that should be constants
- Inconsistent patterns: same thing done 3 different ways across the codebase
- God objects/files: single file handling too many concerns

**Tier 6 — Dependencies & security** (P2 findings)
- `npm outdated` / `cargo outdated` / `pip list --outdated` — report major updates separately
- Unused dependencies: listed in manifest but never imported
- Duplicate dependencies: same thing at different versions
- Deprecated APIs: `Buffer()`, `require()` in ESM, `url.parse()`, etc.
- License compliance: any copyleft licenses in a permissive project?
- Pinning: are deps pinned appropriately? (exact in apps, range in libs)
- Size: unusually large dependencies that could be replaced with lighter alternatives
- **Custom code replaceable by packages** — the standing rule is "prefer mature 3rd-party packages over custom code." Scan for:
  - Hand-rolled utilities that duplicate well-maintained packages (e.g., custom retry logic vs `p-retry`, custom deep-merge vs `deepmerge`, custom glob matching vs `fast-glob`, custom semver comparison vs `semver`, custom config loading vs `cosmiconfig`)
  - Entire subsystems a library already solves (e.g., custom CLI argument parsing when `commander`/`yargs` exists, custom process spawning with output buffering vs `execa`, custom HTTP client wrapper vs `ky`/`ofetch`, custom file watching vs `chokidar`)
  - Vendored or copied code that could be a dependency — look for comments like "copied from", "based on", "adapted from", license headers from other projects, or code blocks that match known library APIs
  - Before recommending replacements: verify the package is actively maintained (not archived), check `.preferred-deps.yaml` if the repo has one, and confirm the custom code has real deficiencies (bugs, missing edge cases, maintenance burden). A 10-line utility that works perfectly is not worth replacing.
  - Each finding becomes a task shaped like: "replace custom X with package Y — deletes ~N lines, gains edge-case handling for free"

**Tier 7 — DX & UX polish** (P1 findings)
- Error messages: do they explain WHAT went wrong AND what to do next?
- CLI help: does every command/subcommand have `--help` with examples?
- Output consistency: same icon/color conventions across all commands
- Onboarding: what happens on first run? Is it clear what to do?
- Performance perception: are there long operations without progress indicators?
- Logging: appropriate log levels? (not spamming INFO, not swallowing ERR)
- Exit codes: do commands exit non-zero on failure?
- **For web UI**: responsive design gaps, accessibility (missing alt text, ARIA labels, color contrast), broken layouts at common viewport widths
- **For CLI**: tab completion, fuzzy matching, typo suggestions ("did you mean...?")

**Tier 8 — Vision alignment & competitive edge** (P1 findings)
- **User story alignment**: read `docs/user-stories.md` (or equivalent) and check each story against the codebase — is it implemented? partially? not at all?
- **README promises vs reality**: does the README claim features that don't exist or work differently?
- **VISION.md coherence**: are there vision goals with no corresponding code or tasks?
- **Competitive gaps**: read `docs/competition.md` (if it exists) — are there competitor features we're missing that would be easy wins?
- **API surface review**: is the external API (CLI commands, exported functions, REST endpoints) minimal and coherent? Are there overlapping commands that should be merged?
- **Naming consistency**: do command names, flag names, and function names follow a consistent convention?
- **Feature completeness**: for each major feature, is it 100% done or are there obvious gaps (e.g., create but no delete, add but no remove)?

---

### Step 4: Deduplicate and prioritize

Collect results from all subagents. For each finding:
1. **Dedup by ID** — if TASKS.md already has it, skip
2. **Dedup by semantics** — if another tier found the same issue differently, merge into one task
3. **Assign priority**:
   - P1: verify failures, security vulnerabilities, crash bugs, data loss risks
   - P2: stability gaps, test gaps, doc drift, code health, DX friction
   - P3: polish, vision alignment, competitive features, naming consistency
4. **Score impact**: high-traffic code paths get higher priority than rarely-used utilities
5. **Write outcome-shaped tasks** — describe the desired end state, not implementation steps

### Step 5: Write TASKS-AUDIT.md

```markdown
# Sweep Audit — YYYY-MM-DD

Project type: [detected type]. Findings from 8-tier parallel audit.
Only NEW tasks not already in TASKS.md.

**Baseline**: X source files, Y test files, Z tests, W source lines.
**Verify gate**: typecheck [pass/fail], lint [pass/fail], tests [X/Y pass], security [N issues].
**Tiers run**: 1-8 (or list which were skipped and why).

---
