#!/bin/sh
# strip-agent-attribution.sh — shared helper that enforces the
# agent-attribution-footer rule on git commit messages.
#
# Sourced by:
#   - git-hooks/commit-msg     (global hook)
#   - ~/.config/husky/init.sh  (husky-managed repos)
#
# Exposes one function:
#   _strip_agent_attribution_in_file <path-to-commit-msg>
#
# Behavior:
#   1. Removes vendor-specific attribution lines that any AI agent
#      (Devin, Claude, Cursor, Windsurf, Copilot, Aider, Augment, …)
#      auto-inserts: `Generated with [<Agent>](<url>)` footers and
#      `Co-Authored-By: <Agent> <bot@…>` trailers (case-insensitive
#      header — catches both `Co-Authored-By:` and `Co-authored-by:`).
#   2. If we stripped any vendor line, appends the canonical
#      tool-neutral Fyodor footer so readers can still tell the commit
#      was agent-authored.
#   3. Orchestrator pipelines (e.g. minsky) are exempt — set
#      MINSKY_PIPELINE=1 to bypass entirely. Bypass mode preserves
#      the caller's commit message as-is so the orchestrator stays
#      in control of attribution. Minsky deliberately has no bot
#      identity (see minsky user-story 012); the operator's own
#      identity is the correct author for orchestrator-driven runs.
#
# Why a shared library: Husky overrides core.hooksPath (it points at
# .husky/_), which makes the global commit-msg hook irrelevant inside
# Husky-managed repos. We solve that by also sourcing this library
# from ~/.config/husky/init.sh, which Husky's runner sources before
# every hook invocation. One source of truth, two callers, zero
# repos slip through.

# Names and bot-account email patterns of known AI coding agents.
# Grow these as new agents are adopted — match the product name or
# the agent's bot-account email, never the human's email.
AGENT_ATTR_NAMES='Devin|devin-ai-integration\[bot\]|Claude|Claude Code|Windsurf|Cursor|GitHub Copilot|Copilot|Aider|Augment|Augment Code|Roo|Cline|Kiro|OpenCode|Continue|Trae|Amp|Goose|Junie|Warp|Droid|Bolt|Replit Agent|Zed|Codex'
AGENT_ATTR_EMAILS='devin-ai-integration|noreply@anthropic\.com|claude@anthropic\.com|copilot@github\.com|agent@cursor\.com|@cursor\.sh|agent@windsurf\.com|@windsurf\.sh|aider@|@augmentcode\.com|@codeium\.com|bot@openai\.com'

# Internal: build the combined regex from the agent name/email tables.
_agent_attr_combined_re() {
  coauthor_name_re="^Co-Authored-By:[[:space:]]+(${AGENT_ATTR_NAMES})[[:space:]]*<"
  coauthor_email_re="^Co-Authored-By:[[:space:]]+[^<]*<[^>]*(${AGENT_ATTR_EMAILS})"
  generated_re="^Generated (with|by)[[:space:]]+\[(${AGENT_ATTR_NAMES})\]"
  printf '%s' "(${coauthor_name_re}|${coauthor_email_re}|${generated_re})"
}

# Public: filter agent attribution from text on stdin, write the
# cleaned text to stdout. Used by the `gh` wrapper to scrub
# `--body` / `--body-file` content before it's posted to GitHub.
# Idempotent — safe to run on text that's already clean. If we end
# up stripping anything, the canonical Fyodor footer is appended so
# the final body is still tagged as agent-authored.
_strip_agent_attribution_in_stream() {
  if [ -n "${MINSKY_PIPELINE:-}" ]; then
    cat
    return 0
  fi
  combined_re=$(_agent_attr_combined_re)
  fyodor_footer_re='Written by an agent, not Fyodor'

  input=$(cat)
  stripped_vendor_attribution=0
  if printf '%s\n' "$input" | grep -iqE "$combined_re"; then
    stripped_vendor_attribution=1
  fi

  filtered=$(printf '%s\n' "$input" | grep -ivE "$combined_re" || true)
  # Trim trailing blank lines that the strip may have left behind.
  filtered=$(printf '%s\n' "$filtered" | awk 'BEGIN{n=0} {a[++n]=$0} END{
    while (n>0 && a[n] ~ /^[[:space:]]*$/) n--
    for (i=1;i<=n;i++) print a[i]
  }')

  # If we stripped vendor attribution AND the result lacks the Fyodor
  # footer, append it. Otherwise emit the input unchanged (modulo
  # trailing-blank trimming, which is invisible to GitHub).
  if [ "$stripped_vendor_attribution" = "1" ] && ! printf '%s' "$filtered" | grep -qE "$fyodor_footer_re"; then
    printf '%s\n\n---\n_🤖 Written by an agent, not Fyodor. Ping me if this looks off._\n' "$filtered"
  else
    printf '%s\n' "$filtered"
  fi
}

# Public: strip agent attribution from the commit message file passed
# in $1 and append the Fyodor footer if any was stripped.
_strip_agent_attribution_in_file() {
  msg_file="$1"
  if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
    return 0
  fi

  # Orchestrator pipelines (minsky etc.): pure bypass — leave the
  # message exactly as the orchestrator wrote it. The orchestrator is
  # responsible for any attribution it wants; this library stays out
  # of its way.
  if [ -n "${MINSKY_PIPELINE:-}" ]; then
    return 0
  fi

  # Skip merge/fixup/squash/revert commits — they're tooling-generated
  # and the user can't control their format.
  if head -1 "$msg_file" | grep -qE "^(Merge|fixup!|squash!|amend!|Revert)"; then
    return 0
  fi

  combined_re=$(_agent_attr_combined_re)
  fyodor_footer_re='Written by an agent, not Fyodor'

  stripped_vendor_attribution=0
  if grep -iqE "$combined_re" "$msg_file"; then
    tmp_file=$(mktemp)
    # grep -ivE may exit 1 if nothing passes through — tolerated with || true.
    grep -ivE "$combined_re" "$msg_file" > "$tmp_file" || true
    mv "$tmp_file" "$msg_file"
    stripped_vendor_attribution=1
    echo ""
    echo "🤖 Stripped tool-specific agent attribution line(s) (agent-attribution-footer rule)."
    echo "   The rule keeps your public authorship identity consistent across agents."
    echo "   To preserve attribution (e.g., minsky orchestrator pipelines), export MINSKY_PIPELINE=1."
    echo ""
  fi

  # If we just stripped vendor attribution, the commit was almost
  # certainly agent-authored — append the Fyodor footer so readers
  # know an agent wrote it. We do NOT touch commits that had no
  # vendor attribution (those are human commits).
  if [ "$stripped_vendor_attribution" = "1" ] && ! grep -qE "$fyodor_footer_re" "$msg_file"; then
    tmp_file=$(mktemp)
    # Trim trailing blank lines so the appended footer stays cleanly spaced.
    awk 'BEGIN{n=0} {a[++n]=$0} END{
      while (n>0 && a[n] ~ /^[[:space:]]*$/) n--
      for (i=1;i<=n;i++) print a[i]
    }' "$msg_file" > "$tmp_file"
    cleaned=$(cat "$tmp_file")
    printf '%s\n\n---\n_🤖 Written by an agent, not Fyodor. Ping me if this looks off._\n' "$cleaned" > "$msg_file"
    rm -f "$tmp_file"
    echo "🤖 Appended tool-neutral agent footer (agent-attribution-footer rule)."
    echo ""
  fi
}
