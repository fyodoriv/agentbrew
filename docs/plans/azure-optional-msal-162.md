# Update the optional Azure dependency for alert 162

This stage measures only alert 162. Preserve the original nine-row task
and its strict full-graph requirement. The existing Promptfoo and
Nunjucks peer issue remains in its own task.

- **Hypothesis:** A normal npm update of the existing optional Azure Identity and MSAL declarations reduces the affected alert row from 1 to 0 while preserving optional Azure support and unrelated dependencies.
- **Measurement:** Run `heavy-run npx --yes --prefer-offline --package=npm@10 -- npm update --package-lock-only --ignore-scripts --include=optional @azure/identity @azure/msal-node`. Compare lock records, resolve the normal optional tree before and after, verify clean hosted installation, then read alert 162 after default-branch ingestion.
- **Success:** Every MSAL copy is at least 7.1.0, at least 1 optional Azure Identity path remains, and all reachable new nodes are supported by published parent manifests. There are 0 changes outside the old or new Azure dependency trees, 0 new graph problems, and 0 changes to direct declarations, the root lock record, Node floor or overrides. Hosted checks pass and alert 162 is fixed with a timestamp.
- **Pivot:** Reject if 1 required optional edge disappears, 1 affected MSAL copy or unexpected graph problem remains, 1 unrelated record changes, or normal install needs a peer override.
- **Anchor:** [MSAL advisory](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5), [Azure Identity 4.14.1 manifest](https://registry.npmjs.org/@azure%2fidentity/4.14.1), and [existing dependency controls](dependency-alert-controls.md).

The initial lock has Azure Identity 4.13.3 with MSAL ^6.0.0. The direct
optional MSAL is 7.0.1 and the nested copy is 6.0.1. The published Identity
4.14.1 manifest permits MSAL ^7.1.0 and keeps the same Node requirement.
Keep both root optional declarations. Use npm's normal resolver. Do not
drop optional dependencies or change the existing peer policy to make
this stage pass.
