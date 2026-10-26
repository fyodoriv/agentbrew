#!/usr/bin/env python3
"""Check a README against the readme skill's shape. Prints one line per problem; exit 1 if any."""

import re
import sys


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


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "README.md"
    found = problems(open(path, encoding="utf-8").read())
    for p in found:
        print(p)
    print(f"{len(found)} problems")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
