# Sync binding: ancestor metadata preflight

The registered red observation stopped before test discovery. The private
canary was readable outside the sandbox and both direct and scratch-symlink
reads were denied. The repository read succeeded. The dedicated static
listing then failed with `EPERM` on `lstat` of the home directory. No test or
target case ran. This is inconclusive setup, not the registered red result.
The private logs remain under the experiment's printed temporary path.

Use a separate preflight that adds only metadata access to the literal
ancestor directories of the checkout and the pinned Node directory, through
the real home directory. Do not grant directory contents or file data outside
the existing repo and Node exceptions. A separate synthetic directory canary
checks that its literal metadata grant still refuses listing its contents. Retain all original hashes, the two
private-read canaries, positive repo canary, static discovery assertions and
named red oracle unchanged. Predict the dedicated and default static listings
complete, and the placeholder reports the exact registered named failure.
A failed canary, unauthorized read, unlisted test, missing named failure or
unbounded process observation rejects this preflight. A setup failure remains
inconclusive. Do not run any target case.

The exact command below constructs the modified red command from the already
committed plan. It checks the replacement is unique. No shell text from a
repository or fixture is executed as a command; only the fixed registered
script is run. Its original status, logs and safety checks remain intact.
Run it from the candidate checkout, after this plan is committed:

```sh
env -i HOME="$HOME" PATH="$HOME/apps/tooling/dotfiles/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR=/private/tmp LANG=C /Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 - <<'PYCODE'
from pathlib import Path
import hashlib
import shutil
import subprocess
import tempfile

path = Path.home() / 'apps/tooling/wt.noindex/git-doctor-email-allowance-478/docs/tooling-command-center/plans/sync-selection-binding-preparation.md'
data = path.read_bytes()
if hashlib.sha256(data).hexdigest() != '66554e69821d5a98112ccb02bb8c83b85cd5dd030cfbb76e780048b7d9677e92':
    raise SystemExit('registered plan identity changed')
plan = data.decode('utf-8')
if plan.count('```sh\n') != 1:
    raise SystemExit('expected one shell block')
script = plan.split('```sh\n', 1)[1].split('\n```', 1)[0] + '\n'
needle = 'mkdir -p "$realhome/.local/state/agentbrew/experiments"\n'
addition = """for directory in "$repo" "$node_dir"; do
  while [ "$directory" != "$realhome" ]; do
    directory=$(dirname "$directory")
    case "$directory" in "$realhome"|"$realhome"/*) ;; *) exit 2 ;; esac
    printf '(allow file-read-metadata (literal "%s"))\\n' "$directory" >>"$logs/sandbox.sb"
  done
done
"""
canary_needle = "printf '%s\\n' 'synthetic private-read canary' >\"$canary/record\"\n"
canary_check = """printf '(allow file-read-metadata (literal "%s"))\\n' "$canary" >>"$logs/sandbox.sb"
/usr/bin/sandbox-exec -f "$logs/sandbox.sb" /usr/bin/stat -f '%p' "$canary" >"$logs/metadata-canary.out" 2>"$logs/metadata-canary.err"
if /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/ls -1 "$canary" >"$logs/list-canary.out" 2>"$logs/list-canary.err"; then exit 1; fi
[ ! -s "$logs/list-canary.out" ]
"""
if script.count(needle) != 1 or script.count(canary_needle) != 1:
    raise SystemExit('expected insertion point missing or ambiguous')
script = script.replace(needle, addition + needle).replace(canary_needle, canary_needle + canary_check)
owned = Path(tempfile.mkdtemp(prefix='sync-binding-command-'))
try:
    target = owned / 'red.sh'
    with target.open('x', encoding='utf-8') as out:
        out.write(script)
    env = {'HOME': str(Path.home()), 'PATH': str(Path.home() / 'apps/tooling/dotfiles/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': '/private/tmp', 'LANG': 'C'}
    result = subprocess.run(['/bin/bash', str(target)], env=env, check=False)
    raise SystemExit(result.returncode)
finally:
    shutil.rmtree(owned)
PYCODE
```

Success is the exact registered red result and both private-read canaries
still refused. The two listing checks still guard against default-suite or
target-case admission. No green run follows automatically. The sandbox's
process limitation and explicit repo and Node read exceptions are unchanged.
Anchors: recorded `lstat` failure and Basili, Caldiera and Rombach (1994),
Goal Question Metric.
