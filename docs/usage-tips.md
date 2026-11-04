# Usage tips are retired

Usage tips are no longer supported. Agentbrew does not register the retired
Stop hook or deploy its producer/catalog, and the performance status line does
not read or replay cached tips. Do not reinstall the retired standalone plugin.

Existing private tip history stays in place, unused. Retirement does not read
native transcripts or historical tip logs, delete backups, or rewrite history.
Normal performance statistics and unrelated agent hooks remain supported.

The [retirement plan](plans/retire-usage-tips.md) separates source tests,
qualified installed-hook/helper reconciliation, and repository archive
readback. A source gate alone does not prove that an older installation has
been reconciled. Machine defaults and existing enabled entries belong to the
dotfiles overlay retirement; agentbrew owns agent hook and helper deployment.
