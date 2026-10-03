#!/usr/bin/env bash
# competitor-spot-check.sh — search the repo's competitor docs for prior art
# on a proposed feature, so a PR's `Competitor prior art` line can cite it.
# Local and read-only: no network, no LLM. Spec: the `competitor-spot-check`
# skill (skill-plugins/dev/competitor-spot-check/SKILL.md in agentbrew).
#
# Usage: competitor-spot-check.sh "<feature description>"
# Exit:  always 0 — a research tool, not a gate.
#
# `agentbrew sync` installs this file to ~/.config/agentbrew/scripts/ from
# agentbrew's templates/scripts/. It keeps any copy it did not write.
# Bash 3.2 compatible (macOS /bin/bash).

set -uo pipefail

MAX_MATCHES=20
STOPWORDS=" a about add adds all also an and any anything are as at be been but by can could do does doing done every everything feature features for from get has have how i if in into is it its just let like make makes me more my need new no not of on or our should so some something support that the their them then there these they thing things this those to too us use using via want was we were what when where which who will with work works would you your "

description="$*"
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)
echo "competitor-spot-check @ $root"

if [ -z "$(printf '%s' "$description" | tr -d '[:space:]')" ]; then
  echo "usage: competitor-spot-check.sh \"<feature description>\"" >&2
  exit 0
fi

# Keywords: lowercase words of 2+ characters, without stopwords or repeats.
keywords=""
for word in $(printf '%s' "$description" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' ' '); do
  [ "${#word}" -lt 2 ] && continue
  case "$STOPWORDS" in *" $word "*) continue ;; esac
  case " $keywords " in *" $word "*) continue ;; esac
  keywords="${keywords:+$keywords }$word"
done

if [ -z "$keywords" ]; then
  echo "  feature description has only stopwords: \"$description\""
  echo "  Give more specific feature terms, for example: \"skill install github url\" or \"team skill presets\"."
  exit 0
fi
echo "  keywords: $(printf '%s' "$keywords" | sed 's/ /, /g')"

# Corpus: the canonical competitor-doc locations, relative to the repo root.
FIND=/usr/bin/find
[ -x "$FIND" ] || FIND="find"
files=()
corpus=()
singles="|"
for dir in competitors docs/competitors docs/competition; do
  [ -d "$root/$dir" ] || continue
  count=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    files+=("$path")
    count=$((count + 1))
  done <<EOF
$("$FIND" "$root/$dir" -type f \( -name '*.md' -o -name '*.mdx' -o -name '*.txt' \) | LC_ALL=C sort)
EOF
  [ "$count" -eq 1 ] && corpus+=("$dir/ (1 file)")
  [ "$count" -gt 1 ] && corpus+=("$dir/ ($count files)")
done
for path in "$root"/* "$root"/docs/*; do
  [ -f "$path" ] || continue
  rel=${path#"$root"/}
  case "$rel" in
    [Cc][Oo][Mm][Pp][Ee][Tt][Ii][Tt][Oo][Rr][Ss].[Mm][Dd] | docs/[Cc][Oo][Mm][Pp][Ee][Tt][Ii][Tt][Ii][Oo][Nn].[Mm][Dd])
      files+=("$path")
      corpus+=("$rel")
      singles="$singles$rel|"
      ;;
  esac
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "  no competitive corpus in this repo (looked for competitors/, docs/competitors/, docs/competition/, docs/competition.md, COMPETITORS.md)"
  echo "  PR line: Competitor prior art: N/A — repo has no competitive corpus (deployment manifest / pure tooling)"
  exit 0
fi
echo "  corpus: $(printf '%s\n' "${corpus[@]}" | paste -sd, - | sed 's/,/, /g')"

# One record per matching line: hits, order, competitor, context, path:line.
# A line matches when it holds every keyword, or at least 2 of 3+ keywords.
# A keyword matches at the start of a word, so "skill" also finds "skills".
# Link targets and bare URLs do not count, so "github" does not match every link.
matches=$(awk -v kw="$keywords" -v root="$root" -v singles="$singles" '
  function has(s, k,   p, off) {
    off = 0
    while ((p = index(substr(s, off + 1), k)) > 0) {
      p += off
      if (p == 1 || substr(s, p - 1, 1) !~ /[a-z0-9]/) return 1
      off = p
    }
    return 0
  }
  BEGIN { n = split(kw, K, " "); need = (n >= 2) ? 2 : 1; order = 0 }
  FNR == 1 {
    rel = FILENAME
    if (index(rel, root "/") == 1) rel = substr(rel, length(root) + 2)
    single = index(singles, "|" rel "|") > 0
    base = rel; sub(/^.*\//, "", base); sub(/\.[A-Za-z]+$/, "", base); sub(/-vs-.*$/, "", base)
    heading = ""
  }
  /^#+[ \t]/ { heading = $0; sub(/^#+[ \t]+/, "", heading); sub(/[ \t#]+$/, "", heading) }
  {
    line = tolower($0)
    gsub(/\]\([^)]*\)/, "]", line)
    gsub(/https?:\/\/[^ \t)>]+/, " ", line)
    hits = 0
    for (i = 1; i <= n; i++) if (has(line, K[i])) hits++
    if (hits < need) next
    ctx = $0; gsub(/\t/, " ", ctx); sub(/^[ \t]+/, "", ctx); sub(/[ \t]+$/, "", ctx)
    if (length(ctx) > 200) ctx = substr(ctx, 1, 197) "..."
    name = (single && heading != "") ? heading : base
    printf "%d\t%d\t%s\t%s\t%s:%d\n", hits, ++order, name, ctx, rel, FNR
  }
' "${files[@]}" | LC_ALL=C sort -t "$(printf '\t')" -k1,1nr -k2,2n)

file_count=${#files[@]}
file_noun="files"
[ "$file_count" -eq 1 ] && file_noun="file"
if [ -z "$matches" ]; then
  echo "no prior art found in $file_count competitor $file_noun scanned — safe to propose, but note in the PR body that you scanned and found nothing"
  exit 0
fi

total=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
matched_files=$(printf '%s\n' "$matches" | awk -F'\t' '{ sub(/:[0-9]+$/, "", $5); print $5 }' | sort -u | wc -l | tr -d ' ')
printf '%s\n' "$matches" | head -n "$MAX_MATCHES" | awk -F'\t' '{ printf "[%s] %s (%s)\n", $3, $4, $5 }'
if [ "$total" -gt "$MAX_MATCHES" ]; then
  echo "+$((total - MAX_MATCHES)) more matches — refine search keywords"
fi
echo "$total matching lines in $matched_files of $file_count competitor $file_noun scanned."
exit 0
