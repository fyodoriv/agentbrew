"""Classify known leading commands without evaluating shell input."""

import os
import re
import shlex
import stat
import subprocess
import sys
from pathlib import Path


GIT_OPTIONS_WITH_VALUE = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env")
GIT_LONG_OPTIONS = ("--git-dir=", "--work-tree=", "--namespace=", "--config-env=")
GIT_SWITCHES = ("--no-pager", "--paginate", "-p", "--no-replace-objects")
GH_MERGE_LONG_OPTIONS_WITH_VALUE = (
    "--author-email", "--body", "--body-file", "--match-head-commit", "--repo", "--subject",
)
GH_MERGE_SHORT_OPTIONS_WITH_VALUE = "AbFRt"
TRUE_BOOL_VALUES = ("1", "t", "T", "true", "True", "TRUE")
BASH_END = re.compile(r"""'[^']*'|"(?:\\.|[^"\\])*"|\\.|(?P<redirect>&>>?|[<>])|(?P<end>(?:^|[ \t<>])#.*|[;&|()])""")
TEMP_ARGUMENT = re.compile(r"rm[ \t]+(?:-[A-Za-z-]+[ \t]+)+\$TMPDIR/[A-Za-z0-9._/-]+[ \t]*")


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


def owned_directory(path):
    try:
        info = path.lstat()
        return stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022
    except (AttributeError, OSError):
        return False


def temporary_roots():
    roots = {}
    for name in ("/tmp", "/var/tmp"):
        path = Path(name)
        physical = path.resolve()
        if physical in (path, Path(f"/private{name}")) and physical.is_dir():
            roots[path] = roots[physical] = physical
    if sys.platform == "darwin":
        try:
            path = Path(subprocess.check_output(
                ["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"], timeout=2, text=True, stderr=subprocess.DEVNULL,
            ).rstrip("\n"))
            physical = path.resolve()
            if path.is_absolute() and owned_directory(physical):
                roots[path] = roots[physical] = physical
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError):
            pass
    return roots


def verified_path(value, roots):
    if not value.startswith("/") or any(character in value for character in "$`*?[]{}~\\"):
        return None
    if any(not character.isprintable() for character in value) or any(
        component in ("", ".", "..") for component in value[1:].rstrip("/").split("/")
    ):
        return None
    requested = Path(value)
    for alias, physical in roots.items():
        if requested != alias and alias not in requested.parents:
            continue
        target = physical / requested.relative_to(alias)
        current = physical
        for component in requested.relative_to(alias).parts:
            current /= component
            try:
                info = current.lstat()
                if stat.S_ISLNK(info.st_mode) or current.is_mount():
                    return None
            except FileNotFoundError:
                break
            except OSError:
                return None
        return target
    return None


def recursive_force_outside_scratch(command_line, words, has_redirection):
    recursive = force = False
    options = True
    targets = []
    for word in words:
        if options and word == "--":
            options = False
        elif options and (word in ("--recursive", "--force") or re.fullmatch(r"-[A-Za-z]+", word)):
            recursive |= word == "--recursive" or (not word.startswith("--") and bool(set(word) & {"r", "R"}))
            force |= word == "--force" or (not word.startswith("--") and "f" in word)
            if not word.startswith("--") and not re.fullmatch(r"-[fRrdiIvWxP]+", word):
                targets.append(word)
        else:
            targets.append(word)
    if not (recursive and force):
        return False
    if has_redirection or not targets:
        return True

    roots = temporary_roots()
    configured = os.environ.get("TMPDIR", "")
    configured_path = verified_path(configured, roots)
    if configured_path not in roots.values() and (configured_path is None or not owned_directory(configured_path)):
        configured_path = None
    scratch = Path.home().resolve() / "apps" / "agent-scratch"
    if scratch.resolve() == scratch and owned_directory(scratch):
        roots[scratch] = scratch

    if len(targets) == 1 and TEMP_ARGUMENT.fullmatch(command_line):
        if configured_path is None or not re.fullmatch(r"/[A-Za-z0-9._/-]+", configured):
            return True
        suffix = targets[0][len("$TMPDIR/"):]
        targets = [f"{configured.rstrip('/')}/{suffix}"]
    protected_roots = {None, configured_path, *roots.values()}
    return any(verified_path(target, roots) in protected_roots for target in targets)


def classify(source, npm_only=False):
    command_line, has_redirection = leading_command(source)
    words = shlex.shlex(command_line, posix=True, punctuation_chars="<>")
    words.whitespace_split = True
    words.commenters = ""
    executable = os.path.basename(next(words, ""))

    if executable == "npm" and next(words, "") == "publish":
        return "npm-publish"
    if npm_only:
        return "allow"
    if executable == "git" and discards_stash(words):
        return "stash"
    if executable == "rm" and recursive_force_outside_scratch(command_line, words, has_redirection):
        return "recursive-delete"
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
        print(classify(sys.stdin.read(), npm_only=sys.argv[1:] == ["npm"]))
    except (OSError, RuntimeError, ValueError):
        sys.exit(2)
