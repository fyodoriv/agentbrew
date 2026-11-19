#!/usr/bin/env python3
"""Check a README against the readme skill's shape. Prints one line per problem; exit 1 if any."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def problems(text: str) -> list[str]:
    out = []
    body = re.sub(r"^```.*?^```", "", text, flags=re.M | re.S)
    blocks = re.findall(r"^```(\w*)\n(.*?)^```", text, re.M | re.S)
    head = text.split("```", 1)[0]
    intro = re.sub(r"^#[^\n]*\n", "", head.strip()).strip().split("\n\n")[0] if head.strip() else ""
    n = len([s for s in re.split(r"(?<=[.!?])\s+", intro) if s.strip()])
    if not 1 <= n <= 3:
        out.append(f"intro: {n} sentences under the title, want 1-3")
    if not blocks or blocks[0][0] != "text" or "INSTALL.md" not in blocks[0][1]:
        out.append("start: the first code block must be a `text` prompt that links INSTALL.md")
    if len(blocks) < 2 or blocks[1][0] != "bash":
        out.append("start: a one-line `bash` fallback must follow the prompt")
    else:
        line = blocks[1][1].strip()
        if "\n" in line:
            out.append("start: the bash fallback must be one line")
        if not re.search(r"(doctor|check)\S*$", line):
            out.append("start: the bash fallback must end with the doctor or a check")
    pos = {h: text.find(f"\n## {h}\n") for h in ("Use cases", "Features")}
    for h, p in pos.items():
        if p < 0:
            out.append(f"order: no `## {h}` section")
    if min(pos.values()) >= 0:
        last = text.find("```", text.find("```bash") + 3) if "```bash" in text else 0
        if not last < pos["Use cases"] < pos["Features"]:
            out.append("order: want start blocks, then ## Use cases, then ## Features")
        first_h2 = re.search(r"^## ", text, re.M)
        if first_h2 and first_h2.start() < pos["Use cases"]:
            out.append("order: ## Use cases must be the first ## section")
    h2 = re.findall(r"^## (.+)$", text, re.M)
    if "Features" in h2:
        i = h2.index("Features")
        if i + 1 >= len(h2) or h2[i + 1] != "Proof":
            out.append("proof: want a `## Proof` section right after ## Features")
    if "Proof" in h2:
        sec = text.split("\n## Proof\n", 1)[1].split("\n## ", 1)[0]
        if "```mermaid" not in sec:
            out.append("proof: the Proof section needs a Mermaid chart")
        rows = [r for r in sec.splitlines() if r.startswith("|") and not re.match(r"\|[\s:-]+\|", r)][1:]
        if not rows:
            out.append("proof: the Proof section needs a claims table")
        for r in rows:
            if not re.search(r"real use|local run|not measured yet", r, re.I):
                out.append(f"proof: row names no data kind: {r[:60]}")
    prose = re.sub(r"`[^`]*`|\|[^\n]*", "", body)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n", prose) if s.strip()]
    seen = set()
    for s in sentences:
        words = re.findall(r"[\w'-]+", s.lower())
        key = " ".join(words)
        if len(words) >= 8:
            if key in seen:
                out.append(f"repeat: {s[:70]}")
            seen.add(key)
        if len(words) > 30:
            out.append(f"long ({len(words)} words): {s[:70]}")
    for para in re.split(r"\n\s*\n", prose):
        if para.lstrip().startswith(("-", "*", "#", ">")) or re.match(r"\s*\d+\.", para):
            continue
        k = len([s for s in re.split(r"(?<=[.!?])\s+", para.strip()) if s])
        if k > 4:
            out.append(f"wall ({k} sentences): {para.strip()[:70]}")
    return out


def read_index(path: Path, *args: str) -> bytes:
    return subprocess.check_output(
        ["git", *args, f":./{path.as_posix()}"], stderr=subprocess.DEVNULL
    )


def check_budget(path: Path, staged: bool) -> int:
    try:
        config = path.with_name(".readme-budget.json")
        data = json.loads(read_index(config, "show") if staged else config.read_bytes())
        if not staged and not path.is_file():
            raise OSError
        size = int(read_index(path, "cat-file", "-s")) if staged else path.stat().st_size
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("budget: cannot read README or .readme-budget.json.", file=sys.stderr)
        return 2
    if not isinstance(data, dict):
        data = {}
    baseline = data.get("baseline_bytes")
    headroom = data.get("headroom_percent")
    reason = data.get("reason")
    if (
        type(baseline) is not int
        or baseline < 0
        or type(headroom) is not int
        or headroom < 0
        or not isinstance(reason, str)
        or not reason.strip()
    ):
        print("budget: set nonnegative baseline_bytes and headroom_percent and a reason.", file=sys.stderr)
        return 2
    limit = baseline * (100 + headroom) // 100
    if size > limit:
        print(f"budget: {size} bytes exceeds {limit} bytes. Edit the README or record a new baseline and reason.", file=sys.stderr)
        return 1
    print(f"budget: {size} of {limit} bytes.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("readme", nargs="?", type=Path, default=Path("README.md"))
    parser.add_argument("--budget", action="store_true", help="check the project's README byte budget")
    parser.add_argument("--staged", action="store_true", help="read the README and its budget from the Git index")
    args = parser.parse_args()
    if args.staged and (not args.budget or args.readme.is_absolute()):
        parser.error("--staged needs --budget and a relative README path")
    if args.budget:
        return check_budget(args.readme, args.staged)
    found = problems(args.readme.read_text(encoding="utf-8"))
    for p in found:
        print(p)
    print(f"{len(found)} problems")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
