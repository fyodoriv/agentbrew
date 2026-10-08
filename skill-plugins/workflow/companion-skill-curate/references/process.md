### Step 2: Duplicate detection

Two flavors of duplicate matter:

**A. Exact-name duplicates across sources.** Same skill name in two
or more source repos. This is the common case when the user added a
new source that overlaps with the built-ins or with a previously-
installed catalog skill.

> **Boundary:** cross-source dedup belongs here, not in each registry's
> own `scripts/`. A bash audit in a source registry that scans sibling
> repos by filesystem convention (e.g. `~/apps/foo`, `~/apps/bar`) is
> an anti-pattern — it encodes a personal workspace layout and runs
> nowhere predictable. Agentbrew is the orchestrator across registries
> because `state.yaml::skillSourceDirs` is the only canonical list of
> *which* registries are in play. A registry's own per-repo dedup
> (e.g. duplicate `name:` within `templates/` + `teams/`) stays in
> that registry; cross-registry dedup stays here.

```bash
# Count skill name occurrences across sources
cut -f2 /tmp/companion-skill-inventory.tsv \
  | sort | uniq -c | awk '$1 > 1 {print}' \
  > /tmp/companion-skill-name-dupes.txt

cat /tmp/companion-skill-name-dupes.txt | head -20
```

For each duplicated name, read both `SKILL.md` files and confirm
they describe the same thing (sometimes a name collision is benign —
different skills happen to share a name). If they're substantively
the same, propose `agentbrew uninstall` for one of them, or
ask the user to drop one source repo.

**B. Description / scope near-duplicates.** Different skill names
but the same purpose. Limit the cluster scan to **frontmatter-only**
matches and use pre-defined keyword groups so spurious mentions of
"skill" or "audit" elsewhere in the document don't pollute counts.

```bash
# Extract just the frontmatter from each SKILL.md for cluster
# matching. The frontmatter is the first `---` block.
extract_frontmatter() {
  awk '
    /^---$/ { n++; if (n == 1) { p = 1; next }; if (n == 2) exit }
    p { print }
  ' "$1"
}

# Pre-defined cluster keyword groups (don't grep raw single words —
# "skill" matches every companion-skill-* file, etc.).
declare -A CLUSTERS=(
  [fuzzing]='(libfuzz|afl|cargo-fuzz|atheris|ruzzy|libafl|ossfuzz|harness-writing|fuzzing-dictionary)'
  [security-scan]='(codeql|semgrep|trailmark|substrate-vuln|solana-vuln|cosmos-vuln|cairo-vuln|algorand-vuln|ton-vuln)'
  [skill-authoring]='(skill-improver|designing-workflow-skills|skill-creator|writing-skills)'
  [git-and-pr]='(gh-cli|git-workflow|git-diagnose-codebase|pr-comments|second-opinion)'
  [orchestration]='(orchestrator-|minsky|pipeline-ops|run-healthy-pipelines)'
  [crypto-protocol]='(crypto-protocol-diagram|mermaid-to-proverif|constant-time|wycheproof|zeroize-audit)'
)

for cluster in "${!CLUSTERS[@]}"; do
  pattern="${CLUSTERS[$cluster]}"
  matches=()
  while IFS=$'\t' read -r label name path; do
    front=$(extract_frontmatter "$path")
    if [[ "$front" =~ $pattern ]] || [[ "$name" =~ $pattern ]]; then
      matches+=("$label/$name")
    fi
  done < /tmp/companion-skill-curate/inventory.tsv
  if [ "${#matches[@]}" -gt 3 ]; then
    printf 'cluster=%s count=%d skills=%s\n' \
      "$cluster" "${#matches[@]}" "$(IFS=,; echo "${matches[*]}")"
  fi
done
```

For clusters with >3 skills, list them and judge whether the cluster
has a clear "primary" skill the others should defer to (e.g.
Anthropic `skill-creator` (from `anthropics/skills`) and Superpowers `writing-skills` are the upstream lifecycle skills).
File TASKS.md entries proposing one of:

- **Merge**: two skills that should be one (e.g. `agentbrew-add-skill`
  and `agentbrew-add-catalog-source` both add things to agentbrew —
  could be one with subcommands)
- **Defer**: skill A says "use skill B for the broader case" in its
  description (mostly a docs fix; the skills stay)
- **Remove**: legacy / deprecated skill that's been superseded

### Step 3: Update check

For each `skillSourceDirs` entry whose `path` lives under
`~/.cache/agentbrew/sources/<owner>_<repo>/`, the source is a fetched
git repo. Check three orthogonal freshness signals — the simple
binary "is upstream ahead" check misses two important degenerate
states.

```bash
for cache_dir in ~/.cache/agentbrew/sources/*/; do
  [ -d "$cache_dir/.git" ] || continue

  local_head_iso=$(git -C "$cache_dir" log -1 --format=%aI HEAD 2>/dev/null)
  upstream_url=$(git -C "$cache_dir" remote get-url origin 2>/dev/null)
  local_dirty=$(git -C "$cache_dir" status --porcelain 2>/dev/null \
    | head -3 | wc -l | tr -d ' ')

  parse_owner_repo() {
    if [[ "$1" =~ github\.com[:/]([^/]+)/([^/]+)(\.git)?$ ]]; then
      echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
    fi
  }
  owner_repo=$(parse_owner_repo "$upstream_url")
  src_name=$(basename "$cache_dir")

  if [ -z "$owner_repo" ]; then
    echo "source=$src_name signal=non-github-remote url=$upstream_url"
    continue
  fi

  # Probe upstream HEAD via gh api. Capture status code so we can
  # tell "synced" from "upstream-unreachable" (private, deleted,
  # network blocked).
  api_out=$(gh api "repos/$owner_repo/commits" -q '.[0].commit.author.date' 2>/tmp/companion-skill-curate/gh-err.txt)
  api_status=$?

  if [ "$api_status" -ne 0 ] || [ -z "$api_out" ]; then
    err=$(head -1 /tmp/companion-skill-curate/gh-err.txt 2>/dev/null)
    echo "source=$src_name signal=upstream-unreachable url=$upstream_url err='$err'"
    [ "$local_dirty" -gt 0 ] && \
      echo "source=$src_name signal=cache-dirty count=$local_dirty"
    continue
  fi

  upstream_iso="$api_out"
  # Days between local HEAD and upstream HEAD
  delta_days=$(python3 -c "
import datetime as d
def parse(s): return d.datetime.fromisoformat(s.replace('Z','+00:00'))
print((parse('$upstream_iso') - parse('$local_head_iso')).days)
" 2>/dev/null)

  # Days since upstream itself last moved (dormant upstream signal)
  upstream_age_days=$(python3 -c "
import datetime as d
def parse(s): return d.datetime.fromisoformat(s.replace('Z','+00:00'))
print((d.datetime.now(d.timezone.utc) - parse('$upstream_iso')).days)
" 2>/dev/null)

  signal=""
  if [ "${delta_days:-0}" -gt 7 ]; then
    signal="behind-by-${delta_days}d"
  elif [ "${upstream_age_days:-0}" -gt 60 ]; then
    signal="upstream-stale-itself-${upstream_age_days}d"
  else
    signal="synced"
  fi

  echo "source=$src_name signal=$signal local-head=$local_head_iso upstream-head=$upstream_iso"
  [ "$local_dirty" -gt 0 ] && \
    echo "source=$src_name signal=cache-dirty count=$local_dirty"
done
```

Each `signal` value has a different action:

| Signal | What it means | Suggested action |
|--------|---------------|------------------|
| `synced` | All current | none |
| `behind-by-Nd` | Upstream ahead by N days (>7) | File P3: refresh source. Use the actual fetch verb from Step 1's `--help` output |
| `upstream-stale-itself-Nd` | Upstream HEAD itself is >60 days old | File P3: consider replacement / archive. A dormant upstream is a supply-chain risk |
| `upstream-unreachable` | gh api 404 / 403 / network | File P3: investigate — repo may be private, deleted, or renamed. Decide whether to keep the local clone as the source of truth |
| `cache-dirty` | Local working tree has uncommitted changes | File P2: capture and commit the cache-side edits before the next fetch overwrites them |
| `non-github-remote` | Source isn't on github.com | Informational only — manual update check needed |

For sources whose `path` doesn't live under
`~/.cache/agentbrew/sources/` (e.g. user-local `skill-plugins/dev/`
in a tracked repo like agentbrew), skip — those are managed by the
worker / human, not by an `agentbrew catalog --sources` refresh.

### Step 4: Discovery (new candidates)

Search for **agent skill sources** that aren't already installed.
Limit yourself to `--max-discovery` (default 5) high-quality finds
per session — quality over quantity. Avoid filing 30 mediocre
candidates.

Search venues, in priority order:

1. **GitHub topic search** — the highest-signal venue. Query for
   each of `claude-code-skills`, `agent-skills`, `agentskills`,
   `cursor-rules`, and `claude-skills` with star + recency filters:
   ```bash
   gh api 'search/repositories?q=topic:claude-code-skills+stars:>10&sort=updated&per_page=20' \
     --jq '.items[] | {name, full_name, html_url, stargazers_count, updated_at, description}'
   ```
   Filter to repos updated in the last 90 days with >10 stars and a
   real README. Discard anything still in draft / boilerplate.
2. **Known-good vendor and curator repos** — check these directly
   regardless of topic tags:
   - `anthropics/skills` — Anthropic's reference skills
   - `openai/skills` — OpenAI Codex-aligned skills
   - `obra/superpowers` — high-quality TDD / debug / git skills
   - `trailofbits/skills` — security-focused, already a known source
     for many users
   - `vercel-labs/*-skills` — Next.js / Vercel-aligned utilities
   - `supabase/agent-skills`, `huggingface/skills` — vendor-niche
3. **Awesome lists** — `awesome-claude-code`, `awesome-ai-coding`,
   `awesome-mcp-servers`. Fetch with `webfetch` and look for skill
   references you haven't seen. Skip if the list hasn't been updated
   in 6+ months (signal of stale curation).
4. **trailofbits/skills commits since last fetch** — when this
   source is already cached, run `gh api repos/trailofbits/skills/commits --jq '.[0:10] | .[] | .commit.message'`
   to see what's been added recently.
5. **The Anthropic blog and docs** — sometimes ship reference skills
   when a new agent feature lands (e.g. memory, computer use). Low
   refresh frequency but high signal when it happens.

**NOT a discovery venue**: [agentskills.io](https://agentskills.io)
is the **specification site** for the skill format (frontmatter
shape, naming rules). Read it for description-quality criteria when
judging candidates, but don't expect to find a catalog of skills
there — there isn't one.

For each candidate:

- Confirm the skill follows the [agentskills.io spec](https://agentskills.io)
  (proper frontmatter with `name` and `description`).
- Confirm it's NOT already in the user's catalog (check
  `agentbrew catalog list` or grep the catalog YAML).
- Confirm the upstream repo is active (last commit < 90 days).
- Read the SKILL.md to confirm the description and process look
  professional — no half-finished skills.

