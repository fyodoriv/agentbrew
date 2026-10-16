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
#
# Flags for `run` (the answers to the INSTALL.md questions):
#   --no-recommended   Skip the recommended skills and MCP servers
#   --no-auto-repair   Do not install the background repair job (every 30 min)
#   --no-shell-hook    Do not add the project-detection line to your shell rc file
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
  .cursor/mcp.json .cursor/rules .cursor/skills .cursor/hooks.json
  .codex/AGENTS.md .codex/config.toml .codex/skills
  .config/agentbrew .gemini/settings.json .gemini/GEMINI.md
  .zshrc .bashrc .bash_profile .config/fish/config.fish
  .local/bin/agentbrew
)
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

usage() { sed -n '3,21p' "$0" | sed -E 's/^# ?//'; }

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

preflight() {
  local ok=0
  if ! command -v git >/dev/null 2>&1; then say "  ✗ git is missing (install Xcode Command Line Tools: xcode-select --install)"; ok=1; fi
  if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
    say "  ✗ Node.js 20 or newer is missing (https://nodejs.org or: brew install node)"; ok=1
  fi
  if ! command -v npm >/dev/null 2>&1; then say "  ✗ npm is missing (it ships with Node.js)"; ok=1; fi
  if command -v gh >/dev/null 2>&1; then say "  ✓ GitHub CLI found (needed later for 'agentbrew contribute')"
  else say "  - GitHub CLI not found: optional, only for sending fixes upstream (brew install gh)"; fi
  [ "$ok" -eq 0 ] && say "  ✓ git, Node.js $(node_major), npm"
  return "$ok"
}

cmd_plan() {
  say "agentbrew install plan (nothing has changed yet)"
  step "What you need"
  preflight
  say "  - About 5 minutes and about 500 MB of disk (dependencies + build)."
  say "  - A network connection (npm and GitHub)."
  step "What will happen"
  say "  1. Back up your current agent settings to $BACKUP_ROOT/<time>/"
  say "     (Claude Code, Cursor, Codex, Gemini settings, skills, rules; shell rc files)."
  say "  2. Build agentbrew in $REPO_DIR (npm ci, npm run build)."
  say "  3. Link the 'agentbrew' command into $BIN_DIR."
  say "  4. Run 'agentbrew init': detect your agents, install the recommended skills,"
  say "     MCP servers and rules, and write them into each agent's config."
  say "     It also adds a background repair job (every 30 min) and a shell hook,"
  say "     unless you opt out."
  say "  5. Heal: 'agentbrew status --fix' repairs any drift it finds."
  say "  6. Verify: 'agentbrew lint' and 'agentbrew status'."
  step "If something goes wrong"
  say "  A critical error in steps 2-4 or 6 restores the backup automatically."
  say "  You can also undo by hand any time: bash $REPO_DIR/scripts/install.sh restore"
  step "Your choices (the agent asks you these)"
  say "  - Install the recommended skills and MCP servers? (default yes)"
  say "  - Install the background repair job? (default yes)"
  say "  - Add the project-detection hook to your shell rc file? (default yes)"
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

critical() {
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
  local yes=0 recommended=1 auto_repair=1 shell_hook=1 init_args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes) yes=1 ;;
      --no-recommended) recommended=0 ;;
      --no-auto-repair) auto_repair=0 ;;
      --no-shell-hook) shell_hook=0 ;;
      *) say "Unknown flag: $1"; usage; exit 2 ;;
    esac
    shift
  done
  [ "$yes" -eq 1 ] || { say "Show the plan first (install.sh plan), then rerun with --yes."; exit 2; }

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
  AGENTBREW_NO_AUTO_INIT=1 "$AGENTBREW_CMD" init ${init_args[@]+"${init_args[@]}"} || critical "agent setup (agentbrew init)"

  step "6/7 Heal"
  if ! "$AGENTBREW_CMD" status --fix; then
    say "  ! Some drift could not be repaired. Your setup works; run 'agentbrew status' to see what is left."
  fi

  step "7/7 Verify"
  "$AGENTBREW_CMD" lint || critical "verification (agentbrew lint)"

  step "Done"
  say "agentbrew is installed. Backup: $BACKUP_ROOT/$BACKUP_ID"
  say "Undo any time: bash $REPO_DIR/scripts/install.sh restore $BACKUP_ID"
  say "See what it does on your machine: agentbrew metrics"
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
  backups) ls -1 "$BACKUP_ROOT" 2>/dev/null || say "No backups yet." ;;
  -h|--help|help|"") usage ;;
  *) say "Unknown command: $1"; usage; exit 2 ;;
esac
