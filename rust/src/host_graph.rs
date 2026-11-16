use crate::{
    model::Diagnostic,
    syntax::{Call, Host, Pattern, Value},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(deny_unknown_fields)]
pub struct Site {
    pub path: String,
    pub start: u32,
    pub end: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
pub enum Datum {
    Text(String, Site),
    Boolean(bool, Site),
    Number(String, Site),
    Null(Site),
    Parts(Vec<Datum>, Site),
    List(Vec<Datum>),
    Object(BTreeMap<String, Datum>),
    Function(String, u32),
    Namespace(String, String),
    Api(String, String),
    Input(Site, Vec<String>),
    Unknown(Site),
    Alternatives(Vec<Datum>),
}
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Write,
    Execute,
    Shell,
    Eval,
    Mode,
    Indirect,
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Event {
    pub site: Site,
    pub operation: Operation,
    pub api: String,
    pub arguments: Vec<Datum>,
    pub owner: Option<u32>,
}
#[derive(Default)]
pub struct Graph {
    pub events: BTreeSet<Event>,
    pub called_functions: BTreeSet<(String, u32)>,
    pub diagnostics: Vec<Diagnostic>,
}
type Environment = BTreeMap<u32, Datum>;
struct Frame {
    module: String,
    call: Call,
    environment: Environment,
}
struct Engine<'a> {
    modules: &'a BTreeMap<String, Host>,
    known_registry_calls: &'a BTreeSet<Site>,
    graph: Graph,
    queue: VecDeque<Frame>,
    seen: BTreeSet<(String, u32, Environment)>,
    steps: usize,
}
const STEP_LIMIT: usize = 1_000_000;
const DEPTH_LIMIT: usize = 32;
fn site(path: &str, start: u32, end: u32) -> Site {
    Site {
        path: path.into(),
        start,
        end,
        body: None,
    }
}
fn module_path(modules: &BTreeMap<String, Host>, parent: &str, reference: &str) -> Option<String> {
    if !reference.starts_with('.') {
        return None;
    }
    let mut pieces: Vec<_> = parent.split('/').collect();
    pieces.pop();
    for piece in reference.split('/') {
        match piece {
            "." | "" => {}
            ".." => {
                pieces.pop()?;
            }
            piece => pieces.push(piece),
        }
    }
    let path = pieces.join("/");
    let mut options = vec![
        path.clone(),
        format!("{path}.ts"),
        format!("{path}.js"),
        format!("{path}/index.ts"),
        format!("{path}/index.js"),
    ];
    if let Some(base) = path.strip_suffix(".js") {
        options.push(format!("{base}.ts"));
        options.push(format!("{base}.tsx"));
    }
    options.into_iter().find(|path| modules.contains_key(path))
}
fn api(source: &str, name: &str) -> Datum {
    let source = match source {
        "fs" => "node:fs",
        "fs/promises" => "node:fs/promises",
        "child_process" => "node:child_process",
        "path" => "node:path",
        "os" => "node:os",
        "vm" => "node:vm",
        source => source,
    };
    if name == "*"
        || name == "default"
            && matches!(
                source,
                "node:fs"
                    | "node:fs/promises"
                    | "node:child_process"
                    | "node:path"
                    | "node:os"
                    | "node:vm"
            )
    {
        Datum::Namespace(source.into(), String::new())
    } else {
        Datum::Api(source.into(), name.into())
    }
}
fn operation(module: &str, name: &str) -> Option<Operation> {
    match module {
        "node:fs" | "node:fs/promises"
            if matches!(
                name,
                "writeFile"
                    | "writeFileSync"
                    | "appendFile"
                    | "appendFileSync"
                    | "createWriteStream"
            ) =>
        {
            Some(Operation::Write)
        }
        "write-file-atomic" if matches!(name, "default" | "sync" | "async") => {
            Some(Operation::Write)
        }
        "node:fs" | "node:fs/promises" if matches!(name, "chmod" | "chmodSync") => {
            Some(Operation::Mode)
        }
        "node:child_process" if matches!(name, "exec" | "execSync") => Some(Operation::Shell),
        "node:child_process"
            if matches!(
                name,
                "spawn" | "spawnSync" | "execFile" | "execFileSync" | "fork"
            ) =>
        {
            Some(Operation::Execute)
        }
        "node:vm"
            if matches!(
                name,
                "runInContext"
                    | "runInNewContext"
                    | "runInThisContext"
                    | "Script"
                    | "compileFunction"
            ) =>
        {
            Some(Operation::Eval)
        }
        "global" if matches!(name, "eval" | "Function") => Some(Operation::Eval),
        "execa" | "cross-spawn" | "shelljs" | "zx" => Some(Operation::Indirect),
        _ => None,
    }
}

fn data_api(module: &str, name: &str) -> bool {
    match module {
        "global:console" => matches!(name, "log" | "warn" | "error" | "info" | "debug" | "trace"),
        "global:JSON" => matches!(name, "parse" | "stringify"),
        "global:Object" => matches!(
            name,
            "keys"
                | "values"
                | "entries"
                | "fromEntries"
                | "assign"
                | "freeze"
                | "is"
                | "hasOwn"
                | "getOwnPropertyNames"
        ),
        "global:Math" => true,
        "global" => matches!(
            name,
            "String"
                | "Number"
                | "Boolean"
                | "Date"
                | "Error"
                | "TypeError"
                | "RangeError"
                | "RegExp"
                | "parseInt"
                | "parseFloat"
                | "isNaN"
                | "isFinite"
        ),
        "node:path" | "node:os" | "node:url" => true,
        "node:fs" | "node:fs/promises" => matches!(
            name,
            "readFile"
                | "readFileSync"
                | "existsSync"
                | "stat"
                | "statSync"
                | "lstat"
                | "lstatSync"
                | "readdir"
                | "readdirSync"
                | "realpath"
                | "realpathSync"
                | "access"
                | "accessSync"
                | "mkdir"
                | "mkdirSync"
        ),
        _ => false,
    }
}
impl Engine<'_> {
    fn input(&self, path: &str, key: u32) -> Datum {
        Datum::Input(site(path, key, key), Vec::new())
    }
    fn is_parameter(&self, path: &str, key: u32) -> bool {
        fn contains(pattern: &Pattern, key: u32) -> bool {
            match pattern {
                Pattern::Name(candidate) => *candidate == key,
                Pattern::Object(properties) => properties.iter().any(|(_, p)| contains(p, key)),
                Pattern::Array(items) => items.iter().flatten().any(|p| contains(p, key)),
                Pattern::Unknown => false,
            }
        }
        self.modules[path].functions.values().any(|function| {
            function
                .parameters
                .iter()
                .any(|pattern| contains(pattern, key))
        })
    }
    fn resolve_import(&mut self, path: &str, source: &str, name: &str, depth: usize) -> Datum {
        if depth > DEPTH_LIMIT {
            return Datum::Unknown(site(path, 0, 0));
        }
        if source.starts_with('.') {
            let Some(target) = module_path(self.modules, path, source) else {
                return Datum::Unknown(site(path, 0, 0));
            };
            if name == "*" {
                return Datum::Namespace("owned".into(), target);
            }
            if let Some(value) = self.modules[&target].exports.get(name).cloned() {
                return self.value(&target, &value, &Environment::new(), depth + 1);
            }
            for source in self.modules[&target].reexports.clone() {
                let resolved = self.resolve_import(&target, &source, name, depth + 1);
                if !matches!(resolved, Datum::Unknown(_)) {
                    return resolved;
                }
            }
            Datum::Unknown(site(&target, 0, 0))
        } else {
            api(source, name)
        }
    }
    fn value(
        &mut self,
        path: &str,
        value: &Value,
        environment: &Environment,
        depth: usize,
    ) -> Datum {
        self.steps += 1;
        if depth > DEPTH_LIMIT || self.steps > STEP_LIMIT {
            return Datum::Unknown(site(path, 0, 0));
        }
        match value {
            Value::Literal(text, start, end) => Datum::Text(text.clone(), site(path, *start, *end)),
            Value::Boolean(value, start, end) => Datum::Boolean(*value, site(path, *start, *end)),
            Value::Number(value, start, end) => {
                Datum::Number(value.clone(), site(path, *start, *end))
            }
            Value::Null(start, end) => Datum::Null(site(path, *start, *end)),
            Value::Symbol(key) => {
                if let Some(value) = environment.get(key) {
                    value.clone()
                } else if let Some(value) = self.modules[path].bindings.get(key).cloned() {
                    self.value(path, &value, environment, depth + 1)
                } else if self.is_parameter(path, *key) {
                    self.input(path, *key)
                } else {
                    Datum::Unknown(site(path, *key, *key))
                }
            }
            Value::Global(name) => {
                let source = if matches!(
                    name.as_str(),
                    "writeFileSync" | "writeFile" | "appendFileSync" | "chmodSync"
                ) {
                    "node:fs"
                } else if matches!(
                    name.as_str(),
                    "spawn" | "spawnSync" | "execFile" | "execFileSync" | "exec" | "execSync"
                ) {
                    "node:child_process"
                } else {
                    "global"
                };
                Datum::Api(source.into(), name.clone())
            }
            Value::Import(source, name) => self.resolve_import(path, source, name, depth + 1),
            Value::Member(object, property) => {
                let object = self.value(path, object, environment, depth + 1);
                self.member(path, object, property, depth + 1)
            }
            Value::Array(values) => Datum::List(
                values
                    .iter()
                    .map(|value| self.value(path, value, environment, depth + 1))
                    .collect(),
            ),
            Value::Object(values) => Datum::Object(
                values
                    .iter()
                    .map(|(key, value)| {
                        (key.clone(), self.value(path, value, environment, depth + 1))
                    })
                    .collect(),
            ),
            Value::Function(start) => Datum::Function(path.into(), *start),
            Value::Call(start) => {
                let call = self.modules[path]
                    .call_index
                    .get(start)
                    .and_then(|index| self.modules[path].calls.get(*index))
                    .cloned();
                call.map(|call| self.return_value(path, &call, environment, depth + 1))
                    .unwrap_or_else(|| Datum::Unknown(site(path, *start, *start)))
            }
            Value::Concat(values, start, end) => {
                let values: Vec<_> = values
                    .iter()
                    .map(|value| self.value(path, value, environment, depth + 1))
                    .collect();
                if values.iter().all(|value| matches!(value, Datum::Text(..))) {
                    Datum::Text(
                        values
                            .iter()
                            .map(|value| match value {
                                Datum::Text(text, ..) => text.as_str(),
                                _ => "",
                            })
                            .collect(),
                        site(path, *start, *end),
                    )
                } else {
                    Datum::Parts(values, site(path, *start, *end))
                }
            }
            Value::Append(previous, values, start, end) => {
                let previous = self.value(path, previous, environment, depth + 1);
                let values: Vec<_> = values
                    .iter()
                    .map(|value| self.value(path, value, environment, depth + 1))
                    .collect();
                if let Datum::List(mut list) = previous {
                    list.extend(values);
                    Datum::List(list)
                } else {
                    Datum::Unknown(site(path, *start, *end))
                }
            }
            Value::Alternatives(values) => {
                let mut values: Vec<_> = values
                    .iter()
                    .map(|value| self.value(path, value, environment, depth + 1))
                    .collect();
                values.sort();
                values.dedup();
                Datum::Alternatives(values)
            }
            Value::Unknown(start, end) => Datum::Unknown(site(path, *start, *end)),
        }
    }
    fn member(&mut self, path: &str, object: Datum, property: &str, depth: usize) -> Datum {
        match object {
            Datum::Namespace(kind, module) if kind == "owned" => {
                if let Some(value) = self.modules[&module].exports.get(property).cloned() {
                    self.value(&module, &value, &Environment::new(), depth + 1)
                } else {
                    Datum::Unknown(site(&module, 0, 0))
                }
            }
            Datum::Namespace(module, _) => api(&module, property),
            Datum::Object(values) => values
                .get(property)
                .cloned()
                .unwrap_or_else(|| Datum::Unknown(site(path, 0, 0))),
            Datum::List(values) => property
                .parse::<usize>()
                .ok()
                .and_then(|i| values.get(i).cloned())
                .unwrap_or_else(|| Datum::Unknown(site(path, 0, 0))),
            Datum::Alternatives(values) => Datum::Alternatives(
                values
                    .into_iter()
                    .map(|value| self.member(path, value, property, depth + 1))
                    .collect(),
            ),
            Datum::Api(module, name) if module == "global" => {
                Datum::Api(format!("global:{name}"), property.into())
            }
            Datum::Input(origin, mut properties) => {
                properties.push(property.into());
                Datum::Input(origin, properties)
            }
            _ => Datum::Unknown(site(path, 0, 0)),
        }
    }
    fn bind_pattern(
        &self,
        path: &str,
        pattern: &Pattern,
        value: Datum,
        environment: &mut Environment,
    ) {
        match pattern {
            Pattern::Name(key) => {
                environment.insert(*key, value);
            }
            Pattern::Object(properties) => {
                for (key, pattern) in properties {
                    let value = match &value {
                        Datum::Object(values) => values
                            .get(key)
                            .cloned()
                            .unwrap_or_else(|| Datum::Unknown(site(path, 0, 0))),
                        Datum::Input(origin, properties) => {
                            let mut properties = properties.clone();
                            properties.push(key.clone());
                            Datum::Input(origin.clone(), properties)
                        }
                        _ => Datum::Unknown(site(path, 0, 0)),
                    };
                    self.bind_pattern(path, pattern, value, environment);
                }
            }
            Pattern::Array(items) => {
                for (index, pattern) in items.iter().enumerate() {
                    if let Some(pattern) = pattern {
                        let value = match &value {
                            Datum::List(values) => values
                                .get(index)
                                .cloned()
                                .unwrap_or_else(|| Datum::Unknown(site(path, 0, 0))),
                            Datum::Input(origin, properties) => {
                                let mut properties = properties.clone();
                                properties.push(index.to_string());
                                Datum::Input(origin.clone(), properties)
                            }
                            _ => Datum::Unknown(site(path, 0, 0)),
                        };
                        self.bind_pattern(path, pattern, value, environment);
                    }
                }
            }
            Pattern::Unknown => {}
        }
    }
    fn function_environment(&self, path: &str, start: u32, arguments: &[Datum]) -> Environment {
        let mut environment = Environment::new();
        if let Some(function) = self.modules[path].functions.get(&start) {
            for (index, pattern) in function.parameters.iter().enumerate() {
                self.bind_pattern(
                    path,
                    pattern,
                    arguments
                        .get(index)
                        .cloned()
                        .unwrap_or_else(|| self.input(path, start)),
                    &mut environment,
                );
            }
        }
        environment
    }
    fn return_value(
        &mut self,
        path: &str,
        call: &Call,
        environment: &Environment,
        depth: usize,
    ) -> Datum {
        if depth > DEPTH_LIMIT {
            return Datum::Unknown(site(path, call.start, call.end));
        }
        let arguments: Vec<_> = call
            .arguments
            .iter()
            .map(|value| self.value(path, value, environment, depth + 1))
            .collect();
        let callee = self.value(path, &call.callee, environment, depth + 1);
        match callee {
            Datum::Api(module, name)
                if module == "global" && matches!(name.as_str(), "require" | "import") =>
            {
                if let Some(Datum::Text(source, ..)) = arguments.first() {
                    self.resolve_import(path, source, "*", depth + 1)
                } else {
                    Datum::Unknown(site(path, call.start, call.end))
                }
            }
            Datum::Function(module, start) => {
                let environment = self.function_environment(&module, start, &arguments);
                let returns = self.modules[&module]
                    .functions
                    .get(&start)
                    .map(|function| function.returns.clone())
                    .unwrap_or_default();
                if returns.len() == 1 {
                    self.value(&module, &returns[0], &environment, depth + 1)
                } else {
                    Datum::Alternatives(
                        returns
                            .iter()
                            .map(|value| self.value(&module, value, &environment, depth + 1))
                            .collect(),
                    )
                }
            }
            Datum::Api(module, name)
                if matches!(module.as_str(), "node:path" | "global:path")
                    && matches!(name.as_str(), "join" | "resolve") =>
            {
                if arguments.iter().all(|v| matches!(v, Datum::Text(..))) {
                    let values = arguments
                        .iter()
                        .filter_map(|v| {
                            if let Datum::Text(text, ..) = v {
                                Some(text.as_str())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    let first = if name == "resolve" {
                        values
                            .iter()
                            .rposition(|value| value.starts_with('/'))
                            .unwrap_or(0)
                    } else {
                        0
                    };
                    let text = values[first..].join("/");
                    if name == "resolve" && !text.starts_with('/') {
                        Datum::Unknown(site(path, call.start, call.end))
                    } else {
                        let mut parts = Vec::new();
                        let absolute = text.starts_with('/');
                        for part in text.split('/') {
                            match part {
                                "" | "." => {}
                                ".." if parts.last().is_some_and(|part| *part != "..") => {
                                    parts.pop();
                                }
                                ".." if !absolute => parts.push(part),
                                ".." => {}
                                part => parts.push(part),
                            }
                        }
                        Datum::Text(
                            format!("{}{}", if absolute { "/" } else { "" }, parts.join("/")),
                            site(path, call.start, call.end),
                        )
                    }
                } else {
                    Datum::Parts(arguments, site(path, call.start, call.end))
                }
            }
            _ => {
                // Array joins are deterministic producer syntax; the original receiver is retained in IR.
                if let Value::Member(receiver, name) = &call.callee {
                    if name == "join" {
                        if let Datum::List(values) =
                            self.value(path, receiver, environment, depth + 1)
                        {
                            let separator = match arguments.first() {
                                Some(Datum::Text(text, ..)) => text.as_str(),
                                None => ",",
                                _ => return Datum::Unknown(site(path, call.start, call.end)),
                            };
                            if values.iter().all(|v| matches!(v, Datum::Text(..))) {
                                return Datum::Text(
                                    values
                                        .iter()
                                        .filter_map(|v| {
                                            if let Datum::Text(text, ..) = v {
                                                Some(text.as_str())
                                            } else {
                                                None
                                            }
                                        })
                                        .collect::<Vec<_>>()
                                        .join(separator),
                                    site(path, call.start, call.end),
                                );
                            }
                            let mut parts = Vec::new();
                            for (index, value) in values.into_iter().enumerate() {
                                if index > 0 {
                                    parts.push(Datum::Text(
                                        separator.into(),
                                        site(path, call.start, call.end),
                                    ));
                                }
                                parts.push(value);
                            }
                            return Datum::Parts(parts, site(path, call.start, call.end));
                        }
                    }
                }
                Datum::Unknown(site(path, call.start, call.end))
            }
        }
    }
    fn process(&mut self, frame: Frame) {
        let callee = self.value(&frame.module, &frame.call.callee, &frame.environment, 0);
        let arguments: Vec<_> = frame
            .call
            .arguments
            .iter()
            .map(|value| self.value(&frame.module, value, &frame.environment, 0))
            .collect();
        let mut callees = vec![callee];
        while let Some(callee) = callees.pop() {
            match callee {
                Datum::Alternatives(values) => callees.extend(values),
                Datum::Function(module, start) => {
                    self.graph.called_functions.insert((module.clone(), start));
                    let environment = self.function_environment(&module, start, &arguments);
                    if self
                        .seen
                        .insert((module.clone(), start, environment.clone()))
                    {
                        for call in self.modules[&module]
                            .calls
                            .iter()
                            .filter(|call| call.owner == Some(start))
                        {
                            self.queue.push_back(Frame {
                                module: module.clone(),
                                call: call.clone(),
                                environment: environment.clone(),
                            });
                        }
                    }
                }
                Datum::Api(module, name) => {
                    if let Some(operation) = operation(&module, &name) {
                        self.graph.events.insert(Event {
                            site: site(&frame.module, frame.call.start, frame.call.end),
                            operation,
                            api: format!("{module}/{name}"),
                            arguments: arguments.clone(),
                            owner: frame.call.owner,
                        });
                    } else if !data_api(&module, &name)
                        && !self.known_registry_calls.contains(&site(
                            &frame.module,
                            frame.call.start,
                            frame.call.end,
                        ))
                    {
                        self.graph.diagnostics.push(Diagnostic::new(
                            "reviewed-call-registry-required",
                            Some(&frame.module),
                        ));
                    }
                }
                Datum::Input(origin, properties) => {
                    self.graph.events.insert(Event {
                        site: site(&frame.module, frame.call.start, frame.call.end),
                        operation: Operation::Indirect,
                        api: format!(
                            "parameter:{}@{}:{}",
                            origin.path,
                            origin.start,
                            properties.join(".")
                        ),
                        arguments: arguments.clone(),
                        owner: frame.call.owner,
                    });
                }
                Datum::Unknown(_) | Datum::Parts(..) => self
                    .graph
                    .diagnostics
                    .push(Diagnostic::new("unresolved-execution", Some(&frame.module))),
                _ => {}
            }
        }
    }
}
pub fn analyze(modules: &BTreeMap<String, Host>) -> Graph {
    analyze_with_registry_calls(modules, &BTreeSet::new())
}

pub fn analyze_with_registry_calls(
    modules: &BTreeMap<String, Host>,
    known_registry_calls: &BTreeSet<Site>,
) -> Graph {
    let mut engine = Engine {
        modules,
        known_registry_calls,
        graph: Graph::default(),
        queue: VecDeque::new(),
        seen: BTreeSet::new(),
        steps: 0,
    };
    for (module, host) in modules {
        for call in &host.calls {
            engine.queue.push_back(Frame {
                module: module.clone(),
                call: call.clone(),
                environment: Environment::new(),
            });
        }
    }
    while let Some(frame) = engine.queue.pop_front() {
        engine.steps += 1;
        if engine.steps > STEP_LIMIT {
            engine
                .graph
                .diagnostics
                .push(Diagnostic::new("caller-worklist-limit", None));
            break;
        }
        engine.process(frame);
    }
    engine.graph
}

pub fn resolve_value(modules: &BTreeMap<String, Host>, path: &str, value: &Value) -> Datum {
    if !modules.contains_key(path) {
        return Datum::Unknown(site(path, 0, 0));
    }
    let known_registry_calls = BTreeSet::new();
    let mut engine = Engine {
        modules,
        known_registry_calls: &known_registry_calls,
        graph: Graph::default(),
        queue: VecDeque::new(),
        seen: BTreeSet::new(),
        steps: 0,
    };
    engine.value(path, value, &Environment::new(), 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(sources: &[(&str, &str)]) -> Graph {
        let modules = sources
            .iter()
            .map(|(path, text)| {
                (
                    (*path).into(),
                    crate::syntax::parse_host(path, text, true).expect("valid control syntax"),
                )
            })
            .collect();
        analyze(&modules)
    }

    fn literal(value: &Datum) -> Option<&str> {
        match value {
            Datum::Text(value, _) => Some(value),
            _ => None,
        }
    }

    #[test]
    fn imported_writer_alias_retains_actual_output_and_body() {
        let result = graph(&[(
            "src/create.ts",
            "import {writeFileSync as emit} from 'node:fs'; const alias = emit; alias('tools/guard', '#!/bin/sh\\nexit 0\\n');",
        )]);
        let events: Vec<_> = result.events.iter().collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].operation, Operation::Write);
        assert_eq!(events[0].api, "node:fs/writeFileSync");
        assert_eq!(literal(&events[0].arguments[0]), Some("tools/guard"));
        assert_eq!(
            literal(&events[0].arguments[1]),
            Some("#!/bin/sh\nexit 0\n")
        );
    }

    #[test]
    fn namespace_destructure_process_alias_retains_inline_arguments() {
        let result = graph(&[(
            "src/run.ts",
            "import * as cp from 'node:child_process'; const {spawnSync: invoke} = cp; invoke('node', ['-e', 'console.log(1)']);",
        )]);
        let events: Vec<_> = result.events.iter().collect();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].operation, Operation::Execute);
        assert_eq!(literal(&events[0].arguments[0]), Some("node"));
        let Datum::List(arguments) = &events[0].arguments[1] else {
            panic!("array retained")
        };
        assert_eq!(literal(&arguments[0]), Some("-e"));
        assert_eq!(literal(&arguments[1]), Some("console.log(1)"));
    }

    #[test]
    fn cross_module_wrapper_propagates_owned_caller_arguments() {
        let result = graph(&[
            (
                "src/create.ts",
                "import {writeFileSync as emit} from 'node:fs'; export function create(path, body) { emit(path, body); }",
            ),
            (
                "src/main.ts",
                "import {create as original} from './create.js'; const alias = original; alias('tools/guard', '#!/bin/sh\\nexit 0\\n');",
            ),
        ]);
        assert!(result
            .called_functions
            .iter()
            .any(|(path, _)| path == "src/create.ts"));
        assert!(result.events.iter().any(|event| {
            event.operation == Operation::Write
                && literal(&event.arguments[0]) == Some("tools/guard")
                && literal(&event.arguments[1]) == Some("#!/bin/sh\nexit 0\n")
        }));
    }

    #[test]
    fn same_line_calls_have_distinct_ast_sites_and_arguments() {
        let result = graph(&[(
            "src/run.ts",
            "import {spawnSync as run} from 'node:child_process'; run('node',['first.js']); run('node',['second.js']);",
        )]);
        let events: Vec<_> = result.events.iter().collect();
        assert_eq!(events.len(), 2);
        assert_ne!(events[0].site.start, events[1].site.start);
        assert_ne!(events[0].arguments, events[1].arguments);
    }

    #[test]
    fn local_shadow_does_not_inherit_imported_writer_authority() {
        let result = graph(&[(
            "src/run.ts",
            "import {writeFileSync as emit} from 'node:fs'; function harmless(emit) { emit('data'); } harmless((value) => value);",
        )]);
        assert!(!result
            .events
            .iter()
            .any(|event| event.operation == Operation::Write));
        assert!(result
            .events
            .iter()
            .any(|event| event.operation == Operation::Indirect));
    }

    #[test]
    fn destructured_inputs_keep_distinct_symbol_and_property_identities() {
        let result = graph(&[(
            "src/run.ts",
            "export function run({first,second}) { first(); second(); }",
        )]);
        let events: Vec<_> = result
            .events
            .iter()
            .filter(|event| event.operation == Operation::Indirect)
            .collect();
        assert_eq!(events.len(), 2);
        assert_ne!(events[0].api, events[1].api);
    }

    #[test]
    fn unknown_computed_callee_fails_closed() {
        let result = graph(&[(
            "src/run.ts",
            "const table = {}; table[process.argv[2]]('node');",
        )]);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "unresolved-execution"));
    }
}
