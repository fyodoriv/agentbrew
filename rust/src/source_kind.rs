use crate::native_facts::interpreter;

fn shebang(text: &str) -> Option<Option<&'static str>> {
    let first = text.lines().next()?.strip_prefix("#!")?;
    let words: Vec<_> = first.split_whitespace().collect();
    let first = words.first()?;
    if first.rsplit('/').next() == Some("env") {
        Some(
            words
                .iter()
                .skip(1)
                .filter(|s| !s.starts_with('-') && !s.contains('='))
                .find_map(|s| interpreter(s)),
        )
    } else {
        Some(interpreter(first))
    }
}
pub fn language(path: &str, text: &str) -> Option<&'static str> {
    if path.ends_with(".rs") && text.starts_with("#![") {
        return Some("rust");
    }
    if let Some(result) = shebang(text) {
        return result;
    }
    let name = path.strip_suffix(".jinja").unwrap_or(path);
    match name.rsplit('.').next().unwrap_or("") {
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "rs" => Some("rust"),
        "py" => Some("python"),
        "sh" | "bash" | "bats" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        "pl" | "pm" => Some("perl"),
        "rb" => Some("ruby"),
        "awk" => Some("awk"),
        "ps1" => Some("powershell"),
        "c" | "h" => Some("c"),
        "cc" | "cpp" | "hpp" => Some("cpp"),
        "go" => Some("go"),
        "swift" => Some("swift"),
        "applescript" => Some("applescript"),
        _ => None,
    }
}
