use crate::{
    host_graph::{Datum, Event, Graph, Operation, Site},
    native_facts::interpreter,
    shell_ast::{Command, Shell, Word},
};
use std::collections::{BTreeMap, BTreeSet};

fn origin(path: &str, start: usize, end: usize) -> Site {
    Site {
        path: path.into(),
        start: start as u32,
        end: end as u32,
        body: None,
    }
}

fn value(path: &str, shell: &Shell, command: &Command, word: &Word, depth: usize) -> Datum {
    let site = origin(path, command.start, command.end);
    if depth > 32 {
        return Datum::Unknown(site);
    }
    match word {
        Word::Literal(text) => Datum::Text(text.clone(), site),
        Word::Variable(name) => {
            if name.parse::<usize>().is_ok() || matches!(name.as_str(), "@" | "*") {
                return Datum::Input(site, vec![format!("shell-parameter:{name}")]);
            }
            if command.conditional {
                return Datum::Unknown(site);
            }
            let assignments: Vec<_> = shell
                .assignments
                .iter()
                .filter(|assignment| {
                    assignment.name == *name
                        && assignment.scope_start == command.scope_start
                        && assignment.end <= command.start
                        && assignment.command_start.is_none()
                })
                .collect();
            let Some(last) = assignments.last() else {
                return Datum::Unknown(site);
            };
            // An intervening command can mutate a shell variable through read,
            // eval, a function or a declaration. Do not infer persistence.
            let intervening = shell.commands.iter().any(|other| {
                other.start >= last.end
                    && other.end <= command.start
                    && other.scope_start == command.scope_start
            });
            if last.conditional || intervening || last.local {
                return Datum::Unknown(site);
            }
            let mut assignment_command = command.clone();
            assignment_command.start = last.start;
            assignment_command.end = last.end;
            value(path, shell, &assignment_command, &last.value, depth + 1)
        }
        Word::Composite(words) => {
            let parts: Vec<_> = words
                .iter()
                .map(|word| value(path, shell, command, word, depth + 1))
                .collect();
            if parts.iter().all(|value| matches!(value, Datum::Text(..))) {
                Datum::Text(
                    parts
                        .iter()
                        .filter_map(|value| match value {
                            Datum::Text(text, _) => Some(text.as_str()),
                            _ => None,
                        })
                        .collect(),
                    site,
                )
            } else {
                Datum::Parts(parts, site)
            }
        }
        Word::Expression { start, end } => Datum::Unknown(origin(path, *start, *end)),
    }
}

fn event(path: &str, shell: &Shell, command: &Command) -> Option<Event> {
    let site = origin(path, command.start, command.end);
    let mut name = value(path, shell, command, &command.name, 0);
    let mut arguments: Vec<_> = command
        .args
        .iter()
        .map(|word| value(path, shell, command, word, 0))
        .collect();
    let mut wrappers = 0;
    loop {
        let Datum::Text(text, _) = &name else {
            break;
        };
        if !matches!(
            text.as_str(),
            "command" | "exec" | "env" | "sudo" | "nice" | "nohup"
        ) {
            break;
        }
        wrappers += 1;
        if wrappers > 8 || arguments.is_empty() {
            break;
        }
        // Wrapper options and environment assignments have distinct semantics.
        // Only the argument-free forwarding form is inferred here.
        if matches!(&arguments[0], Datum::Text(text, _) if !text.starts_with('-') && !text.contains('='))
        {
            name = arguments.remove(0);
        } else {
            name = Datum::Unknown(site.clone());
            break;
        }
    }
    let literal = match &name {
        Datum::Text(text, _) => Some(text.as_str()),
        _ => None,
    };
    let mut operation = Operation::Execute;
    let api;
    if matches!(literal, Some("source" | ".")) {
        api = format!("shell/{}", literal.unwrap());
        arguments = vec![
            Datum::Text("bash".into(), site.clone()),
            Datum::List(arguments),
        ];
    } else if literal == Some("eval") {
        operation = Operation::Shell;
        api = "shell/eval".into();
        let mut parts = Vec::new();
        for (index, argument) in arguments.into_iter().enumerate() {
            if index > 0 {
                parts.push(Datum::Text(" ".into(), site.clone()));
            }
            parts.push(argument);
        }
        arguments = vec![Datum::Parts(parts, site.clone())];
    } else if literal.and_then(interpreter).is_some() {
        api = format!("shell/{}", literal.unwrap());
        let mut input = None;
        if !command.heredocs.is_empty() {
            if command.heredocs.len() != 1 {
                arguments.push(Datum::Unknown(site.clone()));
            } else {
                let doc = &command.heredocs[0];
                let body_site = origin(path, doc.body_start, doc.body_end);
                let body = if doc.quoted {
                    Datum::Text(doc.text.clone(), body_site)
                } else {
                    Datum::Unknown(body_site)
                };
                input = Some(body);
            }
        }
        arguments = vec![name, Datum::List(arguments)];
        if let Some(input) = input {
            arguments.push(Datum::Object(BTreeMap::from([("input".into(), input)])));
        }
    } else if literal.is_none() {
        api = "shell/unresolved-command".into();
        arguments = vec![name, Datum::List(arguments)];
    } else {
        return None;
    }
    Some(Event {
        site,
        operation,
        api,
        arguments,
        owner: command.scope_start.map(|start| start as u32),
    })
}

pub fn events(path: &str, shell: &Shell) -> Graph {
    let mut result = Graph::default();
    if shell.commands.iter().any(|command|matches!(&command.name,Word::Literal(name) if matches!(name.as_str(),"cd"|"pushd"|"popd"))){
        result.diagnostics.push(crate::model::Diagnostic::new("reviewed-working-directory-required",Some(path)));
    }
    for command in &shell.commands {
        if let Some(event) = event(path, shell, command) {
            result.events.insert(event);
        }
        if matches!(&command.name,Word::Literal(name) if name == "cat")
            && command.heredocs.len() == 1
        {
            let doc = &command.heredocs[0];
            for redirect in &command.redirects {
                if !matches!(redirect.operator.as_str(), ">" | ">>" | ">|") {
                    continue;
                }
                let site = origin(path, command.start, command.end);
                let body_site = origin(path, doc.body_start, doc.body_end);
                let body = if doc.quoted {
                    Datum::Text(doc.text.clone(), body_site)
                } else {
                    Datum::Unknown(body_site)
                };
                result.events.insert(Event {
                    site,
                    operation: Operation::Write,
                    api: "shell/cat-heredoc".into(),
                    arguments: vec![value(path, shell, command, &redirect.target, 0), body],
                    owner: command.scope_start.map(|start| start as u32),
                });
            }
        }
    }
    result
}

pub fn owned_targets(shell: &Shell) -> BTreeSet<String> {
    shell
        .commands
        .iter()
        .filter_map(|command| match &command.name {
            Word::Literal(name) if name.starts_with("./") || name.contains('/') => {
                Some(name.clone())
            }
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_facts::{from_host, RequiredTarget};

    fn boundaries(source: &str) -> crate::native_facts::Boundaries {
        let shell = crate::shell_ast::parse_shell("source.sh", source).unwrap();
        from_host(events("source.sh", &shell))
    }

    #[test]
    fn immediate_scalar_interpreter_alias_keeps_the_inline_child() {
        let result = boundaries("python_bin=python3\n\"$python_bin\" -I -c 'print(1)'\n");
        assert!(result.diagnostics.is_empty());
        assert!(result
            .boundaries
            .values()
            .any(|boundary| boundary.bodies.iter().any(|body| body.language == "python")));
    }

    #[test]
    fn conditional_assignment_cannot_hide_an_unresolved_interpreter() {
        let result=boundaries("python_bin=python3\nif false; then python_bin=node; fi\n\"$python_bin\" -c 'payload'\n");
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }

    #[test]
    fn prefix_assignment_does_not_resolve_prior_command_expansion() {
        let result = boundaries("python_bin=python3 \"$python_bin\" -c 'payload'\n");
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }

    #[test]
    fn inert_cat_body_has_no_inline_interpreter() {
        let result = boundaries("cat <<'DOC'\nnode -e 'example'\nDOC\n");
        assert!(result.boundaries.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn source_builtin_keeps_the_unusual_suffix_target() {
        let result = boundaries("source hooks/helpers.rules\n");
        assert!(result.boundaries.values().any(|boundary| boundary
            .targets
            .contains(&RequiredTarget::Owned("hooks/helpers.rules".into()))));
    }

    #[test]
    fn loop_binder_cannot_reuse_an_outer_literal_interpreter_alias() {
        let result = boundaries(
            "python_bin=python3\nfor python_bin in node; do \"$python_bin\" -c 'payload'; done\n",
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }
    #[test]
    fn post_loop_alias_is_invalidated_even_when_body_only_defines_a_function() {
        let result =
            boundaries("tool=python3\nfor tool in node; do f() { :; }; done\n\"$tool\" -c pass\n");
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }
}
