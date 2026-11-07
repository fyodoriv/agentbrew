# Sync binding: nine-control green observation

The scratch-cache preflight passed both privacy canaries, both static discovery
checks and the exact named placeholder failure. The registered red is valid;
its private log and original config backup remain local. The four target cases
have not run.

Implement the nine synthetic controls specified in the committed binding plan.
Predict nine exact named passes and zero calls through each of the 15 guarded
process and network entry points during binding. Use the same clean launcher,
no-bundle loader, scratch module cache, privacy canaries and JSON oracle. A
missing control, unsafe call, false canary, discovery regression or wrong
binding rejects this approach. Do not run the four target cases.

After committing this plan and implementing only the named controls, run this
exact command from the candidate checkout. It verifies the known scratch-cache
config and the committed loader plan. It changes only the original runner's
mode from red to green, retaining the earlier plan hashes and preflight checks.

```sh
env -i HOME="$HOME" PATH="$HOME/apps/tooling/dotfiles/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR=/private/tmp LANG=C /Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 - <<'PYCODE'
from pathlib import Path
import hashlib
import subprocess

home = Path.home()
config = Path('vitest.sync-binding-prep.config.ts')
if hashlib.sha256(config.read_bytes()).hexdigest() != '062ce976d8c4a3249df341ade3aff4dab7edeb0d8ebc27b09f77da953b981099':
    raise SystemExit('scratch config identity changed')
path = home / 'apps/tooling/wt.noindex/git-doctor-email-allowance-478/docs/tooling-command-center/plans/sync-binding-config-loader-preflight.md'
data = path.read_bytes()
if hashlib.sha256(data).hexdigest() != 'caf2e157539bd7e2558c8a66d8259fbb93122f82daf86113c7dd9e3a3bfe1bf5':
    raise SystemExit('loader plan identity changed')
plan = data.decode('utf-8')
if plan.count('```sh\n') != 1:
    raise SystemExit('expected one shell block')
command = plan.split('```sh\n', 1)[1].split('\n```', 1)[0] + '\n'
needle = '''script = script.replace(loader_needle, '"$PWD/node_modules/vitest/vitest.mjs" --configLoader runner "$@";')
'''
addition = '''red_needle = "bash -s -- red <<'BASH'"
if script.count(red_needle) != 1:
    raise SystemExit('expected red mode missing or ambiguous')
script = script.replace(red_needle, "bash -s -- green <<'BASH'")
'''
if command.count(needle) != 1:
    raise SystemExit('expected loader generator point missing or ambiguous')
command = command.replace(needle, needle + addition)
env = {'HOME': str(home), 'PATH': str(home / 'apps/tooling/dotfiles/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': '/private/tmp', 'LANG': 'C'}
raise SystemExit(subprocess.run(['/bin/bash'], input=command, text=True, env=env, check=False).returncode)
PYCODE
```

Success requires all nine distinct named passing assertions, no skips or extra
cases, zero guarded attempts during the bindings, and all preflight checks.
This is only builder wiring. CLI and update baselines, actual output, and the
production behavior remain separate. Anchor: the committed binding plan and
Basili, Caldiera and Rombach (1994), Goal Question Metric.

Observed after registration: the nine exact named controls passed. The 15
canaries exercised the instrumented CommonJS properties and global fetch;
Node's ESM aliases were synchronized but not independently canaried. The
result does not qualify the sealed selection cases or prove absence of calls
through uninstrumented native or third-party paths.
