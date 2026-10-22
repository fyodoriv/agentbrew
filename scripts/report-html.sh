#!/usr/bin/env bash
# Turn a checkup log into one self-contained HTML page: the verdict, the
# blockers, what to do next, and every section in full.
# Usage: scripts/report-html.sh "<title>" <log-file> <out.html>
# Log shape: "== <section>" or "## <section>" starts a section; a line
# starting with "->" or "Next:" is a next step; a line with FAIL, ✗, "not ok", or "failed" marks its section as a
# blocker; the last "checkup: ..." line is the verdict.
# The page stays local (write it under an ignored folder such as .metrics/).
set -euo pipefail

title="$1" log="$2" out="$3"
mkdir -p "$(dirname "$out")"

esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
strip() { sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g'; }

clean="$(strip <"$log")"
verdict="$(printf '%s\n' "$clean" | grep -E '^checkup: ' | tail -1 | sed 's/^checkup: //' | esc)"
[ -n "$verdict" ] || verdict="no verdict line"
case "$verdict" in healthy*) tone=ok ;; *) tone=bad ;; esac

blockers="$(printf '%s\n' "$clean" | awk '
  /^(==|##) /{sec=substr($0,4); next}
  /FAIL|✗|not ok|[Ff]ailed/ && sec!="" && !(sec in seen){seen[sec]=1; print sec}' | esc)"
next_steps="$(printf '%s\n' "$clean" | grep -E '^[[:space:]]*(->|Next:)' | sed -E 's/^[[:space:]]*(->|Next:)[[:space:]]*//' | esc || true)"

list() {
  if [ -z "$1" ]; then printf '<p class="none">%s</p>\n' "$2"; return; fi
  printf '<ul>\n'
  printf '%s\n' "$1" | while IFS= read -r line; do printf '<li>%s</li>\n' "$line"; done
  printf '</ul>\n'
}

sections="$(printf '%s\n' "$clean" | esc | awk '
  /^(==|##) /{if(open) print "</pre></details>"; printf "<details open><summary>%s</summary><pre>", substr($0,4); open=1; next}
  open{print}
  END{if(open) print "</pre></details>"}')"

{
  cat <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$(printf '%s' "$title" | esc)</title>
<style>
:root { --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --card: #ffffff; --line: #e7e5e4; --ok: #15803d; --bad: #b45309; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --card: #292524; --line: #44403c; --ok: #4ade80; --bad: #fbbf24; }
}
:root[data-theme="dark"] { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --card: #292524; --line: #44403c; --ok: #4ade80; --bad: #fbbf24; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 4px; }
.meta { color: var(--muted); margin: 0 0 20px; }
.verdict { padding: 12px 16px; border-radius: 8px; background: var(--card); border-left: 4px solid var(--$tone); margin-bottom: 20px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
.none { color: var(--muted); margin: 0; }
details { border-top: 1px solid var(--line); padding: 6px 0; }
summary { cursor: pointer; font-weight: 600; }
pre { overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-size: 13px; margin: 8px 0 0; }
</style>
</head>
<body>
<main>
<h1>$(printf '%s' "$title" | esc)</h1>
<p class="meta">$(date '+%Y-%m-%d %H:%M')</p>
<div class="verdict"><strong>Verdict:</strong> $verdict</div>
<section><h2>Blockers</h2>
$(list "$blockers" "None.")
</section>
<section><h2>What to do next</h2>
$(list "$next_steps" "Nothing pending.")
</section>
<section><h2>What was checked</h2>
$sections
</section>
</main>
</body>
</html>
HTML
} >"$out"
