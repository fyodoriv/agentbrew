# Update three development dependencies within their current ranges

The Nov 20 audit found 14 open development dependency alerts. This change
covers the 10 new alerts in the table. Existing tasks retain their original
alert sets. Alert 181 also needs the exact node-server pin in the Promptfoo
dependency tree to move to a compatible release.

| Package | Alerts | First fixed release | Candidate lock |
| --- | --- | --- | --- |
| `hono` | 184, 185, 186, 187, 188 | 4.13.16 | 4.13.19 |
| `fast-xml-parser` | 180 | 5.12.0 | 5.12.1 |
| `mongoose` | 176, 177, 178, 179 | 9.11.4 | 9.12.2 |

- **Hypothesis**: The three supported updates reduce affected rows from 10 to 0. Existing root declarations, optional dependencies, overrides and the Node floor stay intact.
- **Measurement**: Run `heavy-run timeout 180 npx --yes --prefer-offline --package=npm@10 -- npm update --package-lock-only --ignore-scripts --include=optional hono fast-xml-parser mongoose`. Compare all matching lock entries with the version floors, run the lockfile integrity check and verify a fresh hosted installation.
- **Success**: Zero remaining affected rows, at least one resolved copy per package, zero unrelated graph changes and passing required checks. Verify the 10 alert states after default-branch ingestion.
- **Pivot**: One affected copy, an unrelated lock change, a missing dependency, or a failed installation rejects the candidate. Use a narrower supported update or retain the prior lock.
- **Anchor**: [Published Hono advisory](https://github.com/advisories/GHSA-46wx-v44x-9hh2), [Fast XML Parser advisory](https://github.com/advisories/GHSA-474x-hrwr-fgx4), [Mongoose advisory](https://github.com/advisories/GHSA-8332-j7wj-wjw4), and [npm update](https://docs.npmjs.com/cli/v10/commands/npm-update/).

Check every direct and nested lock entry. Count a row only when a resolved
copy remains in its affected range. Use the fixed version from each advisory
as the floor for current copies. Compare the root lock record and
`package.json` byte for byte with the base. Review any new resolved imports
against the published manifests for those three updated packages.

The resolver changed 22 lock records within those dependency trees. The
root lock record, Node floor, and package declarations match the base.
The lockfile integrity check passed. The hosted gate runs a fresh `npm ci`
and the default-branch alert refresh measures the final alert count.

## Published parent check

The exact Promptfoo 0.126.0 registry manifest lists node-server 2.1.6,
Chokidar 6.0.0 and a jks-js peer of ^1.1.5. Nunjucks 3.2.4 lists an
optional Chokidar ^3.3.0 peer. The development lock uses the local jks-js
stub. The package resolver still advertises Promptfoo 0.125.1, which pins
node-server 2.1.5. Alert 181 remains in its separate task while a compatible
normal resolution is unavailable. [Promptfoo registry manifest](https://registry.npmjs.org/promptfoo/0.126.0) · [Nunjucks registry manifest](https://registry.npmjs.org/nunjucks/3.2.4)
