#!/bin/bash
# agentbrew/hooks/lib/goal-state.sh
#
# Prints the state token a goal judge verdict must carry, for example
# `gs2-3f9a0c41d2e8b7a6`. goal-judges-before-stop recomputes it at Stop, so a
# verdict counts only for the exact state it judged.
#
# Usage: bash goal-state.sh <contract path> [judge dir]
#        bash goal-state.sh --rubric-sha <judge file>   (16 hex of the rubric)
#        bash goal-state.sh --file-sha <file>           (16 hex of the file)
#
# The token is a SHA-256 over:
#   - the contract file (so its `Judges:` and `Judged paths:` lines are frozen),
#   - each contract judge's rubric: its file up to the `## Calibration`
#     heading (calibration notes may be added at any time),
#   - each judged path: each file's path and its content with line endings
#     made LF, trailing spaces and tabs cut from each line, and trailing
#     blank lines cut at the end (for a git work tree, the tracked and untracked
#     files `git ls-files -co --exclude-standard` lists; for a plain file or
#     folder, every file).
# Any other edit to the work (Edit tool, Bash, a subagent) changes the token,
# including a space added or removed inside a line (`"$D" /x` and `"$D"/x`
# differ). A trailing-space, line-ending, or end-of-file blank-line edit, or a
# commit, does not, so it cannot buy a new judging round on the same work.
#
# Contract lines it reads:
#   Judges: <id>, <id>, <id>
#   Judged paths: <path>, <path>     (`~` expands to $HOME)
#
# Exit 2 with a message on stderr when the contract lacks either line, a judge
# file is missing or below the rubric floor, or a judged path does not exist.
#
# Rubric floor: a judge file needs `Field:`, `Applies:`, and `Scale:` lines and
# at least three rubric lines with a "capped at" limit. Every cap must be below
# the passing bar (`RUN_GOAL_JUDGE_MIN`, default 8): a cap at the bar or above
# limits nothing. No rubric line may steer the judge ("trust the summary",
# "skip the tests", "give 9", "minimum score"). Once the `## Calibration`
# section has notes, it needs a line `Rubric <rubric sha>: <the missed defect
# this rubric fixes>` for the current rubric, so every rubric change names the
# defect it fixes and the owner can audit it. When score lines come before it,
# the Rubric line must cite the state token of one of them (the round where the
# defect was missed). A file that lost its rubric (for
# example one that only says "give 10") cannot be judged with.

set -uo pipefail

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -c1-64; }
rubric() { awk '/^## Calibration/{exit} {print}' "$1"; }
calib() { awk '/^## Calibration/{c=1; next} c' "$1"; }
MIN="${RUN_GOAL_JUDGE_MIN:-8}"
case "$MIN" in "" | *[!0-9.]*) MIN=8 ;; esac
STEER='trust (the |its |their )?(runner|summar|contract|claim|report|author)|skip (the |all )?(check|test|reproduc|command)|(do not|don.t|never) (run|reproduce|check|verify)|(give|award|assign)s? (it |them |a )?(score of |at least |a minimum of )?(8|9|10)([^0-9]|$)|minimum score|always (pass|score)|full marks|benefit of the doubt|(be|stay|err on the side of being) (generous|lenient|kind|charitable)|lean(ing)? (toward|towards) (passing|a pass|high)|round (the score )?up|(ignore|overlook|forgive) (minor |small )?(defects|issues|bugs|gaps)|(an? )?[0-9]+(/10)? is (typical|usual|normal|expected|the norm)|usually (scores?|gets?|passes)|note to (the )?judges?'

floor() { # judge file -> empty when it meets the rubric floor, else the gap
  local f="$1" gap=""
  grep -qE '^Field:[[:space:]]*[^[:space:]]' "$f" || gap="$gap no Field: line,"
  grep -qE '^Applies:[[:space:]]*[^[:space:]]' "$f" || gap="$gap no Applies: line,"
  grep -qE '^Scale:[[:space:]]*[^[:space:]]' "$f" || gap="$gap no Scale: line,"
  [ "$(rubric "$f" | grep -cE '^- .*capped at [0-9]')" -ge 3 ] || gap="$gap fewer than 3 'capped at' rubric lines,"
  rubric "$f" | grep -oE 'capped at [0-9]+(\.[0-9]+)?' | awk -v m="$MIN" '{ if ($3 + 0 >= m + 0) bad = 1 } END { exit !bad }' &&
    gap="$gap a cap at or above the passing bar $MIN (caps must be below it),"
  local rtext ctext; rtext="$(rubric "$f")"; ctext="$(calib "$f")"
  grep -qiE "$STEER" <<<"$rtext" && gap="$gap a rubric line steers the judge ($(grep -iE "$STEER" <<<"$rtext" | head -1 | cut -c1-80)),"
  if grep -q '[^[:space:]]' <<<"$ctext"; then
    local rs; rs="$(rubric "$f" | sha | cut -c1-16)"
    grep -qE "Rubric $rs: *[^[:space:]]" <<<"$ctext" ||
      gap="$gap no calibration line 'Rubric $rs: <missed defect it fixes>' for the current rubric,"
    # After a scored round, the Rubric line must cite the state of an earlier
    # score line, so each rubric change points at a round the hook checked.
    awk -v rs="Rubric $rs:" '
      index($0, rs) { found = 1; if (n == 0) ok = 1
        for (k in seen) if (index($0, k)) ok = 1
        next }
      { while (match($0, /gs[0-9]-[0-9a-f]+/)) { seen[substr($0, RSTART, RLENGTH)] = 1; n++
          $0 = substr($0, RSTART + RLENGTH) } }
      END { exit !(found == 0 || ok) }' <<<"$ctext" ||
      gap="$gap the 'Rubric $rs:' line cites no state token of an earlier calibration line (name the round whose missed defect it fixes),"
    local hist id old rlines
    hist="${RUN_GOAL_STATE_DIR:-$HOME/.cache/agentbrew/run-goal}/goal-judge-history.tsv"
    id="$(basename "$f" .md)"
    old="$(awk -F'\t' -v j="$id" -v r="$rs" '$4 == j && $5 != r && $5 != "" { print $6 }' "$hist" 2>/dev/null | sort -u)"
    rlines="$(grep -E "Rubric $rs:" <<<"$ctext" || true)"
    if [ -n "$old" ] && ! grep -qF -f <(printf '%s\n' "$old") <<<"$rlines"; then
      gap="$gap the rubric changed after scored rounds in goal-judge-history.tsv, and its 'Rubric $rs:' line cites none of their states (name the round whose missed defect it fixes),"
    fi
  fi
  printf '%s' "${gap%,}"
}

if [ "${1:-}" = "--rubric-sha" ]; then
  [ -f "${2:-}" ] || { echo "goal-state: judge file missing: ${2:-}" >&2; exit 2; }
  rubric "$2" | sha | cut -c1-16
  exit 0
fi
if [ "${1:-}" = "--file-sha" ]; then
  [ -f "${2:-}" ] || { echo "goal-state: file missing: ${2:-}" >&2; exit 2; }
  sha <"$2" | cut -c1-16
  exit 0
fi

CONTRACT="${1:-}"
JUDGE_DIR="${2:-${RUN_GOAL_JUDGE_DIR:-$HOME/.config/agentbrew/goal-judges}}"
[ -f "$CONTRACT" ] || { echo "goal-state: no contract file: $CONTRACT" >&2; exit 2; }

field() { # contract field value: "Judges" -> "a, b, c"
  sed -nE "s/^[-*_ ]*$1:[*_ ]*(.*)$/\\1/p" "$CONTRACT" | head -1
}
split() { tr ',' '\n' | sed -E 's/^[[:space:]`]+//; s/[[:space:]`]+$//' | sed '/^$/d'; }

JUDGES="$(field Judges | split)"
PATHS="$(field 'Judged paths' | split)"
[ -n "$JUDGES" ] || { echo "goal-state: contract has no 'Judges: <id>, <id>, <id>' line" >&2; exit 2; }
[ -n "$PATHS" ] || { echo "goal-state: contract has no 'Judged paths: <path>, ...' line" >&2; exit 2; }

while IFS= read -r id; do
  case "$id" in *[!a-z0-9-]* | "") echo "goal-state: bad judge id '$id' (use a-z, 0-9, -)" >&2; exit 2 ;; esac
  [ -f "$JUDGE_DIR/$id.md" ] || { echo "goal-state: judge file missing: $JUDGE_DIR/$id.md; create it from the template in run-goal references/goal-judges.md step 1: Field:, Applies:, and Scale: lines and three or more rubric lines with 'capped at N'" >&2; exit 2; }
  gap="$(floor "$JUDGE_DIR/$id.md")"
  [ -z "$gap" ] || { echo "goal-state: judge file $JUDGE_DIR/$id.md is below the rubric floor:$gap; fix it per run-goal references/goal-judges.md step 1 (Field:, Applies:, Scale:, three or more 'capped at N' lines with N below $MIN, no steering lines, and a 'Rubric <sha>: <defect>' calibration line once it has notes)" >&2; exit 2; }
done <<<"$JUDGES"
# A verbatim owner line skips the check only when its text is in the
# hook-written owner file (the /goal words from the transcript).
OWNER_FILE="${CONTRACT%.contract.md}.owner.md"
CTEXT="$(while IFS= read -r l || [ -n "$l" ]; do
  if grep -qiE '^(Goal \(verbatim\)|Owner, verbatim|Owner \(verbatim\))' <<<"$l"; then
    t="$(sed -E 's/^[^:]*:[[:space:]"]*//; s/[[:space:]"]+$//' <<<"$l")"
    [ -n "$t" ] && [ -f "$OWNER_FILE" ] && grep -qF -- "$t" "$OWNER_FILE" && continue
  fi
  printf '%s\n' "$l"
done <"$CONTRACT")"
if grep -qiE "$STEER|scored [0-9]|[0-9]+/[0-9]+/[0-9]+|(lowest|judge|round [0-9]+) (score )?[0-9]+/10" <<<"$CTEXT"; then
  echo "goal-state: the contract steers or anchors the judges ($(grep -iE "$STEER|scored [0-9]|[0-9]+/[0-9]+/[0-9]+|(lowest|judge|round [0-9]+) (score )?[0-9]+/10" <<<"$CTEXT" | head -1 | cut -c1-80)); every judge reads it, so keep instructions to judges and earlier scores out of it (put round history in the retro)" >&2
  exit 2
fi
while IFS= read -r p; do
  [ -e "${p/#\~/$HOME}" ] || { echo "goal-state: judged path missing: ${p/#\~/$HOME}" >&2; exit 2; }
done <<<"$PATHS"

WS_HASH='use strict; use Digest::SHA; local $/ = "\0"; my $d = Digest::SHA->new(256);
while (my $f = <STDIN>) { chomp $f;
  if (-d $f) { $d->add($f, "\0dir\n"); next; }
  next unless -f $f; open(my $h, "<:raw", $f) or next;
  my $c = do { local $/; <$h> }; close $h;
  $c =~ s/\r\n?/\n/g; $c =~ s/[ \t]+$//mg; $c =~ s/\s+\z//;
  $d->add($f, "\0", (-x $f ? "x" : "-"), Digest::SHA::sha256_hex($c), "\n"); }
print $d->hexdigest, "\n";'
{
  printf 'contract\n'; cat "$CONTRACT"
  while IFS= read -r id; do
    f="$JUDGE_DIR/$id.md"
    printf '\njudge %s\n' "$id"
    rubric "$f"
  done <<<"$JUDGES"
  while IFS= read -r p; do
    p="${p/#\~/$HOME}"
    printf '\npath %s\n' "$p"
    if [ -d "$p" ] && git -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      # Tracked, untracked, and ignored files (an ignored folder counts by
      # name only: node_modules is too big to hash on every Stop).
      (cd "$p" && { git ls-files -z -co --exclude-standard -- .
        git ls-files -z -oi --exclude-standard --directory -- .; } 2>/dev/null | LC_ALL=C sort -zu | perl -e "$WS_HASH")
    else
      find "$p" -type f -not -path '*/.git/*' -print0 2>/dev/null | LC_ALL=C sort -z | perl -e "$WS_HASH"
    fi
  done <<<"$PATHS"
} | sha | cut -c1-16 | sed 's/^/gs2-/'
