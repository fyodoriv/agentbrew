#!/usr/bin/env python3
"""Find a too-broad search root for hooks/checks/no-home-crawl.sh.

Reads NHC_* from the environment; prints "<tool>\t<root>" or nothing.
"""
import os, re, shlex

hook_tool = os.environ["NHC_TOOL"]
cmd = os.environ["NHC_COMMAND"]
cwd = os.environ["NHC_CWD"]
home = os.path.normpath(os.environ["NHC_HOME"] or "/")
user = os.environ.get("NHC_USER", "")
broad = {"/", home, os.path.join(home, "Library"), os.path.join(home, "Library", "Application Support")}
LITERAL_TILDE = "\x00literal-tilde\x00"
SEARCH_TOOLS = ("rg", "grep", "ag", "ug", "ugrep", "fd", "find")

# Options that take a value as the next word, per tool.
GREP_VALUES = {"-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir", "-d", "-D"}
VALUE_OPTS = {
    "rg": {"-e", "-f", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "-m", "--max-count",
           "-A", "-B", "-C", "-j", "--threads", "-M", "--max-columns", "-d", "--max-depth", "-r", "--replace",
           "--sort", "--sortr", "-E", "--encoding", "--type-add", "--ignore-file", "--pre", "--max-filesize"},
    "grep": GREP_VALUES,
    "ugrep": GREP_VALUES | {"-g", "--glob", "-t", "--file-type"},
    "ug": GREP_VALUES | {"-g", "--glob", "-t", "--file-type"},
    "ag": {"-G", "--file-search-regex", "--depth", "-m", "--max-count", "-A", "-B", "-C", "--ignore", "-p", "--path-to-ignore"},
    "fd": {"-e", "--extension", "-t", "--type", "-E", "--exclude", "-d", "--max-depth", "--min-depth", "--exact-depth",
           "-S", "--size", "--changed-within", "--changed-before", "-o", "--owner", "-j", "--threads", "--base-directory",
           "--search-path", "-c", "--color", "--ignore-file"},
}
ROOT_OPTS = {"--search-path", "--base-directory"}
DEPTH_OPTS = {"rg": {"-d", "--max-depth"}, "ag": {"--depth"}, "fd": {"-d", "--max-depth", "--exact-depth"}}
# Wrappers and the options of theirs that take a value.
WRAPPERS = {
    "sudo": {"-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t"},
    "doas": {"-u", "-C"},
    "nice": {"-n"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "gtimeout": {"-s", "-k", "--signal", "--kill-after"},
    "stdbuf": {"-i", "-o", "-e"},
    "caffeinate": {"-t", "-w"},
    "env": {"-u", "-C", "-S"},
    "time": set(), "command": set(), "exec": set(), "nohup": set(), "xargs": {"-I", "-n", "-P", "-L", "-d", "-s"},
}
TAKES_DURATION = {"timeout", "gtimeout"}


def expand(p, base):
    if LITERAL_TILDE in p:
        # A file or folder literally named "~", not the home folder.
        return os.path.normpath(os.path.join(base, p.replace(LITERAL_TILDE, "~")))
    p = p.replace("${HOME}", home).replace("$HOME", home)
    p = p.replace("${USER}", user).replace("$USER", user)
    if p == "~" or p.startswith("~/"):
        p = home + p[1:]
    elif p.startswith("~") and not p.startswith("~+"):
        name, _, rest = p[1:].partition("/")
        if re.match(r"^[A-Za-z0-9._-]+$", name):
            p = os.path.join(os.path.dirname(home), name, rest)
    return os.path.normpath(os.path.join(base, p))


def depth_ok(v):
    try:
        return int(v) <= 2
    except ValueError:
        return False


def split_segments(text):
    """Return [(words, after_pipe)] for each simple command in text."""
    # A quoted '~' or "~" is a literal tilde, not the home folder.
    text = re.sub(r"""(?<![^\s=])(['"])~\1(?=\s|$)""", LITERAL_TILDE, text)
    lex = shlex.shlex(text, posix=True, punctuation_chars=";&|()\n")
    lex.whitespace_split = True
    try:
        words = list(lex)
    except ValueError:
        return []
    out, cur, after_pipe = [], [], False
    for w in words:
        if w and set(w) <= set(";&|()\n"):
            if cur:
                out.append((cur, after_pipe))
            cur = []
            after_pipe = w in ("|", "|&")
        else:
            cur.append(w)
    if cur:
        out.append((cur, after_pipe))
    return out


def strip_wrappers(seg):
    allow_env = False
    while seg:
        w = seg[0]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w):
            if w == "AGENTBREW_ALLOW_HOME_SEARCH=1":
                allow_env = True
            seg = seg[1:]
            continue
        name = os.path.basename(w)
        if name in WRAPPERS:
            opts = WRAPPERS[name]
            seg = seg[1:]
            while seg and seg[0].startswith("-") and seg[0] != "--":
                o = seg[0]
                seg = seg[2:] if o in opts else seg[1:]
            if seg and seg[0] == "--":
                seg = seg[1:]
            if name in TAKES_DURATION and seg:
                seg = seg[1:]
            continue
        break
    return seg, allow_env


def roots_for(tool, args, after_pipe):
    """Return (paths, depth_limited) or None when the call is not recursive."""
    paths, deep_ok = [], False
    if tool == "find":
        i = 0
        while i < len(args) and args[i] in ("-H", "-L", "-P", "-E", "-X", "-s", "-x", "-d"):
            i += 1
        while i < len(args) and not args[i].startswith("-") and args[i] not in ("(", "!"):
            paths.append(args[i]); i += 1
        for j, a in enumerate(args):
            if a == "-maxdepth" and j + 1 < len(args) and depth_ok(args[j + 1]):
                deep_ok = True
        return (paths or ["."]), deep_ok
    recursive = tool not in ("grep", "ugrep")
    explicit_pattern = files_mode = False
    positionals = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            positionals.extend(args[i + 1:]); break
        if tool == "fd" and a in ("-x", "--exec", "-X", "--exec-batch"):
            break
        if a.startswith("--") and "=" in a:
            name, val = a.split("=", 1)
            if name in DEPTH_OPTS.get(tool, ()) and depth_ok(val):
                deep_ok = True
            if name in ("--regexp", "--file"):
                explicit_pattern = True
            if name in ROOT_OPTS:
                paths.append(val)
            i += 1; continue
        if a.startswith("-") and a != "-":
            if tool in ("grep", "ugrep") and not a.startswith("--") and re.search(r"[rR]", a):
                recursive = True
            if a in ("--recursive", "--dereference-recursive"):
                recursive = True
            if a in ("-e", "-f", "--regexp", "--file"):
                explicit_pattern = True
            if a == "--files":
                files_mode = True
            if a in VALUE_OPTS.get(tool, ()) or a in ("--regexp", "--file"):
                val = args[i + 1] if i + 1 < len(args) else ""
                if a in DEPTH_OPTS.get(tool, ()) and depth_ok(val):
                    deep_ok = True
                if a in ROOT_OPTS:
                    paths.append(val)
                i += 2; continue
            i += 1; continue
        positionals.append(a); i += 1
    if not recursive:
        return None
    if not (explicit_pattern or files_mode) and positionals:
        positionals = positionals[1:]
    paths.extend(positionals)
    if not paths:
        # After a pipe, rg/grep/ag/ug read stdin instead of the cwd.
        if after_pipe and tool != "fd":
            return None
        paths = ["."]
    return paths, deep_ok


def check_command(text, base, depth=0):
    if depth > 3:
        return None
    for seg, after_pipe in split_segments(text):
        seg, allow_env = strip_wrappers(seg)
        if not seg:
            continue
        tool = os.path.basename(seg[0])
        args = seg[1:]
        if tool in ("bash", "sh", "zsh", "dash", "ksh"):
            for k, a in enumerate(args):
                if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", a) and k + 1 < len(args):
                    hit = check_command(args[k + 1], base, depth + 1)
                    if hit:
                        return hit
                    break
            continue
        if tool == "eval":
            hit = check_command(" ".join(args), base, depth + 1)
            if hit:
                return hit
            continue
        if tool in ("cd", "pushd"):
            target = next((a for a in args if not a.startswith("-")), None)
            base = expand(target, base) if target else home
            continue
        if allow_env or tool not in SEARCH_TOOLS:
            continue
        found = roots_for(tool, args, after_pipe)
        if not found or found[1]:
            continue
        for p in found[0]:
            root = expand(p, base)
            if root in broad:
                return f"{tool}\t{root}"
    return None


if hook_tool in ("Grep", "Glob"):
    glob = os.environ.get("NHC_GLOB", "")
    if hook_tool == "Glob" and "**" not in glob:
        raise SystemExit(0)
    root = expand(os.environ.get("NHC_PATH", "") or ".", cwd)
    if root in broad:
        print(f"{hook_tool}\t{root}")
    raise SystemExit(0)

hit = check_command(cmd, cwd)
if hit:
    print(hit)
