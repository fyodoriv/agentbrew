use crate::model::Diagnostic;
use std::collections::{BTreeMap, BTreeSet};
use tree_sitter::Node;

const SOURCE_LIMIT: usize = 2 * 1024 * 1024;
const NODE_LIMIT: usize = 200_000;
const CALL_LIMIT: usize = 100_000;
const DEPTH_LIMIT: usize = 256;

#[derive(Clone, Debug, Default)]
pub struct Shell {
    pub commands: Vec<Command>,
    pub assignments: Vec<Assignment>,
    pub scopes: Vec<Scope>,
}

#[derive(Clone, Debug)]
pub struct Command {
    pub start: usize,
    pub end: usize,
    pub scope_start: Option<usize>,
    pub conditional: bool,
    pub name: Word,
    pub args: Vec<Word>,
    pub heredocs: Vec<HereDoc>,
    pub redirects: Vec<Redirect>,
    pub pipeline: Option<PipelineMember>,
}

#[derive(Clone, Debug)]
pub struct Scope {
    pub start: usize,
    pub end: usize,
    pub parent: Option<usize>,
    pub kind: ScopeKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScopeKind {
    Function,
    Subshell,
    Substitution,
}

#[derive(Clone, Debug)]
pub struct Redirect {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub target: Word,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PipelineMember {
    pub start: usize,
    pub end: usize,
    pub index: usize,
    pub incoming: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Word {
    Literal(String),
    Variable(String),
    Composite(Vec<Word>),
    Expression { start: usize, end: usize },
}

#[derive(Clone, Debug)]
pub struct HereDoc {
    pub body_start: usize,
    pub body_end: usize,
    pub text: String,
    pub quoted: bool,
}

#[derive(Clone, Debug)]
pub struct Assignment {
    pub start: usize,
    pub end: usize,
    pub scope_start: Option<usize>,
    pub command_start: Option<usize>,
    // This marks control-dependent syntax, not a proof that another assignment must execute.
    pub conditional: bool,
    // False includes unsupported declaration modes; it does not prove outer-shell visibility.
    pub local: bool,
    pub name: String,
    pub value: Word,
}

struct Frontend<'a> {
    path: &'a str,
    source: &'a str,
    visited: usize,
    shell: Shell,
    docs: BTreeMap<usize, Vec<HereDoc>>,
    extra_args: BTreeMap<usize, Vec<Word>>,
    inert_bodies: BTreeSet<usize>,
    redirects: BTreeMap<usize, Vec<Redirect>>,
    pipelines: BTreeMap<usize, PipelineMember>,
    handled_pipelines: BTreeSet<usize>,
}

impl Frontend<'_> {
    fn error(&self, code: &str) -> Diagnostic {
        Diagnostic::new(code, Some(self.path))
    }

    fn visit(&mut self, depth: usize) -> Result<(), Diagnostic> {
        self.visited += 1;
        if self.visited > NODE_LIMIT {
            return Err(self.error("parser-node-limit"));
        }
        if depth > DEPTH_LIMIT {
            return Err(self.error("parser-depth-limit"));
        }
        Ok(())
    }

    fn text(&self, node: Node<'_>) -> Result<&str, Diagnostic> {
        self.source
            .get(node.start_byte()..node.end_byte())
            .ok_or_else(|| self.error("unsupported-source-syntax"))
    }

    fn nodes<'tree>(
        &mut self,
        nodes: impl Iterator<Item = Node<'tree>>,
        depth: usize,
    ) -> Result<Vec<Node<'tree>>, Diagnostic> {
        let mut result = Vec::new();
        for node in nodes {
            self.visit(depth)?;
            result.push(node);
        }
        Ok(result)
    }

    fn expression(node: Node<'_>) -> Word {
        Word::Expression {
            start: node.start_byte(),
            end: node.end_byte(),
        }
    }

    fn word(&mut self, node: Node<'_>, depth: usize) -> Result<Word, Diagnostic> {
        self.visit(depth)?;
        let expression = Self::expression(node);
        let raw = self.text(node)?;
        match node.kind() {
            "command_name" => {
                if node.named_child_count() == 1 {
                    self.word(node.named_child(0).unwrap(), depth + 1)
                } else {
                    Ok(expression)
                }
            }
            "word" => Ok(decode_unquoted(raw)
                .map(Word::Literal)
                .unwrap_or(expression)),
            "$" => Ok(Word::Literal("$".into())),
            "number" if node.named_child_count() == 0 => Ok(Word::Literal(raw.into())),
            "raw_string" => Ok(raw
                .strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
                .map(|s| Word::Literal(s.into()))
                .unwrap_or(expression)),
            "simple_expansion" => {
                if let Some(name) = node.named_child(0).filter(|n| n.kind() == "variable_name") {
                    Ok(Word::Variable(self.text(name)?.into()))
                } else {
                    Ok(expression)
                }
            }
            "expansion"
                if node.child_count() == 3 && node.child_by_field_name("operator").is_none() =>
            {
                if let Some(name) = node.named_child(0).filter(|n| n.kind() == "variable_name") {
                    Ok(Word::Variable(self.text(name)?.into()))
                } else {
                    Ok(expression)
                }
            }
            "concatenation" => {
                let mut cursor = node.walk();
                let children = self.nodes(node.named_children(&mut cursor), depth + 1)?;
                let parts = children
                    .into_iter()
                    .map(|child| self.word(child, depth + 1))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Word::Composite(parts))
            }
            "string" => {
                if !raw.starts_with('"') || !raw.ends_with('"') {
                    return Ok(expression);
                }
                let mut parts = Vec::new();
                let mut offset = node.start_byte() + 1;
                let mut cursor = node.walk();
                for child in node.named_children(&mut cursor) {
                    if child.start_byte() > offset {
                        let gap = self
                            .source
                            .get(offset..child.start_byte())
                            .ok_or_else(|| self.error("unsupported-source-syntax"))?;
                        parts.push(Word::Literal(decode_double(gap)));
                    }
                    if child.kind() == "string_content" {
                        self.visit(depth + 1)?;
                        parts.push(Word::Literal(decode_double(self.text(child)?)));
                    } else {
                        parts.push(self.word(child, depth + 1)?);
                    }
                    offset = child.end_byte();
                }
                if offset < node.end_byte() - 1 {
                    parts.push(Word::Literal(decode_double(
                        &self.source[offset..node.end_byte() - 1],
                    )));
                }
                match parts.len() {
                    0 => Ok(Word::Literal(String::new())),
                    1 => Ok(parts.remove(0)),
                    _ => Ok(Word::Composite(parts)),
                }
            }
            _ => Ok(expression),
        }
    }

    fn direct_command<'tree>(&self, mut node: Node<'tree>) -> Option<Node<'tree>> {
        for _ in 0..DEPTH_LIMIT {
            match node.kind() {
                "command" => return Some(node),
                "negated_command" if node.named_child_count() == 1 => node = node.named_child(0)?,
                "redirected_statement" => node = node.child_by_field_name("body")?,
                _ => return None,
            }
        }
        None
    }

    fn redirects(&mut self, node: Node<'_>, depth: usize) -> Result<(), Diagnostic> {
        let command = node
            .child_by_field_name("body")
            .and_then(|body| self.direct_command(body));
        let mut cursor = node.walk();
        for redirect in node.children_by_field_name("redirect", &mut cursor) {
            let command =
                command.ok_or_else(|| self.error("unsupported-shell-redirect-context"))?;
            let fact = self.redirect(redirect, depth + 1)?;
            self.redirects.entry(command.id()).or_default().push(fact);
            if redirect.kind() != "heredoc_redirect" {
                continue;
            }
            let mut redirect_cursor = redirect.walk();
            let children = self.nodes(redirect.named_children(&mut redirect_cursor), depth + 1)?;
            let start = children
                .iter()
                .find(|n| n.kind() == "heredoc_start")
                .copied()
                .ok_or_else(|| self.error("unsupported-shell-heredoc-context"))?;
            let body = children
                .iter()
                .find(|n| n.kind() == "heredoc_body")
                .copied()
                .ok_or_else(|| self.error("unsupported-shell-heredoc-context"))?;
            let delimiter = self.text(start)?;
            if delimiter.contains(['\n', '\r']) {
                return Err(self.error("unsupported-shell-heredoc-delimiter"));
            }
            let quoted = delimiter.chars().any(|c| matches!(c, '\'' | '"' | '\\'));
            let body_text = self.text(body)?.to_owned();
            self.docs.entry(command.id()).or_default().push(HereDoc {
                body_start: body.start_byte(),
                body_end: body.end_byte(),
                text: body_text,
                quoted,
            });
            if quoted {
                self.inert_bodies.insert(body.id());
            }
            for child in children {
                if child.kind() == "pipeline" {
                    self.pipeline(child, Some(command), depth + 1)?;
                }
            }
            let mut nested_cursor = redirect.walk();
            for nested in redirect.children_by_field_name("redirect", &mut nested_cursor) {
                let fact = self.redirect(nested, depth + 1)?;
                self.redirects.entry(command.id()).or_default().push(fact);
            }
            let mut argument_cursor = redirect.walk();
            for argument in redirect.children_by_field_name("argument", &mut argument_cursor) {
                let word = self.word(argument, depth + 1)?;
                self.extra_args.entry(command.id()).or_default().push(word);
            }
        }
        Ok(())
    }

    fn redirect(&mut self, node: Node<'_>, depth: usize) -> Result<Redirect, Diagnostic> {
        self.visit(depth)?;
        let mut cursor = node.walk();
        let children = self.nodes(node.children(&mut cursor), depth + 1)?;
        let operator = children
            .iter()
            .find(|child| {
                matches!(
                    child.kind(),
                    "<" | ">"
                        | ">>"
                        | "&>"
                        | "&>>"
                        | "<&"
                        | ">&"
                        | ">|"
                        | "<&-"
                        | ">&-"
                        | "<<<"
                        | "<<"
                        | "<<-"
                )
            })
            .copied()
            .ok_or_else(|| self.error("unsupported-shell-redirect-context"))?;
        let mut op = node
            .child_by_field_name("descriptor")
            .map(|n| self.text(n))
            .transpose()?
            .unwrap_or("")
            .to_owned();
        op.push_str(self.text(operator)?);
        let target = match node.kind() {
            "file_redirect" => {
                let mut cursor = node.walk();
                let destinations: Vec<_> = node
                    .children_by_field_name("destination", &mut cursor)
                    .take(2)
                    .collect();
                match destinations.as_slice() {
                    [target] => self.word(*target, depth + 1)?,
                    [] if matches!(operator.kind(), "<&-" | ">&-") => Self::expression(node),
                    _ => return Err(self.error("unsupported-shell-redirect-context")),
                }
            }
            "herestring_redirect" => {
                let target = children
                    .iter()
                    .find(|child| child.is_named() && child.kind() != "file_descriptor")
                    .copied()
                    .ok_or_else(|| self.error("unsupported-shell-redirect-context"))?;
                self.word(target, depth + 1)?
            }
            "heredoc_redirect" => {
                let target = children
                    .iter()
                    .find(|child| child.kind() == "heredoc_start")
                    .copied()
                    .ok_or_else(|| self.error("unsupported-shell-heredoc-context"))?;
                Self::expression(target)
            }
            _ => return Err(self.error("unsupported-shell-redirect-context")),
        };
        Ok(Redirect {
            start: node.start_byte(),
            end: node.end_byte(),
            operator: op,
            target,
        })
    }

    fn stages<'tree>(
        &mut self,
        node: Node<'tree>,
        incoming: Option<String>,
        depth: usize,
        stages: &mut Vec<(Node<'tree>, Option<String>)>,
    ) -> Result<(), Diagnostic> {
        self.visit(depth)?;
        if node.kind() != "pipeline" {
            let command = self
                .direct_command(node)
                .ok_or_else(|| self.error("unsupported-shell-pipeline-context"))?;
            stages.push((command, incoming));
            return Ok(());
        }
        self.handled_pipelines.insert(node.id());
        let mut next = incoming;
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if matches!(child.kind(), "|" | "|&") {
                next = Some(self.text(child)?.into());
            } else if child.is_named() && child.kind() != "comment" {
                self.stages(child, next.take(), depth + 1, stages)?;
            }
        }
        Ok(())
    }

    fn pipeline<'tree>(
        &mut self,
        node: Node<'tree>,
        prefix: Option<Node<'tree>>,
        depth: usize,
    ) -> Result<(), Diagnostic> {
        if self.handled_pipelines.contains(&node.id()) {
            return Ok(());
        }
        let mut stages = Vec::new();
        if let Some(prefix) = prefix {
            stages.push((prefix, None));
        }
        self.stages(node, None, depth, &mut stages)?;
        if stages.len() < 2
            || stages
                .first()
                .is_some_and(|(_, incoming)| incoming.is_some())
        {
            return Err(self.error("unsupported-shell-pipeline-context"));
        }
        for (index, (command, incoming)) in stages.into_iter().enumerate() {
            let fact = PipelineMember {
                start: node.start_byte(),
                end: node.end_byte(),
                index,
                incoming,
            };
            if let Some(existing) = self.pipelines.get(&command.id()) {
                if existing != &fact {
                    return Err(self.error("unsupported-shell-pipeline-context"));
                }
            }
            self.pipelines.insert(command.id(), fact);
        }
        Ok(())
    }

    fn assignment(
        &mut self,
        node: Node<'_>,
        scope: Option<usize>,
        function_scope: Option<usize>,
        conditional: bool,
        depth: usize,
    ) -> Result<(), Diagnostic> {
        let name = node
            .child_by_field_name("name")
            .ok_or_else(|| self.error("unsupported-source-syntax"))?;
        let value = node
            .child_by_field_name("value")
            .ok_or_else(|| self.error("unsupported-source-syntax"))?;
        let parent = node.parent();
        let declaration = parent.filter(|n| n.kind() == "declaration_command");
        let declaration_name = declaration.and_then(|n| n.child(0)).map(|n| n.kind());
        let mut cursor = node.walk();
        let append = node.children(&mut cursor).any(|child| child.kind() == "+=");
        let mut declaration_flags = false;
        if let Some(declaration) = declaration {
            let mut cursor = declaration.walk();
            for child in declaration.named_children(&mut cursor) {
                if matches!(child.kind(), "variable_assignment" | "variable_name") {
                    continue;
                }
                declaration_flags |= match self.word(child, depth + 1)? {
                    Word::Literal(value) => value.starts_with('-'),
                    _ => true,
                };
            }
        }
        let local = declaration_name == Some("local")
            || function_scope.is_some()
                && !declaration_flags
                && matches!(declaration_name, Some("declare" | "typeset"));
        let word = if name.kind() != "variable_name" || append || declaration_flags {
            Self::expression(node)
        } else {
            self.word(value, depth + 1)?
        };
        let binding = if name.kind() == "subscript" {
            name.child_by_field_name("name")
                .ok_or_else(|| self.error("unsupported-source-syntax"))?
        } else {
            name
        };
        let name = self.text(binding)?.to_owned();
        self.shell.assignments.push(Assignment {
            start: node.start_byte(),
            end: node.end_byte(),
            scope_start: scope,
            command_start: parent
                .filter(|n| n.kind() == "command")
                .map(|n| n.start_byte()),
            conditional,
            local,
            name,
            value: word,
        });
        Ok(())
    }

    fn command(
        &mut self,
        node: Node<'_>,
        scope: Option<usize>,
        conditional: bool,
        depth: usize,
    ) -> Result<(), Diagnostic> {
        if self.shell.commands.len() >= CALL_LIMIT {
            return Err(self.error("parser-call-limit"));
        }
        let declaration = matches!(node.kind(), "declaration_command" | "unset_command");
        let mut redirect_cursor = node.walk();
        for redirect in node.children_by_field_name("redirect", &mut redirect_cursor) {
            let fact = self.redirect(redirect, depth + 1)?;
            self.redirects.entry(node.id()).or_default().push(fact);
        }
        let name = if declaration {
            let token = node
                .child(0)
                .ok_or_else(|| self.error("unsupported-source-syntax"))?;
            Word::Literal(self.text(token)?.into())
        } else {
            self.word(
                node.child_by_field_name("name")
                    .ok_or_else(|| self.error("unsupported-source-syntax"))?,
                depth + 1,
            )?
        };
        let mut cursor = node.walk();
        let arguments = if declaration {
            self.nodes(node.named_children(&mut cursor), depth + 1)?
        } else {
            self.nodes(
                node.children_by_field_name("argument", &mut cursor),
                depth + 1,
            )?
        };
        let mut args = arguments
            .into_iter()
            .map(|argument| self.word(argument, depth + 1))
            .collect::<Result<Vec<_>, _>>()?;
        args.extend(self.extra_args.remove(&node.id()).unwrap_or_default());
        self.shell.commands.push(Command {
            start: node.start_byte(),
            end: node.end_byte(),
            scope_start: scope,
            conditional,
            name,
            args,
            heredocs: self.docs.remove(&node.id()).unwrap_or_default(),
            redirects: self.redirects.remove(&node.id()).unwrap_or_default(),
            pipeline: self.pipelines.remove(&node.id()),
        });
        Ok(())
    }
}

fn decode_unquoted(raw: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next()? {
                '\n' => {}
                escaped => result.push(escaped),
            },
            '*' | '?' | '[' | ']' | '{' | '}' | '~' => return None,
            _ => result.push(c),
        }
    }
    Some(result)
}

fn decode_double(raw: &str) -> String {
    let mut result = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\'
            && chars
                .peek()
                .is_some_and(|next| matches!(*next, '$' | '`' | '"' | '\\' | '\n'))
        {
            if let Some(escaped) = chars.next() {
                if escaped != '\n' {
                    result.push(escaped);
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

pub fn parse_shell(path: &str, source: &str) -> Result<Shell, Diagnostic> {
    if source.len() > SOURCE_LIMIT {
        return Err(Diagnostic::new("parser-source-limit", Some(path)));
    }
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .map_err(|_| Diagnostic::new("parser-language", None))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| Diagnostic::new("parser-incomplete", Some(path)))?;
    if tree.root_node().has_error() {
        return Err(Diagnostic::new("unsupported-source-syntax", Some(path)));
    }
    let mut frontend = Frontend {
        path,
        source,
        visited: 0,
        shell: Shell::default(),
        docs: BTreeMap::new(),
        extra_args: BTreeMap::new(),
        inert_bodies: BTreeSet::new(),
        redirects: BTreeMap::new(),
        pipelines: BTreeMap::new(),
        handled_pipelines: BTreeSet::new(),
    };
    let mut stack = vec![(tree.root_node(), None, None, false, 0usize)];
    while let Some((node, inherited_scope, inherited_function, inherited_conditional, depth)) =
        stack.pop()
    {
        frontend.visit(depth)?;
        if frontend.inert_bodies.contains(&node.id())
            || matches!(node.kind(), "comment" | "heredoc_content")
        {
            continue;
        }
        let kind = match node.kind() {
            "function_definition" => Some(ScopeKind::Function),
            "subshell" => Some(ScopeKind::Subshell),
            "command_substitution" | "process_substitution" => Some(ScopeKind::Substitution),
            _ => None,
        };
        let function_scope = if kind == Some(ScopeKind::Function) {
            Some(node.start_byte())
        } else {
            inherited_function
        };
        let conditional = inherited_conditional
            || matches!(
                node.kind(),
                "if_statement"
                    | "elif_clause"
                    | "else_clause"
                    | "for_statement"
                    | "c_style_for_statement"
                    | "while_statement"
                    | "case_statement"
                    | "case_item"
                    | "list"
                    | "ternary_expression"
            )
            || node.next_sibling().is_some_and(|next| next.kind() == "&");
        let scope = if let Some(kind) = kind {
            frontend.shell.scopes.push(Scope {
                start: node.start_byte(),
                end: node.end_byte(),
                parent: inherited_scope,
                kind,
            });
            Some(node.start_byte())
        } else {
            inherited_scope
        };
        if node.kind() == "redirected_statement" {
            frontend.redirects(node, depth)?;
        }
        if node.kind() == "pipeline" {
            frontend.pipeline(node, None, depth)?;
        }
        if matches!(
            node.kind(),
            "command" | "declaration_command" | "unset_command"
        ) {
            frontend.command(node, scope, conditional, depth)?;
        }
        if node.kind() == "variable_assignment" {
            frontend.assignment(node, scope, function_scope, conditional, depth)?;
        }
        if node.kind() == "for_statement" {
            let variable = node
                .child_by_field_name("variable")
                .ok_or_else(|| frontend.error("unsupported-source-syntax"))?;
            frontend.visit(depth + 1)?;
            let name = frontend.text(variable)?.to_owned();
            frontend.shell.assignments.push(Assignment {
                start: variable.start_byte(),
                end: variable.end_byte(),
                scope_start: scope,
                command_start: None,
                conditional: true,
                local: false,
                name,
                value: Frontend::expression(node),
            });
        }
        let mut cursor = node.walk();
        let children = frontend.nodes(node.named_children(&mut cursor), depth + 1)?;
        stack.extend(
            children
                .into_iter()
                .rev()
                .map(|child| (child, scope, function_scope, conditional, depth + 1)),
        );
    }
    if !frontend.docs.is_empty()
        || !frontend.extra_args.is_empty()
        || !frontend.redirects.is_empty()
        || !frontend.pipelines.is_empty()
    {
        return Err(Diagnostic::new(
            "unsupported-shell-heredoc-context",
            Some(path),
        ));
    }
    frontend.shell.commands.sort_by_key(|command| command.start);
    frontend
        .shell
        .assignments
        .sort_by_key(|assignment| assignment.start);
    Ok(frontend.shell)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(source: &str) -> Shell {
        parse_shell("probe.sh", source).unwrap()
    }

    #[test]
    fn distinct_same_line_calls_keep_spans() {
        let shell = parse("python3 -c 'print(1)'; python3 -c 'print(2)'\n");
        assert_eq!(shell.commands.len(), 2);
        assert_ne!(shell.commands[0].start, shell.commands[1].start);
        assert_eq!(shell.commands[0].name, Word::Literal("python3".into()));
        assert_eq!(shell.commands[1].args[1], Word::Literal("print(2)".into()));
    }

    #[test]
    fn scalar_alias_and_quoted_single_variable_remain_structured() {
        let shell = parse("python_bin=python3\n\"$python_bin\" -I -c 'pass'\n");
        assert_eq!(shell.assignments[0].name, "python_bin");
        assert_eq!(shell.assignments[0].value, Word::Literal("python3".into()));
        assert_eq!(shell.commands[0].name, Word::Variable("python_bin".into()));
    }

    #[test]
    fn function_calls_have_function_scope() {
        let source =
            "tool=python3\nf() { local tool=node; \"$tool\" -e '1'; }\n\"$tool\" -c pass\n";
        let shell = parse(source);
        let function = source.find("f()").unwrap();
        let variable_calls: Vec<_> = shell
            .commands
            .iter()
            .filter(|call| matches!(call.name, Word::Variable(_)))
            .collect();
        assert_eq!(variable_calls.len(), 2);
        assert_eq!(variable_calls[0].scope_start, Some(function));
        assert_eq!(variable_calls[1].scope_start, None);
        assert_eq!(shell.assignments[1].scope_start, Some(function));
    }

    #[test]
    fn quoted_heredoc_text_never_becomes_bash_calls() {
        let source = "cat <<'JS'\nnode -e 'inert'; $(python3 -c 'also inert')\nJS\n";
        let shell = parse(source);
        assert_eq!(shell.commands.len(), 1);
        let doc = &shell.commands[0].heredocs[0];
        assert!(doc.quoted);
        assert_eq!(doc.text, source[doc.body_start..doc.body_end]);
        assert!(doc.text.contains("$(python3"));
    }

    #[test]
    fn unquoted_heredoc_keeps_executing_substitution_call() {
        let shell = parse("cat <<JS\n$(node -e '1')\nJS\n");
        assert_eq!(shell.commands.len(), 2);
        assert_eq!(shell.commands[0].name, Word::Literal("cat".into()));
        assert!(!shell.commands[0].heredocs[0].quoted);
        assert_eq!(shell.commands[1].name, Word::Literal("node".into()));
        assert!(shell.commands[1].scope_start.is_some());
    }

    #[test]
    fn source_suffix_and_dynamic_words_are_not_guessed() {
        let shell = parse("source ./hooks/setup.guard\n\"${dir}/tool\" \"${name:-fallback}\"\n");
        assert_eq!(
            shell.commands[0].args,
            [Word::Literal("./hooks/setup.guard".into())]
        );
        assert_eq!(
            shell.commands[1].name,
            Word::Composite(vec![
                Word::Variable("dir".into()),
                Word::Literal("/tool".into())
            ])
        );
        assert!(matches!(shell.commands[1].args[0], Word::Expression { .. }));
    }

    #[test]
    fn static_concatenation_stays_explicit() {
        let shell = parse("'py'thon3 -c pass\n");
        assert_eq!(
            shell.commands[0].name,
            Word::Composite(vec![
                Word::Literal("py".into()),
                Word::Literal("thon3".into())
            ])
        );
    }

    #[test]
    fn assignment_evidence_preserves_prefix_local_and_unknown_mutations() {
        let source = "tool=python3 printf x\nf() { local tool=node; declare '-n' alias=tool; tool[0]=node; tool+=extra; }\n";
        let shell = parse(source);
        assert_eq!(
            shell.assignments[0].command_start,
            Some(shell.commands[0].start)
        );
        assert!(shell.assignments[1].local);
        assert!(matches!(
            shell.assignments[2].value,
            Word::Expression { .. }
        ));
        assert_eq!(shell.assignments[3].name, "tool");
        assert!(matches!(
            shell.assignments[3].value,
            Word::Expression { .. }
        ));
        assert!(matches!(
            shell.assignments[4].value,
            Word::Expression { .. }
        ));
        assert_eq!(shell.scopes[0].kind, ScopeKind::Function);
    }

    #[test]
    fn assignment_control_context_separates_straight_line_from_may_writes() {
        let shell = parse("tool=python3\nif false; then tool=node; fi\nwhile false; do tool=bash; done\ntrue && tool=ruby\ntool=node &\n");
        assert_eq!(shell.assignments.len(), 5);
        assert!(!shell.assignments[0].conditional);
        assert!(shell.assignments[1..]
            .iter()
            .all(|assignment| assignment.conditional));
        assert!(shell
            .assignments
            .iter()
            .all(|assignment| assignment.scope_start.is_none()));
    }

    #[test]
    fn loop_command_context_keeps_variables_unknown_but_literal_calls_visible() {
        let shell = parse("tool=python3\nfor tool in node; do \"$tool\" -e '1'; node -e '2'; done\n\"$tool\" -c pass\n");
        assert!(shell.commands[0].conditional);
        assert_eq!(shell.commands[0].name, Word::Variable("tool".into()));
        assert!(shell.commands[1].conditional);
        assert_eq!(shell.commands[1].name, Word::Literal("node".into()));
        assert!(!shell.commands[2].conditional);
    }

    #[test]
    fn implicit_loop_binder_survives_without_a_same_scope_body_call() {
        let shell =
            parse("tool=python3\nfor tool in node; do f() { :; }; done\n\"$tool\" -c pass\n");
        assert_eq!(shell.assignments.len(), 2);
        let binder = &shell.assignments[1];
        assert_eq!(binder.name, "tool");
        assert_eq!(binder.scope_start, None);
        assert!(binder.conditional);
        assert!(matches!(binder.value, Word::Expression { .. }));
        let outside = shell.commands.last().unwrap();
        assert!(!outside.conditional);
        assert!(binder.end < outside.start);
    }

    #[test]
    fn heredoc_output_and_pipeline_have_explicit_ast_owners() {
        let shell = parse("cat <<'SH' > ./generated.guard\nprintf fixture\nSH\n");
        assert!(shell.commands[0]
            .redirects
            .iter()
            .any(|r| r.operator == ">" && r.target == Word::Literal("./generated.guard".into())));
        let piped = parse("cat <<'JS' | node -\nconsole.log(1)\nJS\n");
        assert_eq!(piped.commands.len(), 2);
        let first = piped.commands[0].pipeline.as_ref().unwrap();
        let second = piped.commands[1].pipeline.as_ref().unwrap();
        assert_eq!((first.start, first.end), (second.start, second.end));
        assert_eq!((first.index, second.index), (0, 1));
        assert_eq!(second.incoming.as_deref(), Some("|"));
    }

    #[test]
    fn ordinary_pipeline_order_and_nested_scope_are_preserved() {
        let shell = parse("printf x | node - | cat\nvalue=$(node -e 1)\n");
        assert_eq!(shell.commands[0].pipeline.as_ref().unwrap().index, 0);
        assert_eq!(shell.commands[2].pipeline.as_ref().unwrap().index, 2);
        assert_eq!(shell.scopes[0].kind, ScopeKind::Substitution);
        assert_eq!(shell.commands[3].scope_start, Some(shell.scopes[0].start));
    }

    #[test]
    fn syntax_and_source_limits_fail_closed() {
        assert_eq!(
            parse_shell("probe.sh", "if then\n").unwrap_err().code,
            "unsupported-source-syntax"
        );
        assert_eq!(
            parse_shell("probe.sh", &"x".repeat(2 * 1024 * 1024 + 1))
                .unwrap_err()
                .code,
            "parser-source-limit"
        );
    }
}
