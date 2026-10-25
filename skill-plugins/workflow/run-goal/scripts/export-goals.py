#!/usr/bin/env python3
"""Export the run-goal ledger as dashboard datasets.

Reads the goal files the /goal hooks write (`<id>.contract.md`,
`<id>.retro.md`, `<id>.pending`) and writes, into the output folder:

- goals.json: one row per goal.
- retro_items.json: one row per top-level retro bullet.
- manifest.json: one entry per dataset, for the Goals dashboard.

It only reads its inputs. Titles and retro lines are scrubbed: private
pattern matches, token-like strings, emails, and paths outside
~/apps/tooling become placeholders.

Usage: export-goals.py [--state-dir DIR] [--out DIR]
Defaults: $RUN_GOAL_STATE_DIR or ~/.cache/agentbrew/run-goal, and
~/.local/state/run-goal/dashboard.
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

TITLE_MAX = 80
TEXT_MAX = 160
PR_URL = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+")
RESULT = re.compile(
    r"goal result:?\**\s*(met|partly met|blocked)\b(?:[^\n]*?\b(\d+)\s*/\s*(\d+))?",
    re.IGNORECASE,
)
TOKEN = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/_-]{40,})\b"
)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
HOME_DIR = r"/(?:Users|home)/[^/\s]+"
PATH = re.compile(r"(?:~|" + HOME_DIR + r"|/private|/tmp|/var|/opt|/etc)(?:/[^\s`'\")\]]*)?")
TOOLING = re.compile(r"^(?:~|" + HOME_DIR + r")/apps/tooling(?:/|$)")


def private_pattern(home: Path):
    """Return the owner's private-reference regex, or None when absent."""
    env = home / ".config" / "oss-readiness" / "oss-readiness.env"
    try:
        text = env.read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"^\s*(?:export\s+)?OSS_READINESS_INTERNAL_PATTERN=(.*)$", text, re.M)
    if not m:
        return None
    raw = m.group(1).strip().strip("'\"")
    try:
        return re.compile(raw, re.IGNORECASE) if raw else None
    except re.error:
        return None


def scrub(text: str, pattern, limit: int) -> str:
    text = " ".join(text.split())
    if pattern is not None:
        text = pattern.sub("[private]", text)
    text = TOKEN.sub("[redacted]", text)
    text = EMAIL.sub("[email]", text)
    text = PATH.sub(lambda m: m.group(0) if TOOLING.match(m.group(0)) else "[path]", text)
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def section(text: str, name: str) -> str:
    m = re.search(rf"^##\s+{name}\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S | re.I)
    return m.group(1) if m else ""


def raw_goal(contract: str) -> str:
    m = re.search(r"^\**raw goal\**:?\**\s*(.+)$", contract, re.M | re.I)
    if m:
        return m.group(1)
    m = re.search(r"^#\s+(?:goal contract\s*[—:-]\s*)?(.+)$", contract, re.M | re.I)
    return m.group(1) if m else ""


def criteria_count(contract: str) -> int:
    return len(re.findall(r"^\s{0,1}(?:\d+[.)]|[-*])\s+\S", section(contract, "Done when"), re.M))


def retro_items(retro: str):
    """Yield (category, text) for each top-level bullet under a ## heading."""
    category = ""
    for line in retro.splitlines():
        h = re.match(r"^##\s+(.+?)\s*$", line)
        if h:
            category = h.group(1).strip().lower()
            continue
        b = re.match(r"^[-*]\s+(.+)$", line)
        if b and category:
            yield category, b.group(1)


def day(path: Path) -> str:
    ts = path.stat().st_mtime
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat()


def export(state: Path, out: Path, home: Path) -> dict:
    pattern = private_pattern(home)
    ids = sorted(
        {p.name.split(".")[0] for p in state.glob("*.md") if p.name.endswith((".contract.md", ".retro.md"))}
    )
    goals, items = [], []
    for gid in ids:
        contract_p, retro_p = state / f"{gid}.contract.md", state / f"{gid}.retro.md"
        contract, retro = read(contract_p), read(retro_p)
        result = RESULT.search(retro)
        if result:
            status = result.group(1).lower()
        elif retro:
            status = "done"
        else:
            status = "open"
        met = int(result.group(2)) if result and result.group(2) else None
        found = [(c, t) for c, t in retro_items(retro)]
        short = gid[:8]
        dated = contract_p if contract_p.exists() else retro_p
        goals.append(
            {
                "goal_id": short,
                "date": day(dated),
                "title": scrub(raw_goal(contract), pattern, TITLE_MAX) if contract else "",
                "criteria": criteria_count(contract),
                "met": met,
                "status": status,
                "prs": len(set(PR_URL.findall(retro))),
                "retro_items": len(found),
            }
        )
        for category, text in found:
            items.append(
                {
                    "goal_id": short,
                    "category": scrub(category, pattern, 40),
                    "text": scrub(text, pattern, TEXT_MAX),
                }
            )
    goals.sort(key=lambda g: (g["date"], g["goal_id"]), reverse=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "goals.json").write_text(json.dumps(goals, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "retro_items.json").write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest = [
        {
            "id": "goals",
            "title": "Goals run",
            "description": "One row per /goal run: date, short title, criteria, met, status, PRs, retro items.",
            "file": "goals.json",
            "staleAfterHours": 168,
        },
        {
            "id": "retro_items",
            "title": "Retro items",
            "description": "One row per retro bullet: goal id, category heading, one scrubbed line.",
            "file": "retro_items.json",
            "staleAfterHours": 168,
        },
    ]
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    return {"goals": len(goals), "retro_items": len(items)}


def main() -> int:
    home = Path(os.environ.get("HOME", str(Path.home())))
    ap = argparse.ArgumentParser(description="Export run-goal datasets for the Goals dashboard.")
    ap.add_argument("--state-dir", default=os.environ.get("RUN_GOAL_STATE_DIR", str(home / ".cache/agentbrew/run-goal")))
    ap.add_argument("--out", default=str(home / ".local/state/run-goal/dashboard"))
    args = ap.parse_args()
    state = Path(args.state_dir)
    if not state.is_dir():
        print(f"no goal state folder: {state}", file=sys.stderr)
        return 1
    counts = export(state, Path(args.out), home)
    print(f"goals={counts['goals']} retro_items={counts['retro_items']} out={args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
