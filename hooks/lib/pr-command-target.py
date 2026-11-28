"""Resolve a simple gh PR command without evaluating shell source.

The selected target belongs to one hook invocation. Unsupported syntax clears
it; the helper prints no command text and writes no persistent state.
"""

import json
import os
import re
import shlex
import subprocess
import sys
import time
from urllib.parse import quote


PUNCTUATION = ";&|<>()\n"


# These are complete command shapes. Do not remove substrings from shell code.
LITERAL_WORD = r"""(?:'[^']*'|"(?:[^"\\$`]|\\[^\r\n])*"|[A-Za-z0-9_./:%=-]+)"""
PRINT_FORMAT = r"""(?:'%s(?:\\n)?'|"%s(?:\\n)?")"""
LITERAL_NOTE = re.compile(
    rf"[ \t]*(?:echo(?:[ \t]+{LITERAL_WORD})+|"
    rf"printf[ \t]+{PRINT_FORMAT}(?:[ \t]+{LITERAL_WORD})+|"
    rf"git[ \t]+commit[ \t]+(?:-m|--message)[ \t]+{LITERAL_WORD})[ \t]*\n?"
)
TEXT_REDIRECT = r"[ \t]+>>?[ \t]*[A-Za-z0-9_./-]+\.(?:md|txt|json)"
QUOTED_HEREDOC = re.compile(
    rf"""[ \t]*cat(?P<prior>{TEXT_REDIRECT})?[ \t]+<<[ \t]*(?P<quote>['"])"""
    rf"(?P<delimiter>[A-Za-z_][A-Za-z0-9_]*)(?P=quote)(?P<later>{TEXT_REDIRECT})?[ \t]*"
)
REPO = r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+"
HOST = r"[A-Za-z0-9][A-Za-z0-9.:-]*"
PUBLIC_PR_URL = re.compile(rf"https://github\.com/({REPO})/pull/([0-9]+)", re.IGNORECASE | re.ASCII)


def is_literal_note(command):
    if len(command) > 65536 or "\0" in command:
        return False
    if LITERAL_NOTE.fullmatch(command):
        return True
    header, separator, body = command.partition("\n")
    if not separator:
        return False
    doc = QUOTED_HEREDOC.fullmatch(header)
    if not doc or (doc["prior"] and doc["later"]):
        return False
    delimiter = doc["delimiter"]
    if body.endswith("\n"):
        body = body[:-1]
    lines = body.split("\n")
    return lines[-1] == delimiter and delimiter not in lines[:-1]


def command_words(command):
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)
        lexer.whitespace = " \t"
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return None


def pr_options(action, words, strict=False):
    values = {
        "merge": {"-A", "--author-email", "-b", "--body", "-F", "--body-file", "--match-head-commit", "-t", "--subject"},
        "view": {"-q", "--jq", "--json", "-t", "--template"},
        "ready": set(),
        "edit": {"--add-assignee", "--add-label", "--add-project", "--add-reviewer", "--attach", "-B", "--base", "-b", "--body", "-F", "--body-file", "-m", "--milestone", "--remove-assignee", "--remove-label", "--remove-project", "--remove-reviewer", "-t", "--title"},
    }[action]
    switches = {
        "merge": {"--admin", "--auto", "-d", "--delete-branch", "--disable-auto", "-m", "--merge", "-r", "--rebase", "-s", "--squash"},
        "view": {"-c", "--comments", "-w", "--web"},
        "ready": {"--undo"},
        "edit": {"--remove-milestone"},
    }[action]
    repo, head, i = "", "", 0
    while i < len(words):
        word = words[i]
        flag, equals, value = word.partition("=")
        if word.startswith("-R") and word != "-R":
            flag, equals, value = "-R", "=", word[2:]
        if flag in ("--repo", "-R") or flag in values:
            if not equals:
                i += 1
                if i >= len(words):
                    return None
                value = words[i]
            if flag in ("--repo", "-R"):
                if (strict and repo) or not re.fullmatch(rf"(?:{HOST}/)?{REPO}", value):
                    return None
                repo = value
            elif flag == "--match-head-commit":
                if strict and (head or not re.fullmatch(r"[0-9a-fA-F]{40}", value)):
                    return None
                head = value
        elif word not in switches:
            return None
        elif strict and word in ("--admin", "--disable-auto"):
            return None
        i += 1
    return repo, head


def has_unsupported_words(command, words):
    return any(character in command for character in "$`*?[]{}") or any(
        word.startswith("#") or (word and set(word) <= set(PUNCTUATION)) for word in words
    )


def target(command, words=None):
    words = command_words(command) if words is None else words
    if words is None or len(words) < 4 or has_unsupported_words(command, words):
        return None
    if os.path.basename(words[0]) != "gh" or words[1] != "pr":
        return None
    action, number = words[2:4]
    if action not in ("view", "ready", "merge", "edit") or not number.isascii() or not number.isdigit():
        return None
    options = pr_options(action, words[4:])
    return {"number": number, "repo": options[0]} if options is not None else None


def check_ready(check):
    if not isinstance(check, dict):
        return False
    if check.get("__typename") == "CheckRun":
        return check.get("status") == "COMPLETED" and check.get("conclusion") in ("SUCCESS", "SKIPPED", "NEUTRAL")
    return check.get("__typename") == "StatusContext" and check.get("state") == "SUCCESS"


def read_github_json(args, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        probe = subprocess.run(
            ["gh", *args],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=True, timeout=remaining,
        )
        if len(probe.stdout) <= 1024 * 1024:
            return json.loads(probe.stdout)
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        pass
    return None


def read_merge_readiness(argv, slug, expected_url, number, head):
    deadline = time.monotonic() + 5
    info = read_github_json(
        ["pr", "view", *argv, "--json",
         "number,url,state,isDraft,mergeStateStatus,headRefOid,baseRefName,baseRefOid,statusCheckRollup"],
        deadline,
    )
    if not isinstance(info, dict):
        return "unavailable"
    returned_url = info.get("url")
    returned_number = info.get("number")
    if (not isinstance(returned_url, str) or returned_url.lower() != expected_url.lower()
            or type(returned_number) is not int or str(returned_number) != number):
        return "unavailable"
    if info.get("headRefOid") != head.lower():
        return "changed-head"
    if info.get("state") != "OPEN" or info.get("isDraft") is not False or info.get("mergeStateStatus") != "CLEAN":
        return "not-ready"
    checks = info.get("statusCheckRollup")
    if not isinstance(checks, list) or not checks or not all(check_ready(check) for check in checks):
        return "checks-not-ready"
    branch = info.get("baseRefName")
    tested_base = info.get("baseRefOid")
    if not isinstance(branch, str) or not branch or not isinstance(tested_base, str):
        return "unavailable"
    if not re.fullmatch(r"[0-9a-fA-F]{40}", tested_base):
        return "unavailable"
    ref = read_github_json(
        ["api", "--hostname", "github.com", f"repos/{slug}/git/ref/heads/{quote(branch, safe='')}"],
        deadline,
    )
    if not isinstance(ref, dict) or ref.get("ref") != f"refs/heads/{branch}":
        return "unavailable"
    target = ref.get("object")
    if not isinstance(target, dict) or target.get("type") != "commit":
        return "unavailable"
    live_base = target.get("sha")
    if not isinstance(live_base, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", live_base):
        return "unavailable"
    return "ready" if live_base.lower() == tested_base.lower() else "changed-base"


def merge_preflight(command):
    if len(command) > 65536 or "\0" in command:
        return "unsupported"
    if is_literal_note(command):
        return "irrelevant"
    words = command_words(command)
    if words is None:
        return "unsupported"
    merge_positions = [
        index for index in range(len(words) - 2)
        if os.path.basename(words[index]) == "gh" and words[index + 1:index + 3] == ["pr", "merge"]
    ]
    if not merge_positions:
        if words and os.path.basename(words[0]) == "gh" and any(
            words[index:index + 2] == ["pr", "merge"] for index in range(1, len(words) - 1)
        ):
            return "unsupported"
        return "irrelevant"
    if merge_positions != [0] or len(words) < 4 or has_unsupported_words(command, words):
        return "unsupported"
    if words[3:] in (["--help"], ["--disable-auto"]):
        return "irrelevant"
    options = pr_options("merge", words[4:], strict=True)
    if options is None:
        return "unsupported"
    repo, head = options
    if not head:
        return "unsupported"
    url = PUBLIC_PR_URL.fullmatch(words[3])
    if url is not None and not repo:
        slug, number = url.groups()
    elif re.fullmatch(r"[0-9]+", words[3]) and re.fullmatch(rf"github\.com/{REPO}", repo, re.IGNORECASE | re.ASCII):
        _, _, slug = repo.partition("/")
        number = words[3]
    else:
        return "unsupported"
    number = number.lstrip("0")
    if not number:
        return "unsupported"
    argv = [number, "--repo", f"github.com/{slug}"]
    return read_merge_readiness(argv, slug, f"https://github.com/{slug}/pull/{number}", number, head)


def reviewer_request(command):
    words = command_words(command)
    if words is None or target(command, words) is None or words[2] != "edit":
        return False
    if len(words) == 6 and words[4] == "--add-reviewer":
        value = words[5]
    elif len(words) == 5 and words[4].startswith("--add-reviewer="):
        value = words[4].partition("=")[2]
    else:
        return False
    return bool(value.strip() and not value.startswith("-"))


def main():
    latest = None
    activity = False
    unavailable = False
    try:
        with open(sys.argv[1], encoding="utf-8") as transcript:
            for line in transcript:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                message = row.get("message", {}) if isinstance(row, dict) else {}
                content = message.get("content", []) if isinstance(message, dict) else []
                if not isinstance(content, list):
                    continue
                for item in content:
                    if not isinstance(item, dict) or item.get("type") != "tool_use" or item.get("name") != "Bash":
                        continue
                    inputs = item.get("input", {})
                    command = inputs.get("command", "") if isinstance(inputs, dict) else ""
                    if not isinstance(command, str):
                        continue
                    words = command_words(command)
                    actions = [] if words is None else [
                        words[i + 2] for i in range(len(words) - 2)
                        if os.path.basename(words[i]) == "gh" and words[i + 1] == "pr"
                    ]
                    mentions_pr = (words is not None and "pr" in words) or re.search(
                        r"\bpr\s+(create|ready|merge|view|edit)\b", command
                    )
                    if (not actions and not mentions_pr) or is_literal_note(command):
                        continue
                    if actions:
                        activity = activity or any(action in ("create", "ready", "merge") for action in actions)
                        latest = target(command, words)
                    else:
                        activity = True
                        latest = None
    except (OSError, UnicodeError, IndexError):
        latest, unavailable = None, True
    print(json.dumps({"activity": activity, "unavailable": unavailable, **(latest or {})}))


if __name__ == "__main__":
    if sys.argv[1:] == ["--merge-preflight"]:
        print(merge_preflight(sys.stdin.read(65537)))
    else:
        main()
