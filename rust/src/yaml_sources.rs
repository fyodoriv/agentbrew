use crate::model::Diagnostic;
use yaml_rust2::{
    parser::{Event, Parser},
    Yaml, YamlLoader,
};

const SOURCE_LIMIT: usize = 2 * 1024 * 1024;
const NODE_LIMIT: usize = 200_000;
const DEPTH_LIMIT: usize = 256;

pub struct Script {
    pub id: String,
    pub language: String,
    pub text: String,
}

#[derive(Default)]
pub struct Evidence {
    pub scripts: Vec<Script>,
    pub targets: Vec<(String, String)>,
    pub diagnostics: Vec<Diagnostic>,
}

fn error(path: &str, code: &str) -> Diagnostic {
    Diagnostic::new(code, Some(path))
}

fn parse(path: &str, text: &str) -> Result<Yaml, Diagnostic> {
    if text.len() > SOURCE_LIMIT {
        return Err(error(path, "parser-source-limit"));
    }
    let mut parser = Parser::new_from_str(text);
    let mut depth = 0usize;
    let mut documents = 0;
    // Bound the upstream event stream before its loader allocates a tree.
    for _ in 0..NODE_LIMIT {
        let (event, _) = parser
            .next_token()
            .map_err(|_| error(path, "invalid-source-registry"))?;
        match event {
            Event::Alias(_) => return Err(error(path, "reviewed-yaml-alias-required")),
            Event::DocumentStart => {
                documents += 1;
                if documents > 1 {
                    return Err(error(path, "invalid-source-registry"));
                }
            }
            Event::SequenceStart(..) | Event::MappingStart(..) => {
                depth += 1;
                if depth > DEPTH_LIMIT {
                    return Err(error(path, "parser-depth-limit"));
                }
            }
            Event::SequenceEnd | Event::MappingEnd => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| error(path, "invalid-source-registry"))?;
            }
            Event::StreamEnd => {
                if depth != 0 || documents != 1 {
                    return Err(error(path, "invalid-source-registry"));
                }
                let mut docs = YamlLoader::load_from_str(text)
                    .map_err(|_| error(path, "invalid-source-registry"))?;
                if docs.len() != 1 {
                    return Err(error(path, "invalid-source-registry"));
                }
                return Ok(docs.remove(0));
            }
            _ => {}
        }
    }
    Err(error(path, "parser-node-limit"))
}

fn pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn shell(value: &Yaml) -> Option<&'static str> {
    match value.as_str() {
        None if value.is_badvalue() => Some("sh"),
        Some("bash") => Some("bash"),
        Some("sh") => Some("sh"),
        Some("python") => Some("python"),
        Some("pwsh" | "powershell") => Some("powershell"),
        Some("cmd") => Some("cmd"),
        _ => None,
    }
}

fn steps(path: &str, prefix: &str, value: &Yaml, default_shell: &Yaml, result: &mut Evidence) {
    let Some(steps) = value.as_vec() else {
        result
            .diagnostics
            .push(error(path, "invalid-source-registry"));
        return;
    };
    for (index, step) in steps.iter().enumerate() {
        if !step["run"].is_badvalue() {
            let Some(text) = step["run"].as_str() else {
                result
                    .diagnostics
                    .push(error(path, "invalid-source-registry"));
                continue;
            };
            let selected = if step["shell"].is_badvalue() {
                default_shell
            } else {
                &step["shell"]
            };
            let Some(language) = shell(selected) else {
                result
                    .diagnostics
                    .push(error(path, "reviewed-shell-registry-required"));
                continue;
            };
            result.scripts.push(Script {
                id: format!("workflow-run:{path}#{prefix}/{index}/run"),
                language: language.into(),
                text: text.into(),
            });
        }
        if let Some(target) = step["uses"].as_str() {
            if target.starts_with("./") {
                result.targets.push((
                    format!("workflow-use:{path}#{prefix}/{index}/uses"),
                    target.into(),
                ));
            }
        }
    }
}

pub fn workflow(path: &str, text: &str) -> Evidence {
    let mut result = Evidence::default();
    let doc = match parse(path, text) {
        Ok(doc) => doc,
        Err(error) => {
            result.diagnostics.push(error);
            return result;
        }
    };
    let Some(jobs) = doc["jobs"].as_hash() else {
        result
            .diagnostics
            .push(error(path, "invalid-source-registry"));
        return result;
    };
    for (name, job) in jobs {
        let Some(name) = name.as_str() else {
            result
                .diagnostics
                .push(error(path, "invalid-source-registry"));
            continue;
        };
        if !job["steps"].is_badvalue() {
            let selected = if job["defaults"]["run"]["shell"].is_badvalue() {
                &doc["defaults"]["run"]["shell"]
            } else {
                &job["defaults"]["run"]["shell"]
            };
            steps(
                path,
                &format!("/jobs/{}/steps", pointer(name)),
                &job["steps"],
                selected,
                &mut result,
            );
        }
    }
    result
}

pub fn hook_manifest(path: &str, text: &str) -> Evidence {
    let mut result = Evidence::default();
    let doc = match parse(path, text) {
        Ok(doc) => doc,
        Err(error) => {
            result.diagnostics.push(error);
            return result;
        }
    };
    let Some(hooks) = doc["hooks"].as_vec() else {
        result
            .diagnostics
            .push(error(path, "invalid-source-registry"));
        return result;
    };
    for hook in hooks {
        let (Some(id), Some(script)) = (hook["id"].as_str(), hook["script"].as_str()) else {
            result
                .diagnostics
                .push(error(path, "invalid-source-registry"));
            continue;
        };
        if id.chars().any(char::is_control)
            || script.starts_with('/')
            || script.split('/').any(|part| part == "..")
        {
            result
                .diagnostics
                .push(error(path, "invalid-source-registry"));
            continue;
        }
        result.targets.push((
            format!("hook:{path}#{}/script", pointer(id)),
            format!("hooks/{script}"),
        ));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_native_scalar_preserves_owned_run_body() {
        let result = workflow(
            ".github/workflows/check.yml",
            "jobs:\n  check:\n    steps:\n      - run: |\n          node -e 'console.log(1)'\n",
        );
        assert!(result.diagnostics.is_empty());
        assert_eq!(result.scripts.len(), 1);
        assert_eq!(result.scripts[0].text, "node -e 'console.log(1)'\n");
    }

    #[test]
    fn workflow_comments_and_quoted_records_do_not_become_steps() {
        let result=workflow(".github/workflows/check.yml","# run: node -e example\njobs:\n  check:\n    steps:\n      - uses: upstream/action@v1\n        with:\n          record: 'run: node -e example'\n");
        assert!(result.diagnostics.is_empty());
        assert!(result.scripts.is_empty());
    }

    #[test]
    fn hook_table_extracts_actual_script_field() {
        let result=hook_manifest("hooks/manifest.yaml","hooks:\n  - id: guard\n    script: checks/guard.sh\n    description: 'script: fake.sh'\n");
        assert!(result.diagnostics.is_empty());
        assert_eq!(
            result.targets,
            vec![(
                "hook:hooks/manifest.yaml#guard/script".into(),
                "hooks/checks/guard.sh".into()
            )]
        );
    }

    #[test]
    fn yaml_aliases_fail_before_materialization() {
        let result = workflow(
            ".github/workflows/check.yml",
            "jobs: &jobs\n  check:\n    steps: []\ncopy: *jobs\n",
        );
        assert_eq!(result.diagnostics[0].code, "reviewed-yaml-alias-required");
    }
}
