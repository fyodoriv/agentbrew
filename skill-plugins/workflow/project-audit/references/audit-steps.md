# Audit steps (1–6)

## Step 1 — Gather Context

Read these before touching any code. Skip files that don't exist.

**Step 1.0 — run `git-diagnose-codebase` first.** Five `git log` commands plus the churn × bug-keyword cross-reference produce a 5-minute high-signal map of where bugs cluster, who owns the code, and whether the team is in firefighting mode — without opening any source files. The cross-reference output (top 5 churn ∩ top 20 bug clusters) is the **seed list** for the rest of this audit. Read source for those files first; sample everything else only after they're covered.

If `git-diagnose-codebase` is unavailable in the host agent, run the 5 commands inline (see [`piechowski.io`](https://piechowski.io/post/git-commands-before-reading-code/) for the recipe).

**CRITICAL — read first to avoid duplicating existing tasks:**
- `TASKS.md` — already-planned work. Do not re-add these.
- `docs/VISION.md` — project direction, what NOT to build, decision framework. Every task you write must align with the vision.

**Then read:**
- `README.md`, `AGENTS.md` — stated purpose, dev workflow, conventions
- `CHANGELOG.md` or `git log --oneline -20` — recent trajectory (this is now redundant if `git-diagnose-codebase` ran above; skip when its output is fresh)
- `.preferred-deps.yaml` — banned or preferred packages (minsky repos)

**Detect language & tooling** (check in order, skip missing):
- `package.json` / `yarn.lock` / `pnpm-lock.yaml` → Node.js/TypeScript
- `Cargo.toml` → Rust  
- `go.mod` → Go  
- `pyproject.toml` / `requirements.txt` → Python  
- `Gemfile` → Ruby  
- `Makefile` / `CMakeLists.txt` → C/C++
- Shell scripts (`*.sh`, `bin/`) → Bash

**Detect verification commands:**
- Test runner: vitest / jest / pytest / go test / cargo test / make test / bats
- Type checker: tsc --noEmit / mypy / cargo check
- Linter: biome / eslint / ruff / shellcheck / make lint
- Build: tsup / tsc --build / cargo build / go build

Record all detected commands — you'll use them verbatim in acceptance criteria.

## Step 1.2 — Live UX Walkthrough (if the project has a UI)

**Run the project and walk through it before reading any code.** Seeing it in action surfaces bugs and UX issues that are invisible in source files.

### Start the server

Detect and launch the dev server using the scripts found in Step 1:
- `package.json` → `npm run dev` / `yarn dev` / `pnpm dev`
- `Makefile` → `make dev` / `make serve`
- Python entry point → `python -m uvicorn …` or `python app.py`
- Rust → `cargo run`
- Note the local URL from the output (typically `http://localhost:3000` or similar)

If no UI exists (CLI tool, library, backend-only service), skip this step and note "no UI" in the audit summary.

### Walk through the app using `agent-browser`

Open the local URL and exercise the product:

1. **Homepage / entry point** — screenshot the first thing a user sees. Note: visual hierarchy, empty states, broken layouts.
2. **Primary user flows** — complete 3-5 end-to-end flows a real user would perform. Click every significant button and link.
3. **Forms and inputs** — fill out forms, submit them, trigger validation errors. Note: missing feedback, confusing labels, no loading states.
4. **Error and empty states** — navigate to empty data states, trigger errors where possible. Note: raw JSON in UI, unstyled errors, missing copy.
5. **Mobile layout** — resize to 375px width. Note: overflow, unreadable text, broken nav.
6. **Console and network** — check browser console for errors and failed network requests.

### Record UX/UI findings

For each issue, note:
- **What**: specific problem description
- **Where**: URL path + element
- **Severity**: P0 (broken/data loss) / P1 (user will fail task) / P2 (confusing but recoverable) / P3 (polish)

These become TASKS.md entries in Step 6 alongside code findings.

---

## Step 1.5 — Run Health Checks

Run all detected verification commands. **Fix any failures before continuing** — a broken baseline means subsequent analysis is unreliable.

Run in parallel if possible:
1. **Type check**: record ✅ pass or ❌ N errors (list each)
2. **Lint**: record ✅ pass or ❌ N violations
3. **Tests**: record ✅ N/N pass, or ❌ N failures (list each)
4. **Security audit**: `yarn npm audit` / `cargo audit` / `pip-audit` — record ✅ clean or ❌ N vulnerabilities (severity breakdown). Include devDependencies — they run on developer machines and in CI even if they don't ship to production. Flag minor/patch-fixable CVEs as P2 (safe to upgrade); major-version fixes as P3 (needs evaluation).

**If anything fails**: inspect, diagnose, fix, re-run, and **commit immediately** with `fix:` conventional commit before continuing the audit. Don't batch fixes with audit findings.

Report a health summary table before proceeding to sweeps.

## Step 2 — Sweep: No-Brainer Fixes

Issues any senior engineer would fix on sight:

**Code quality:**
- Dead code, unused imports, commented-out blocks
- Inconsistent patterns used differently across similar files
- Copy-pasted code that should be a shared utility
- Hardcoded values that should be constants
- Actionable TODOs/FIXMEs (not aspirational)

**Type safety:**
- TypeScript: `any` casts, unchecked type assertions, unguarded `JSON.parse` without try/catch
- Python: missing type hints on public APIs
- Shell: unquoted variables, missing `set -euo pipefail`

**Consistency gaps:**
- Functions that do the same thing implemented differently (e.g. one has timeout, sibling doesn't)
- ESM/CJS shims (`const __dirname = dirname(__filename)`) when `import.meta.dirname` is available — also look for partial migrations: `import.meta.dirname ?? __dirname` means the shim was half-removed
- `process.on` where `process.once` is needed (listener accumulation)
- Mutating commands that call an auto-sync/invalidation function — if five out of six call it and one doesn't, that's a bug. Scan all commands that mutate shared state for consistency.

## Step 3 — Sweep: Stability

"What can fail in production?"

**Error handling:**
- Unhandled promise rejections / uncaught exceptions — one rejection shouldn't crash the whole process. Check if the process handler calls `process.exit()` instead of isolating the failure.
- Swallowed errors: empty catch blocks, `.catch(() => {})`, `catch { /* ignore */ }`. **Every catch must log, propagate, or emit a degraded event.** Grep: `catch\s*\{?\s*\}`, `.catch\(\s*\(\)\s*=>`
- String-based error classification: code that regex-matches error messages instead of using typed error classes. These break when messages change and cause misclassification (e.g., a crash misclassified as an auth failure gets a shorter cooldown, making things worse).
- Missing `try/catch` around `JSON.parse`, `readFileSync`, `yaml.load` on external data
- Missing validation on external inputs (API params, file contents, env vars, config values)
- Errors logged but not surfaced to the user
- Inconsistent error handling across parallel paths: if 5 code paths doing the same thing (retry, resume, reconnect) handle errors differently, the inconsistent ones are bugs

**Resilience:**
- Missing pre-condition checks: functions that start expensive operations (network, subprocess, file writes) without verifying preconditions first. Errors discovered reactively = wasted retries and confusing error messages.
- Missing timeouts on external calls: HTTP requests, `execFileSync`/`spawnSync`, DB queries
  - Check for inconsistency: if one call in a module has a timeout but a sibling doesn't, that's a bug
  - Expand scope to **all** OS-level shell calls, not just network ones — `launchctl`, `systemctl`, `schtasks`, `osascript`, and similar daemon commands block forever on a hung system. If you find timeouts on git calls, also check OS service calls.
- Crash-retry loops: failed operations retried blindly without checking if conditions changed between attempts. Look for retry loops that don't check system health. Missing circuit breakers for repeated failures.
- Missing retries for network/IO operations
- Race conditions in concurrent code (parallel async sharing state, TOCTOU bugs)
- Resource leaks: file handles not closed, timers not cleared, connections not released, child processes not reaped, unbounded in-memory buffers (`buf += chunk`), event listeners added without removal (`on(` without `off(`)
  - Check **both** request/response body accumulation and subprocess stdout/stderr accumulation — both patterns appear in the same file and both are resource leaks
- Unbounded growth: log files, queues, caches, arrays that grow forever
- Shallow health checks: `isAvailable()` or `isReady()` methods that check binary existence but not auth, connectivity, or capacity. The next real operation fails because the check was too shallow.
- Missing validation between pipeline stages: output from one stage fed to the next without quality checks. Garbage-in-garbage-out cascading.

**Recovery:**
- State inconsistencies after partial failures
- Missing graceful degradation — single component failure brings down the whole system instead of just one part
- Missing graceful shutdown: SIGINT/SIGTERM handlers that don't stop active work, don't flush state, or can double-fire (no `shuttingDown` guard). Missing hard timeout on shutdown sequence.
- Log files that grow without bound (no rotation, no size cap) — when one log has rotation and a sibling doesn't, that's a consistency bug
- **CI/local parity**: cross-reference the verification commands detected in Step 1 against `.github/workflows/` (or equivalent CI config). Every command in `yarn verify` / `make check` / `pre-push` hooks must also run in CI. If `biome check`, `yarn npm audit`, or any other local gate is absent from CI, flag it — regressions of that type will land on main silently.

## Step 4 — Sweep: Dependency Modernization

For every piece of custom code, ask: "Does a well-maintained package already do this?"

**Before recommending any replacement:**
1. Check `.preferred-deps.yaml` for banned packages or preferred alternatives
2. Verify the suggested package is actively maintained (recent commits, not archived)
3. Check `package.json` — maybe it's already installed but unused
4. Estimate migration effort — only recommend if the replacement is clearly better AND the custom code has real deficiencies

**Common candidates (Node.js/TypeScript):**
- Hand-rolled semver comparison → `semver` package
- Custom retry logic → `p-retry`
- Custom HTTP client → `ky` or `ofetch`
- Manual `structuredClone` workarounds → native `structuredClone` (Node 17+)
- Hand-rolled process spawning with buffering → `execa`
- Custom file watching → `chokidar` (if not already used)

**Before running `npm-check-updates`:** verify it's safe to run (`npx npm-check-updates --help`). Then categorize updates:
- **Major** (breaking): P3 task, investigate before upgrading
- **Minor/patch** (safe): group all into one P1/P2 task with the full list

## Step 5 — Sweep: Documentation & Content Coverage

Treat documentation like code — every claim must be verified, every feature must be documented,
and every page must render correctly. This is the most thorough sweep.

### 5.1 — Inventory All Documentation

Find every documentation artifact in the repo:

```bash
# Find all docs
fd -e md -e mdx -e txt --no-ignore | grep -iE "readme|vision|agents|changelog|contributing|tasks|doc|story|guide|tutorial"
# Also check for docs/ directories
fd -t d docs
# Check for user stories
fd -t d user-stories
fd -t d stories
```

Read every file found. Build a checklist of all documents and their purposes.

### 5.2 — README Accuracy (run every command, verify every claim)

Go through the README line by line:

- **Install instructions**: follow them on a clean checkout. Do they work? Missing steps?
- **CLI commands**: run every documented command. Does the output match the docs?
- **Config examples**: copy-paste each example. Does it parse? Does it work?
- **Feature list**: for each claimed feature, grep the codebase. Is it implemented? Is it behind a flag?
- **Skip counter/number accuracy** — `N+` approximations (e.g. "100+ agents", "2600+ tests") are self-maintaining by design. Never create tasks to update them.
- **Screenshots/images**: if the README includes images, verify they're current (compare against live UI)
- **Badges**: verify CI badge URL points to the right workflow, coverage badge is accurate
- **Links**: click every link. Flag broken ones.

### 5.3 — Vision & Strategy Docs

Read `docs/VISION.md`, `docs/COMPETITION.md`, and any strategy/roadmap docs:

- **Code-vision alignment**: for each stated goal in VISION.md, is there working code? Flag goals with zero implementation.
- **Dead vision items**: features described in vision that were built and removed, or abandoned mid-implementation
- **Competition accuracy**: if a competition doc exists, verify competitor claims (check their repos/changelogs/star counts)
- **Decision framework**: if the vision doc says "we don't build X", grep for X in the codebase. Flag violations.

### 5.4 — User Stories Coverage

If the repo has `docs/user-stories/` or similar:

- **Read every user story**. For each one:
  - Is there code implementing it? (grep for key terms, trace the flow)
  - Is the implementation complete or partial?
  - Does the acceptance criteria match what the code actually does?
  - Are there implemented features with NO user story? (orphan features)
- **Cross-reference TASKS.md**: are there tasks that reference user stories? Do the references still exist?
- **Coverage matrix**: produce a table of stories vs implementation status

If no user stories exist, flag it as a P1 gap: "No user stories — features lack traceability".

### 5.5 — AGENTS.md / CLAUDE.md Accuracy

These files are critical for AI agent productivity:

- **Repo layout**: verify every directory listed in the layout section exists. Flag phantom entries.
- **Build commands**: run every command. Do they work? Match the output described?
- **File descriptions**: sample 10 files listed in the layout. Do the descriptions match what the file actually does?
- **Convention claims**: verify 3-5 stated conventions against actual code (e.g., "use `it()` not `test()`" — grep for violations)
- **Stale references**: grep for removed features, renamed files, or dead links
- **Cross-section duplication**: check for headings that appear in both the instructions template and the managed rules section (same heading in both = wasted tokens)
- **Token overhead**: estimate deployed instructions file size (`wc -c` / 4 = approx tokens). Flag if over 8K tokens. See `docs/instructions-analysis.md`.

### 5.6 — Rendered Documentation (Browser Verification)

If the project has rendered docs (GitHub Pages, Storybook, dashboard, or any HTML output):

1. **Start the docs server** if applicable (`npm run docs`, `mkdocs serve`, `storybook`, etc.)
2. **Open every page** using `agent-browser`:
   - Navigate to each route/page linked from the nav or sidebar
   - Screenshot each page
   - Check for: broken layouts, 404s, stale content, empty sections, console errors
3. **If the project has a dashboard/web UI** (already started in Step 1.2):
   - Verify every help tooltip, info modal, and inline docs
   - Check that error messages shown in the UI are actionable (not raw stack traces)
   - Verify onboarding/setup flow guides match actual behavior
4. **API docs**: if the project has OpenAPI/Swagger docs, verify endpoints match actual routes

### 5.7 — Cross-Document Consistency

Check that all docs tell the same story:

- **Naming**: is the project called the same thing everywhere? (README vs package.json vs CLI help)
- **Feature list overlap**: do README, VISION, user stories, and AGENTS.md all agree on what the project does?
- **Contradictions**: flag places where one doc says X and another says Y
- **Missing cross-links**: AGENTS.md should link to VISION.md and vice versa. User stories should link to relevant code.

## Step 6 — Write Tasks

For every finding, write a task to `TASKS.md` under the appropriate priority heading. Match the repo's existing task format exactly — read the existing entries and mirror them.

**Standard format** (adapt if the repo uses a different format):

```markdown
- [ ] Concise title — one-line summary
  **ID**: kebab-case-id
  **Tags**: stability | no-brainer-fix | resilience | resource-leak | security | code-quality
  **Details**: 2-3 sentences. What exists today (file path + line number). What's missing or broken. How to fix it, including which existing pattern to follow.
  **Files**: `path/to/file.ts`
  **Acceptance**: Testable criterion. `<exact test command>` and `<exact typecheck command>` must pass.
```

**Multi-step findings** — when a fix requires distinct sequential steps (e.g., add timeout to 5 call sites, or migrate 3 files from old pattern to new), include a `**Plan**:` section:

```markdown
- [ ] Add missing timeouts to all execFileSync calls
  **ID**: missing-timeouts
  **Tags**: resilience
  **Details**: 5 execFileSync calls lack timeout options, risking hangs.
  **Files**: `src/update.ts`, `src/sync/auto-sync.ts`, `src/git-hooks.ts`
  **Acceptance**: All execFileSync/spawnSync calls have timeout. Tests pass.
  **Plan**:
    - [ ] Add timeout to src/update.ts:20 (npx skills check)
    - [ ] Add timeout to src/sync/auto-sync.ts (git pull)
    - [ ] Add timeout to src/git-hooks.ts:15 (git rev-parse)
    - [ ] Run typecheck + tests
```

Use sub-tasks when a finding affects 3+ locations or has a natural sequence. Skip them for single-file fixes.

**Before writing each task:**
1. Verify it's not already in `TASKS.md`
2. Grep to verify it hasn't already been fixed in the codebase
3. Include exact file paths and line numbers from your read — not approximations
4. Include the specific existing pattern to follow (e.g. "matching the pattern in `agentfile.ts:120`")
5. Group related micro-fixes into one task if they're <5 lines each and touch the same concern
6. Do NOT group unrelated changes — each task should be a focused, single-PR change

**Priority assignment:**
- P0 — broken, blocking, data loss risk
- P1 — stability, correctness, missing error handling for production paths
- P2 — polish, consistency, minor improvements, safe dependency upgrades
- P3 — nice-to-have, needs evaluation, deferred by external gating

**After writing all tasks:**
```bash
# run the project's test and typecheck scripts (check package.json)
git add TASKS.md
git commit -m "chore: add audit findings to task queue"
git push
```
