use crate::{
    host_graph::{Datum, Event, Graph, Operation, Site},
    model::Diagnostic,
    observations::{self, CallReceipt},
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum RequiredTarget {
    Owned(String),
    Inline(String),
    External(String),
    Input(String),
    Output(Datum),
}

#[derive(Clone, Debug)]
pub struct Boundary {
    pub id: String,
    pub site: Site,
    pub form: String,
    pub bodies: BTreeSet<Body>,
    pub receipts: Vec<CallReceipt>,
    pub targets: BTreeSet<RequiredTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Body {
    pub form: String,
    pub language: String,
    pub value: Datum,
}

#[derive(Default)]
pub struct Boundaries {
    pub boundaries: BTreeMap<String, Boundary>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn interpreter(command: &str) -> Option<&'static str> {
    match command.rsplit('/').next().unwrap_or(command) {
        "sh" | "dash" => Some("sh"),
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        "node" | "nodejs" | "bun" | "deno" => Some("javascript"),
        "python" | "python2" | "python3" => Some("python"),
        name if name.starts_with("python3.") => Some("python"),
        "perl" => Some("perl"),
        "ruby" => Some("ruby"),
        "awk" | "gawk" | "mawk" => Some("awk"),
        "jq" => Some("jq"),
        "osascript" => Some("applescript"),
        _ => None,
    }
}

pub fn shebang(body: &str) -> Option<&'static str> {
    let first = body.lines().next()?.strip_prefix("#!")?;
    let words: Vec<_> = first.split_whitespace().collect();
    let first = *words.first()?;
    if first.rsplit('/').next() == Some("env") {
        words
            .iter()
            .skip(1)
            .filter(|word| !word.starts_with('-') && !word.contains('='))
            .find_map(|word| interpreter(word))
    } else {
        interpreter(first)
    }
}

fn issue(result: &mut Boundaries, path: &str) {
    result
        .diagnostics
        .push(Diagnostic::new("unresolved-execution", Some(path)));
}

fn uncertain(value: &Datum, targets: &mut BTreeSet<RequiredTarget>) -> bool {
    let mut inputs = BTreeSet::new();
    observations::external_inputs(value, &mut inputs);
    targets.extend(inputs.into_iter().map(RequiredTarget::Input));
    observations::has_unknown(value)
}

fn process(event: &Event, boundary: &mut Boundary, result: &mut Boundaries) {
    let Some(command) = event.arguments.first() else {
        issue(result, &event.site.path);
        return;
    };
    if event.api.ends_with("/fork") {
        match observations::literal(command) {
            Some(path) if !path.is_empty() => {
                boundary.targets.insert(RequiredTarget::Owned(path.into()));
            }
            _ => {
                if uncertain(command, &mut boundary.targets) || boundary.targets.is_empty() {
                    issue(result, &event.site.path);
                }
            }
        }
        if event.arguments.get(2).is_some_and(|options| match options {
            Datum::Object(options) => options.contains_key("execArgv"),
            Datum::Null(_) => false,
            _ => true,
        }) {
            issue(result, &event.site.path);
        }
        return;
    }
    if let Some(options) = event.arguments.get(2) {
        match options {
            Datum::Object(options) => match options.get("shell") {
                None | Some(Datum::Boolean(false, _)) => {}
                Some(Datum::Boolean(true, _)) | Some(Datum::Text(..)) => {
                    let mut parts = vec![command.clone()];
                    match event.arguments.get(1) {
                        Some(Datum::List(arguments)) => {
                            for argument in arguments {
                                parts.push(Datum::Text(" ".into(), event.site.clone()));
                                parts.push(argument.clone());
                            }
                        }
                        _ => issue(result, &event.site.path),
                    }
                    boundary.form = "embedded-program".into();
                    boundary.bodies.insert(Body {
                        form: "embedded-program".into(),
                        language: "sh".into(),
                        value: Datum::Parts(parts, event.site.clone()),
                    });
                    return;
                }
                _ => {
                    issue(result, &event.site.path);
                    return;
                }
            },
            Datum::Null(_) => {}
            _ => {
                issue(result, &event.site.path);
                return;
            }
        }
    }
    if event.arguments.get(2).is_some_and(
        |options| matches!(options,Datum::Object(options) if options.contains_key("cwd")),
    ) {
        result.diagnostics.push(Diagnostic::new(
            "reviewed-working-directory-required",
            Some(&event.site.path),
        ));
    }
    let Some(command_text) = observations::literal(command) else {
        if uncertain(command, &mut boundary.targets) || boundary.targets.is_empty() {
            issue(result, &event.site.path);
        }
        return;
    };
    let Some(language) = interpreter(command_text) else {
        boundary
            .targets
            .insert(RequiredTarget::External(command_text.into()));
        return;
    };
    let Some(Datum::List(arguments)) = event.arguments.get(1) else {
        issue(result, &event.site.path);
        return;
    };
    if matches!(language, "awk" | "jq") {
        let mut index = 0;
        while let Some(argument) = arguments.get(index) {
            let Some(text) = observations::literal(argument) else {
                issue(result, &event.site.path);
                return;
            };
            if matches!(text, "-f" | "--from-file" | "--file") {
                match arguments.get(index + 1).and_then(observations::literal) {
                    Some(path) => {
                        boundary.targets.insert(RequiredTarget::Owned(path.into()));
                    }
                    None => issue(result, &event.site.path),
                }
                return;
            }
            if matches!(text, "-v" | "-F") && language == "awk" {
                index += 2;
                continue;
            }
            if matches!(text, "--arg" | "--argjson" | "--rawfile" | "--slurpfile")
                && language == "jq"
            {
                index += 3;
                continue;
            }
            if text.starts_with('-') {
                if language == "jq"
                    && text.len() > 1
                    && text[1..].chars().all(|flag| "rscenSMCj".contains(flag))
                {
                    index += 1;
                    continue;
                }
                issue(result, &event.site.path);
                return;
            }
            boundary.form = "embedded-program".into();
            boundary.bodies.insert(Body {
                form: "embedded-program".into(),
                language: language.into(),
                value: argument.clone(),
            });
            return;
        }
        issue(result, &event.site.path);
        return;
    }
    // Runtime-specific options with values are explicit. Unknown options do not
    // shift the script position and silently convert an argument into a target.
    let takes_value = match language {
        "javascript" => &[
            "--require",
            "-r",
            "--import",
            "--loader",
            "--experimental-loader",
        ][..],
        "python" => &["-W", "-X"][..],
        _ => &[][..],
    };
    let mut index = 0;
    while index < arguments.len() {
        let value = &arguments[index];
        let Some(argument) = observations::literal(value) else {
            if uncertain(value, &mut boundary.targets) || boundary.targets.is_empty() {
                issue(result, &event.site.path);
            }
            return;
        };
        let inline = match language {
            "javascript" => matches!(argument, "-e" | "--eval" | "-p" | "--print"),
            "python" | "sh" | "bash" | "zsh" | "fish" => argument == "-c",
            "perl" | "ruby" | "applescript" => argument == "-e",
            _ => false,
        };
        if inline {
            let Some(body) = arguments.get(index + 1) else {
                issue(result, &event.site.path);
                return;
            };
            if observations::has_unknown(body) {
                issue(result, &event.site.path);
            }
            uncertain(body, &mut boundary.targets);
            boundary.form = "embedded-program".into();
            boundary.bodies.insert(Body {
                form: "embedded-program".into(),
                language: language.into(),
                value: body.clone(),
            });
            return;
        }
        if argument == "--" {
            index += 1;
            break;
        }
        if takes_value.contains(&argument) {
            // Preloads are executable inputs as well as the main script.
            if language == "javascript" {
                if let Some(value) = arguments.get(index + 1) {
                    match observations::literal(value) {
                        Some(path) => {
                            boundary.targets.insert(RequiredTarget::Owned(path.into()));
                        }
                        None => {
                            issue(result, &event.site.path);
                        }
                    }
                } else {
                    issue(result, &event.site.path);
                    return;
                }
            }
            index += 2;
            continue;
        }
        if matches!(argument, "-m" | "--module") {
            issue(result, &event.site.path);
            return;
        }
        if argument == "-" {
            break;
        }
        if argument.starts_with('-') {
            let simple = match language {
                "python" => matches!(argument, "-I" | "-E" | "-s" | "-S" | "-B" | "-u"),
                "javascript" => matches!(
                    argument,
                    "--no-warnings"
                        | "--input-type=module"
                        | "--input-type=commonjs"
                        | "--experimental-strip-types"
                        | "-c"
                        | "--check"
                ),
                "sh" | "bash" | "zsh" | "fish" => {
                    matches!(argument, "-x" | "-n" | "-s" | "-e" | "-u" | "-eu" | "-ue")
                }
                _ => false,
            };
            if simple {
                index += 1;
                continue;
            }
            issue(result, &event.site.path);
            return;
        }
        break;
    }
    let stdin = event.arguments.get(2).and_then(|options| {
        if let Datum::Object(options) = options {
            options.get("input")
        } else {
            None
        }
    });
    let stdin_is_program = arguments
        .get(index)
        .is_none_or(|value| observations::literal(value) == Some("-"));
    if stdin_is_program && (event.api.starts_with("shell/") || event.api.ends_with("Sync")) {
        if let Some(body) = stdin {
            boundary.form = "embedded-program".into();
            boundary.bodies.insert(Body {
                form: "embedded-program".into(),
                language: language.into(),
                value: body.clone(),
            });
            if uncertain(body, &mut boundary.targets) {
                issue(result, &event.site.path);
            }
            return;
        }
    }
    match arguments.get(index) {
        Some(value) => match observations::literal(value) {
            Some(path) if !path.is_empty() && path != "-" => {
                boundary.targets.insert(RequiredTarget::Owned(path.into()));
            }
            _ => {
                if uncertain(value, &mut boundary.targets) || boundary.targets.is_empty() {
                    issue(result, &event.site.path);
                }
            }
        },
        None => issue(result, &event.site.path),
    }
}

fn executable_mode(value: Option<&Datum>) -> Option<bool> {
    let Datum::Number(raw, _) = value? else {
        return None;
    };
    let raw = raw.replace('_', "");
    let mode = if let Some(raw) = raw.strip_prefix("0o") {
        u32::from_str_radix(raw, 8).ok()?
    } else if let Some(raw) = raw.strip_prefix("0x") {
        u32::from_str_radix(raw, 16).ok()?
    } else {
        raw.parse::<u32>().ok()?
    };
    Some(mode & 0o111 != 0)
}

pub fn from_host(graph: Graph) -> Boundaries {
    let receipts = observations::by_site(&graph.events);
    let mut result = Boundaries {
        diagnostics: graph.diagnostics,
        ..Boundaries::default()
    };
    for event in &graph.events {
        let id = format!(
            "call:{}:{}:{}",
            event.site.path, event.site.start, event.site.end
        );
        let mut boundary = result.boundaries.remove(&id).unwrap_or_else(|| Boundary {
            id: id.clone(),
            site: event.site.clone(),
            form: "dynamic-call".into(),
            bodies: BTreeSet::new(),
            receipts: receipts[&event.site].clone(),
            targets: BTreeSet::new(),
        });
        match event.operation {
            Operation::Execute => process(event, &mut boundary, &mut result),
            Operation::Shell | Operation::Eval => {
                boundary.form = "embedded-program".into();
                match event.arguments.first() {
                    Some(value) if !observations::has_unknown(value) => {
                        boundary.bodies.insert(Body {
                            form: "embedded-program".into(),
                            language: if event.operation == Operation::Shell {
                                "sh"
                            } else {
                                "javascript"
                            }
                            .into(),
                            value: value.clone(),
                        });
                        uncertain(value, &mut boundary.targets);
                    }
                    _ => issue(&mut result, &event.site.path),
                }
            }
            Operation::Write => {
                let body = event.arguments.get(1);
                let language = body.and_then(observations::literal).and_then(shebang);
                if body
                    .and_then(observations::literal)
                    .is_some_and(|text| text.starts_with("#!"))
                    && language.is_none()
                {
                    result.diagnostics.push(Diagnostic::new(
                        "unsupported-executable",
                        Some(&event.site.path),
                    ));
                }
                if let Some(language) = language {
                    boundary.form = "generated-program".into();
                    boundary.bodies.insert(Body {
                        form: "generated-program".into(),
                        language: language.into(),
                        value: body.unwrap().clone(),
                    });
                } else {
                    boundary.form = "write-site".into();
                    result.diagnostics.push(Diagnostic::new(
                        "reviewed-write-body-required",
                        Some(&event.site.path),
                    ));
                }
                if let Some(path) = event.arguments.first() {
                    boundary
                        .targets
                        .insert(RequiredTarget::Output(path.clone()));
                    if observations::has_unknown(path) {
                        issue(&mut result, &event.site.path);
                    }
                } else {
                    issue(&mut result, &event.site.path);
                }
            }
            Operation::Mode => {
                boundary.form = "mode-site".into();
                if executable_mode(event.arguments.get(1)) != Some(false) {
                    let path = event.arguments.first().and_then(observations::literal);
                    let has_reviewed_body = path.is_some_and(|path| {
                        graph.events.iter().any(|writer| {
                            writer.operation == Operation::Write
                                && writer.arguments.first().and_then(observations::literal)
                                    == Some(path)
                                && writer
                                    .arguments
                                    .get(1)
                                    .and_then(observations::literal)
                                    .and_then(shebang)
                                    .is_some()
                        })
                    });
                    if !has_reviewed_body {
                        result.diagnostics.push(Diagnostic::new(
                            "reviewed-generated-body-required",
                            Some(&event.site.path),
                        ));
                    }
                }
                if let Some(path) = event.arguments.first() {
                    boundary
                        .targets
                        .insert(RequiredTarget::Output(path.clone()));
                } else {
                    issue(&mut result, &event.site.path);
                }
            }
            Operation::Indirect => {
                for value in &event.arguments {
                    uncertain(value, &mut boundary.targets);
                }
                if event.api.starts_with("parameter:") {
                    boundary
                        .targets
                        .insert(RequiredTarget::Input(event.api.clone()));
                } else {
                    issue(&mut result, &event.site.path);
                }
            }
        }
        result.boundaries.insert(id, boundary);
    }
    result
}
