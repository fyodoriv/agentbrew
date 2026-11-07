# Sync binding: no-bundle config preflight

The metadata preflight passed both private-read canaries, the metadata/listing
canary, and the positive repo-read check. Static discovery then stopped before
any test because Vite tried to write a bundled config inside the checkout.
That setup failure is inconclusive. The checkout write restriction worked.
No target case ran. The private logs are retained.

Vitest's installed help lists `--configLoader runner`: it processes the config
without the default bundling step. Predict that this loader permits both
registered static listings and the exact named placeholder failure, while all
prior sandbox canaries still pass. A privacy-canary failure, checkout write,
unlisted test, unexpected result or accepted target case rejects the approach.
Setup errors remain inconclusive and are not a red result.

After committing this plan, run the exact command below from the candidate
checkout. It verifies the prior metadata plan by SHA-256, adds one fixed loader
flag to its pinned generator, and retains its existing unique-insertion checks,
private logs, clean environments, sandbox and canaries. The generator and its
child are both launched with explicit clean environments. This authorizes only
the named red, not the four target cases or a green run.

```sh
env -i HOME="$HOME" PATH="$HOME/apps/tooling/dotfiles/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR=/private/tmp LANG=C /Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 - <<'PYCODE'
from pathlib import Path
import hashlib
import subprocess

home = Path.home()
path = home / 'apps/tooling/wt.noindex/git-doctor-email-allowance-478/docs/tooling-command-center/plans/sync-binding-metadata-preflight.md'
data = path.read_bytes()
if hashlib.sha256(data).hexdigest() != 'edc19c6d33f91764bfa5d907e0265455494cb7424dd5bb346589af6db8211f03':
    raise SystemExit('metadata plan identity changed')
plan = data.decode('utf-8')
if plan.count('```sh\n') != 1:
    raise SystemExit('expected one shell block')
command = plan.split('```sh\n', 1)[1].split('\n```', 1)[0] + '\n'
needle = "script = script.replace(needle, addition + needle).replace(canary_needle, canary_needle + canary_check)\n"
addition = '''loader_needle = '"$PWD/node_modules/vitest/vitest.mjs" "$@";'
if script.count(loader_needle) != 1:
    raise SystemExit('expected loader insertion point missing or ambiguous')
script = script.replace(loader_needle, '"$PWD/node_modules/vitest/vitest.mjs" --configLoader runner "$@";')
'''
if command.count(needle) != 1:
    raise SystemExit('expected generator insertion point missing or ambiguous')
command = command.replace(needle, needle + addition)
env = {'HOME': str(home), 'PATH': str(home / 'apps/tooling/dotfiles/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': '/private/tmp', 'LANG': 'C'}
raise SystemExit(subprocess.run(['/bin/bash'], input=command, text=True, env=env, check=False).returncode)
PYCODE
```

Success is the exact registered red and all original preflight checks. The
process-observation limit, explicit repo/Node read exceptions and prohibition
on the four target cases stay unchanged. Anchor: the installed Vitest help and
Basili, Caldiera and Rombach (1994), Goal Question Metric.
