use crate::model::Diagnostic;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::{ScopeFlags, Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use std::collections::BTreeMap;

const SOURCE_LIMIT: usize = 2 * 1024 * 1024;
const CALL_LIMIT: usize = 100_000;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Value {
    Literal(String, u32, u32),
    Boolean(bool, u32, u32),
    Number(String, u32, u32),
    Null(u32, u32),
    Symbol(u32),
    Global(String),
    Member(Box<Value>, String),
    Import(String, String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
    Function(u32),
    Call(u32),
    Alternatives(Vec<Value>),
    Concat(Vec<Value>, u32, u32),
    Append(Box<Value>, Vec<Value>, u32, u32),
    Unknown(u32, u32),
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Call {
    pub start: u32,
    pub end: u32,
    pub owner: Option<u32>,
    pub callee: Value,
    pub arguments: Vec<Value>,
}
#[derive(Clone, Debug)]
pub struct Function {
    pub start: u32,
    pub end: u32,
    pub parameters: Vec<Pattern>,
    pub returns: Vec<Value>,
}
#[derive(Clone, Debug)]
pub enum Pattern {
    Name(u32),
    Object(Vec<(String, Pattern)>),
    Array(Vec<Option<Pattern>>),
    Unknown,
}
#[derive(Debug, Default)]
pub struct Host {
    pub bindings: BTreeMap<u32, Value>,
    pub names: BTreeMap<u32, String>,
    pub calls: Vec<Call>,
    pub call_index: BTreeMap<u32, usize>,
    pub functions: BTreeMap<u32, Function>,
    pub exports: BTreeMap<String, Value>,
    pub reexports: Vec<String>,
}
struct Collector<'s, 'a> {
    semantic: &'s Semantic<'a>,
    host: Host,
    owners: Vec<u32>,
}
impl<'s, 'a> Collector<'s, 'a> {
    fn name(&mut self, identifier: &BindingIdentifier<'a>) -> u32 {
        let key = identifier
            .symbol_id
            .get()
            .map(|id| self.semantic.scoping().symbol_span(id).start)
            .unwrap_or(identifier.span.start);
        self.host.names.insert(key, identifier.name.as_str().into());
        key
    }
    fn reference(&self, identifier: &IdentifierReference<'a>) -> Value {
        identifier
            .reference_id
            .get()
            .and_then(|id| self.semantic.scoping().get_reference(id).symbol_id())
            .map(|id| Value::Symbol(self.semantic.scoping().symbol_span(id).start))
            .unwrap_or_else(|| Value::Global(identifier.name.as_str().into()))
    }
    fn property(&self, key: &PropertyKey<'a>) -> Option<String> {
        match key {
            PropertyKey::StaticIdentifier(key) => Some(key.name.as_str().into()),
            PropertyKey::StringLiteral(key) => key.value.as_str().map(str::to_owned),
            _ => None,
        }
    }
    fn expression(&self, expression: &Expression<'a>) -> Value {
        match expression {
            Expression::BooleanLiteral(value) => {
                Value::Boolean(value.value, value.span.start, value.span.end)
            }
            Expression::NumericLiteral(value) => value
                .raw
                .map(|raw| raw.as_str())
                .map(|raw| Value::Number(raw.into(), value.span.start, value.span.end))
                .unwrap_or(Value::Unknown(value.span.start, value.span.end)),
            Expression::NullLiteral(value) => Value::Null(value.span.start, value.span.end),
            Expression::StringLiteral(value) => value
                .value
                .as_str()
                .map(|text| Value::Literal(text.into(), value.span.start, value.span.end))
                .unwrap_or(Value::Unknown(value.span.start, value.span.end)),
            Expression::TemplateLiteral(value)
                if value.expressions.is_empty() && value.quasis.len() == 1 =>
            {
                value.quasis[0]
                    .value
                    .cooked
                    .and_then(|s| s.as_str())
                    .map(|text| Value::Literal(text.into(), value.span.start, value.span.end))
                    .unwrap_or(Value::Unknown(value.span.start, value.span.end))
            }
            Expression::TemplateLiteral(value) => {
                let mut parts = Vec::new();
                for (index, quasi) in value.quasis.iter().enumerate() {
                    parts.push(
                        quasi
                            .value
                            .cooked
                            .and_then(|s| s.as_str())
                            .map(|text| {
                                Value::Literal(text.into(), quasi.span.start, quasi.span.end)
                            })
                            .unwrap_or(Value::Unknown(quasi.span.start, quasi.span.end)),
                    );
                    if let Some(expression) = value.expressions.get(index) {
                        parts.push(self.expression(expression));
                    }
                }
                Value::Concat(parts, value.span.start, value.span.end)
            }
            Expression::BinaryExpression(value) if value.operator.as_str() == "+" => Value::Concat(
                vec![self.expression(&value.left), self.expression(&value.right)],
                value.span.start,
                value.span.end,
            ),
            Expression::ConditionalExpression(value) => Value::Alternatives(vec![
                self.expression(&value.consequent),
                self.expression(&value.alternate),
            ]),
            Expression::LogicalExpression(value) => Value::Alternatives(vec![
                self.expression(&value.left),
                self.expression(&value.right),
            ]),
            Expression::AwaitExpression(value) => self.expression(&value.argument),
            Expression::ImportExpression(value) => Value::Call(value.span.start),
            Expression::Identifier(identifier) => self.reference(identifier),
            Expression::StaticMemberExpression(member) => Value::Member(
                Box::new(self.expression(&member.object)),
                member.property.name.as_str().into(),
            ),
            Expression::ComputedMemberExpression(member) => {
                match self.expression(&member.expression) {
                    Value::Literal(key, ..) => {
                        Value::Member(Box::new(self.expression(&member.object)), key)
                    }
                    _ => Value::Unknown(member.span.start, member.span.end),
                }
            }
            Expression::ArrayExpression(array) => Value::Array(
                array
                    .elements
                    .iter()
                    .map(|value| {
                        value
                            .as_expression()
                            .map(|expr| self.expression(expr))
                            .unwrap_or_else(|| {
                                let span = value.span();
                                Value::Unknown(span.start, span.end)
                            })
                    })
                    .collect(),
            ),
            Expression::ObjectExpression(object) => {
                let mut values = BTreeMap::new();
                for item in &object.properties {
                    if let ObjectPropertyKind::ObjectProperty(property) = item {
                        if let Some(key) = self.property(&property.key) {
                            values.insert(key, self.expression(&property.value));
                        } else {
                            return Value::Unknown(object.span.start, object.span.end);
                        }
                    } else {
                        return Value::Unknown(object.span.start, object.span.end);
                    }
                }
                Value::Object(values)
            }
            Expression::FunctionExpression(function) => Value::Function(function.span.start),
            Expression::ArrowFunctionExpression(function) => Value::Function(function.span.start),
            Expression::CallExpression(call) => Value::Call(call.span.start),
            Expression::ParenthesizedExpression(value) => self.expression(&value.expression),
            Expression::TSAsExpression(value) => self.expression(&value.expression),
            Expression::TSSatisfiesExpression(value) => self.expression(&value.expression),
            Expression::TSNonNullExpression(value) => self.expression(&value.expression),
            Expression::TSTypeAssertion(value) => self.expression(&value.expression),
            _ => {
                let span = expression.span();
                Value::Unknown(span.start, span.end)
            }
        }
    }
    fn call(&self, call: &CallExpression<'a>) -> Call {
        Call {
            start: call.span.start,
            end: call.span.end,
            owner: self.owners.last().copied(),
            callee: self.expression(&call.callee),
            arguments: call
                .arguments
                .iter()
                .map(|value| {
                    value
                        .as_expression()
                        .map(|expr| self.expression(expr))
                        .unwrap_or_else(|| {
                            let span = value.span();
                            Value::Unknown(span.start, span.end)
                        })
                })
                .collect(),
        }
    }
    fn pattern(&mut self, pattern: &BindingPattern<'a>) -> Pattern {
        match pattern {
            BindingPattern::BindingIdentifier(name) => Pattern::Name(self.name(name)),
            BindingPattern::ObjectPattern(object) => Pattern::Object(
                object
                    .properties
                    .iter()
                    .map(|property| {
                        let key = self.property(&property.key).unwrap_or_default();
                        (key, self.pattern(&property.value))
                    })
                    .collect(),
            ),
            BindingPattern::ArrayPattern(array) => Pattern::Array(
                array
                    .elements
                    .iter()
                    .map(|item| item.as_ref().map(|pattern| self.pattern(pattern)))
                    .collect(),
            ),
            BindingPattern::AssignmentPattern(pattern) => self.pattern(&pattern.left),
        }
    }
    fn bind(&mut self, pattern: &Pattern, value: Value) {
        match pattern {
            Pattern::Name(key) => {
                self.host
                    .bindings
                    .entry(*key)
                    .and_modify(|previous| {
                        *previous = Value::Alternatives(vec![previous.clone(), value.clone()])
                    })
                    .or_insert(value);
            }
            Pattern::Object(properties) => {
                for (key, pattern) in properties {
                    self.bind(pattern, Value::Member(Box::new(value.clone()), key.clone()));
                }
            }
            Pattern::Array(elements) => {
                for (index, pattern) in elements.iter().enumerate() {
                    if let Some(pattern) = pattern {
                        self.bind(
                            pattern,
                            Value::Member(Box::new(value.clone()), index.to_string()),
                        );
                    }
                }
            }
            Pattern::Unknown => {}
        }
    }
    fn export_name(&self, name: &ModuleExportName<'a>) -> String {
        match name {
            ModuleExportName::IdentifierName(name) => name.name.as_str().into(),
            ModuleExportName::IdentifierReference(name) => name.name.as_str().into(),
            ModuleExportName::StringLiteral(name) => name.value.as_str().unwrap_or("").into(),
        }
    }
}
impl<'s, 'a> Visit<'a> for Collector<'s, 'a> {
    fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
        if import.import_kind == ImportOrExportKind::Type {
            return;
        }
        let source = import.source.value.as_str().unwrap_or("").to_string();
        if let Some(specifiers) = &import.specifiers {
            for specifier in specifiers {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier)
                        if specifier.import_kind != ImportOrExportKind::Type =>
                    {
                        let key = self.name(&specifier.local);
                        self.host.bindings.insert(
                            key,
                            Value::Import(source.clone(), self.export_name(&specifier.imported)),
                        );
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        let key = self.name(&specifier.local);
                        self.host
                            .bindings
                            .insert(key, Value::Import(source.clone(), "default".into()));
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        let key = self.name(&specifier.local);
                        self.host
                            .bindings
                            .insert(key, Value::Import(source.clone(), "*".into()));
                    }
                    _ => {}
                }
            }
        }
    }
    fn visit_variable_declarator(&mut self, declaration: &VariableDeclarator<'a>) {
        if let Some(initializer) = &declaration.init {
            let pattern = self.pattern(&declaration.id);
            let value = self.expression(initializer);
            self.bind(&pattern, value);
        }
        walk::walk_variable_declarator(self, declaration);
    }
    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        self.host.calls.push(Call {
            start: import.span.start,
            end: import.span.end,
            owner: self.owners.last().copied(),
            callee: Value::Global("import".into()),
            arguments: vec![self.expression(&import.source)],
        });
        walk::walk_import_expression(self, import);
    }
    fn visit_new_expression(&mut self, expression: &NewExpression<'a>) {
        self.host.calls.push(Call {
            start: expression.span.start,
            end: expression.span.end,
            owner: self.owners.last().copied(),
            callee: self.expression(&expression.callee),
            arguments: expression
                .arguments
                .iter()
                .map(|arg| {
                    arg.as_expression()
                        .map(|expr| self.expression(expr))
                        .unwrap_or(Value::Unknown(expression.span.start, expression.span.end))
                })
                .collect(),
        });
        walk::walk_new_expression(self, expression);
    }
    fn visit_assignment_expression(&mut self, assignment: &AssignmentExpression<'a>) {
        let value = self.expression(&assignment.right);
        match &assignment.left {
            AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                if let Value::Symbol(key) = self.reference(identifier) {
                    self.host
                        .bindings
                        .entry(key)
                        .and_modify(|previous| {
                            *previous = Value::Alternatives(vec![previous.clone(), value.clone()])
                        })
                        .or_insert(value.clone());
                }
            }
            AssignmentTarget::StaticMemberExpression(member) => {
                let object = self.expression(&member.object);
                let property = member.property.name.as_str();
                if object == Value::Global("module".into()) && property == "exports" {
                    if let Value::Object(values) = value {
                        self.host.exports.extend(values);
                    } else {
                        self.host.exports.insert("default".into(), value);
                    }
                } else if object == Value::Global("exports".into())
                    || object
                        == Value::Member(Box::new(Value::Global("module".into())), "exports".into())
                {
                    self.host.exports.insert(property.into(), value);
                } else if let Value::Symbol(key) = object {
                    self.host.bindings.insert(
                        key,
                        Value::Unknown(assignment.span.start, assignment.span.end),
                    );
                }
            }
            _ => {}
        }
        walk::walk_assignment_expression(self, assignment);
    }
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &call.callee {
            if member.property.name.as_str() == "push" {
                if let Expression::Identifier(identifier) = &member.object {
                    if let Value::Symbol(key) = self.reference(identifier) {
                        let previous = self
                            .host
                            .bindings
                            .remove(&key)
                            .unwrap_or(Value::Symbol(key));
                        let values = call
                            .arguments
                            .iter()
                            .map(|arg| {
                                arg.as_expression()
                                    .map(|e| self.expression(e))
                                    .unwrap_or(Value::Unknown(call.span.start, call.span.end))
                            })
                            .collect();
                        self.host.bindings.insert(
                            key,
                            Value::Append(
                                Box::new(previous),
                                values,
                                call.span.start,
                                call.span.end,
                            ),
                        );
                    }
                }
            }
        }
        self.host.calls.push(self.call(call));
        walk::walk_call_expression(self, call);
    }
    fn visit_function(&mut self, function: &oxc_ast::ast::Function<'a>, flags: ScopeFlags) {
        if let Some(name) = &function.id {
            let key = self.name(name);
            self.host
                .bindings
                .insert(key, Value::Function(function.span.start));
        }
        let parameters = function
            .params
            .items
            .iter()
            .map(|p| self.pattern(&p.pattern))
            .collect();
        self.host.functions.insert(
            function.span.start,
            Function {
                start: function.span.start,
                end: function.span.end,
                parameters,
                returns: Vec::new(),
            },
        );
        self.owners.push(function.span.start);
        walk::walk_function(self, function, flags);
        self.owners.pop();
    }
    fn visit_arrow_function_expression(&mut self, function: &ArrowFunctionExpression<'a>) {
        let parameters = function
            .params
            .items
            .iter()
            .map(|p| self.pattern(&p.pattern))
            .collect();
        let returns = function
            .get_expression()
            .map(|expr| vec![self.expression(expr)])
            .unwrap_or_default();
        self.host.functions.insert(
            function.span.start,
            Function {
                start: function.span.start,
                end: function.span.end,
                parameters,
                returns,
            },
        );
        self.owners.push(function.span.start);
        walk::walk_arrow_function_expression(self, function);
        self.owners.pop();
    }
    fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
        if let (Some(owner), Some(expression)) = (self.owners.last().copied(), &statement.argument)
        {
            let value = self.expression(expression);
            if let Some(function) = self.host.functions.get_mut(&owner) {
                function.returns.push(value);
            }
        }
        walk::walk_return_statement(self, statement);
    }
    fn visit_export_declaration(&mut self, export: &ExportDeclaration<'a>) {
        match &export.declaration {
            Declaration::FunctionDeclaration(function) => {
                if let Some(name) = &function.id {
                    let key = self.name(name);
                    self.host
                        .exports
                        .insert(name.name.as_str().into(), Value::Symbol(key));
                }
            }
            Declaration::VariableDeclaration(declaration) => {
                for item in &declaration.declarations {
                    if let BindingPattern::BindingIdentifier(name) = &item.id {
                        let key = self.name(name);
                        self.host
                            .exports
                            .insert(name.name.as_str().into(), Value::Symbol(key));
                    }
                }
            }
            _ => {}
        }
        walk::walk_export_declaration(self, export);
    }
    fn visit_export_named_declaration(&mut self, export: &ExportNamedDeclaration<'a>) {
        if export.export_kind != ImportOrExportKind::Type {
            for item in &export.specifiers {
                let value = match &item.local {
                    ModuleExportName::IdentifierReference(name) => self.reference(name),
                    _ => Value::Unknown(item.span.start, item.span.end),
                };
                self.host
                    .exports
                    .insert(self.export_name(&item.exported), value);
            }
        }
        walk::walk_export_named_declaration(self, export);
    }
    fn visit_export_all_declaration(&mut self, export: &ExportAllDeclaration<'a>) {
        if export.export_kind != ImportOrExportKind::Type {
            if let Some(name) = &export.exported {
                self.host.exports.insert(
                    self.export_name(name),
                    Value::Import(
                        export.source.value.as_str().unwrap_or("").into(),
                        "*".into(),
                    ),
                );
            } else {
                self.host
                    .reexports
                    .push(export.source.value.as_str().unwrap_or("").into());
            }
        }
        walk::walk_export_all_declaration(self, export);
    }
    fn visit_export_default_declaration(&mut self, export: &ExportDefaultDeclaration<'a>) {
        let value = match &export.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                Value::Function(function.span.start)
            }
            other => other
                .as_expression()
                .map(|e| self.expression(e))
                .unwrap_or(Value::Unknown(export.span.start, export.span.end)),
        };
        self.host.exports.insert("default".into(), value);
        walk::walk_export_default_declaration(self, export);
    }
    fn visit_export_from_declaration(&mut self, export: &ExportFromDeclaration<'a>) {
        if export.export_kind != ImportOrExportKind::Type {
            for item in &export.specifiers {
                self.host.exports.insert(
                    self.export_name(&item.exported),
                    Value::Import(
                        export.source.value.as_str().unwrap_or("").into(),
                        self.export_name(&item.local),
                    ),
                );
            }
        }
        walk::walk_export_from_declaration(self, export);
    }
}
pub fn parse_host(path: &str, source: &str, typescript: bool) -> Result<Host, Diagnostic> {
    if source.len() > SOURCE_LIMIT {
        return Err(Diagnostic::new("parser-source-limit", Some(path)));
    }
    let allocator = Allocator::default();
    let source_type = if typescript {
        if path.ends_with(".tsx") {
            SourceType::tsx()
        } else {
            SourceType::ts()
        }
    } else if path.ends_with(".cjs") {
        SourceType::cjs()
    } else {
        SourceType::mjs()
    };
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.fatal_error || !parsed.diagnostics.is_empty() {
        return Err(Diagnostic::new("unsupported-source-syntax", Some(path)));
    }
    let built = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !built.diagnostics.is_empty() {
        return Err(Diagnostic::new("invalid-source-bindings", Some(path)));
    }
    let mut collector = Collector {
        semantic: &built.semantic,
        host: Host::default(),
        owners: Vec::new(),
    };
    collector.visit_program(&parsed.program);
    if collector.host.calls.len() > CALL_LIMIT {
        return Err(Diagnostic::new("parser-call-limit", Some(path)));
    }
    collector.host.call_index = collector
        .host
        .calls
        .iter()
        .enumerate()
        .map(|(index, call)| (call.start, index))
        .collect();
    Ok(collector.host)
}

#[derive(Debug)]
pub struct ShellCommand {
    pub start: usize,
    pub end: usize,
    pub name: String,
    pub arguments: Vec<String>,
    pub heredocs: Vec<(usize, usize, String)>,
}
pub fn parse_shell(path: &str, source: &str) -> Result<Vec<ShellCommand>, Diagnostic> {
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
    let mut result = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if result.len() > CALL_LIMIT {
            return Err(Diagnostic::new("parser-call-limit", Some(path)));
        }
        if node.kind() == "command" {
            let name = node
                .child_by_field_name("name")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                .unwrap_or("")
                .to_string();
            let mut arguments = Vec::new();
            let mut cursor = node.walk();
            for child in node.children_by_field_name("argument", &mut cursor) {
                arguments.push(child.utf8_text(source.as_bytes()).unwrap_or("").to_string());
            }
            result.push(ShellCommand {
                start: node.start_byte(),
                end: node.end_byte(),
                name,
                arguments,
                heredocs: Vec::new(),
            });
        }
        let mut cursor = node.walk();
        let children: Vec<_> = node.named_children(&mut cursor).collect();
        stack.extend(children.into_iter().rev());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parser_probe_aliases_keep_scoped_binding_and_two_calls() {
        let host=parse_host("probe.ts","import {spawn as launch} from 'node:child_process'; launch('node',['-e','1']); launch('node',['-e','2']);",true).unwrap();
        assert_eq!(host.calls.len(), 2);
        assert_ne!(host.calls[0].start, host.calls[1].start);
        let Value::Symbol(key) = &host.calls[0].callee else {
            panic!("callee must resolve to import binding")
        };
        assert_eq!(
            host.bindings[key],
            Value::Import("node:child_process".into(), "spawn".into())
        );
    }
    #[test]
    fn parser_probe_valid_type_query_is_not_skipped() {
        let host = parse_host(
            "probe.ts",
            "async function f(){return await importOriginal<typeof import('./m.js')>();}",
            true,
        )
        .unwrap();
        assert_eq!(host.calls.len(), 1);
    }
    #[test]
    fn parser_probe_inert_host_text_has_no_call() {
        let host = parse_host(
            "probe.ts",
            "const sample = { command: \"spawn('node',['-e','example'])\" }; // eval('example')\n",
            true,
        )
        .unwrap();
        assert!(host.calls.is_empty());
    }
    #[test]
    fn parser_probe_quoted_cat_heredoc_is_inert() {
        let commands = parse_shell("probe.sh", "cat <<'DOC'\nnode -e 'example'\nDOC\n").unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "cat");
    }
    #[test]
    fn parser_probe_unquoted_heredoc_keeps_executing_substitution() {
        let commands = parse_shell("probe.sh", "cat <<DOC\n$(node -e '1')\nDOC\n").unwrap();
        assert!(commands.iter().any(|command| command.name == "node"));
    }
}
