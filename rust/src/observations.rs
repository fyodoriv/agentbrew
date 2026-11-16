use crate::host_graph::{Datum, Event, Operation, Site};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(deny_unknown_fields)]
pub struct CallReceipt {
    pub site: Site,
    pub operation: Operation,
    pub callee: String,
    pub arguments: Vec<Datum>,
}

impl From<&Event> for CallReceipt {
    fn from(event: &Event) -> Self {
        Self {
            site: event.site.clone(),
            operation: event.operation.clone(),
            callee: event.api.clone(),
            arguments: event.arguments.clone(),
        }
    }
}

pub fn by_site(events: &BTreeSet<Event>) -> BTreeMap<Site, Vec<CallReceipt>> {
    let mut result: BTreeMap<Site, Vec<CallReceipt>> = BTreeMap::new();
    for event in events {
        result
            .entry(event.site.clone())
            .or_default()
            .push(CallReceipt::from(event));
    }
    for receipts in result.values_mut() {
        receipts.sort();
        receipts.dedup();
    }
    result
}

pub fn exact_receipts(observed: &[CallReceipt], reviewed: &[CallReceipt]) -> bool {
    if observed.is_empty() || reviewed.is_empty() {
        return false;
    }
    let observed: BTreeSet<_> = observed.iter().collect();
    let reviewed_unique: BTreeSet<_> = reviewed.iter().collect();
    reviewed_unique.len() == reviewed.len() && observed == reviewed_unique
}

pub fn literal(value: &Datum) -> Option<&str> {
    match value {
        Datum::Text(value, _) => Some(value),
        _ => None,
    }
}

pub fn output_matches(observed: &Datum, reviewed_path: &str, reviewed: Option<&Datum>) -> bool {
    if let Some(path) = literal(observed) {
        path == reviewed_path && reviewed.is_none_or(|reviewed| reviewed == observed)
    } else {
        reviewed == Some(observed) && !has_unknown(observed)
    }
}

pub fn has_unknown(value: &Datum) -> bool {
    match value {
        Datum::Unknown(_) => true,
        Datum::Parts(values, _) | Datum::List(values) | Datum::Alternatives(values) => {
            values.iter().any(has_unknown)
        }
        Datum::Object(values) => values.values().any(has_unknown),
        _ => false,
    }
}

pub fn external_inputs(value: &Datum, result: &mut BTreeSet<String>) {
    match value {
        Datum::Input(origin, properties) => {
            result.insert(format!(
                "parameter:{}@{}:{}",
                origin.body.as_deref().unwrap_or(&origin.path),
                origin.start,
                properties.join(".")
            ));
        }
        Datum::Parts(values, _) | Datum::List(values) | Datum::Alternatives(values) => {
            for value in values {
                external_inputs(value, result);
            }
        }
        Datum::Object(values) => {
            for value in values.values() {
                external_inputs(value, result);
            }
        }
        _ => {}
    }
}

pub fn edge_kind(operation: &Operation, inline: bool) -> &'static str {
    match operation {
        Operation::Write | Operation::Mode => "writes-executable",
        Operation::Execute | Operation::Shell | Operation::Eval | Operation::Indirect if inline => {
            "invokes-inline"
        }
        Operation::Execute | Operation::Shell | Operation::Eval | Operation::Indirect => "invokes",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{host_graph, syntax};

    fn receipts(source: &str) -> BTreeMap<Site, Vec<CallReceipt>> {
        let modules = BTreeMap::from([(
            "src/control.ts".into(),
            syntax::parse_host("src/control.ts", source, true).unwrap(),
        )]);
        by_site(&host_graph::analyze(&modules).events)
    }

    #[test]
    fn misleading_callee_or_argument_receipt_is_rejected() {
        let result = receipts(
            "import {spawnSync as run} from 'node:child_process'; run('node', ['actual.js']);",
        );
        let observed = result.values().next().unwrap();
        assert!(exact_receipts(observed, observed));
        let mut reviewed = observed.clone();
        reviewed[0].operation = Operation::Write;
        assert!(!exact_receipts(observed, &reviewed));
        let mut reviewed = observed.clone();
        reviewed[0].arguments[0] = Datum::Text("bash".into(), reviewed[0].site.clone());
        assert!(!exact_receipts(observed, &reviewed));
    }

    #[test]
    fn one_complete_same_line_call_cannot_cover_the_other() {
        let result = receipts("import {spawnSync as run} from 'node:child_process'; run('node', ['actual.js']); run('node', ['other.js']);");
        let calls: Vec<_> = result.values().collect();
        assert_eq!(calls.len(), 2);
        assert!(!exact_receipts(calls[0], calls[1]));
    }

    #[test]
    fn wrong_literal_output_cannot_be_overridden_by_a_reviewed_expression() {
        let result = receipts("import {writeFileSync as emit} from 'node:fs'; emit('tools/actual', '#!/bin/sh\\nexit 0\\n');");
        let observed = &result.values().next().unwrap()[0].arguments[0];
        assert!(output_matches(observed, "tools/actual", None));
        assert!(!output_matches(observed, "tools/other", Some(observed)));
    }
}
