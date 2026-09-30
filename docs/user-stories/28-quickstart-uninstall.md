# One-liner Setup + Symmetric Uninstall

> My team has a private overlay repo and I want a single command that installs agentbrew AND configures it with our team config. Same for uninstall — one line restores my machine to vanilla.

Each team overlay ships its own `bin/quickstart` and `bin/uninstall` scripts. agentbrew core doesn't ship them — they live in the overlay repo because they know your team's specific URLs, install preferences, and one-time bootstrap.

```bash
# install — full overlay setup on a fresh machine
git clone <overlay-repo-url> ~/apps/<overlay-dir>
~/apps/<overlay-dir>/bin/quickstart

# uninstall — symmetric reversal
~/apps/<overlay-dir>/bin/uninstall
```

## Why each overlay ships its own scripts

agentbrew core can't know your team's setup choices:

- Which Node/npm/volta version to install
- What env vars to set in the operator's shell
- What one-time bootstrap to run (auth tokens, proxy config, etc.)
- What companion tools to install alongside (e.g. dotfiles overlay)

The overlay knows. The overlay's scripts wrap the generic `agentbrew team set/unset` with operator-friendly bits specific to that team.

## What `bin/quickstart` does

Typical implementation (the overlay's choice — agentbrew doesn't enforce):

1. Install agentbrew if absent (`npm install -g agentbrew` or equivalent)
2. Run `agentbrew team set <overlay-repo-url>` (the overlay points at itself by URL)
3. Run `agentbrew sync` to deploy overlay-registered content to all agents
4. Print a green one-liner summary of what changed

Each step is idempotent — re-running `bin/quickstart` on an already-configured machine is a no-op.

## What `bin/uninstall` does

Symmetric reversal. Typical implementation:

1. Run `agentbrew team unset` (removes overlay-tagged state)
2. Print a one-line summary

Does **not** delete the local clone of the overlay repo (operator may re-enable later). Does **not** touch user-added entries (`origin: "user"`). Does **not** uninstall agentbrew itself.

## Independence guarantee — each overlay touches only its own scope

If you have **both** an agentbrew overlay and a dotfiles overlay from the same team:

- `agentbrew-<company>/bin/quickstart` configures only agentbrew — never touches dotfiles state
- `dotfiles-<company>/bin/quickstart` configures only dotfiles — never touches agentbrew state

A user who wants only agentbrew runs only its overlay's quickstart. A user who wants the full setup chains them:

```bash
git clone <agentbrew-overlay-url> ~/apps/agentbrew-<company> \
  && ~/apps/agentbrew-<company>/bin/quickstart \
  && git clone <dotfiles-overlay-url> ~/apps/dotfiles-<company> \
  && ~/apps/dotfiles-<company>/bin/quickstart
```

The acceptance tests for each overlay's quickstart explicitly assert that the other tool's state is untouched (see the overlay's `tests/quickstart.bats`).

## Worked example

Each overlay repo (`agentbrew-<org>`, `dotfiles-<org>`) ships its own `bin/quickstart`. Read one to see the canonical shape: a short, idempotent shell script with a clear summary at the end.

## Why this is in agentbrew's user stories, not just the overlay's README

The pattern is generic — every overlay benefits from a quickstart/uninstall pair. Documenting it here means:

1. Future overlay authors have a template to follow
2. agentbrew's contract with overlays is explicit (overlays provide their own quickstart)
3. The "one-line setup" UX is preserved across teams — each team's URL is different, but the shape is the same

## Related

- [US 27: Team overlays](27-team-overlay.md) — the underlying `team set/unset/status` commands wrapped by the quickstart scripts
- dotfiles US 10: Add your company's config without forking — the matching dotfiles-side overlay pattern
