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

## Observed comparison

On November 19, the archived verifier exited 0 after its file-list command
exited 7. It printed a clean result. The new verifier found every expected
path on all 20 registered Agentbrew merges. Each read-only check took 1.01 to
1.87 seconds with up to three readers at a time. The final strict metadata
candidate again passed all 20 cases in 0.90 to 1.38 seconds each.

## Delivery order checks

Register before editing the Dotfiles `/ship-it` reference. The previous merge
cascade can delete the Agentbrew branch before the new verifier runs.

- **Hypothesis:** Agentbrew keeps its branch through the exact merged-commit
  check, and `/ship-it` can distinguish verification, a missing path and
  incomplete evidence before cleanup.
- **Measurement:** Run `tests/ship-it-self-review.bats` on hosted CI. Check the
  Agentbrew-only deletion flag, the receipt and fetch order, the verifier call
  before cleanup, and the three result paths. Add a matching `/ship-it` eval.
- **Success:** Every registered guard passes and the reference preserves the
  previous branch option for other repos.
- **Pivot:** One changed merge option outside Agentbrew or one Agentbrew
  cleanup before verification rejects the integration.
- **Anchor:** Dotfiles `docs/ship-it-reference.md` Step 7 and the Agentbrew
  squash file coverage controls above.

The extracted delivery procedure ran against a scratch Git history. All
four merge-option controls passed. The direct and delivery paths reported
exit 0 for the full rename, 1 for either planted omission, and 2 for missing
evidence. The delivery procedure also refused an unmerged receipt, a commit
without the verifier, an unknown ancestor, and a missing target branch.
