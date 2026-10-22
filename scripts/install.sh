#!/bin/bash
# <!-- scope: human-approved owner goal 2026-10-16: one-step agent-driven install with backup and auto-restore -->
# agentbrew one-step installer. An agent (or a person) runs it from a fresh
# clone; INSTALL.md is the playbook that tells the agent how.
#
# Usage:
#   scripts/install.sh plan                 Explain what will change; change nothing
#   scripts/install.sh run [flags]          Back up, install, set up, heal, verify
#   scripts/install.sh restore [BACKUP_ID]  Put the backed-up settings back (latest by default)
#   scripts/install.sh backups              List backups
#   scripts/install.sh gains                Compare this machine now with the install receipt
#
# Flags for `run` (the answers to the INSTALL.md questions):
#   --no-recommended   Skip the recommended skills and MCP servers
#   --no-auto-repair   Do not install the background repair job (every 30 min)
#   --no-shell-hook    Do not add the project-detection line to your shell rc file
#   --keep-claude-permissions
#                      Keep Claude Code permission prompts on (claudePermissions: keep)
#   --yes              Required: confirms the user agreed to the plan
#
# Phases of `run`: preflight -> backup -> build -> link -> setup -> heal ->
# verify. If build, link, setup, or verify fails, the installer restores the
# backup by itself and exits 1. Heal problems are reported, not fatal.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/agentbrew"
BACKUP_ROOT="$STATE_DIR/install-backups"
BIN_DIR="${AGENTBREW_INSTALL_BIN_DIR:-$HOME/.local/bin}"
# The CLI that setup/heal/verify call. Tests point this at a stub.
AGENTBREW_CMD="${AGENTBREW_INSTALL_CLI:-$REPO_DIR/dist/cli.js}"

# Everything agentbrew setup may write. Paths are relative to $HOME.
BACKUP_PATHS=(
  .claude/settings.json .claude/CLAUDE.md .claude/skills .claude/commands
  .claude/agents .claude/codeassist .claude.json
  .codex/AGENTS.md .codex/config.toml .codex/skills
  .config/agentbrew .gemini/settings.json .gemini/GEMINI.md
  .zshrc .bashrc .bash_profile .config/fish/config.fish
  .local/bin/agentbrew
)
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

usage() { sed -n '3,23p' "$0" | sed -E 's/^# ?//'; }

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# The minimum Node.js (major.minor) from package.json "engines", e.g. 20.11.
node_min() {
  sed -n 's/^ *"node": *">= *\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' "$REPO_DIR/package.json" | head -n 1
}

# One upgrade command for the version manager that owns `node` on PATH.
node_upgrade_cmd() {
  local path
  path="$(command -v node 2>/dev/null || true)"
  case "$path" in
    */.volta/*) echo "volta install node@22"; return ;;
    */fnm/* | */.fnm/* | */fnm_multishells/*) echo "fnm install 22 && fnm default 22"; return ;;
    */.nvm/*) echo "nvm install 22 && nvm alias default 22"; return ;;
    */mise/*) echo "mise use -g node@22"; return ;;
  esac
  if [ -z "$path" ]; then
    if command -v volta >/dev/null 2>&1; then echo "volta install node@22"; return; fi
    if command -v fnm >/dev/null 2>&1; then echo "fnm install 22 && fnm default 22"; return; fi
    if [ -n "${NVM_DIR:-}" ]; then echo "nvm install 22 && nvm alias default 22"; return; fi
    if command -v mise >/dev/null 2>&1; then echo "mise use -g node@22"; return; fi
  fi
  if command -v brew >/dev/null 2>&1; then echo "brew install node"; else echo "see https://nodejs.org"; fi
}

# Prints a ✗ line and returns 1 when Node.js is missing or older than package.json allows.
check_node() {
  local min found major minor min_major min_minor
  min="$(node_min)"; min="${min:-20.11}"
  min_major="${min%%.*}"; min_minor="${min#*.}"
  if ! command -v node >/dev/null 2>&1; then
    say "  ✗ Node.js is missing; $min+ needed. Install it: $(node_upgrade_cmd)"
    return 1
  fi
  found="$(node --version 2>/dev/null)"; found="${found#v}"
  major="${found%%.*}"; minor="${found#*.}"; minor="${minor%%.*}"
  case "$major$minor" in
    '' | *[!0-9]*)
      say "  ✗ Node.js found, but 'node --version' failed; $min+ needed. Fix: $(node_upgrade_cmd)"
      return 1
      ;;
  esac
  if [ "$major" -gt "$min_major" ] || { [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ]; }; then
    return 0
  fi
  found="$major"
  [ "$major" -eq "$min_major" ] && found="$major.$minor"
  say "  ✗ Node.js $found found; $min+ needed. Upgrade: $(node_upgrade_cmd)"
  return 1
}

preflight() {
  local ok=0
  if ! command -v git >/dev/null 2>&1; then say "  ✗ git is missing (install Xcode Command Line Tools: xcode-select --install)"; ok=1; fi
  check_node || ok=1
  if ! command -v npm >/dev/null 2>&1; then say "  ✗ npm is missing (it ships with Node.js)"; ok=1; fi
  if command -v gh >/dev/null 2>&1; then say "  ✓ GitHub CLI found (needed later for 'agentbrew contribute')"
  else say "  - GitHub CLI not found: optional, only for sending fixes upstream (brew install gh)"; fi
  [ "$ok" -eq 0 ] && say "  ✓ git, Node.js $(node_major), npm"
  return "$ok"
}

# Hooks that sync wires into Claude Code by default (hooks/manifest.yaml
# entries for claude-code without `defaultEnabled: false`).
claude_hook_count() {
  awk '
    function done() { if (open && on && cc) n++ }
    /^  - id:/ { done(); open = 1; on = 1; cc = 0; next }
    /^    defaultEnabled: *false/ { on = 0 }
    /^    agents:.*claude-code/ { cc = 1 }
    END { done(); print n + 0 }
  ' "$REPO_DIR/hooks/manifest.yaml"
}

# Approximate size in KB of the always-loaded text agentbrew writes to
# ~/.claude/CLAUDE.md: templates/AGENTS.md plus the recommended catalog rules.
claude_md_kb() {
  local template rules
  template="$(wc -c < "$REPO_DIR/templates/AGENTS.md")"
  rules="$(LC_ALL=C awk '
    function done() { if (rec) total += buf; rec = 0; buf = 0; inc = 0 }
    /^[a-z_]+:/ { done(); sec = ($0 ~ /^rules:/); next }
    !sec { next }
    inc && /^      / { buf += length($0) - 5; next }
    inc && /^ *$/ { buf += 1; next }
    { inc = 0 }
    /^  - name:/ { done(); next }
    /^    recommended: *true/ { rec = 1 }
    /^    content: *\|/ { inc = 1 }
    END { done(); print total + 0 }
  ' "$REPO_DIR/src/catalog.yaml")"
  echo $(( (template + rules + 512) / 1024 ))
}

# Sets `claudePermissions: keep` in state.yaml and keeps every other line.
seed_keep_claude_permissions() {
  local dir="$HOME/.config/agentbrew" file
  file="$dir/state.yaml"
  mkdir -p "$dir" || return 1
  if [ -f "$file" ]; then
    grep -v '^claudePermissions:' "$file" > "$file.tmp" || true
    mv "$file.tmp" "$file" || return 1
  fi
  printf 'claudePermissions: keep\n' >> "$file"
}

cmd_plan() {
  say "agentbrew install plan (nothing has changed yet)"
  step "What you need"
  preflight
  say "  - About 5 minutes and about 500 MB of disk (dependencies + build)."
  say "  - A network connection (npm and GitHub)."
  step "What will happen"
  say "  1. Back up your current agent settings to $BACKUP_ROOT/<time>/"
  say "     (Claude Code, Codex, Gemini settings, skills, rules; shell rc files)."
  say "  2. Build agentbrew in $REPO_DIR (npm ci, npm run build)."
  say "  3. Link the 'agentbrew' command into $BIN_DIR."
  say "  4. Run 'agentbrew init': detect your agents, install the recommended skills,"
  say "     MCP servers and rules, and write them into each agent's config."
  say "     It also adds a background repair job (every 30 min) and a shell hook,"
  say "     unless you opt out."
  say "     What it changes in Claude Code:"
  say "     - It adds $(claude_hook_count) hooks (hooks/manifest.yaml). After you set a goal with"
  say "       /goal, one blocks file edits until the goal contract is written, and"
  say "       another makes Claude write a retro before it stops."
  say "     - It adds about $(claude_md_kb) KB of always-loaded text to ~/.claude/CLAUDE.md"
  say "       (agentbrew instructions plus the recommended rules)."
  say "     - It turns permission prompts off (bypassPermissions) and allows the tools"
  say "       of every MCP server, unless you pass --keep-claude-permissions"
  say "       (claudePermissions: keep in ~/.config/agentbrew/state.yaml)."
  say "  5. Heal: 'agentbrew status --fix' repairs any drift it finds."
  say "  6. Verify: 'agentbrew lint', then the doctor 'agentbrew status --ci'."
  step "If something goes wrong"
  say "  A critical error in steps 2-4 or 6 restores the backup automatically."
  say "  You can also undo by hand any time: bash $REPO_DIR/scripts/install.sh restore"
  step "Your choices (the agent asks you these)"
  say "  - Install the recommended skills and MCP servers? (default yes)"
  say "  - Install the background repair job? (default yes)"
  say "  - Add the project-detection hook to your shell rc file? (default yes)"
  say "  - Keep Claude Code permission prompts on? (default no: prompts off)"
}

# Backup ids are timestamps, so the glob's sort order is oldest first.
latest_backup() {
  local d last=""
  for d in "$BACKUP_ROOT"/*/; do [ -d "$d" ] && last="$(basename "$d")"; done
  printf '%s' "$last"
}

do_backup() {
  local id dir rel plist existing=()
  id="$(date +%Y%m%d-%H%M%S)"
  dir="$BACKUP_ROOT/$id"
  mkdir -p "$dir" || return 1
  : > "$dir/absent.txt"
  for rel in "${BACKUP_PATHS[@]}"; do
    if [ -e "$HOME/$rel" ] || [ -L "$HOME/$rel" ]; then existing+=("$rel"); else printf '%s\n' "$rel" >> "$dir/absent.txt"; fi
  done
  if [ -d "$LAUNCH_AGENTS_DIR" ]; then
    : > "$dir/launchagents.txt"
    for plist in "$LAUNCH_AGENTS_DIR"/com.agentbrew.*.plist; do
      [ -e "$plist" ] && printf 'Library/LaunchAgents/%s\n' "$(basename "$plist")" >> "$dir/launchagents.txt"
    done
    while IFS= read -r rel; do [ -n "$rel" ] && existing+=("$rel"); done < "$dir/launchagents.txt"
  fi
  if [ "${#existing[@]}" -gt 0 ]; then
    (cd "$HOME" && tar -czf "$dir/files.tar.gz" "${existing[@]}") || return 1
  else
    tar -czf "$dir/files.tar.gz" -T /dev/null || return 1
  fi
  printf '%s\n' "${existing[@]+"${existing[@]}"}" > "$dir/present.txt"
  printf 'created=%s\nrepo=%s\n' "$id" "$REPO_DIR" > "$dir/manifest.txt"
  BACKUP_ID="$id"
  say "  ✓ Backed up ${#existing[@]} item(s) to $dir"
}

do_restore() {
  local id="${1:-$(latest_backup)}" dir rel plist
  [ -n "$id" ] || { say "No backup found in $BACKUP_ROOT"; return 1; }
  dir="$BACKUP_ROOT/$id"
  [ -f "$dir/files.tar.gz" ] || { say "Backup $id not found in $BACKUP_ROOT"; return 1; }
  # Unload agentbrew LaunchAgents that the failed install added.
  if [ -d "$LAUNCH_AGENTS_DIR" ]; then
    for plist in "$LAUNCH_AGENTS_DIR"/com.agentbrew.*.plist; do
      [ -e "$plist" ] || continue
      rel="Library/LaunchAgents/$(basename "$plist")"
      if ! grep -qxF "$rel" "$dir/launchagents.txt" 2>/dev/null; then
        launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
        rm -f "$plist"
      fi
    done
  fi
  # Remove what did not exist before, then put back what did.
  while IFS= read -r rel; do
    [ -n "$rel" ] && rm -rf "${HOME:?}/$rel"
  done < "$dir/absent.txt"
  while IFS= read -r rel; do
    [ -n "$rel" ] && rm -rf "${HOME:?}/$rel"
  done < "$dir/present.txt"
  (cd "$HOME" && tar -xzf "$dir/files.tar.gz") || return 1
  say "  ✓ Restored your settings from backup $id"
}

# ── Install receipt (state-dir scope; kept until the user deletes it) ─────
# `run` measures the agent setup before it changes anything, so the gains of
# the install can be shown later (`install.sh gains`). Plain shell: node may
# not exist yet. install-before.json is written once and never overwritten,
# so a repeated run keeps the true before. When dotfiles installs agentbrew,
# dotfiles' own receipt holds the earlier, truer before.
receipt_dir() { printf '%s/agentbrew' "${XDG_STATE_HOME:-$HOME/.local/state}"; }
_claude_dir() { printf '%s' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; }
measure_claude_skills() {
  local n=0 entry
  for entry in "$(_claude_dir)/skills"/*; do [ -e "$entry" ] && n=$((n + 1)); done
  printf '%s\n' "$n"
}
measure_claude_hooks() {
  local f n
  f="$(_claude_dir)/settings.json"
  [ -f "$f" ] || { printf '0\n'; return; }
  # Count the "command" key only; "type": "command" holds the same word.
  n="$(grep -o '"command"[[:space:]]*:' "$f" 2>/dev/null | wc -l | tr -d ' ')"
  printf '%s\n' "${n:-0}"
}
measure_claude_md_bytes() {
  local f
  f="$(_claude_dir)/CLAUDE.md"
  [ -f "$f" ] && wc -c <"$f" | tr -d ' ' || printf '0\n'
}
measure_claude_permissions() {
  local f mode
  f="$(_claude_dir)/settings.json"
  [ -f "$f" ] || { printf 'none\n'; return; }
  mode="$(grep -o '"defaultMode"[[:space:]]*:[[:space:]]*"[A-Za-z]*"' "$f" 2>/dev/null | head -1 | sed -E 's/.*"([A-Za-z]*)"$/\1/')"
  printf '%s\n' "${mode:-default}"
}
measure_launchagents() {
  local n=0 plist
  for plist in "$HOME/Library/LaunchAgents"/*.plist; do [ -e "$plist" ] && n=$((n + 1)); done
  printf '%s\n' "$n"
}
_receipt_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

receipt_begin() {
  local dir
  dir="$(receipt_dir)"
  mkdir -p "$dir" 2>/dev/null || return 0
  RECEIPT_STARTED_AT="$(_receipt_now)"
  RECEIPT_START_S="$(date +%s)"
  [ -s "$dir/install-before.json" ] && return 0
  printf '{"taken_at":"%s","launchagents":%s,"claude_skills":%s,"claude_hooks":%s,"claude_md_bytes":%s,"claude_permissions":"%s"}\n' \
    "$RECEIPT_STARTED_AT" "$(measure_launchagents)" "$(measure_claude_skills)" "$(measure_claude_hooks)" \
    "$(measure_claude_md_bytes)" "$(measure_claude_permissions)" >"$dir/install-before.json" 2>/dev/null || true
}

# receipt_finish <true|false> [failed step]: a record, never a failing step.
receipt_finish() {
  [ -n "${RECEIPT_START_S:-}" ] || return 0
  local dir before failed=""
  dir="$(receipt_dir)"
  before="$(cat "$dir/install-before.json" 2>/dev/null)" || before=""
  [ -n "$before" ] || before="null"
  [ -z "${2:-}" ] || failed=",\"failed_step\":\"$(printf '%s' "$2" | tr -d '"\\')\""
  printf '{"before":%s,"run":{"started_at":"%s","finished_at":"%s","seconds":%s,"ok":%s%s}}\n' \
    "$before" "$RECEIPT_STARTED_AT" "$(_receipt_now)" "$(($(date +%s) - RECEIPT_START_S))" "$1" "$failed" \
    >"$dir/install-receipt.json" 2>/dev/null || true
  RECEIPT_START_S=""
}

cmd_gains() {
  local receipt
  receipt="$(receipt_dir)/install-receipt.json"
  [ -s "$receipt" ] || { say "No install receipt yet. 'install.sh run' saves one; then run this again."; return 0; }
  command -v node >/dev/null 2>&1 || { say "install.sh gains needs node."; return 1; }
  RECEIPT="$receipt" NOW_LA="$(measure_launchagents)" NOW_SKILLS="$(measure_claude_skills)" \
    NOW_HOOKS="$(measure_claude_hooks)" NOW_MD="$(measure_claude_md_bytes)" NOW_PERMS="$(measure_claude_permissions)" \
    node -e '
const r = JSON.parse(require("fs").readFileSync(process.env.RECEIPT, "utf-8"));
const b = r.before || {}; const e = process.env;
const v = (x) => (x === undefined || x === null ? "n/a" : String(x));
const row = (name, before, now) => console.log(name.padEnd(22) + v(before).padStart(10) + v(now).padStart(10));
console.log(`Since the install (${v(b.taken_at)})`);
console.log("Metric".padEnd(22) + "Before".padStart(10) + "Now".padStart(10));
row("LaunchAgents", b.launchagents, e.NOW_LA);
row("Claude skills", b.claude_skills, e.NOW_SKILLS);
row("Claude hooks", b.claude_hooks, e.NOW_HOOKS);
row("CLAUDE.md (bytes)", b.claude_md_bytes, e.NOW_MD);
row("Claude permissions", b.claude_permissions, e.NOW_PERMS);
const s = r.run && r.run.seconds;
if (Number.isFinite(s)) {
  const t = s >= 60 ? Math.round(s / 60) + " min" : s + " s";
  console.log("Time to configured: " + t + (r.run.ok ? "" : " (the run did not finish: " + v(r.run.failed_step) + ")"));
}
'
}

critical() {
  receipt_finish false "$1"
  say ""
  say "✗ Critical error during $1. Restoring your previous settings..."
  if do_restore "$BACKUP_ID"; then
    say "Your machine is back to how it was before the install."
  else
    say "Automatic restore failed. Restore by hand: bash $REPO_DIR/scripts/install.sh restore $BACKUP_ID"
  fi
  say "Please report it: https://github.com/fyodoriv/agentbrew/issues (attach the output above)."
  exit 1
}

cmd_run() {
  local yes=0 recommended=1 auto_repair=1 shell_hook=1 keep_perms=0 init_args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes) yes=1 ;;
      --no-recommended) recommended=0 ;;
      --no-auto-repair) auto_repair=0 ;;
      --no-shell-hook) shell_hook=0 ;;
      --keep-claude-permissions) keep_perms=1 ;;
      *) say "Unknown flag: $1"; usage; exit 2 ;;
    esac
    shift
  done
  [ "$yes" -eq 1 ] || { say "Show the plan first (install.sh plan), then rerun with --yes."; exit 2; }
  # Before anything changes: the "before" half of the install receipt.
  receipt_begin

  step "1/7 Check prerequisites"
  preflight || { say "Install the missing tools above, then run again. Nothing was changed."; exit 1; }

  step "2/7 Back up current settings"
  BACKUP_ID=""
  do_backup || { say "Backup failed, so nothing was changed."; exit 1; }

  step "3/7 Build agentbrew"
  if [ -z "${AGENTBREW_INSTALL_CLI:-}" ]; then
    (cd "$REPO_DIR" && npm ci --no-audit --no-fund && npm run build) || critical "the build"
  else
    say "  (using $AGENTBREW_CMD)"
  fi

  step "4/7 Link the agentbrew command"
  { mkdir -p "$BIN_DIR" && ln -sf "$AGENTBREW_CMD" "$BIN_DIR/agentbrew"; } || critical "linking the command"
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "  ! $BIN_DIR is not on your PATH. Add it to your shell rc file." ;; esac

  step "5/7 Set up your agents"
  [ "$recommended" -eq 1 ] || init_args+=(--skip-install)
  [ "$auto_repair" -eq 1 ] || export AGENTBREW_NO_AUTO_SYNC=1
  [ "$shell_hook" -eq 1 ] || export AGENTBREW_NO_SHELL_HOOK=1
  if [ "$keep_perms" -eq 1 ]; then
    seed_keep_claude_permissions || critical "saving claudePermissions: keep"
    say "  ✓ Claude Code permission prompts stay on (claudePermissions: keep)"
  fi
  AGENTBREW_NO_AUTO_INIT=1 "$AGENTBREW_CMD" init ${init_args[@]+"${init_args[@]}"} || critical "agent setup (agentbrew init)"

  step "6/7 Heal"
  if ! "$AGENTBREW_CMD" status --fix; then
    say "  ! Some drift could not be repaired. Your setup works; run 'agentbrew status' to see what is left."
  fi

  step "7/7 Verify"
  "$AGENTBREW_CMD" lint || critical "verification (agentbrew lint)"
  "$AGENTBREW_CMD" status --ci || say "  ! The doctor (agentbrew status --ci) found drift; each line above names its fix."

  receipt_finish true
  step "Done"
  say "agentbrew is installed. Backup: $BACKUP_ROOT/$BACKUP_ID"
  say "Undo any time: bash $REPO_DIR/scripts/install.sh restore $BACKUP_ID"
  say "See what it does on your machine: agentbrew metrics"
  say "See what the install changed (now, and again in a week): bash $REPO_DIR/scripts/install.sh gains"
  say ""
  say "Found something to fix in agentbrew while installing? Send it upstream:"
  say "  cd $REPO_DIR && git switch -c fix/<short-name>"
  say "  # change the code, add a test and update the docs, then run: npm run verify"
  say "  agentbrew contribute --dry-run && agentbrew contribute"
}

case "${1:-}" in
  plan) cmd_plan ;;
  run) shift; cmd_run "$@" ;;
  restore) shift; do_restore "${1:-}" ;;
  gains) cmd_gains ;;
  backups) ls -1 "$BACKUP_ROOT" 2>/dev/null || say "No backups yet." ;;
  -h|--help|help|"") usage ;;
  *) say "Unknown command: $1"; usage; exit 2 ;;
esac
