# Stacks

Pick the stack per project. Run its official generator after `scaffold.sh`;
the generator owns the manifest, and `scripts/check.sh` finds it.

## Which stack

| Project | Default | Why |
|---|---|---|
| Web app, CLI, or dev tool | TypeScript | biggest ecosystem, one language front to back |
| LLM assistant, data, ML, notebooks | Python | best LLM, eval, and data libraries (pydantic-ai, promptfoo, inspect_ai, fsrs) |
| Heavy app: hot loops, big files, native desktop, low memory, single static binary | Rust | speed and memory safety; small binaries; Tauri for desktop UIs |
| Mixed (Rust core, TS UI) | Rust + TypeScript | [Tauri](https://tauri.app/) or a Rust CLI with a TS web UI |

**Owner rule: a UI with more than one view is a TypeScript web app** (React +
Vite by default), even when the logic is Python or Rust. The logic serves JSON
to the UI (a local API for private apps). A Markdown report or a notes-app page
is not a UI for anything people plan or navigate in.

**UI rule (owner, 2026-10-18):** if the product has a UI with more than one view (plan
ahead, switch views, phone use), pick TypeScript (Vite + React, Hono API) even for an
`assistant` profile, and keep Notion or other note tools for simple exports only. A Python
assistant that later needs views gets ported; keep its e2e shell stories as the spec.

Ask the user only when two rows fit equally. Record the choice in an ADR.

## Generators and toolchain

| | TypeScript | Python | Rust |
|---|---|---|---|
| Generator | `pnpm init` (or `pnpm create vite`) | `uv init --package` | `cargo init` |
| Version pin | `mise use node@lts` or `packageManager` field | `.python-version` (uv) | `rust-toolchain.toml` |
| Package manager | pnpm | uv | cargo |
| Tests | vitest | pytest | `cargo test` (cargo-nextest when slow) |
| Lint and format | Biome | ruff | clippy `-D warnings` + rustfmt |
| Types | `tsc --noEmit`, `strict: true` | pyright (try ty alongside) | the compiler |
| Git hooks | lefthook | prek or pre-commit | lefthook |
| Release | changesets or release-please | release-please | release-please or cargo-dist |
| Supply chain | Dependabot or Renovate | pip-audit | cargo-deny |
| LLM evals | promptfoo | promptfoo, then inspect_ai | promptfoo (black box) |

## Observability per stack

The contract is in each repo's `docs/observability.md`: JSONL events, errors
behind one adapter, a doctor, a metrics table. These libraries fill it:

| | TypeScript | Python | Rust |
|---|---|---|---|
| JSON logs | pino | structlog (or stdlib `logging` with a JSON formatter) | tracing + tracing-subscriber (json) |
| Errors (optional, behind an adapter) | @sentry/node | sentry-sdk | sentry |
| Traces and metrics (when one process is not enough) | OpenTelemetry JS | OpenTelemetry Python | opentelemetry-rust |

Start with the JSONL file. Add a service only when the profile's privacy rules allow it.

## Caching (fast yet full)

`scripts/check.sh` already skips steps while the whole repo is unchanged. When
one step is slow, add finer caching for it:

| | TypeScript | Python | Rust |
|---|---|---|---|
| Task cache by inputs | [Nx](https://nx.dev) or Turborepo (local cache; `inputs`/`outputs` per target) | Nx with `@nxlv/python`, or a per-step input hash | cargo's incremental build + `sccache` |
| Affected tests only | `vitest related` / `vitest --changed`, `nx affected` | `pytest-testmon` | `cargo nextest` with a filter per changed crate |

Keep one rule: a cache may skip work only when every input it depends on is in
its key. When in doubt, run with `NO_CACHE=1` and compare.

Turborepo in an npm workspace (proven in tasks.md, 2026-10-16: full gate 78 s,
all-cached 4.2 s):

- Pin `turbo` exactly; set `"dangerouslyDisablePackageManagerCheck": true`
  when you do not pin npm, and `TURBO_TELEMETRY_DISABLED=1` in the gate.
- Root scripts (lint, e2e) become root tasks (`//#lint`) with explicit
  `inputs` and `dependsOn` on the package builds they use.
- A package test that reads a root file (`.github/`, `scripts/`, shared
  fixtures) lists it with `$TURBO_ROOT$/…` in that task's `inputs`, or a
  change there will not re-run it.
- Give a root input only to the package task that needs it; a shared `build`
  input invalidates every package.
- Prove the inputs: `echo >> <file>; npx turbo run <tasks> --dry=json` and list
  the tasks that miss; restore the file.

## Wire the gate

`scripts/check.sh` runs, when present:

- **TypeScript**: `lint`, `typecheck`, and `test` scripts in `package.json`. `npm init` writes a
  `test` script that always fails; replace it. Add them:
  `"lint": "biome check .", "typecheck": "tsc --noEmit", "test": "vitest run"`.
- **Python**: `ruff format --check`, `ruff check`, `pyright` (when installed), `pytest`.
  Add them as dev dependencies: `uv add --dev ruff pyright pytest`.
- **Rust**: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.

Add one smoke test right after the generator runs, so `scripts/check.sh` proves something on day one.
