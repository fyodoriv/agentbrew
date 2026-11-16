use crate::host_graph::{Datum, Event, Operation};
use crate::model::Diagnostic;
use crate::reviewed_sources::Span;
use crate::snapshot::Snapshot;
use serde::Deserialize;

const SOURCE_LIMIT: usize = 2 * 1024 * 1024;
const DECODED_LIMIT: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextBinding {
    source: Span,
    expected_source: String,
}

impl TextBinding {
    fn valid(&self, source: &str) -> bool {
        self.source.text(source) == Some(self.expected_source.as_str())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Output {
    name: String,
    binding_name: String,
    binding: TextBinding,
    argument: TextBinding,
    inputs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Decoder {
    RustByteString,
    RustString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Body {
    source: Span,
    decoder: Decoder,
    language: String,
    environment_inputs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Mode {
    call: TextBinding,
    argument: TextBinding,
    literal: Span,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Record {
    path: String,
    git_blob: String,
    language: String,
    kind: String,
    owner: String,
    migration_slice: String,
    reason: String,
    call: TextBinding,
    callee: TextBinding,
    caller: TextBinding,
    caller_scope: TextBinding,
    output: Output,
    body: Body,
    mode: Mode,
    consumers: Vec<TextBinding>,
}

#[derive(Clone, Debug)]
pub struct Evidence {
    pub event: Event,
    pub owner: String,
    pub migration_slice: String,
    pub environment_inputs: Vec<String>,
    pub executable_mode: u32,
}

fn error(code: &str, path: &str) -> Diagnostic {
    Diagnostic::new(code, Some(path))
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && !value.as_bytes()[0].is_ascii_digit()
}

fn contains(outer: &Span, inner: &Span) -> bool {
    outer.start <= inner.start && inner.end <= outer.end
}

pub fn inspect(snapshot: &Snapshot) -> Result<Vec<Evidence>, Diagnostic> {
    let records = crate::reviewed_sources::producer_records()?;
    let mut result = Vec::new();
    let mut sites = std::collections::BTreeSet::new();
    let mut decoded = 0usize;
    for record in records {
        let path = &record.path;
        let Some(entry) = snapshot.entries.get(path) else {
            continue;
        };
        if entry.mode == 0o120000 || record.git_blob != entry.blob {
            return Err(error("stale-reviewed-producer", path));
        }
        let source = std::str::from_utf8(&entry.bytes)
            .map_err(|_| error("reviewed-producer-encoding", path))?;
        if source.len() > SOURCE_LIMIT
            || record
                .body
                .source
                .end
                .saturating_sub(record.body.source.start)
                > SOURCE_LIMIT
        {
            return Err(error("reviewed-producer-limit", path));
        }
        if !crate::validation::relative_path(path)
            || !matches!(record.git_blob.len(), 40 | 64)
            || !record.git_blob.bytes().all(|byte| byte.is_ascii_hexdigit())
            || record.language != "rust"
            || record.kind != "literal-producer"
            || crate::source_kind::language(path, source) != Some("rust")
            || record.owner.trim().is_empty()
            || !record.migration_slice.starts_with("rust-")
            || record.reason.trim().is_empty()
            || !record.call.valid(source)
            || !record.callee.valid(source)
            || !record.caller.valid(source)
            || !record.caller_scope.valid(source)
            || record.caller_scope.source.start != record.caller.source.start
            || !contains(&record.caller_scope.source, &record.caller.source)
            || !contains(&record.caller_scope.source, &record.output.binding.source)
            || !contains(&record.caller_scope.source, &record.call.source)
            || !contains(&record.caller_scope.source, &record.mode.call.source)
            || !record.output.binding.valid(source)
            || !record.output.argument.valid(source)
            || !record.mode.call.valid(source)
            || !record.mode.argument.valid(source)
            || !record
                .mode
                .call
                .expected_source
                .starts_with("fs::set_permissions(")
            || record.callee.expected_source != "fs::write"
            || record.callee.source.start != record.call.source.start
            || !contains(&record.call.source, &record.callee.source)
            || !contains(&record.call.source, &record.output.argument.source)
            || !contains(&record.call.source, &record.body.source)
            || !contains(&record.mode.call.source, &record.mode.argument.source)
            || !contains(&record.mode.call.source, &record.mode.literal)
            || record.caller.source.end > record.output.binding.source.start
            || record.output.binding.source.end > record.call.source.start
            || !identifier(&record.output.binding_name)
            || record.output.argument.expected_source != format!("&{}", record.output.binding_name)
            || record.mode.argument.expected_source != record.output.argument.expected_source
            || !record
                .output
                .binding
                .expected_source
                .starts_with(&format!("let {} = ", record.output.binding_name))
            || record.output.name.trim().is_empty()
            || record.output.inputs.is_empty()
            || record.consumers.is_empty()
            || record
                .consumers
                .iter()
                .any(|consumer| !consumer.valid(source))
        {
            return Err(error("reviewed-producer-binding", path));
        }
        let raw = record
            .body
            .source
            .text(source)
            .ok_or_else(|| error("reviewed-producer-binding", path))?;
        let body = match record.body.decoder {
            Decoder::RustByteString => String::from_utf8(
                syn::parse_str::<syn::LitByteStr>(raw)
                    .map_err(|_| error("reviewed-producer-literal", path))?
                    .value(),
            )
            .map_err(|_| error("reviewed-producer-encoding", path))?,
            Decoder::RustString => syn::parse_str::<syn::LitStr>(raw)
                .map_err(|_| error("reviewed-producer-literal", path))?
                .value(),
        };
        decoded = decoded
            .checked_add(body.len())
            .ok_or_else(|| error("reviewed-producer-limit", path))?;
        if decoded > DECODED_LIMIT
            || crate::native_facts::shebang(&body) != Some(record.body.language.as_str())
        {
            return Err(error("reviewed-producer-body", path));
        }
        for name in &record.body.environment_inputs {
            if !identifier(name)
                || (!body.contains(&format!("${name}")) && !body.contains(&format!("${{{name}}}")))
            {
                return Err(error("reviewed-producer-input", path));
            }
        }
        let mode = syn::parse_str::<syn::LitInt>(
            record
                .mode
                .literal
                .text(source)
                .ok_or_else(|| error("reviewed-producer-mode", path))?,
        )
        .map_err(|_| error("reviewed-producer-mode", path))?
        .base10_parse::<u32>()
        .map_err(|_| error("reviewed-producer-mode", path))?;
        if mode & 0o111 == 0 {
            return Err(error("reviewed-producer-mode", path));
        }
        let site = record
            .call
            .source
            .site(path)
            .ok_or_else(|| error("reviewed-producer-binding", path))?;
        if !sites.insert(site.clone()) {
            return Err(error("reviewed-producer-duplicate", path));
        }
        result.push(Evidence {
            event: Event {
                site,
                operation: Operation::Write,
                api: "rust:std::fs/write".into(),
                arguments: vec![
                    Datum::Input(
                        record
                            .output
                            .binding
                            .source
                            .site(path)
                            .ok_or_else(|| error("reviewed-producer-binding", path))?,
                        vec![record.output.name],
                    ),
                    Datum::Text(
                        body,
                        record
                            .body
                            .source
                            .site(path)
                            .ok_or_else(|| error("reviewed-producer-binding", path))?,
                    ),
                ],
                owner: Some(
                    record
                        .caller
                        .source
                        .start
                        .try_into()
                        .map_err(|_| error("reviewed-producer-binding", path))?,
                ),
            },
            owner: record.owner,
            migration_slice: record.migration_slice,
            environment_inputs: record.body.environment_inputs,
            executable_mode: mode,
        });
    }
    Ok(result)
}
