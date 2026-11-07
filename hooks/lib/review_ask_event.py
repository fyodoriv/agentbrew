import importlib.util
from pathlib import Path


spec = importlib.util.spec_from_file_location("pr_command_target", Path(__file__).with_name("pr-command-target.py"))
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


def reminder(event):
    if not isinstance(event, dict) or event.get("hook_event_name") != "PostToolUse" or event.get("tool_name") != "Bash":
        return None
    inputs = event.get("tool_input")
    response = event.get("tool_response")
    if not isinstance(inputs, dict) or not isinstance(response, dict) or response.get("interrupted") is not False:
        return None
    command = inputs.get("command")
    if not isinstance(command, str) or not classifier.reviewer_request(command):
        return None
    return "Verify the reviewer request, then draft the chat review ask."
