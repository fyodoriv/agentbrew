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
