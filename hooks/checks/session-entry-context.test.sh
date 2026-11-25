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
python3 - "$script" "$fixture/home" "$payload" <<'PY'
import json
import os
import subprocess
import sys
import time
environment = dict(os.environ, HOME=sys.argv[2])
environment.pop("BASH_ENV", None)
environment.pop("ENV", None)
started = time.monotonic()
result = subprocess.run(["/bin/bash", sys.argv[1]], input=sys.argv[3], env=environment, text=True, capture_output=True, timeout=2)
elapsed = time.monotonic() - started
assert result.returncode == 0, result.stderr
out = result.stdout
assert len(out.encode()) + 1 <= 2048
context = json.loads(out)["hookSpecificOutput"]
assert context["hookEventName"] == "SessionStart"
text = context["additionalContext"]
assert "AGENTS.md" in text and "Agentfile.yaml" in text
assert "get_bootstrap_profile" in text and "memory_search" in text
print(f"successful hook subprocess: {elapsed:.3f}s")
assert elapsed < 1, "successful hook exceeded startup budget"
PY

plain="$(jq -nc --arg cwd "$fixture/plain" '{hook_event_name:"SessionStart",cwd:$cwd}')"
[ -z "$(invoke "$plain")" ]
[ -z "$(invoke '{invalid')" ]
[ -z "$(invoke '{"hook_event_name":"Stop"}')" ]

mkdir -p "$fixture/repo/tools"
cat > "$fixture/repo/tools/SessionContextFixture.pm" <<'PM'
package SessionContextFixture;
BEGIN {
    open my $marker, '>', "$ENV{HOME}/ambient-module-ran" or die $!;
    print {$marker} 'ran';
    close $marker;
}
1;
PM
result="$(PERL5OPT=-MSessionContextFixture PERL5LIB="$fixture/repo/tools" PERLLIB="$fixture/repo/tools" invoke "$payload")"
if [ -f "$fixture/home/ambient-module-ran" ]; then
  echo 'ambient Perl module ran before the adapter' >&2
  exit 1
fi
printf '%s' "$result" | python3 -c 'import json,sys; assert "AGENTS.md" in json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]'

cp "$helper" "$fixture/original-helper"
cat > "$helper" <<'SH'
#!/bin/bash
printf '%s' "$(printf 'x%.0s' {1..10000})"
SH
result="$(invoke "$payload")"
printf '%s' "$result" | python3 -c 'import json,sys; s=sys.stdin.read(); assert len(s.encode())+1 <= 2048; assert len(json.loads(s)["hookSpecificOutput"]["additionalContext"]) > 1000'

cat > "$helper" <<'SH'
#!/bin/bash
printf '\360\237\222\241%.0s' {1..2000}
SH
result="$(invoke "$payload")"
printf '%s' "$result" | python3 -c 'import json,sys; s=sys.stdin.read(); assert len(s.encode())+1 <= 2048; assert "\U0001f4a1" in json.loads(s)["hookSpecificOutput"]["additionalContext"]'

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
