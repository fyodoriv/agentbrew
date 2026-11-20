"""Classify leading Git and GitHub CLI invocations without running its shell input."""

import os
import re
import shlex
import sys


GIT_OPTIONS_WITH_VALUE = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env")
GIT_LONG_OPTIONS = ("--git-dir=", "--work-tree=", "--namespace=", "--config-env=")
GIT_SWITCHES = ("--no-pager", "--paginate", "-p", "--no-replace-objects")
GH_MERGE_LONG_OPTIONS_WITH_VALUE = (
    "--author-email", "--body", "--body-file", "--match-head-commit", "--repo", "--subject",
)
GH_MERGE_SHORT_OPTIONS_WITH_VALUE = "AbFRt"
TRUE_BOOL_VALUES = ("1", "t", "T", "true", "True", "TRUE")
BASH_END = re.compile(r"""'[^']*'|"(?:\\.|[^"\\])*"|\\.|(?P<redirect>&>>?|[<>])|(?P<end>(?:^|[ \t<>])#.*|[;&|()])""")


def leading_command(source):
    first_line = source.lstrip().partition("\n")[0]
    has_redirection = False
    for match in BASH_END.finditer(first_line):
        if match.group("end") is not None:
            return first_line[: match.start()], has_redirection
        if match.group("redirect") is not None:
            has_redirection = True
    return first_line, has_redirection


def discards_stash(words):
    for word in words:
        if word in GIT_OPTIONS_WITH_VALUE:
            next(words, None)
        elif word not in GIT_SWITCHES and not word.startswith(GIT_LONG_OPTIONS):
            return word == "stash" and next(words, "") in ("drop", "clear")
    return False


def gh_command_word(words):
    for word in words:
        if word in ("-R", "--repo"):
            next(words, None)
        elif not word.startswith(("-R", "--repo=")):
            return word
    return ""


def gh_option_states(words):
    admin = False
    help_requested = False
    for word in words:
        if word == "--":
            break
        if word in GH_MERGE_LONG_OPTIONS_WITH_VALUE:
            next(words, None)
        elif word.startswith("--"):
            flag, separator, value = word.partition("=")
            enabled = not separator or value in TRUE_BOOL_VALUES
            if flag == "--admin":
                admin = enabled
            elif flag == "--help":
                help_requested = enabled
        elif word.startswith("-"):
            shorthands, separator, value = word[1:].partition("=")
            for index, shorthand in enumerate(shorthands, start=1):
                last = index == len(shorthands)
                if shorthand in GH_MERGE_SHORT_OPTIONS_WITH_VALUE:
                    if last and not separator:
                        next(words, None)
                    break
                if shorthand == "h":
                    help_requested = not last or not separator or value in TRUE_BOOL_VALUES
    return admin, help_requested


def classify(source):
    command_line, has_redirection = leading_command(source)
    words = shlex.shlex(command_line, posix=True, punctuation_chars="<>")
    words.whitespace_split = True
    words.commenters = ""
    executable = os.path.basename(next(words, ""))

    if executable == "git" and discards_stash(words):
        return "stash"
    if executable == "gh" and not has_redirection:
        command = (gh_command_word(words), gh_command_word(words))
        if command in (("repo", "delete"), ("pr", "merge")):
            admin, help_requested = gh_option_states(words)
            if not help_requested:
                if command == ("repo", "delete"):
                    return "repo-delete"
                if admin:
                    return "admin-merge"
    return "allow"


if __name__ == "__main__":
    try:
        print(classify(sys.stdin.read()))
    except ValueError:
        sys.exit(2)
