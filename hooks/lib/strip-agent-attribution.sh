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
#      tool-neutral footer ("not <first name>") so readers can still tell the commit
#      was agent-authored.
#      The footer goes before a trailing git trailer block (Task:,
#      Signed-off-by:) so git still parses those trailers.
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

# Internal: succeeds when this machine applies the owner's agent policy.
# dotfiles writes `dotfiles.agentPolicy` into ~/.gitconfig: true on the
# owner's Macs, false elsewhere, so a new user's commits stay untouched.
# Unset (older configs, or no dotfiles) keeps the rewrite on.
_agent_attr_enabled() {
  [ "$(git config --bool dotfiles.agentPolicy 2>/dev/null || true)" != "false" ]
}

# Internal: first name for the footer, from AGENT_FOOTER_NAME or git user.name.
_agent_footer_name() {
  name="${AGENT_FOOTER_NAME:-}"
  [ -n "$name" ] || name="$(git config user.name 2>/dev/null | awk '{print $1}' || true)"
  printf '%s' "${name:-the author}"
}

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
# up stripping anything, the canonical footer is appended so
# the final body is still tagged as agent-authored.
_strip_agent_attribution_in_stream() {
  if [ -n "${MINSKY_PIPELINE:-}" ] || ! _agent_attr_enabled; then
    cat
    return 0
  fi
  combined_re=$(_agent_attr_combined_re)
  footer_re='Written by an agent, not '

  input=$(cat)
  stripped_vendor_attribution=0
  if printf '%s\n' "$input" | grep -iqE "$combined_re"; then  # pipefail-ok: printf never fails
    stripped_vendor_attribution=1
  fi

  filtered=$(printf '%s\n' "$input" | grep -ivE "$combined_re" || true)
  # Trim trailing blank lines that the strip may have left behind.
  filtered=$(printf '%s\n' "$filtered" | awk 'BEGIN{n=0} {a[++n]=$0} END{
    while (n>0 && a[n] ~ /^[[:space:]]*$/) n--
    for (i=1;i<=n;i++) print a[i]
  }')

  # If we stripped vendor attribution AND the result lacks the
  # footer, append it. Otherwise emit the input unchanged (modulo
  # trailing-blank trimming, which is invisible to GitHub).
  if [ "$stripped_vendor_attribution" = "1" ] && ! printf '%s' "$filtered" | grep -qE "$footer_re"; then  # pipefail-ok: printf never fails
    printf '%s\n\n---\n_🤖 Written by an agent, not %s. Ping me if this looks off._\n' "$filtered" "$(_agent_footer_name)"
  else
    printf '%s\n' "$filtered"
  fi
}

# Public: strip agent attribution from the commit message file passed
# in $1 and append the footer if any was stripped.
_strip_agent_attribution_in_file() {
  msg_file="$1"
  if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
    return 0
  fi

  # Orchestrator pipelines (minsky etc.): pure bypass — leave the
  # message exactly as the orchestrator wrote it. The orchestrator is
  # responsible for any attribution it wants; this library stays out
  # of its way.
  if [ -n "${MINSKY_PIPELINE:-}" ] || ! _agent_attr_enabled; then
    return 0
  fi

  # Skip merge/fixup/squash/revert commits — they're tooling-generated
  # and the user can't control their format.
  if head -1 "$msg_file" | grep -qE "^(Merge|fixup!|squash!|amend!|Revert)"; then  # pipefail-ok: file-fed, tiny
    return 0
  fi

  combined_re=$(_agent_attr_combined_re)
  footer_re='Written by an agent, not '

  stripped_vendor_attribution=0
  if grep -iqE "$combined_re" "$msg_file"; then
    tmp_file=$(mktemp "${TMPDIR:-/tmp}/strip-agent-attribution.XXXXXX")
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
  # certainly agent-authored — add the footer so readers
  # know an agent wrote it. We do NOT touch commits that had no
  # vendor attribution (those are human commits).
  if [ "$stripped_vendor_attribution" = "1" ] && ! grep -qE "$footer_re" "$msg_file"; then
    tmp_file=$(mktemp "${TMPDIR:-/tmp}/strip-agent-attribution.XXXXXX")
    # Trim trailing blank lines so the footer stays cleanly spaced.
    awk 'BEGIN{n=0} {a[++n]=$0} END{
      while (n>0 && a[n] ~ /^[[:space:]]*$/) n--
      for (i=1;i<=n;i++) print a[i]
    }' "$msg_file" > "$tmp_file"
    # git reads trailers (Task:, Signed-off-by:, ...) only from the last
    # paragraph. When git parses a trailer block there, put the footer
    # before that paragraph so the trailers stay last. `--no-divider`
    # matches `git log %(trailers)`: it does not stop at a `---` line.
    keep_trailers_last=0
    if [ -n "$(git interpret-trailers --parse --no-divider < "$tmp_file" 2>/dev/null || true)" ]; then
      keep_trailers_last=1
    fi
    footer=$(printf -- '---\n_🤖 Written by an agent, not %s. Ping me if this looks off._' "$(_agent_footer_name)")
    AGENT_ATTR_FOOTER="$footer" awk -v move="$keep_trailers_last" '{a[++n]=$0} END{
      # s = blank line before the last paragraph (skip trailing # comments).
      s=n+1
      if (move == 1) {
        e=n
        while (e>0 && (a[e] ~ /^#/ || a[e] ~ /^[[:space:]]*$/)) e--
        for (i=e; i>0; i--) if (a[i] ~ /^[[:space:]]*$/) { s=i; break }
      }
      b=s-1
      while (b>0 && a[b] ~ /^[[:space:]]*$/) b--
      for (i=1;i<=b;i++) print a[i]
      print ""
      print ENVIRON["AGENT_ATTR_FOOTER"]
      if (s <= n) { print ""; for (i=s+1;i<=n;i++) print a[i] }
    }' "$tmp_file" > "$msg_file"
    rm -f "$tmp_file"
    echo "🤖 Appended tool-neutral agent footer (agent-attribution-footer rule)."
    echo ""
  fi
}
