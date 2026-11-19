"""Classify a leading Git invocation without running its shell input."""

import os
import re
import shlex
import sys


GIT_OPTIONS_WITH_VALUE = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env")
GIT_LONG_OPTIONS = ("--git-dir=", "--work-tree=", "--namespace=", "--config-env=")
GIT_SWITCHES = ("--no-pager", "--paginate", "-p", "--no-replace-objects")
BASH_END = re.compile(r"""'[^']*'|"(?:\\.|[^"\\])*"|\\.|(?P<end>(?:^|[ \t<>])#.*|[;&|()])""")


def leading_command(source):
    first_line = source.lstrip().partition("\n")[0]
    for match in BASH_END.finditer(first_line):
        if match.group("end") is not None:
            return first_line[: match.start()]
    return first_line


def discards_stash(source):
    words = shlex.shlex(leading_command(source), posix=True, punctuation_chars="<>")
    words.whitespace_split = True
    words.commenters = ""
    executable = next(words, "")
    if os.path.basename(executable) != "git":
        return False

    for word in words:
        if word in GIT_OPTIONS_WITH_VALUE:
            next(words, None)
        elif word not in GIT_SWITCHES and not word.startswith(GIT_LONG_OPTIONS):
            return word == "stash" and next(words, "") in ("drop", "clear")
    return False


if __name__ == "__main__":
    try:
        print("block" if discards_stash(sys.stdin.read()) else "allow")
    except ValueError:
        sys.exit(2)
