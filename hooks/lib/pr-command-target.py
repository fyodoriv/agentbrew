"""Resolve a simple gh PR command without evaluating shell source.

The selected target belongs to one hook invocation. Unsupported syntax clears
it; the helper prints no command text and writes no persistent state.
"""

import json
import os
import re
import shlex
import sys


PUNCTUATION = ";&|<>()\n"


def command_words(command):
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)
        lexer.whitespace = " \t"
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return None


def target(command, words=None, include_review=False):
    if any(character in command for character in "$`*?[]{}"):
        return None
    words = command_words(command) if words is None else words
    if words is None or any(word.startswith("#") or (word and set(word) <= set(PUNCTUATION)) for word in words):
        return None
    if len(words) < 4 or os.path.basename(words[0]) != "gh" or words[1] != "pr":
        return None
    action, number = words[2:4]
    if action not in ("view", "ready", "merge", "edit") or not number.isascii() or not number.isdigit():
        return None
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
    repo, i, review_request = "", 4, False
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
                if not re.fullmatch(r"(?:[A-Za-z0-9][A-Za-z0-9.:-]*/)?[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+", value):
                    return None
                repo = value
            elif flag == "--add-reviewer" and value.strip() and not value.startswith("-"):
                review_request = True
        elif word not in switches:
            return None
        i += 1
    result = {"number": number, "repo": repo}
    if include_review:
        result["review_request"] = review_request
    return result


def reviewer_request(command):
    result = target(command, include_review=True)
    return bool(result and result["review_request"])


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
                    if actions:
                        activity = activity or any(action in ("create", "ready", "merge") for action in actions)
                        latest = target(command, words)
                    elif (words is not None and "pr" in words) or re.search(r"\bpr\s+(create|ready|merge|view|edit)\b", command):
                        activity = True
                        latest = None
    except (OSError, UnicodeError, IndexError):
        latest, unavailable = None, True
    print(json.dumps({"activity": activity, "unavailable": unavailable, **(latest or {})}))


if __name__ == "__main__":
    main()
