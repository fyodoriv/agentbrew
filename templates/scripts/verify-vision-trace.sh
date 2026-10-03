#!/usr/bin/env bash
# verify-vision-trace.sh — check that the goal ids a PR body cites on its
# `Vision goal:` line exist in the repo's VISION.md frontmatter goals list.
# Spec: the `verify-vision-trace` skill
# (skill-plugins/dev/verify-vision-trace/SKILL.md in agentbrew). The shape
# gate for the whole `## Vision trace` block is check-pr-vision-trace.mjs.
#
# Usage: verify-vision-trace.sh <path-to-pr-body.md>
# Exit:  0 = valid, skipped, or soft warning; 1 = a cited id is not a goal,
#        or the body has no `Vision goal:` line; 2 = usage error.
#
# `agentbrew sync` installs this file to ~/.config/agentbrew/scripts/ from
# agentbrew's templates/scripts/. It keeps any copy it did not write.
# Bash 3.2 compatible (macOS /bin/bash). One awk pass does the parsing.

set -uo pipefail

body_file=${1:-}
if [ -z "$body_file" ] || [ ! -f "$body_file" ]; then
  echo "usage: verify-vision-trace.sh <path-to-pr-body.md>" >&2
  [ -n "$body_file" ] && echo "  PR body not found: $body_file" >&2
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd -P)

# VISION.md (any case) in the repo root, docs/, or .minsky/ — first hit wins.
vision_rel=""
for dir in "" "docs/" ".minsky/"; do
  for path in "$repo_root/$dir"*; do
    [ -f "$path" ] || continue
    case "${path##*/}" in
      [Vv][Ii][Ss][Ii][Oo][Nn].[Mm][Dd])
        vision_rel="$dir${path##*/}"
        break 2
        ;;
    esac
  done
done
vision_file=/dev/null
[ -n "$vision_rel" ] && vision_file="$repo_root/$vision_rel"

# ARGV[1] is VISION.md (or /dev/null), ARGV[2] is the PR body.
awk -v root="$repo_root" -v vision_rel="$vision_rel" -v body_name="$body_file" -v sq="'" '
  function trim(v) { sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); return v }
  function unquote(v,   q, i) {
    v = trim(v)
    q = substr(v, 1, 1)
    if (q == "\"" || q == sq) {
      v = substr(v, 2); i = index(v, q)
      return i ? substr(v, 1, i - 1) : v
    }
    sub(/[ \t]+#.*$/, "", v)
    return v
  }
  function flush(   p) {
    if (id != "") {
      if (section == "goals" && !(id in goal_name)) { goal_ids[++goal_count] = id; goal_name[id] = name }
      p = id; sub(/[0-9]+$/, "", p); if (p != "") prefix[p] = 1
    }
    id = ""; name = ""
  }
  function join_ids(arr, n,   i, out) {
    out = ""
    for (i = 1; i <= n; i++) out = out (i > 1 ? ", " : "") arr[i]
    return out
  }
  # Cite goal-id-shaped tokens (G1, NG4) whose letter prefix a declared id uses.
  function collect_ids(v,   s, last, pre, post, tok, p) {
    s = v; last = ""
    while (match(s, /[A-Z]+[0-9]+/)) {
      pre = (RSTART > 1) ? substr(s, RSTART - 1, 1) : last
      post = substr(s, RSTART + RLENGTH, 1)
      tok = substr(s, RSTART, RLENGTH)
      last = substr(s, RSTART + RLENGTH - 1, 1)
      s = substr(s, RSTART + RLENGTH)
      if (pre ~ /[A-Za-z0-9_-]/ || post ~ /[A-Za-z0-9_-]/) continue
      p = tok; sub(/[0-9]+$/, "", p)
      if (!(p in prefix) || (tok in seen)) continue
      seen[tok] = 1
      cited[++cited_count] = tok
    }
  }

  # --- VISION.md frontmatter ---
  FILENAME == ARGV[1] && FNR == 1 { if ($0 ~ /^---[ \t]*$/) in_fm = 1; next }
  FILENAME == ARGV[1] && !in_fm { next }
  FILENAME == ARGV[1] && /^(---|\.\.\.)[ \t]*$/ { flush(); in_fm = 0; fm_closed = 1; next }
  FILENAME == ARGV[1] && /^[ \t]*(#.*)?$/ { next }
  FILENAME == ARGV[1] && /^[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/ {
    flush()
    key = $0; sub(/[ \t]*:.*$/, "", key)
    val = $0; sub(/^[^:]*:/, "", val)
    section = key
    if (key == "schema") schema = unquote(val)
    next
  }
  FILENAME == ARGV[1] {
    if (section != "goals" && section != "non_goals") next
    line = $0
    if (line ~ /^[ \t]*-([ \t]|$)/) { flush(); sub(/^[ \t]*-[ \t]*/, "", line) }
    if (line ~ /^[ \t]*id[ \t]*:/) { sub(/^[ \t]*id[ \t]*:/, "", line); id = unquote(line) }
    else if (line ~ /^[ \t]*name[ \t]*:/) { sub(/^[ \t]*name[ \t]*:/, "", line); name = unquote(line) }
    next
  }

  # --- PR body ---
  {
    l = tolower($0)
    # Same opt-out shape as check-pr-vision-trace.mjs: separator, reason (3+ chars), then -->.
    if (optout == "" && match(l, /<!--[ \t]*vision[- ]?trace:[ \t]*not[- ]?applicable[ \t]*(—|-|:)[ \t]*/)) {
      rest = substr($0, RSTART + RLENGTH)
      if (match(rest, /[ \t]*-->/)) {
        rest = substr(rest, 1, RSTART - 1)
        if (length(rest) >= 3) optout = rest
      }
    }
    if (match(l, /^[ \t]*([-*]|•)?[ \t]*(\*\*)?vision[- ]?goal(\*\*)?[ \t]*(:|-)[ \t]*/)) {
      value = substr($0, RLENGTH + 1)
      sub(/^[*`_ \t]+/, "", value)
      sub(/[*`_ \t]+$/, "", value)
      values[++value_count] = value
    }
  }

  END {
    print "verify-vision-trace @ " root
    if (optout != "") { print "  PR body: " body_name; print "  skipped (opt-out: " optout ")"; exit 0 }
    if (value_count == 0) {
      print "  PR body: " body_name
      print "  ✗ no `Vision goal:` line in the PR body — add the ## Vision trace block (see check-pr-vision-trace.mjs)"
      print "exit 1 — nothing to verify"
      exit 1
    }
    if (vision_rel == "") { print "  ⚠ no VISION.md in the repo root, docs/, or .minsky/ — validation skipped"; exit 0 }
    print "  VISION.md: " vision_rel
    if (!fm_closed) {
      print "  ⚠ VISION.md lacks frontmatter — validation skipped"
      print "  File a P3 TASKS.md task: \"add frontmatter to VISION.md\" (schema: vision-v1 with a goals list)."
      exit 0
    }
    print "  schema: " (schema == "" ? "<missing>" : schema)
    if (schema != "vision-v1") { print "  ⚠ VISION.md frontmatter is not schema: vision-v1 — validation skipped"; exit 0 }
    if (goal_count == 0) {
      print "  goals declared: 0"
      print "  ⚠ VISION.md declares no goals yet — validation skipped (cite goals by section name until it does)"
      exit 0
    }
    print "  goals declared: " goal_count " (" join_ids(goal_ids, goal_count) ")"
    print "  PR body: " body_name
    prefix["G"] = 1
    for (i = 1; i <= value_count; i++) {
      if (tolower(values[i]) ~ /^n\/?a([^a-z]|$)/) print "  Vision goal: " values[i] " (skipped)"
      else collect_ids(values[i])
    }
    if (cited_count == 0) { print "  cited ids: none — nothing to resolve"; print "exit 0 — no goal ids cited"; exit 0 }
    print "  cited ids: " join_ids(cited, cited_count)
    invalid = 0
    for (i = 1; i <= cited_count; i++) {
      if (cited[i] in goal_name) print "  ✓ " cited[i] " — " (goal_name[cited[i]] == "" ? "<no name>" : goal_name[cited[i]])
      else { print "  ✗ " cited[i] " — NOT FOUND in VISION.md goals list"; invalid++ }
    }
    if (invalid > 0) { print "exit 1 — " invalid " invalid goal " (invalid == 1 ? "id" : "ids"); exit 1 }
    print "exit 0 — every cited goal id is valid"
    exit 0
  }
' "$vision_file" "$body_file"
