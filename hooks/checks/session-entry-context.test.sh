#!/bin/bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/home/.config/agentbrew/scripts" "$fixture/repo/.git" "$fixture/repo/nested" "$fixture/plain"
printf '# Fixture\n' > "$fixture/repo/AGENTS.md"
printf 'hooks: []\n' > "$fixture/repo/Agentfile.yaml"
helper="$fixture/home/.config/agentbrew/scripts/load-project-context.sh"
cp "$here/../../templates/scripts/load-project-context.sh" "$helper"
script="$here/session-entry-context.sh"

invoke() {
  printf '%s' "$1" | env -u BASH_ENV -u ENV HOME="$fixture/home" /bin/bash "$script"
}

payload="$(jq -nc --arg cwd "$fixture/repo/nested" '{hook_event_name:"SessionStart",cwd:$cwd}')"
start="$(python3 -c 'import time; print(time.monotonic())')"
result="$(invoke "$payload")"
python3 - "$result" "$start" <<'PY'
import json
import sys
import time
out = sys.argv[1]
assert len(out.encode()) + 1 <= 2048
context = json.loads(out)["hookSpecificOutput"]
assert context["hookEventName"] == "SessionStart"
text = context["additionalContext"]
assert "AGENTS.md" in text and "Agentfile.yaml" in text
assert "get_bootstrap_profile" in text and "memory_search" in text
assert time.monotonic() - float(sys.argv[2]) < 1, "successful hook exceeded startup budget"
PY

plain="$(jq -nc --arg cwd "$fixture/plain" '{hook_event_name:"SessionStart",cwd:$cwd}')"
[ -z "$(invoke "$plain")" ]
[ -z "$(invoke '{invalid')" ]
[ -z "$(invoke '{"hook_event_name":"Stop"}')" ]

cp "$helper" "$fixture/original-helper"
printf '#!/bin/bash\nprintf "%%s" "$(printf x%.0s {1..10000})"\n' > "$helper"
result="$(invoke "$payload")"
printf '%s' "$result" | python3 -c 'import json,sys; s=sys.stdin.read(); assert len(s.encode())+1 <= 2048; assert json.loads(s)["hookSpecificOutput"]["additionalContext"]'

cat > "$helper" <<'SH'
#!/bin/bash
sleep 30 &
printf '%s' "$!" > "$HOME/child.pid"
wait
SH
[ -z "$(invoke "$payload")" ]
child="$(cat "$fixture/home/child.pid")"
state="$(ps -o stat= -p "$child" 2>/dev/null || true)"
case "$state" in ''|*Z*) ;; *) echo 'timed-out helper left a running child' >&2; exit 1 ;; esac
rm "$helper"
[ -z "$(invoke "$payload")" ]
printf '%s\n' 'session-entry-context: registered cases passed'
