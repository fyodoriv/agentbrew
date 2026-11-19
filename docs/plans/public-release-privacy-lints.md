# Public-release privacy check

The release check should catch a real home directory in code or docs and a direct upload to an unapproved host before the change can ship.

- **Hypothesis**: The existing OSS gate plus bounded static checks will catch three seeded cases that the public gate misses today, with zero false alarms in the current tracked tree.
- **Measurement**: Run `npm run check:oss`. Compare the three isolated fixture results with the tracked-tree result. Run `npx vitest run src/public-release-preflight-repo-check.test.ts` to verify preflight propagates failure.
- **Success**: All three unsafe fixtures fail, the current tree has zero findings, and the preflight returns a failure when the OSS check fails.
- **Pivot**: If more than two current-tree findings are false alarms, narrow the match or use a reviewed allowance. Do not add a broad exemption to make the check pass.
- **Anchor**: `preflight-privacy-lints` in `TASKS.md`, OWASP ASVS V8, and the archived Minsky path and data-egress lints.

Scan public source and docs using the tracked-file inventory. Report only file paths and line numbers. Recognize static HTTP uploads without replaying requests. Keep configured private identifier checks on the same release path.
