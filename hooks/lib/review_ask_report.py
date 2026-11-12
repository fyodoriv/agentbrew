import re


NAMES = (
    "failure_event_silent",
    "input_is_not_disclosed",
    "interrupted_event_silent",
    "malformed_event_silent",
    "matching_event_reminds",
    "unrelated_command_silent",
)


def valid_report(text, status=None):
    return _valid_report(text, status, "__main__")


def valid_imported_report(text, status=None):
    return _valid_report(text, status, "review_ask_event_fixture")


def _valid_report(text, status, module):
    if not isinstance(text, str) or type(status) is not int or status != 0:
        return False
    lines = text.splitlines()
    results = [line for line in lines if line.startswith("test_")]
    if len(results) != len(NAMES):
        return False
    for line, name in zip(results, NAMES):
        pattern = rf"test_{name} \({re.escape(module)}\.ReviewAskEventTest(?:\.test_{name})?\) \.\.\. ok"
        if re.fullmatch(pattern, line) is None:
            return False
    summaries = [line for line in lines if re.match(r"^Ran \d+ tests? in ", line)]
    if len(summaries) != 1 or re.fullmatch(r"Ran 6 tests in [0-9.]+s", summaries[0]) is None:
        return False
    if [line for line in lines if line.startswith("OK")] != ["OK"]:
        return False
    return not any(re.match(r"^(FAILED|ERROR|FAIL)", line) or "skipped" in line.lower() for line in lines)
