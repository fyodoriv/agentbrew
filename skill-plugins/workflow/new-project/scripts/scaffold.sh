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
    COMMANDS_TABLE='| Install | `pnpm install` |
| One test file | `pnpm vitest run path/to/file.test.ts` |
| Lint and format | `pnpm biome check --write .` |
| Type check | `pnpm tsc --noEmit` |' ;;
  python)
    STACK_LABEL="Python (uv, pytest, ruff, pyright)"
    COMMANDS_TABLE='| Install | `uv sync` |
| One test | `uv run pytest tests/test_file.py::test_name -q` |
| Lint and format | `uv run ruff check --fix . && uv run ruff format .` |
| Type check | `uv run pyright` |' ;;
  rust)
    STACK_LABEL="Rust (cargo, clippy, rustfmt)"
    COMMANDS_TABLE='| Build | `cargo build` |
| One test | `cargo test test_name` |
| Lint and format | `cargo clippy --all-targets -- -D warnings && cargo fmt --all` |' ;;
  none)
    STACK_LABEL="not chosen yet"
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
    PROFILE_RULES='11. Every command and flag shows in `--help` and the README. Keep old flags working, or bump the major version.
12. Record each user-visible change in `CHANGELOG.md` under `Unreleased`.'
    ROUTING_ROWS='| Change a command, flag, or output | the CLI code and its test | `README.md`, `CHANGELOG.md` |'
    DOCS_ROWS=''
    AGENTFILE_SKILLS='  - cli-design'
    GITIGNORE_EXTRA='' ;;
  assistant)
    PROFILE_LABEL="personal AI assistant"
    PROFILE_RULES='11. Personal data lives only in `private/` (see [`docs/privacy.md`](docs/privacy.md)). Tests and evals use synthetic data.
12. Models are named only in `config/models.yaml`. Use the local route first.
13. Each feature is a skill in `skills/<feature>/SKILL.md` with at least one case in `evals/cases/`.
14. A prompt, skill, or model change runs the regression evals (`CHECK_EVALS=1 scripts/check.sh`).'
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
    PROFILE_RULES='11. Personal data lives only in `private/` (see [`docs/privacy.md`](docs/privacy.md)). Tests use synthetic data.
12. Work only on what moves the Success metric in `docs/VISION.md`. Check the Kill criteria at each milestone.'
    ROUTING_ROWS=''
    DOCS_ROWS='| [privacy.md](privacy.md) | Where does personal data live, and how is it backed up? | both |'
    AGENTFILE_SKILLS=''
    GITIGNORE_EXTRA="$PRIVATE_IGNORE" ;;
esac

# Shareable profiles ship the upstream feedback loop (CONTRIBUTING.md "Report problems and ideas").
case "$profile" in
  tool|assistant)
    ROUTING_ROWS="${ROUTING_ROWS:+$ROUTING_ROWS
}| Report a problem or idea in $name | follow [\`CONTRIBUTING.md\`](CONTRIBUTING.md#report-problems-and-ideas): ask before posting | none |"
    AGENTFILE_SKILLS="  - report-upstream${AGENTFILE_SKILLS:+
$AGENTFILE_SKILLS}" ;;
esac

SETUP_EXTRA='' DOCTOR_EXTRA='' ERRORS_EXTRA=''
case "$profile" in
  assistant|side-project)
    SETUP_EXTRA='mkdir -p private'
    DOCTOR_EXTRA='[ -d private ] && ok "private/ exists (ignored by git)" || fail "private/ missing" "scripts/setup.sh"'
    ERRORS_EXTRA='- This profile keeps personal data: errors stay local unless `docs/privacy.md` allows a service.' ;;
esac
case "$profile" in
  assistant) DOCTOR_EXTRA="$DOCTOR_EXTRA
[ -f config/models.yaml ] && ok \"config/models.yaml present\" || fail \"config/models.yaml missing\" \"restore it from git\"" ;;
esac

NAME="$name" DESCRIPTION="$description" PROFILE="$profile" STACK="$stack" OWNER="$owner"
DATE="$(date +%Y-%m-%d)" YEAR="$(date +%Y)"
VARS="NAME DESCRIPTION PROFILE STACK PROFILE_LABEL STACK_LABEL COMMANDS_TABLE SETUP_EXTRA DOCTOR_EXTRA ERRORS_EXTRA
  ROUTING_ROWS PROFILE_RULES DOCS_ROWS AGENTFILE_SKILLS GITIGNORE_EXTRA OWNER DATE YEAR"
# shellcheck disable=SC2086
export $VARS

collapse() {
  # An empty multi-line value leaves a blank line; drop runs of blank lines.
  perl -0pi -e 's/\n{3,}/\n\n/g; s/\n+\z/\n/' "$1"
}

# Copier path: the repo records .copier-answers.yml and can pull template fixes
# later with `copier update`. Used only for a new or empty dir, because copier
# would ask before it touches an existing file.
copier_cmd() {
  [ -z "${NEW_PROJECT_NO_COPIER:-}" ] || return 1
  if command -v copier >/dev/null 2>&1; then echo copier; return; fi
  if command -v uvx >/dev/null 2>&1 && uvx "copier@$COPIER_VERSION" --version >/dev/null 2>&1; then
    echo "uvx copier@$COPIER_VERSION"; return
  fi
  return 1
}
COPIER_VERSION="${NEW_PROJECT_COPIER_VERSION:-9.19.1}"

scaffold_with_copier() {
  # Template source: the git repo root when it carries copier.yml (versioned,
  # so `copier update` works), else this skill dir (copy only, no updates).
  src="$here"
  root="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$root" ] && [ -f "$root/copier.yml" ] && src="$root"
  set -- copy --defaults --quiet --vcs-ref HEAD
  for v in $VARS; do set -- "$@" --data "$v=$(printenv "$v")"; done
  # shellcheck disable=SC2086
  $cmd "$@" "$src" "$dir" </dev/null >/dev/null || return 1
  (cd "$dir" && find . \( -type f -o -type l \) ! -path './.git/*' | sed 's|^\./||' | sort) | while IFS= read -r rel; do
    [ -L "$dir/$rel" ] || [ "$rel" = .copier-answers.yml ] || collapse "$dir/$rel"
    echo "created $rel"
  done
  [ "$src" = "$here" ] && echo "note: template is not in git; 'copier update' will not work for this repo"
  portable_outputs "$([ "$src" = "$here" ] && echo local)"
  return 0
}

portable_outputs() {
  # An installed skill copy can hold CLAUDE.md as an absolute symlink into the template
  # cache, and Copier records the local template path. Both break or leak in a pushed
  # repo: point CLAUDE.md at AGENTS.md, and drop the local path when it cannot update anyway.
  if [ -L "$dir/CLAUDE.md" ] && [ "$(readlink "$dir/CLAUDE.md")" != AGENTS.md ]; then
    ln -sfn AGENTS.md "$dir/CLAUDE.md"; echo "fixed   CLAUDE.md -> AGENTS.md"
  fi
  if [ "${1:-}" = local ] && [ -f "$dir/.copier-answers.yml" ] && grep -q '^_src_path: /' "$dir/.copier-answers.yml"; then
    perl -pi -e 's{^_src_path: /.*}{_src_path: new-project skill (local copy; not updatable)}' "$dir/.copier-answers.yml"
    echo "fixed   .copier-answers.yml _src_path (no local path)"
  fi
}

render_path() {
  # Turn a Copier template path into the output path; print nothing to skip it.
  # Supports {{ 'literal' }} and {% if PROFILE ==|!= 'x' %}name{% endif %}.
  printf '%s\n' "$1" | perl -ne '
    chomp; next if /_copier_/;
    s/\{\{ \x27([^\x27]*)\x27 \}\}/$1/g;
    s/\{% if PROFILE (==|!=) \x27([^\x27]*)\x27 %\}(.*?)\{% endif %\}/(($1 eq "==") == ($ENV{PROFILE} eq $2)) ? $3 : ""/ge;
    next if m{(^|/)(/|$)};
    print "$_\n";'
}

render() {
  # render <src> <dest-rel>: substitute {{VAR}} from the environment; keep existing files.
  src="$1" dest="$dir/$2"
  if [ -e "$dest" ] || [ -L "$dest" ]; then echo "kept    $2"; return; fi
  mkdir -p "$(dirname "$dest")"
  perl -pe 's/\{\{([A-Z_]+)\}\}/exists $ENV{$1} ? $ENV{$1} : $&/ge' "$src" > "$dest"
  collapse "$dest"
  [ -x "$src" ] && chmod +x "$dest"
  echo "created $2"
}

scaffold_with_copy() {
  mkdir -p "$dir"
  (cd "$tpl" && find . -type f | sed 's|^\./||' | sort) | while IFS= read -r rel; do
    out="$(render_path "$rel")"
    if [ -n "$out" ]; then render "$tpl/$rel" "$out"; fi
  done
  if [ ! -e "$dir/CLAUDE.md" ] && [ ! -L "$dir/CLAUDE.md" ]; then
    ln -s AGENTS.md "$dir/CLAUDE.md"; echo "created CLAUDE.md -> AGENTS.md"
  else
    echo "kept    CLAUDE.md"
  fi
}

if [ -z "$(ls -A "$dir" 2>/dev/null)" ] && cmd="$(copier_cmd)" && scaffold_with_copier; then
  :
else
  scaffold_with_copy
fi
# The agent command is /<name>: the template ships commands/start.md.
if [ -f "$dir/commands/start.md" ] && [ ! -e "$dir/commands/$name.md" ]; then mv "$dir/commands/start.md" "$dir/commands/$name.md"; echo "created commands/$name.md (/$name)"; fi
[ -d "$dir/.git" ] || git -C "$dir" init -q -b main 2>/dev/null || echo "note: git init failed; run it yourself"

echo
echo "Next: run the stack generator (references/stacks.md), then scripts/setup.sh,"
echo "replace every FILL: marker,"
echo "then: bash $here/scripts/check-setup.sh $dir --profile $profile --strict"
