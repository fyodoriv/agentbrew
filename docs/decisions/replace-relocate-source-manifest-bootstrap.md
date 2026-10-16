# Decision: keep the source-manifest `bootstrap:` block in agentbrew

- **Status**: decided 2026-10-16
- **Decision**: keep, unchanged
- **Next review**: 2027-01-16
- **Task**: `replace-relocate-source-manifest-bootstrap` (closed by this note)

## Context

A source repo can declare a one-time setup script in its source manifest
(`agentbrew-source.yaml`, `source.yaml`, or `.agentbrew/source.yaml`):

```yaml
bootstrap: scripts/bootstrap.sh
```

agentbrew stores the path in the source state as `bootstrapScript`. The user
then runs `agentbrew bootstrap <source>`. The command runs the script with
`bash` from the source's local cache, with a 10-minute timeout. It never runs
during `install` or `sync`. `--dry-run` prints the script path only.

The code is small:

- `readSourceManifest()` and `applySourceManifest()` in `src/catalog/index-source.ts`
- `src/bootstrap.ts` (about 80 lines)
- `src/commands/cli-bootstrap.ts` (about 20 lines)
- the `bootstrapScript` field in `src/types.ts` and its handling in `src/add-source.ts`
- a README section under "Source repos can declare one-time setup"

VISION.md says to delegate, contribute, or absorb. This note checks whether the
block belongs in agentbrew, in the skills CLI, or in the overlay repos.

## Evidence (gathered 2026-10-16)

### Who uses it

- The feature landed on 2026-06-02. Its task said it was split out so that
  one private overlay could install an MCP server launcher script without
  putting org content into agentbrew (rule 8). Source: the pre-public history
  bundle on the owner's machine.
- On this machine, no tracked source declares `bootstrap:`.
  `~/.config/agentbrew/state.yaml` has no `bootstrapScript` field. A search of
  every cached source under `~/.cache/agentbrew/sources/` and every repo under
  `~/apps/` found no source manifest with a `bootstrap:` key.
- The one private overlay lives on a different machine. Its current use of the
  block **could not be verified** from here.

### What the skills CLI offers

- `skills` v1.7.2 (npm, released 2026-10-09) has no source-level lifecycle or
  setup step. Its `src/` has no install, postinstall, or bootstrap script hook.
  The "Hooks" row in its README compatibility table is about SKILL.md agent
  hooks, not install-time scripts.
- Three open feature requests ask for install lifecycle hooks, all per skill,
  not per source:
  - [#755](https://github.com/vercel-labs/skills/issues/755) (opened 2026-03-25, no comments)
  - [#1155](https://github.com/vercel-labs/skills/issues/1155) (opened 2026-05-15, one comment from a user, none from a maintainer)
  - [#2377](https://github.com/vercel-labs/skills/issues/2377) (opened 2026-10-04, no comments)
- The skills CLI has no persistent "source" object to hang a per-source script
  on. Its lock tracks single skills (see the
  [`experimental_install` test](../competition/vercel-skills-cli-vs-agentbrew.md#experimental_install-test-2026-10-16)).

## Options

### A. Keep in agentbrew

- Cost: the small code above, plus its tests and one CLI command.
- Benefit: an overlay gets a documented, opt-in setup step. The user runs it
  by name, from the same cache that agentbrew already manages.
- Risk: low. It never runs on its own.

### B. Contribute upstream

- Comment on #1155 or #755 with the agentbrew design, then delete the agentbrew
  code when upstream ships.
- Problem 1: upstream asks for per-skill hooks; agentbrew needs a per-source
  step. These are different shapes.
- Problem 2: no maintainer has replied to any of the three requests.
  Install-time scripts are also a security topic that upstream has not
  addressed.
- Problem 3: any upstream comment needs owner approval per action.

### C. Relocate to overlay-owned scripts

- The overlay's quickstart tells the user to run `bash scripts/bootstrap.sh`
  from its own clone. agentbrew deletes the command, the manifest parsing, and
  the state field (rule 7: delete before adding).
- Problem: the only known user is the private overlay, which this machine
  cannot see. Removing the command would break that overlay's quickstart
  without warning, and nobody here can update it in the same change.

## Recommendation

**Keep (option A).** No upstream tool covers a per-source setup step, and the
code is small and opt-in. Relocation is the better end state only if the
private overlay no longer needs the block, and that fact cannot be checked from
this machine.

## Next review: 2027-01-16

At the review, do these checks:

1. On the machine that has the private overlay, check its source manifest for a
   `bootstrap:` key. If there is none, choose option C: delete the command and
   the manifest parsing, and update the README.
2. Check #755, #1155, and #2377 for a maintainer reply. If upstream accepts a
   lifecycle hook that can run once per source, reopen option B.
3. If neither changes, keep the block and set the next review three months
   later.

## Noticed, not changed

- The `agentbrew bootstrap --help` examples use `vercel-labs/skills` and
  `skills`. That source declares no bootstrap script, so the example fails
  with "does not declare a bootstrap script".
