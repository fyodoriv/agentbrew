#!/usr/bin/env python3
"""Export the run-goal ledger as dashboard datasets.

Reads the goal files the /goal hooks write (`<id>.contract.md` and
`<id>.retro.md`; the `.pending` marker is ignored) and writes, into the
output folder:

- goals.json: one row per goal.
- retro_items.json: one row per top-level retro bullet.
- manifest.json: one entry per dataset, for the Goals dashboard.

It only reads its inputs. Titles and retro lines are scrubbed: home folders
become ~, private-pattern matches, secrets, emails, private hosts and IPs, and paths outside
~/apps/tooling become placeholders. It fails closed: without the
oss-readiness pattern, or when any output line still matches it (checked
with `grep -icE`, as the leak gates do), it writes nothing and exits 2.

Usage: export-goals.py [--state-dir DIR] [--out DIR]
Defaults: $RUN_GOAL_STATE_DIR or ~/.cache/agentbrew/run-goal, and
~/.local/state/run-goal/dashboard.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TITLE_MAX = 80
TEXT_MAX = 160
PR_REF = re.compile(
    r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|\b([\w.-]+/[\w.-]+)#(\d+)\b|\bPRs?\s*#(\d+)\b",
    re.IGNORECASE,
)
RESULT = re.compile(
    r"^[\s>*_-]*goal result:?[*_]*\s*(met|partly met|blocked)\b(?:[^\n]*?\b(\d+)\s*/\s*(\d+))?",
    re.IGNORECASE | re.MULTILINE,
)
TOKEN = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b"
    r"|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_=-]{32,}"
)
KEY_VALUE = re.compile(
    r"\b((?:api[_-]?)?key|token|secret|password|passwd|pwd|auth|credential)s?(\s*[=:]\s*)[^\s,;]+"
    r"|\b(Bearer|Basic)\s+[^\s,;]+",
    re.IGNORECASE,
)
SPOKEN_SECRET = re.compile(r"\b(password|passwd|secret)s?\s+(?:is\s+|was\s+)?(?![=:\[])[^\s,;]+", re.IGNORECASE)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
HOME_DIR = re.compile(r"/(?:Users|home|usr/local/home)/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+")
URL = re.compile(r"\bhttps?://([^/\s`'\")\]]+)[^\s`'\")\]]*")
PRIVATE_HOST = re.compile(
    r"\b(?:[\w-]+\.)+(?:internal|lan|local|intranet|corp)\b|\b(?:[\w-]+\.)*corp\.[\w.-]+"
    r"|\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b",
    re.IGNORECASE,
)
PATH = re.compile(r"(?:~|/private|/tmp|/var|/opt|/etc|/Volumes|/mnt|/srv|/root)(?:/[^\s`'\")\]]*)?")
TOOLING = re.compile(r"^~/apps/tooling(?:/|$)")
ENV_REL = Path(".config") / "oss-readiness" / "oss-readiness.env"


class PrivatePatternMissing(Exception):
    pass


def private_pattern(home: Path) -> str:
    """Load the pattern the way the leak gates do: source the env file."""
    env = home / ENV_REL
    if not env.is_file():
        raise PrivatePatternMissing(f"missing {env}")
    r = subprocess.run(
        ["bash", "-c", 'source "$1" >/dev/null 2>&1; printf %s "${OSS_READINESS_INTERNAL_PATTERN:-}"', "_", str(env)],
        capture_output=True,
        text=True,
    )
    if not r.stdout:
        raise PrivatePatternMissing(f"no OSS_READINESS_INTERNAL_PATTERN in {env}")
    return r.stdout


def grep_matches(pattern: str, lines: list) -> set:
    """Substrings that `grep -oiE` finds in the lines."""
    if not lines:
        return set()
    r = subprocess.run(["grep", "-oiE", "--", pattern], input="\n".join(lines) + "\n", capture_output=True, text=True)
    if r.returncode > 1:
        raise PrivatePatternMissing(f"grep rejected the pattern: {r.stderr.strip()}")
    return {m for m in r.stdout.splitlines() if m}


def grep_count(pattern: str, text: str) -> int:
    r = subprocess.run(["grep", "-icE", "--", pattern], input=text, capture_output=True, text=True)
    if r.returncode > 1:
        raise PrivatePatternMissing(f"grep rejected the pattern: {r.stderr.strip()}")
    return int(r.stdout.strip() or 0)


def clean(text: str) -> str:
    """Scrub everything except the private pattern (applied after, with grep)."""
    text = " ".join(text.split())
    text = HOME_DIR.sub("~", text)
    text = URL.sub(lambda m: m.group(0) if m.group(1).lower() in ("github.com", "www.github.com") else "[host]", text)
    text = PRIVATE_HOST.sub("[host]", text)
    text = KEY_VALUE.sub(lambda m: (m.group(1) + m.group(2) if m.group(1) else m.group(3) + " ") + "[redacted]", text)
    text = SPOKEN_SECRET.sub(lambda m: m.group(1) + " [redacted]", text)
    text = EMAIL.sub("[email]", text)
    text = PATH.sub(lambda m: m.group(0) if TOOLING.match(m.group(0)) else "[path]", text)
    text = TOKEN.sub("[redacted]", text)
    return text


def apply_private(values: list, pattern: str) -> list:
    hits = sorted(grep_matches(pattern, values), key=len, reverse=True)
    out = []
    for v in values:
        for h in hits:
            v = re.sub(re.escape(h), "[private]", v, flags=re.IGNORECASE)
        out.append(v)
    return out


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def pr_count(retro: str) -> int:
    refs = set()
    for m in PR_REF.finditer(retro):
        if m.group(1):
            refs.add(f"{m.group(1).lower()}#{m.group(2)}")
        elif m.group(3):
            refs.add(f"{m.group(3).lower()}#{m.group(4)}")
        else:
            refs.add(f"#{m.group(5)}")
    return len(refs)


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
    ids = sorted({p.name.split(".")[0] for p in state.glob("*.contract.md")} | {p.name.split(".")[0] for p in state.glob("*.retro.md")})
    goals, items, texts = [], [], []

    def text(raw: str) -> int:
        texts.append(clean(raw))
        return len(texts) - 1

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
        found = list(retro_items(retro))
        short = gid[:8]
        dated = contract_p if contract_p.exists() else retro_p
        goals.append(
            {
                "goal_id": short,
                "date": day(dated),
                "title": text(raw_goal(contract)),
                "criteria": criteria_count(contract),
                "met": met,
                "status": status,
                "prs": pr_count(retro),
                "retro_items": len(found),
            }
        )
        for category, line in found:
            items.append({"goal_id": short, "category": text(category), "text": text(line)})

    texts = apply_private(texts, pattern)
    for g in goals:
        g["title"] = clip(texts[g["title"]], TITLE_MAX)
    for i in items:
        i["category"] = clip(texts[i["category"]], 40)
        i["text"] = clip(texts[i["text"]], TEXT_MAX)
    goals.sort(key=lambda g: (g["date"], g["goal_id"]), reverse=True)
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
    files = {
        "goals.json": json.dumps(goals, indent=1, ensure_ascii=False) + "\n",
        "retro_items.json": json.dumps(items, indent=1, ensure_ascii=False) + "\n",
        "manifest.json": json.dumps(manifest, indent=1) + "\n",
    }
    leaks = grep_count(pattern, "".join(files.values()))
    if leaks:
        raise PrivatePatternMissing(f"{leaks} output line(s) still match the private pattern; nothing written")
    out.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        (out / name).write_text(body, encoding="utf-8")
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
    try:
        counts = export(state, Path(args.out), home)
    except PrivatePatternMissing as e:
        print(f"export-goals: refusing to export: {e}", file=sys.stderr)
        return 2
    print(f"goals={counts['goals']} retro_items={counts['retro_items']} out={args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
