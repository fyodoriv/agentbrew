# Cursor stores rules as .mdc files, so change the extension before the write.
def target_path(rule_name: str) -> str:
    return f"~/.cursor/rules/{rule_name}.mdc"
