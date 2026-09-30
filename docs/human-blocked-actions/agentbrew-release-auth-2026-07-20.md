# Human-blocked action: restore agentbrew release authentication

**Status**: pending
**Filed**: 2026-07-20
**Agent**: Cursor
**TASKS.md entry**: restore-agentbrew-release-automation

## Why the action is required

Agentbrew's documented release path bumps the package version after a merge and
then publishes that tagged version to npm. PR #1401 merged changes to packaged
rule templates, but no version-bump workflow ran, so npm cannot receive a new
artifact. The merged source and local installation are current; only the
public package release remains blocked.

## Why it cannot be avoided

The documented automatic path did not start. `github.com/fyodoriv/agentbrew`
is the only canonical home, and GitHub Actions is disabled there. The workflow
includes a `workflow_dispatch` fallback, but a maintainer must enable Actions
on `fyodoriv/agentbrew` before anyone can trigger it. The documented manual
fallback also cannot run because `npm whoami` returns `ENEEDAUTH`; obtaining
npm credentials and the required one-time password needs the maintainer's
interactive npm authentication. Creating an undocumented tag or publishing an
untagged version would violate the repository release contract.

## Workarounds attempted

| Path | Tried | Outcome | Reason ruled out |
|---|---|---|---|
| Enterprise Auto-release workflow | 2026-07-20 | No run appeared after the merge; Actions permissions API returned 404 | The agent cannot enable the enterprise runner or repository Actions policy through the available API |
| `fyodoriv/agentbrew` Auto-release workflow | 2026-07-20 | Actions permissions report `enabled: false` | Ruled out while the mirror existed. The mirror is retired, so enabling Actions here is now the fix |
| Manual workflow dispatch | 2026-08-17 | HTTP 422 before this fallback was added; the current branch adds `workflow_dispatch` | Needs GitHub Actions enabled on `fyodoriv/agentbrew` |
| Documented `publish:latest` fallback | 2026-07-20 | `npm whoami` returned `ENEEDAUTH` | npm login and publish OTP require maintainer interaction |

## Sources consulted

- **Documentation** (2026-07-20): `README.md` “Publishing to npm” requires an
  automatic version bump followed by manual npm publish.
- **Workflow source**: `.github/workflows/auto-publish.yml` creates the release
  commit and tag on pushes to `main` or a manual dispatch.
- **Live observation**: PR #1401 merged; `gh run list` returned no new
  Auto-release run; the `fyodoriv/agentbrew` Actions permission endpoint
  returned `{"enabled":false}`.
- **Live observation**: `gh workflow run auto-publish.yml --ref main` returned
  HTTP 422 because workflow dispatch is unsupported.
- **Live observation**: `npm whoami` returned `ENEEDAUTH`.
- **Code anchor**: `scripts/publish-latest.sh` checks npm auth before publishing
  and forwards the required OTP to `npm publish`.

## Exact action the human must take

1. Enable GitHub Actions on `github.com/fyodoriv/agentbrew`, then trigger
   the `Auto-release` workflow for the merged `main` commit.
2. After the workflow creates `release: vX.Y.Z [skip ci]` and its tag,
   authenticate npm on this machine:

   ```bash
   npm login
   npm whoami
   ```

3. Publish the tagged version with the authenticator OTP:

   ```bash
   cd ~/apps/tooling/agentbrew
   npm run publish:latest -- --otp=<current-code>
   ```

## Verification after action

```bash
gh run list --workflow auto-publish.yml --limit 1
npm view agentbrew version
npx agentbrew@latest --version
```

Expected: the workflow is successful and the npm/latest versions match the new
tag.

## Pivot if the action fails

If Actions stays disabled on `fyodoriv/agentbrew`, add a reviewed manual
release path that creates the version commit and tag on `main` without
requiring a local protected-branch push. Keep npm publication manual until a
trusted-publisher path removes the interactive OTP dependency.

## Resolution

