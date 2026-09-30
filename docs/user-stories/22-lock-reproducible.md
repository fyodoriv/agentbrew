# Lock File & Reproducible Installs

> I pin my skill sources to exact commits so every teammate gets the same versions — no surprises from upstream changes.

```bash
agentbrew lock                # show locked source versions (SHA pins)
agentbrew lock --verify       # verify installed sources match locked SHAs
```

## How it works

When you install a skill source from a git repo, agentbrew records the exact commit SHA in a lock file. This ensures that `agentbrew sync` deploys the same version of every skill, even if the upstream repo has new commits.

```
Source: my-team-skills
  Repo: git@github.com:team/agent-skills.git
  Locked: a1b2c3d (2025-03-15)
  Status: ✓ matches
```

## Verifying integrity

Run `agentbrew lock --verify` to check that every installed source matches its locked SHA. This is useful in CI or after switching machines:

```bash
$ agentbrew lock --verify
✓ my-team-skills      a1b2c3d  matches
✗ shared-rules-repo   e4f5g6h  drift detected (installed: f7g8h9i)
```

If a source has drifted, run `agentbrew sync --pull` to fetch the latest and update the lock, or manually reset to the locked version.

## Updating locked versions

```bash
agentbrew sync --pull          # fetch latest from all sources, update lock file
```

After pulling, the lock file updates to the new commit SHAs. Commit the lock file to your team config repo so everyone stays on the same versions.

## Why this matters

Without pinning, a teammate's `agentbrew sync` might pull a different version of a skill than yours — leading to inconsistent agent behavior across the team. The lock file eliminates this class of "works on my machine" problems.
