# Deploy a local skill folder

Declare a local folder in its owning repo's Agentfile:

```yaml
skillDirectories:
  - ./skills
```

Run `agentbrew sync --dry-run` to preview, then `agentbrew sync` to deploy.
Every skill found by the existing skill scanner is selected, including future
additions. The scanner uses skill folder basenames, not frontmatter names.
It scans direct children and `skills/`, with its existing bounded recursive
fallback when neither layout contains skills. Agent feature limits still apply.
No new renderer or host-specific copy path is used.

`sources:` registers a browsable source whose installed skill names remain
explicit selections. `skillDirectories:` opts a local folder into all-skill
deployment. An all-folder declaration takes effect before path deduplication,
so an older source with no selected names cannot hide it. Removing the last
all-folder declaration restores the older source's selection unchanged.

## Ownership and removal

Each declaration belongs to its Agentfile directory. The same folder can have
separate owners. Removing a declaration and syncing from that owning repo
removes only its registration; other owners and manual source entries remain.
`--no-prune` keeps registrations the Agentfile no longer declares.

A missing folder stays declared. Sync removes its unchanged deployed links,
then discovers its skills again when the folder returns. Watch mode monitors
the declared folder and its parent so recreation can trigger sync.

The manifest records exact destination-to-source link receipts only after a
successful deployment. A later sync removes an obsolete link only while its
target still matches that receipt and no remaining source selects it. Real
folders and retargeted owner links are preserved. Pre-existing destinations
are not adopted by an all-folder declaration.

Owner conflicts have separate manifest-scoped protection records. These remain
after declaration removal and manual-selection restoration. Protection ends
when the owner removes the destination and a sync observes it absent. The
next sync can then deploy the selected source there. These records contain
local paths only; they hold no skill bodies or personal payloads.
Standalone repair sweeps honor the same protection, including broken owner links.
They also preserve retained deployment receipts for excluded hosts and deferred
`--no-prune` removals. Normal sync retires links only for its active host targets.

Dry runs do not change registrations, links, or manifest receipts. Regression
coverage is in `src/sync/skill-directories.test.ts`.

## Catalog owner conflicts

`agentbrew install skill-creator` selects only the public `anthropics/skills`
creator. An Agentfile can also select it with `skills: [skill-creator]`. The
catalog entry is optional (`recommended: false`); it points upstream and
does not contain a copy of the skill body. Indexed source providers and a
native host creator do not substitute for this explicit catalog selection.

This entry sets `preserveExisting: true`. The policy applies only to its exact
installed staging path when the selected source matches the catalog provider.
Existing owner folders and foreign links stay in place without adoption,
backup replacement, or overwrite. Sync skips those destinations and records
explicit conflicts. Installing the source does not prove that a preserved
owner workflow matches it. Review the conflict before choosing a workflow.

During `sync --pull`, an existing protected owner path withholds the whole
external skills updater before either its `check` or `update` command. In
upstream skills 1.7.4, `check` is an updating alias, so it is not a read-only
probe. Agentbrew reports that the delegate was withheld; it does not claim
those external skills are current. Managed Git/index updates, staging refresh,
and native sync still run.

The read-only guard covers first-pull requests before installation, selected
catalog policies, retained conflicts, and retargeted receipts. Shared paths and
excluded hosts count because the external updater is global. Selected catalog
owners on excluded hosts also enter native conflict protection before broken
link cleanup. A different active source winner does not acquire this catalog
policy by basename alone. When no protected path or retained conflict applies,
the existing delegated update behavior stays in effect.

The pull entrypoint and central update handler strictly read applicable global,
project, explicit, and workspace Agentfiles before updating. A present invalid
or unreadable policy stops the operation with exit status 1. Diagnostics show
only a sanitized reason and file location, never YAML contents or parser
payloads. Missing optional global/project files remain ordinary; a missing
explicit file or failed application of a present policy stops the pull.

A failed first fetch does not discard the request's owner protection. Native
cleanup keeps shared and excluded owner links without adopting a source or
staged receipt, and conflicts survive deselection. Unchanged receipt-managed
creator links also withhold the opaque global updater; managed Git, staging,
and native refresh continue through their own paths.

New links get exact destination-to-source receipts in the existing
manifest-scoped `localSkillLinks`; owner conflicts use `localSkillConflicts`.
Only active-host receipt reconciliation removes an unchanged managed link
when its source is no longer selected. Excluded hosts and deferred
`--no-prune` removals retain their receipts. Owner retargets stay protected,
including broken links, after selection removal and standalone repair.
Protection clears when the owner removes the destination and sync observes it
absent. This is the same lifecycle used by local declared skill folders.

The catalog field defaults to false. Other catalog entries keep the existing
skill-copy migration behavior; this policy does not grant overwrite permission.
Codex's `.system/skill-creator` is left untouched. The Anthropic upstream body,
a host-native creator, and an existing owner's copy are different workflows.
Do not claim semantic equivalence from their shared name.

Static compatibility was checked against public `anthropics/skills` commit
`ca45fc496a3436251f191354091d557da31c15b5`, path
`skills/skill-creator/SKILL.md`: frontmatter declares `name` and `description`,
with no `allowed-tools`, `context`, or `hooks` feature declaration. The normal
feature gate permits this basic skill on Claude Code and Codex. That check
does not prove every body instruction or model task behaves identically.
The installer copies the whole selected skill folder. Its companion `scripts/`,
`agents/`, and `assets/` paths remain relative to the deployed skill link;
scratch fixtures verify representative script, grader, and review-asset bytes.
Synthetic scratch-home tests cover the actual Agentfile, installer, staging,
deployment, conflicts, and receipt lifecycle without running a real workflow.
