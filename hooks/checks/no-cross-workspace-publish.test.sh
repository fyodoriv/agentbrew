#!/bin/bash
# Test fixture for checks/no-cross-workspace-publish.sh
#
# Hook contract: PreToolUse on Bash, verdict BLOCK (exit 2) for
# `gh pr create --repo <other>`, `gh repo fork`, and `git push` to a remote
# outside the workspace, unless AGENT_PUBLIC_WRITE_APPROVAL names the target
# (`repo=<owner/repo>`). The same commands inside the workspace pass.
# Bypass var: HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH=1.

set -uo pipefail

SCRIPT="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/no-cross-workspace-publish.sh"
PASS=0
FAIL=0
FAIL_DETAILS=()

assert_exit_code() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label: expected exit $expected, got $actual")
  fi
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# Workspace: a repo whose origin is me/app, with a second remote that points
# at someone else's repo.
WORKSPACE="$TMP_ROOT/workspace"
mkdir -p "$WORKSPACE"
GIT_CONFIG_GLOBAL=/dev/null git -C "$WORKSPACE" init -q -b main
git -C "$WORKSPACE" remote add origin https://github.com/me/app.git
git -C "$WORKSPACE" remote add upstream git@github.com:other/app.git
# A repo outside the workspace.
OUTSIDE="$TMP_ROOT/outside"
mkdir -p "$OUTSIDE"
GIT_CONFIG_GLOBAL=/dev/null git -C "$OUTSIDE" init -q -b main
git -C "$OUTSIDE" remote add origin https://github.com/other/lib.git
EMPTY_HOME="$TMP_ROOT/home"
mkdir -p "$EMPTY_HOME"

# run_hook COMMAND [ENV...]: prints the hook's exit code.
run_hook() {
  local command="$1"
  shift
  local input rc=0
  input="$(jq -nc --arg cmd "$command" --arg cwd "$WORKSPACE" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$cmd}}')"
  printf '%s' "$input" |
    env -u AGENT_PUBLIC_WRITE_APPROVAL -u CLAUDE_PROJECT_DIR HOME="$EMPTY_HOME" \
      AGENT_GH_ALLOWLIST_FILE="$TMP_ROOT/no-allowlist.txt" "$@" bash "$SCRIPT" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

# gh pr create
assert_exit_code "gh pr create in the workspace passes" 0 "$(run_hook 'gh pr create --title x --body y')"
assert_exit_code "gh pr create --repo of the workspace passes" 0 "$(run_hook 'gh pr create --repo me/app --title x')"
assert_exit_code "gh pr create --repo other blocks" 2 "$(run_hook 'gh pr create --repo other/app --title x')"
assert_exit_code "gh pr create -R other blocks" 2 "$(run_hook 'gh pr create -R other/app --title x')"
assert_exit_code "gh pr create --repo=other after cd && env prefix blocks" 2 \
  "$(run_hook 'cd . && GH_HOST=github.com gh pr create --repo=other/app --title x')"
assert_exit_code "gh pr create --repo other with approval passes" 0 \
  "$(run_hook 'gh pr create --repo other/app --title x' AGENT_PUBLIC_WRITE_APPROVAL='repo=other/app base=main')"
assert_exit_code "gh pr create --repo other with an inline approval prefix passes" 0 \
  "$(run_hook 'AGENT_PUBLIC_WRITE_APPROVAL="repo=other/app" gh pr create --repo other/app --title x')"
assert_exit_code "approval for another repo still blocks" 2 \
  "$(run_hook 'gh pr create --repo other/app --title x' AGENT_PUBLIC_WRITE_APPROVAL='repo=other/else')"
printf 'other/app # trusted\n' >"$TMP_ROOT/allowlist.txt"
assert_exit_code "gh pr create --repo other on the allowlist passes" 0 \
  "$(run_hook 'gh pr create --repo other/app --title x' AGENT_GH_ALLOWLIST_FILE="$TMP_ROOT/allowlist.txt")"
assert_exit_code "gh pr create from a repo outside the workspace blocks" 2 \
  "$(run_hook "cd $OUTSIDE && gh pr create --title x")"

# gh repo fork
assert_exit_code "gh repo fork blocks" 2 "$(run_hook 'gh repo fork other/app --clone=false')"
assert_exit_code "gh repo fork with approval passes" 0 \
  "$(run_hook 'gh repo fork other/app' AGENT_PUBLIC_WRITE_APPROVAL='repo=other/app')"

# git push
assert_exit_code "git push origin passes" 0 "$(run_hook 'git push origin feat/x')"
assert_exit_code "git push with no remote passes" 0 "$(run_hook 'git push')"
assert_exit_code "git push -u origin HEAD passes" 0 "$(run_hook 'git push -u origin HEAD')"
assert_exit_code "git push to another repo's remote blocks" 2 "$(run_hook 'git push upstream feat/x')"
assert_exit_code "git push to another repo's URL blocks" 2 \
  "$(run_hook 'git push https://github.com/other/app.git HEAD:main')"
assert_exit_code "git push to the workspace URL passes" 0 \
  "$(run_hook 'git push git@github.com:me/app.git HEAD')"
assert_exit_code "git -C outside push blocks" 2 "$(run_hook "git -C $OUTSIDE push origin main")"
assert_exit_code "cd outside && git push blocks" 2 "$(run_hook "cd $OUTSIDE && git push")"
assert_exit_code "git push to another repo with approval passes" 0 \
  "$(run_hook 'git push upstream feat/x' AGENT_PUBLIC_WRITE_APPROVAL='repo=other/app')"
assert_exit_code "CLAUDE_PROJECT_DIR widens the workspace" 0 \
  "$(run_hook "cd $OUTSIDE && git push" CLAUDE_PROJECT_DIR="$TMP_ROOT")"

# Not publishing
assert_exit_code "echoed mention passes" 0 "$(run_hook "echo 'gh repo fork other/app'")"
assert_exit_code "gh pr view passes" 0 "$(run_hook 'gh pr view 3 --repo other/app')"
assert_exit_code "git status passes" 0 "$(run_hook 'git status')"
NON_BASH='{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"x"}}'
assert_exit_code "non-Bash tool passes" 0 "$(printf '%s' "$NON_BASH" | bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_exit_code "bypass env var passes" 0 \
  "$(run_hook 'gh repo fork other/app' HOOK_BYPASS_NO_CROSS_WORKSPACE_PUBLISH=1)"

echo ""
echo "no-cross-workspace-publish.sh: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for detail in "${FAIL_DETAILS[@]}"; do
    echo "  ✗ $detail"
  done
  exit 1
fi
exit 0
