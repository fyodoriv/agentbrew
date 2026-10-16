# Requirements in existing repos: map, waive, change, audit

The required areas (see `SKILL.md` → "Required in every project") apply to
existing repos too. An existing repo rarely uses the scaffold's paths, so it
keeps its own layout and says where each area lives. It may also push back.

## Contents

1. Map an area to the repo's own files
2. Waive an area (push back for this repo)
3. Change a requirement (push back for every repo)
4. Monthly audit

## 1. Map an area to the repo's own files

Add `.agents/requirements.yaml` with flat lines:

```yaml
# Where this repo meets each required area. check-setup.sh reads it.
map.vision: VISION.md
map.setup: scripts/install.sh
map.e2e: real-e2e/scenarios
```

A mapped area replaces that area's default checks with one check: every path
listed must exist. The map is a claim; the monthly audit checks that the
mapped files really meet the area (for example, that `VISION.md` has a
measurable success metric and dated kill criteria). Map only what truly meets it.

## 2. Waive an area (push back for this repo)

```yaml
waive.e2e: spec-only repo; behavior is tested end to end in the CLI package
```

A waiver needs a concrete reason that would convince a reviewer, such as
"privacy forbids sending errors to a service" or "the repo ships no runtime".
"Too much work" is not a reason; file a task instead. Every run prints each
waiver, and the monthly audit re-reads them.

## 3. Change a requirement (push back for every repo)

When the same waiver shows up in two or more repos, or a requirement is wrong
in general, change the requirement itself: open a PR (or a task) on the
`new-project` skill in agentbrew that edits `SKILL.md`, the templates,
`check-setup.sh`, and `references/owner-practices.md`, with the reason and the
repos that hit it. Remove the matching waivers once it merges.

## 4. Monthly audit

Checkup commands run this once a month per repo:

1. `bash <skill>/scripts/audit-due.sh <repo>`. Stop here if it prints `not due`.
2. Run `bash <skill>/scripts/check-setup.sh <repo> --profile <profile>` and keep the output.
3. Read each mapped file and each waiver. Does the mapped file really meet the
   area? Does the waiver's reason still hold? Fix the map or the waiver if not.
4. Compare with last month's score (the checkup report). If any area is not met,
   make sure one P0 task (ID `meet-new-project-requirements`) lists every gap.
   Update it; never file a duplicate. Remove it when all areas are met.
5. A waiver that also shows up in another repo becomes a requirement-change
   proposal (section 3).
6. `bash <skill>/scripts/audit-due.sh <repo> --record`.
