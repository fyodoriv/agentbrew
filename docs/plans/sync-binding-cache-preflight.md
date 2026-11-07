# Sync binding: scratch module-cache preflight

The no-bundle loader passed both static discovery checks and all privacy
canaries. Before any assertion ran, Vitest was denied a write to its separate
experimental module cache under the checkout. The result is inconclusive.
The private logs remain in the printed temporary directory. No target case ran.

The installed Vitest resolves `experimental.fsModuleCachePath` separately from
`cacheDir`. Keep the existing module cache enabled but point it inside the
already sandboxed scratch `TMPDIR`. Predict the exact named placeholder
failure after the same static discovery and privacy checks. A checkout write,
privacy-canary failure, unexpected test or accepted target case rejects this
approach. Setup failure remains inconclusive and cannot count as red.

After this plan is committed, run the exact command below in the candidate
checkout. It verifies both the existing untracked config and the preceding
committed loader plan, backs up the verified regular single-link config, applies exactly one line
through its no-follow descriptor, checks the predicted hash, then runs the pinned loader preflight. The prior clean environments,
network and write restrictions, listing checks and named red oracle remain.
This admits no target cases and does not authorize a green run.

```sh
env -i HOME="$HOME" PATH="$HOME/apps/tooling/dotfiles/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR=/private/tmp LANG=C /Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 - <<'PYCODE'
from pathlib import Path
import hashlib
import os
import stat
import subprocess
import tempfile

home = Path.home()
config = Path('vitest.sync-binding-prep.config.ts')
fd = os.open(config, os.O_RDWR | os.O_NOFOLLOW)
info = os.fstat(fd)
if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o022:
    raise SystemExit('preparation config ownership or type changed')
old = os.read(fd, 4096)
if os.read(fd, 1):
    raise SystemExit('preparation config exceeds fixed bound')
if hashlib.sha256(old).hexdigest() != '5b1621e071f147fa820a12441695dfd919df3bed8d96aec114bf7f23b2bca0b9':
    raise SystemExit('preparation config identity changed')
needle = '    cacheDir: join(process.env.TMPDIR ?? "/tmp", "sync-binding-vitest-cache"),\n'
addition = '    experimental: { ...base.test?.experimental, fsModuleCachePath: join(process.env.TMPDIR ?? "/tmp", "sync-binding-module-cache") },\n'
text = old.decode('utf-8')
if text.count(needle) != 1:
    raise SystemExit('config insertion point missing or ambiguous')
new = text.replace(needle, needle + addition).encode('utf-8')
if hashlib.sha256(new).hexdigest() != '062ce976d8c4a3249df341ade3aff4dab7edeb0d8ebc27b09f77da953b981099':
    raise SystemExit('unexpected candidate config')
plan_path = home / 'apps/tooling/wt.noindex/git-doctor-email-allowance-478/docs/tooling-command-center/plans/sync-binding-config-loader-preflight.md'
plan = plan_path.read_bytes()
if hashlib.sha256(plan).hexdigest() != 'caf2e157539bd7e2558c8a66d8259fbb93122f82daf86113c7dd9e3a3bfe1bf5':
    raise SystemExit('loader plan identity changed')
text = plan.decode('utf-8')
if text.count('```sh\n') != 1:
    raise SystemExit('expected one shell block')
command = text.split('```sh\n', 1)[1].split('\n```', 1)[0] + '\n'
backup_dir = Path(tempfile.mkdtemp(prefix='sync-binding-config-backup-', dir='/private/tmp'))
backup = backup_dir / 'original'
with backup.open('xb') as out:
    os.chmod(backup, 0o600)
    out.write(old)
print(f'Private config backup: {backup}')
current = os.lstat(config)
now = os.fstat(fd)
if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or not stat.S_ISREG(current.st_mode) or now.st_uid != os.getuid() or now.st_nlink != 1 or stat.S_IMODE(now.st_mode) & 0o022:
    raise SystemExit('preparation config path or metadata changed')
os.lseek(fd, 0, os.SEEK_SET)
if hashlib.sha256(os.read(fd, 4096)).hexdigest() != '5b1621e071f147fa820a12441695dfd919df3bed8d96aec114bf7f23b2bca0b9':
    raise SystemExit('preparation config bytes changed')
os.lseek(fd, 0, os.SEEK_SET)
os.ftruncate(fd, 0)
with os.fdopen(fd, 'wb') as out:
    out.write(new)
    out.flush()
    os.fsync(out.fileno())
    os.lseek(out.fileno(), 0, os.SEEK_SET)
    if hashlib.sha256(os.read(out.fileno(), 4096)).hexdigest() != '062ce976d8c4a3249df341ade3aff4dab7edeb0d8ebc27b09f77da953b981099':
        raise SystemExit('written config identity mismatch')
    current = os.lstat(config)
    if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or current.st_uid != os.getuid() or current.st_nlink != 1 or stat.S_IMODE(current.st_mode) & 0o022:
        raise SystemExit('written config path or metadata changed')
env = {'HOME': str(home), 'PATH': str(home / 'apps/tooling/dotfiles/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': '/private/tmp', 'LANG': 'C'}
raise SystemExit(subprocess.run(['/bin/bash'], input=command, text=True, env=env, check=False).returncode)
PYCODE
```

Success is the exact registered red and all inherited canaries. Any setup
failure preserves the modified untracked config and logs for review. The
process-observation and repo/Node read-exception limits are unchanged.
Anchors: the installed Vitest `fsModuleCachePath` implementation and Basili,
Caldiera and Rombach (1994), Goal Question Metric.
