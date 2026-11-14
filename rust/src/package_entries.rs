use crate::{
    discovery::Discovery,
    model::{Diagnostic, Manifest},
    native_facts::RequiredTarget,
    observations,
};
use serde::{
    de::{self, MapAccess, Visitor},
    Deserialize, Deserializer,
};
use std::{collections::BTreeSet, fmt};

#[derive(Clone, Debug)]
pub struct Entry {
    pub id: String,
    pub target: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Bin {
    Single(String),
    Table(UniqueTable),
}

struct UniqueTable(Vec<(String, String)>);
impl<'de> Deserialize<'de> for UniqueTable {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct TableVisitor;
        impl<'de> Visitor<'de> for TableVisitor {
            type Value = UniqueTable;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an executable alias table with unique names")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut names = BTreeSet::new();
                let mut rows = Vec::new();
                while let Some((name, target)) = map.next_entry::<String, String>()? {
                    if !names.insert(name.clone()) {
                        return Err(de::Error::custom("duplicate executable alias"));
                    }
                    rows.push((name, target));
                }
                Ok(UniqueTable(rows))
            }
        }
        deserializer.deserialize_map(TableVisitor)
    }
}

struct Package {
    name: Option<serde_json::Value>,
    bin: Option<Bin>,
}
impl<'de> Deserialize<'de> for Package {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct PackageVisitor;
        impl<'de> Visitor<'de> for PackageVisitor {
            type Value = Package;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a package object with unique fields")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut fields = BTreeSet::new();
                let mut package = Package {
                    name: None,
                    bin: None,
                };
                while let Some(key) = map.next_key::<String>()? {
                    if !fields.insert(key.clone()) {
                        return Err(de::Error::custom("duplicate package field"));
                    }
                    match key.as_str() {
                        "name" => package.name = Some(map.next_value()?),
                        "bin" => package.bin = Some(map.next_value()?),
                        _ => {
                            map.next_value::<de::IgnoredAny>()?;
                        }
                    }
                }
                Ok(package)
            }
        }
        deserializer.deserialize_map(PackageVisitor)
    }
}

fn alias(name: &str) -> bool {
    !name.is_empty()
        && !matches!(name, "." | "..")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

fn package_alias(name: &str) -> Option<&str> {
    if let Some(scoped) = name.strip_prefix('@') {
        let (scope, name) = scoped.split_once('/')?;
        (alias(scope) && alias(name)).then_some(name)
    } else {
        alias(name).then_some(name)
    }
}

pub fn inspect(bytes: &[u8]) -> Result<Vec<Entry>, Diagnostic> {
    let invalid = || Diagnostic::new("invalid-package-bin", Some("package.json"));
    let package: Package = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let rows = match package.bin {
        None => return Ok(Vec::new()),
        Some(Bin::Table(UniqueTable(rows))) => rows,
        Some(Bin::Single(target)) => {
            let name = package
                .name
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .and_then(package_alias)
                .ok_or_else(invalid)?;
            vec![(name.into(), target)]
        }
    };
    let mut entries = Vec::new();
    for (name, target) in rows {
        let target = target.strip_prefix("./").unwrap_or(&target);
        if !alias(&name) || !crate::validation::relative_path(target) {
            return Err(invalid());
        }
        entries.push(Entry {
            id: format!("package-bin:package.json#/bin/{name}"),
            target: target.into(),
        });
    }
    Ok(entries)
}

pub fn validate(manifest: &Manifest, discovered: &Discovery) -> Vec<Diagnostic> {
    let mut errors = Vec::new();
    for entry in &discovered.package_entries {
        let target = if let Some(program) = discovered.package_programs.get(&entry.id) {
            Some(program.as_str())
        } else {
            let outputs: Vec<_> = manifest
                .components
                .iter()
                .flat_map(|component| {
                    component
                        .generated_targets
                        .iter()
                        .filter(move |output| output.path == entry.target)
                        .map(move |output| (component, output))
                })
                .collect();
            if outputs.len() == 1 {
                let (producer, output) = outputs[0];
                let observed = discovered.boundaries.get(&producer.id).is_some_and(|boundary| {
                    boundary.targets.iter().any(|target| matches!(target,
                        RequiredTarget::Output(value) if observations::literal(value) == Some(entry.target.as_str())
                            && observations::output_matches(value, &output.path, output.output_receipt.as_ref())))
                });
                let writes = manifest.edges.iter().any(|edge| {
                    edge.from == producer.id
                        && edge.to == output.id
                        && edge.kind == "writes-executable"
                });
                (observed && writes).then_some(output.id.as_str())
            } else {
                None
            }
        };
        match target {
            Some(target) => {
                if !manifest.edges.iter().any(|edge| {
                    edge.from == entry.id && edge.to == target && edge.kind == "invokes"
                }) {
                    errors.push(Diagnostic::new("missing-caller-edge", Some("package.json")));
                }
            }
            None => errors.push(Diagnostic::new(
                "unresolved-package-bin",
                Some("package.json"),
            )),
        }
    }
    errors
}
