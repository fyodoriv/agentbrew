use crate::{
    model::{Component, Diagnostic, Manifest},
    native_facts::{Boundary, RequiredTarget},
    observations,
};
use std::collections::{BTreeMap, BTreeSet};

fn issue(errors: &mut Vec<Diagnostic>, code: &str, boundary: &Boundary) {
    errors.push(Diagnostic::new(code, Some(&boundary.site.path)));
}

fn normalized_owned(path: &str) -> Option<String> {
    if path.starts_with('/') || path.contains(['\\', ':']) || path.chars().any(char::is_control) {
        return None;
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub fn body_id(boundary: &Boundary, ordinal: usize) -> String {
    format!("body:{}:{ordinal}", boundary.id)
}

pub fn check_boundary(
    manifest: &Manifest,
    discovered_programs: &BTreeMap<String, String>,
    boundary: &Boundary,
    errors: &mut Vec<Diagnostic>,
) {
    let Some(component) = manifest
        .components
        .iter()
        .find(|component| component.id == boundary.id)
    else {
        issue(errors, "unclassified-component", boundary);
        return;
    };
    if component.source.path != boundary.site.path
        || component.source.form != "call-site"
        || !observations::exact_receipts(&boundary.receipts, &component.call_receipts)
    {
        issue(errors, "call-binding-mismatch", boundary);
        return;
    }
    let edge = |to: &str, kind: &str| {
        manifest
            .edges
            .iter()
            .any(|edge| edge.from == boundary.id && edge.to == to && edge.kind == kind)
    };
    let owned_component = |id: &str| {
        manifest
            .components
            .iter()
            .any(|component| component.id == id)
    };
    let mut required_resolutions = BTreeSet::new();
    let mut required_inputs = BTreeSet::new();
    for target in &boundary.targets {
        match target {
            RequiredTarget::Owned(path) => {
                let resolved =
                    normalized_owned(path).and_then(|path| discovered_programs.get(&path));
                match resolved {
                    Some(id) if owned_component(id) && edge(id, "invokes") => {
                        required_resolutions.insert(id.clone());
                    }
                    _ => issue(errors, "unresolved-execution", boundary),
                }
            }
            RequiredTarget::Inline(id) => {
                if !owned_component(id) || !edge(id, "invokes-inline") {
                    issue(errors, "missing-caller-edge", boundary);
                }
            }
            RequiredTarget::External(command) => {
                let id = format!("external:{command}");
                if !component.contracts.contains(&id) || !edge(&id, "invokes") {
                    issue(errors, "unresolved-execution", boundary);
                }
                required_resolutions.insert(id);
            }
            RequiredTarget::Input(id) => {
                if !component.contracts.contains(id) || !edge(id, "invokes") {
                    issue(errors, "unresolved-execution", boundary);
                }
                required_inputs.insert(id.clone());
                required_resolutions.insert(id.clone());
            }
            RequiredTarget::Output(value) => {
                let matching: Vec<_> = component
                    .generated_targets
                    .iter()
                    .filter(|target| {
                        observations::output_matches(
                            value,
                            &target.path,
                            target.output_receipt.as_ref(),
                        )
                    })
                    .collect();
                if matching.len() != 1 {
                    issue(errors, "generated-output-mismatch", boundary);
                } else if !edge(&matching[0].id, "writes-executable") {
                    issue(errors, "missing-generated-edge", boundary);
                }
                observations::external_inputs(value, &mut required_inputs);
            }
        }
    }
    for body in &boundary.bodies {
        observations::external_inputs(&body.value, &mut required_inputs);
        if observations::has_unknown(&body.value) {
            issue(errors, "unresolved-execution", boundary);
        }
    }
    for input in required_inputs {
        if !component.contracts.contains(&input) {
            issue(errors, "unreviewed-input", boundary);
        }
    }
    if !required_resolutions.is_empty() {
        match &component.resolution {
            Some(resolution) => {
                let declared: BTreeSet<_> = resolution.targets.iter().cloned().collect();
                let kind_valid = match resolution.kind.as_str() {
                    "literal-target" => required_resolutions
                        .iter()
                        .all(|id| discovered_programs.values().any(|owned| owned == id)),
                    "upstream-tool" => required_resolutions
                        .iter()
                        .all(|id| id.starts_with("external:")),
                    "reviewed-parameter" => required_resolutions
                        .iter()
                        .all(|id| id.starts_with("parameter:")),
                    "mixed-inputs" => true,
                    _ => false,
                };
                if declared.len() != resolution.targets.len()
                    || declared != required_resolutions
                    || !kind_valid
                    || resolution.reason.trim().is_empty()
                {
                    issue(errors, "resolution-binding-mismatch", boundary);
                }
            }
            None => issue(errors, "unresolved-execution", boundary),
        }
    } else if component.resolution.is_some() {
        issue(errors, "resolution-binding-mismatch", boundary);
    }
    for (ordinal, body) in boundary.bodies.iter().enumerate() {
        let id = body_id(boundary, ordinal);
        let found = manifest
            .components
            .iter()
            .find(|component| component.id == id);
        let correct = found.is_some_and(|component| {
            component.source.path == boundary.site.path
                && component.source.language == body.language
                && component.source.form == body.form
                && observations::exact_receipts(&boundary.receipts, &component.call_receipts)
        });
        if !correct {
            issue(errors, "unclassified-component", boundary);
        } else if !edge(
            &id,
            if body.form == "generated-program" {
                "renders"
            } else {
                "invokes-inline"
            },
        ) {
            issue(errors, "missing-caller-edge", boundary);
        }
    }
    let observed_outputs: Vec<_> = boundary
        .targets
        .iter()
        .filter_map(|target| {
            if let RequiredTarget::Output(output) = target {
                Some(output)
            } else {
                None
            }
        })
        .collect();
    for target in &component.generated_targets {
        if !observed_outputs.iter().any(|output| {
            observations::output_matches(output, &target.path, target.output_receipt.as_ref())
        }) {
            issue(errors, "generated-output-mismatch", boundary);
        }
    }
}

pub fn component<'a>(manifest: &'a Manifest, id: &str) -> Option<&'a Component> {
    manifest
        .components
        .iter()
        .find(|component| component.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{host_graph, native_facts, syntax};
    use serde_json::{json, Value};

    fn observed(source: &str) -> Boundary {
        let modules = BTreeMap::from([(
            "src/control.ts".into(),
            syntax::parse_host("src/control.ts", source, true).unwrap(),
        )]);
        native_facts::from_host(host_graph::analyze(&modules))
            .boundaries
            .into_values()
            .next()
            .unwrap()
    }

    fn reviewed(boundary: &Boundary) -> Value {
        json!({
            "schema_version":1,"owner":"fixture","reviewed_revision":"0000000000000000000000000000000000000000",
            "slices":["rust-tests-and-evals"],"files":[],"edges":[],"components":[{
                "id":boundary.id,"source":{"path":boundary.site.path,"anchor":"","start_line":1,"end_line":1,"language":"typescript","form":"call-site"},
                "owner":"fixture","caller_boundary":"fixture entrypoint","migration_slice":"rust-tests-and-evals","disposition":"eligible","exception_reason":null,
                "generated_targets":[],"resolution":null,"contracts":[],"call_receipts":boundary.receipts
            }]
        })
    }

    fn codes(
        boundary: &Boundary,
        reviewed: &Value,
        programs: &BTreeMap<String, String>,
    ) -> Vec<String> {
        let manifest: Manifest = serde_json::from_value(reviewed.clone()).unwrap();
        let mut errors = Vec::new();
        check_boundary(&manifest, programs, boundary, &mut errors);
        errors.into_iter().map(|error| error.code).collect()
    }

    fn add_program(reviewed: &mut Value, path: &str) -> String {
        let id = format!("program:{path}");
        let mut program = reviewed["components"][0].clone();
        program["id"] = id.clone().into();
        program["source"]["path"] = path.into();
        program["source"]["form"] = "program".into();
        program["call_receipts"] = json!([]);
        reviewed["components"].as_array_mut().unwrap().push(program);
        id
    }

    #[test]
    fn imports_edge_cannot_satisfy_an_actual_process_invocation() {
        let boundary = observed("import {spawnSync as run} from 'node:child_process'; run('node', ['tools/actual.js']);");
        let mut reviewed = reviewed(&boundary);
        let id = add_program(&mut reviewed, "tools/actual.js");
        let programs = BTreeMap::from([("tools/actual.js".into(), id.clone())]);
        reviewed["components"][0]["resolution"] = json!({"kind":"literal-target","targets":[id],"reason":"Exact literal script argument"});
        reviewed["edges"] = json!([{"id":"caller","from":boundary.id,"to":id,"kind":"invokes"}]);
        assert!(codes(&boundary, &reviewed, &programs).is_empty());
        reviewed["edges"][0]["kind"] = "imports".into();
        assert!(codes(&boundary, &reviewed, &programs).contains(&"unresolved-execution".into()));
    }

    #[test]
    fn unrelated_owned_program_cannot_satisfy_literal_argument() {
        let boundary = observed("import {spawnSync as run} from 'node:child_process'; run('node', ['tools/actual.js']);");
        let mut reviewed = reviewed(&boundary);
        let actual = add_program(&mut reviewed, "tools/actual.js");
        let other = add_program(&mut reviewed, "tools/other.js");
        let programs = BTreeMap::from([
            ("tools/actual.js".into(), actual),
            ("tools/other.js".into(), other.clone()),
        ]);
        reviewed["components"][0]["resolution"] = json!({"kind":"literal-target","targets":[other],"reason":"Misleading but complete owned target"});
        reviewed["edges"] = json!([{"id":"caller","from":boundary.id,"to":other,"kind":"invokes"}]);
        assert!(codes(&boundary, &reviewed, &programs).contains(&"unresolved-execution".into()));
    }

    #[test]
    fn exact_call_receipt_is_required_even_with_a_complete_target_graph() {
        let boundary = observed(
            "import {spawnSync as run} from 'node:child_process'; run('git', ['status']);",
        );
        let mut reviewed = reviewed(&boundary);
        reviewed["components"][0]["contracts"] = json!(["external:git"]);
        reviewed["components"][0]["resolution"] = json!({"kind":"upstream-tool","targets":["external:git"],"reason":"The literal external command is not owned code"});
        reviewed["edges"] =
            json!([{"id":"caller","from":boundary.id,"to":"external:git","kind":"invokes"}]);
        assert!(codes(&boundary, &reviewed, &BTreeMap::new()).is_empty());
        reviewed["components"][0]["call_receipts"][0]["callee"] =
            "node:child_process/execSync".into();
        assert_eq!(
            codes(&boundary, &reviewed, &BTreeMap::new()),
            vec!["call-binding-mismatch"]
        );
    }

    #[test]
    fn wrong_literal_output_fails_after_all_components_and_edges_are_present() {
        let boundary = observed("import {writeFileSync as emit} from 'node:fs'; emit('tools/actual', '#!/bin/sh\\nexit 0\\n');");
        let mut reviewed = reviewed(&boundary);
        reviewed["components"][0]["generated_targets"] = json!([{"id":"output:guard","path":"tools/actual","condition":null,"consumer":"fixture executable"}]);
        let id = body_id(&boundary, 0);
        let mut body = reviewed["components"][0].clone();
        body["id"] = id.clone().into();
        body["source"]["form"] = "generated-program".into();
        body["source"]["language"] = "sh".into();
        body["generated_targets"] = json!([]);
        reviewed["components"].as_array_mut().unwrap().push(body);
        reviewed["edges"] = json!([
            {"id":"output","from":boundary.id,"to":"output:guard","kind":"writes-executable"},
            {"id":"body","from":boundary.id,"to":id,"kind":"renders"}
        ]);
        assert!(codes(&boundary, &reviewed, &BTreeMap::new()).is_empty());
        reviewed["components"][0]["generated_targets"][0]["path"] = "tools/other".into();
        assert!(codes(&boundary, &reviewed, &BTreeMap::new())
            .contains(&"generated-output-mismatch".into()));
    }

    #[test]
    fn complete_wrapper_keeps_generated_body_across_symbolic_and_literal_contexts() {
        let modules = BTreeMap::from([
            (
                "src/create.ts".into(),
                syntax::parse_host(
                    "src/create.ts",
                    "import {writeFileSync as emit} from 'node:fs'; export function create(path, body) { emit(path, body); }",
                    true,
                ).unwrap(),
            ),
            (
                "src/main.ts".into(),
                syntax::parse_host(
                    "src/main.ts",
                    "import {create} from './create.js'; create('tools/actual', '#!/bin/sh\\nexit 0\\n');",
                    true,
                ).unwrap(),
            ),
        ]);
        let boundary = native_facts::from_host(host_graph::analyze(&modules))
            .boundaries
            .into_values()
            .next()
            .unwrap();
        let mut reviewed = reviewed(&boundary);
        let mut outputs = Vec::new();
        let mut edges = Vec::new();
        let mut inputs = BTreeSet::new();
        for (index, target) in boundary.targets.iter().enumerate() {
            if let RequiredTarget::Output(output) = target {
                let id = format!("output:{index}");
                outputs.push(json!({
                    "id":id,
                    "path":observations::literal(output).unwrap_or("runtime-output"),
                    "condition":null,"consumer":"fixture executable",
                    "output_receipt":output,
                }));
                edges.push(json!({"id":format!("write:{index}"),"from":boundary.id,"to":id,"kind":"writes-executable"}));
                observations::external_inputs(output, &mut inputs);
            }
        }
        reviewed["components"][0]["generated_targets"] = outputs.into();
        reviewed["components"][0]["contracts"] = inputs.into_iter().collect::<Vec<_>>().into();
        let id = body_id(&boundary, 0);
        let mut body = reviewed["components"][0].clone();
        body["id"] = id.clone().into();
        body["source"]["form"] = "generated-program".into();
        body["source"]["language"] = "sh".into();
        body["generated_targets"] = json!([]);
        reviewed["components"].as_array_mut().unwrap().push(body);
        edges.push(json!({"id":"body","from":boundary.id,"to":id,"kind":"renders"}));
        reviewed["edges"] = edges.into();
        assert_eq!(
            boundary.bodies.len(),
            1,
            "the actual shell body must be observed"
        );
        assert_eq!(
            codes(&boundary, &reviewed, &BTreeMap::new()),
            Vec::<String>::new()
        );
    }
}
