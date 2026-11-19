# Verify file coverage after a squash merge

Register before running the fixture or reading the selected pull request file
lists. The archived [Minsky verifier](https://github.com/fyodoriv/minsky/blob/c003a60978051172a5170c1cfc53d9bcd81d0dc3/scripts/verify-squash-merge-completeness.mjs)
compares two path sets. Keep that decision and require complete evidence from
both tools. Use the exact merged commit from the pull request receipt.

- **Hypothesis:** The verifier catches one deliberately omitted file and
  reports its exact path. All 20 selected real Agentbrew squash merges cover
  their pull request file lists.
- **Measurement:** Run the hosted CLI fixture against a temporary Git history
  and a fixed GitHub CLI response. Then run
  `node scripts/verify-squash-merge-completeness.mjs --pr <number>` in a checkout
  with the selected merge commits. Use these consecutive `main` pull requests
  in descending merge time through `015e888e`: 1139, 1135, 1136, 1131, 1132,
  1134, 1130, 1129, 1127, 1126, 1125, 1124, 1121, 1123, 1120, 1122, 1119,
  1118, 1117 and 1114.
- **Success:** The omission exits 1 and names the planted path. The complete
  control and all 20 real pulls exit 0. Missing, malformed, incomplete or
  ambiguous evidence exits 2. No command changes remote state.
- **Pivot:** If any result is inconclusive, keep the delivery check unqualified.
  If more than one real merge yields a false omission, replace path-set
  comparison with a separately registered approach. Keep every mismatch in
  the receipt and investigate it before wiring the check into delivery.
- **Anchor:** [GitHub pull request file list](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files),
  [Git diff exit and path formats](https://git-scm.com/docs/git-diff), and
  Forsgren, Humble, Kim (2018), *Accelerate*, change failure rate.

GitHub supplies the merged state, full commit ID, expected file count and
paginated file names. Git supplies the first-parent path diff for that exact
commit, with null separators and rename detection disabled. A result is about
file coverage. Byte content and authorization are separate checks.
