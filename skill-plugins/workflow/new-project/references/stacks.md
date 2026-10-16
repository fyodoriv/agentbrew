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

## Wire the gate

`scripts/check.sh` runs, when present:

- **TypeScript**: `lint`, `typecheck`, and `test` scripts in `package.json`. `npm init` writes a
  `test` script that always fails; replace it. Add them:
  `"lint": "biome check .", "typecheck": "tsc --noEmit", "test": "vitest run"`.
- **Python**: `ruff format --check`, `ruff check`, `pyright` (when installed), `pytest`.
  Add them as dev dependencies: `uv add --dev ruff pyright pytest`.
- **Rust**: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.

Add one smoke test right after the generator runs, so `scripts/check.sh` proves something on day one.
