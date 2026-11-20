"""Read enrolled watcher stamps and decide whether to remind a Claude session."""

import json
import os
import re
import stat
import sys
import time


SESSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
STOP_REQUEST = re.compile(
    r"^\s*(?:(?:please|let['’]s)\s+)?wrap[\s-]+up\b"
    r"|^\s*(?:please\s+)?(?:stop|pause|cancel)"
    r"(?:\s+(?:watching|(?:the|this)\s+(?:session|turn|run|watch|goal)))?"
    r"(?:\s+(?:here|now|please))?[\s.!]*$",
    re.IGNORECASE,
)
STAMP_LIMIT = 512
TRANSCRIPT_LIMIT = 262_144


def trusted_file(path, directory=None):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(path, flags, dir_fd=directory)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        os.close(fd)
        raise OSError("untrusted file")
    return os.fdopen(fd, "rb"), info


def file_version(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def verify_current_file(stream, opened, path, directory=None):
    current = os.stat(path, dir_fd=directory, follow_symlinks=False)
    if file_version(opened) != file_version(os.fstat(stream.fileno())) or file_version(opened) != file_version(current):
        raise OSError("file changed during read")


def stamp(directory, session, suffix):
    name = f"{session}.{suffix}"
    try:
        stream, info = trusted_file(name, directory)
    except FileNotFoundError:
        return None
    with stream:
        value = stream.read(STAMP_LIMIT + 1)
        verify_current_file(stream, info, name, directory)
    if len(value) > STAMP_LIMIT:
        raise ValueError("oversize stamp")
    return value.decode("utf-8").strip(), info.st_mtime


def watch_active(watch, max_age):
    if watch is None:
        return False
    value, modified = watch
    kind, equals, identifier = value.partition("=")
    if equals and kind == "cron" and IDENTIFIER.fullmatch(identifier):
        return 0 <= time.time() - modified <= max_age
    if not equals or kind != "pid" or not re.fullmatch(r"[1-9][0-9]{0,9}", identifier):
        return False
    pid = int(identifier)
    if not 1 < pid <= 2_147_483_647:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Signal zero can identify an existing process without sending a signal.
        return True
    return True


def latest_user_request(path):
    if not isinstance(path, str) or not os.path.isabs(path):
        return None
    stream, info = trusted_file(path)
    with stream:
        length = stream.seek(0, os.SEEK_END)
        start = max(0, length - TRANSCRIPT_LIMIT)
        stream.seek(start)
        rows = stream.read(TRANSCRIPT_LIMIT).splitlines()
        verify_current_file(stream, info, path)
    if start:
        rows = rows[1:]
    for line in reversed(rows):
        row = json.loads(line)
        if not isinstance(row, dict):
            return None
        if row.get("type") != "user" or row.get("isMeta"):
            continue
        message = row.get("message")
        if not isinstance(message, dict):
            return None
        content = message.get("content")
        if isinstance(content, str):
            return content.strip() or None
        if not isinstance(content, list):
            return None
        blocks = [item for item in content if isinstance(item, dict)]
        if len(blocks) != len(content) or not blocks:
            return None
        if any(
            not isinstance(item.get("type"), str)
            or (item.get("type") == "text" and not isinstance(item.get("text"), str))
            for item in blocks
        ):
            return None
        if all(item.get("type") == "tool_result" for item in blocks):
            continue
        if any(item.get("type") == "tool_result" for item in blocks):
            return None
        text = [item["text"] for item in blocks if item.get("type") == "text" and isinstance(item.get("text"), str)]
        return " ".join(text).strip() or None
    return None


def should_remind(event):
    if not isinstance(event, dict) or event.get("hook_event_name") != "Stop":
        return False
    if event.get("stop_hook_active") is not False:
        return False
    session = event.get("session_id")
    if not isinstance(session, str) or not SESSION.fullmatch(session):
        return False
    directory = os.environ.get("ALWAYS_ON_DIR", "")
    projects = {value.strip() for value in os.environ.get("ALWAYS_ON_PROJECTS", "").split(",") if value.strip()}
    if not os.path.isabs(directory) or not projects:
        return False
    max_age = int(os.environ.get("ALWAYS_ON_CRON_MAX_AGE", "300"))
    if max_age <= 0:
        return False
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or info.st_mode & 0o022:
            return False
        project = stamp(fd, session, "project")
        if project is None or project[0] not in projects or not IDENTIFIER.fullmatch(project[0]):
            return False
        if stamp(fd, session, "wrapup") is not None or watch_active(stamp(fd, session, "watch"), max_age):
            return False
        request = latest_user_request(event.get("transcript_path"))
        if request is None:
            return False
        first_sentence = re.split(r"(?<=[.!?])\s+", request, maxsplit=1)[0]
        if STOP_REQUEST.search(first_sentence):
            return False

        current = os.stat(directory, follow_symlinks=False)
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            return False
        if project != stamp(fd, session, "project") or watch_active(stamp(fd, session, "watch"), max_age):
            return False
        return stamp(fd, session, "wrapup") is None
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        payload = sys.stdin.buffer.read(TRANSCRIPT_LIMIT + 1)
        remind = len(payload) <= TRANSCRIPT_LIMIT and should_remind(json.loads(payload))
    except (OSError, ValueError, RecursionError):
        remind = False
    print("block" if remind else "allow")
