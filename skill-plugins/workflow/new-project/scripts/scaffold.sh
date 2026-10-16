#!/usr/bin/env bash
# Write the agent-ready skeleton of a new repo for one profile and stack.
#
# Usage: scaffold.sh <repo-dir> --profile tool|assistant|side-project --name <name>
#          [--stack ts|python|rust|none] [--description "<one sentence>"] [--owner "<name>"]
#
# Never overwrites a file: existing files are kept and listed as "kept".
# Stack files (package.json, pyproject.toml, Cargo.toml) come from the stack's
# own generator, run after this script (see references/stacks.md).
# Runs under macOS /bin/bash 3.2.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
tpl="$here/templates"

usage() {
  echo "usage: scaffold.sh <repo-dir> --profile tool|assistant|side-project --name <name> [--stack ts|python|rust|none] [--description \"...\"] [--owner \"...\"]" >&2
  exit 2
}

dir="" profile="" name="" stack="none" description="" owner=""
while [ $# -gt 0 ]; do
  case "$1" in --profile|--name|--stack|--description|--owner) [ $# -ge 2 ] || usage ;; esac
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --name) name="${2:-}"; shift 2 ;;
    --stack) stack="${2:-}"; shift 2 ;;
    --description) description="${2:-}"; shift 2 ;;
    --owner) owner="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) dir="$1"; shift ;;
  esac
done
[ -n "$dir" ] && [ -n "$name" ] || usage
case "$profile" in tool|assistant|side-project) ;; *) usage ;; esac
case "$stack" in ts|python|rust|none) ;; *) usage ;; esac
[ -n "$description" ] || description="FILL: one sentence on what it does and for whom."
[ -n "$owner" ] || owner="$(git config user.name 2>/dev/null || true)"
[ -n "$owner" ] || owner="FILL: copyright holder"

# Stack: commands table rows, quickstart, label.
case "$stack" in
  ts)
    STACK_LABEL="TypeScript (pnpm, vitest, Biome, tsc)"
    QUICKSTART="pnpm install"
    COMMANDS_TABLE='| Install | `pnpm install` |
| One test file | `pnpm vitest run path/to/file.test.ts` |
| Lint and format | `pnpm biome check --write .` |
| Type check | `pnpm tsc --noEmit` |' ;;
  python)
    STACK_LABEL="Python (uv, pytest, ruff, pyright)"
    QUICKSTART="uv sync"
    COMMANDS_TABLE='| Install | `uv sync` |
| One test | `uv run pytest tests/test_file.py::test_name -q` |
| Lint and format | `uv run ruff check --fix . && uv run ruff format .` |
| Type check | `uv run pyright` |' ;;
  rust)
    STACK_LABEL="Rust (cargo, clippy, rustfmt)"
    QUICKSTART="cargo build"
    COMMANDS_TABLE='| Build | `cargo build` |
| One test | `cargo test test_name` |
| Lint and format | `cargo clippy --all-targets -- -D warnings && cargo fmt --all` |' ;;
  none)
    STACK_LABEL="not chosen yet"
    QUICKSTART="# FILL: the install command"
    COMMANDS_TABLE='| Install | FILL: install command |
| One test | FILL: single-test command |
| Lint and format | FILL: lint command |' ;;
esac

# Profile: label, extra rules, routing rows, docs rows, Agentfile skills, gitignore.
PRIVATE_IGNORE='
# Personal data stays local (see docs/privacy.md)
private/'
case "$profile" in
  tool)
    PROFILE_LABEL="developer tool"
    PROFILE_RULES='7. Every command and flag shows in `--help` and the README. Keep old flags working, or bump the major version.
8. Record each user-visible change in `CHANGELOG.md` under `Unreleased`.'
    ROUTING_ROWS='| Change a command, flag, or output | the CLI code and its test | `README.md`, `CHANGELOG.md` |'
    DOCS_ROWS=''
    AGENTFILE_SKILLS='  - cli-design'
    GITIGNORE_EXTRA='' ;;
  assistant)
    PROFILE_LABEL="personal AI assistant"
    PROFILE_RULES='7. Personal data lives only in `private/` (see [`docs/privacy.md`](docs/privacy.md)). Tests and evals use synthetic data.
8. Models are named only in `config/models.yaml`. Use the local route first.
9. Each feature is a skill in `skills/<feature>/SKILL.md` with at least one case in `evals/cases/`.
10. A prompt, skill, or model change runs the regression evals (`CHECK_EVALS=1 scripts/check.sh`).'
    ROUTING_ROWS='| Add an assistant feature | `skills/<feature>/SKILL.md` and a case in `evals/cases/` | `README.md` |
| Change assistant behavior | `prompts/` or the skill, then run the evals | `evals/rubric.md` if the bar moves |
| Change a model or provider | `config/models.yaml` | `docs/privacy.md` if data leaves the machine |
| Add reference material | `knowledge/<topic>.md` | `knowledge/README.md` |'
    DOCS_ROWS='| [privacy.md](privacy.md) | Where does personal data live, and what may leave the machine? | both |'
    AGENTFILE_SKILLS='
sources:
  - ./skills'
    GITIGNORE_EXTRA="$PRIVATE_IGNORE" ;;
  side-project)
    PROFILE_LABEL="personal side project"
    PROFILE_RULES='7. Personal data lives only in `private/` (see [`docs/privacy.md`](docs/privacy.md)). Tests use synthetic data.
8. Work only on what moves the Success metric in `docs/VISION.md`. Check the Kill criteria at each milestone.'
    ROUTING_ROWS=''
    DOCS_ROWS='| [privacy.md](privacy.md) | Where does personal data live, and how is it backed up? | both |'
    AGENTFILE_SKILLS=''
    GITIGNORE_EXTRA="$PRIVATE_IGNORE" ;;
esac

NAME="$name" DESCRIPTION="$description" PROFILE="$profile" OWNER="$owner"
DATE="$(date +%Y-%m-%d)" YEAR="$(date +%Y)"
export NAME DESCRIPTION PROFILE PROFILE_LABEL STACK_LABEL QUICKSTART COMMANDS_TABLE \
  ROUTING_ROWS PROFILE_RULES DOCS_ROWS AGENTFILE_SKILLS GITIGNORE_EXTRA OWNER DATE YEAR

mkdir -p "$dir"
render() {
  # render <src> <dest-rel>: substitute {{VAR}} from the environment; keep existing files.
  src="$1" dest="$dir/$2"
  if [ -e "$dest" ] || [ -L "$dest" ]; then echo "kept    $2"; return; fi
  mkdir -p "$(dirname "$dest")"
  perl -pe 's/\{\{([A-Z_]+)\}\}/exists $ENV{$1} ? $ENV{$1} : $&/ge' "$src" > "$dest"
  # An empty multi-line value leaves a blank line; drop runs of blank lines.
  perl -0pi -e 's/\n{3,}/\n\n/g; s/\n+\z/\n/' "$dest"
  [ -x "$src" ] && chmod +x "$dest"
  echo "created $2"
}

copy_tree() {
  # copy_tree <template-root>: render every file under it, keeping relative paths.
  root="$1"
  (cd "$root" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r rel; do
    out="$rel"; [ "$rel" = gitignore ] && out=.gitignore
    render "$root/$rel" "$out"
  done
}

copy_tree "$tpl/common"
[ -d "$tpl/$profile" ] && copy_tree "$tpl/$profile"
case "$profile" in assistant|side-project) render "$tpl/shared/privacy.md" docs/privacy.md ;; esac

chmod +x "$dir/scripts/check.sh"
if [ ! -e "$dir/CLAUDE.md" ] && [ ! -L "$dir/CLAUDE.md" ]; then
  ln -s AGENTS.md "$dir/CLAUDE.md"; echo "created CLAUDE.md -> AGENTS.md"
else
  echo "kept    CLAUDE.md"
fi
[ -d "$dir/.git" ] || git -C "$dir" init -q -b main 2>/dev/null || echo "note: git init failed; run it yourself"

echo
echo "Next: run the stack generator (references/stacks.md), replace every FILL: marker,"
echo "then: bash $here/scripts/check-setup.sh $dir --profile $profile --strict"
