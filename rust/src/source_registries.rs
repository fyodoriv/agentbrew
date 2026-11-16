use crate::{
    host_graph::{self, Datum, Site},
    model::Diagnostic,
    syntax::{Host, Value},
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceRow {
    pub name: String,
    pub path: String,
    pub origin: Site,
}

#[derive(Default)]
pub struct Evidence {
    pub sources: Vec<SourceRow>,
    pub constructor_sites: BTreeSet<Site>,
    pub diagnostics: Vec<Diagnostic>,
}

fn issue(result: &mut Evidence, path: &str) {
    result
        .diagnostics
        .push(Diagnostic::new("unresolved-source-registry", Some(path)));
}

fn relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', ':'])
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | ".."))
}

pub fn helper_map(
    modules: &BTreeMap<String, Host>,
    indexed: &BTreeSet<String>,
    source: &str,
) -> Evidence {
    let mut result = Evidence::default();
    let Some(host) = modules.get(source) else {
        issue(&mut result, source);
        return result;
    };
    let Some(export) = host.exports.get("HELPER_SCRIPT_SOURCES") else {
        issue(&mut result, source);
        return result;
    };
    let Datum::Object(rows) = host_graph::resolve_value(modules, source, export) else {
        issue(&mut result, source);
        return result;
    };
    if rows.is_empty() {
        issue(&mut result, source);
    }
    for (name, value) in rows {
        match value {
            Datum::Text(path, origin)
                if relative(&path)
                    && indexed.contains(&path)
                    && !name.is_empty()
                    && !name.contains('/')
                    && !name.chars().any(char::is_control) =>
            {
                result.sources.push(SourceRow { name, path, origin });
            }
            _ => issue(&mut result, source),
        }
    }
    result
}

pub fn bundler_entries(
    modules: &BTreeMap<String, Host>,
    indexed: &BTreeSet<String>,
    source: &str,
) -> Evidence {
    let mut result = Evidence::default();
    let Some(host) = modules.get(source) else {
        issue(&mut result, source);
        return result;
    };
    let Some(Value::Call(start)) = host.exports.get("default") else {
        issue(&mut result, source);
        return result;
    };
    let Some(call) = host
        .call_index
        .get(start)
        .and_then(|index| host.calls.get(*index))
    else {
        issue(&mut result, source);
        return result;
    };
    if !matches!(host_graph::resolve_value(modules,source,&call.callee),Datum::Api(module,name) if module=="tsup"&&name=="defineConfig")
    {
        issue(&mut result, source);
        return result;
    }
    let Some(Value::Object(options)) = call.arguments.first() else {
        issue(&mut result, source);
        return result;
    };
    if [
        "banner",
        "footer",
        "inject",
        "onSuccess",
        "esbuildOptions",
        "esbuildPlugins",
        "loader",
        "define",
    ]
    .iter()
    .any(|name| options.contains_key(*name))
    {
        result.diagnostics.push(Diagnostic::new(
            "reviewed-bundler-producer-required",
            Some(source),
        ));
    }
    let Some(entries) = options.get("entry") else {
        issue(&mut result, source);
        return result;
    };
    match host_graph::resolve_value(modules, source, entries) {
        Datum::List(entries) => {
            if entries.is_empty() {
                issue(&mut result, source);
            }
            for entry in entries {
                match entry {
                    Datum::Text(path, origin) if relative(&path) && indexed.contains(&path) => {
                        result.sources.push(SourceRow {
                            name: path.clone(),
                            path,
                            origin,
                        });
                    }
                    _ => issue(&mut result, source),
                }
            }
        }
        Datum::Object(entries) => {
            if entries.is_empty() {
                issue(&mut result, source);
            }
            for (name, entry) in entries {
                match entry {
                    Datum::Text(path, origin)
                        if relative(&path) && indexed.contains(&path) && relative(&name) =>
                    {
                        result.sources.push(SourceRow { name, path, origin });
                    }
                    _ => issue(&mut result, source),
                }
            }
        }
        _ => issue(&mut result, source),
    }
    if result.diagnostics.is_empty() {
        result.constructor_sites.insert(Site {
            path: source.into(),
            start: call.start,
            end: call.end,
            body: None,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modules(path: &str, source: &str) -> BTreeMap<String, Host> {
        BTreeMap::from([(
            path.into(),
            crate::syntax::parse_host(path, source, true).unwrap(),
        )])
    }

    #[test]
    fn helper_registry_uses_actual_exported_rows_and_aliased_path_join() {
        let modules=modules("src/helpers.ts","import {join as path} from 'node:path'; export const HELPER_SCRIPT_SOURCES={ 'guard.sh':path('templates','scripts','guard.sh') };");
        let indexed = BTreeSet::from(["templates/scripts/guard.sh".into()]);
        let evidence = helper_map(&modules, &indexed, "src/helpers.ts");
        assert!(evidence.diagnostics.is_empty());
        assert_eq!(evidence.sources.len(), 1);
        assert_eq!(evidence.sources[0].name, "guard.sh");
        assert_eq!(evidence.sources[0].path, "templates/scripts/guard.sh");
    }

    #[test]
    fn helper_registry_cannot_name_a_missing_or_external_source() {
        let modules = modules(
            "src/helpers.ts",
            "export const HELPER_SCRIPT_SOURCES={ 'guard.sh':'../outside/guard.sh' };",
        );
        let evidence = helper_map(&modules, &BTreeSet::new(), "src/helpers.ts");
        assert!(evidence.sources.is_empty());
        assert_eq!(evidence.diagnostics[0].code, "unresolved-source-registry");
    }

    #[test]
    fn bundler_registry_resolves_scoped_configuration_alias() {
        let modules=modules("tsup.config.ts","import {defineConfig as build} from 'tsup'; const alias=build; export default alias({entry:['src/cli.ts','src/worker.ts']});");
        let indexed = BTreeSet::from(["src/cli.ts".into(), "src/worker.ts".into()]);
        let evidence = bundler_entries(&modules, &indexed, "tsup.config.ts");
        assert!(evidence.diagnostics.is_empty());
        assert_eq!(
            evidence
                .sources
                .iter()
                .map(|source| source.path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/cli.ts", "src/worker.ts"]
        );
    }

    #[test]
    fn unrelated_function_cannot_impersonate_the_bundler_constructor() {
        let modules=modules("tsup.config.ts","const defineConfig=(value)=>value; export default defineConfig({entry:['src/cli.ts']});");
        let evidence = bundler_entries(
            &modules,
            &BTreeSet::from(["src/cli.ts".into()]),
            "tsup.config.ts",
        );
        assert!(evidence.sources.is_empty());
        assert_eq!(evidence.diagnostics[0].code, "unresolved-source-registry");
    }
}
