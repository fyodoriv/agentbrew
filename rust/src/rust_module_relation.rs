//! Narrow test-only relation over an already materialized synthetic snapshot.
use super::rust_syntax_slice::{self, SyntaxSite};
use crate::snapshot::Snapshot;
use serde_json::Value;

const LIMIT: usize = 2_097_152;

pub(crate) struct Relation {
    pub(crate) path: String,
    pub(crate) module: String,
    pub(crate) site: SyntaxSite,
}

fn fits(total: usize, additional: usize) -> bool {
    total.checked_add(additional).is_some_and(|n| n <= 65_536)
}

pub(crate) fn relation(snapshot: &Snapshot) -> Option<Vec<Relation>> {
    if snapshot.entries.contains_key("src/main.rs") {
        return None;
    }
    let root = snapshot.entries.get("src/lib.rs")?;
    if root.path != "src/lib.rs" || root.mode != 0o100644 || root.bytes.len() > LIMIT {
        return None;
    }
    let file: syn::File = syn::parse_str(std::str::from_utf8(&root.bytes).ok()?).ok()?;
    if !file.attrs.is_empty() || file.items.len() != 1 {
        return None;
    }
    let syn::Item::Mod(module) = file.items.into_iter().next()? else {
        return None;
    };
    if !module.attrs.is_empty() || module.content.is_some() {
        return None;
    }
    let name = module.ident.to_string();
    if name.len() > 256 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return None;
    }
    let paths = [format!("src/{name}.rs"), format!("src/{name}/mod.rs")];
    let candidates: Vec<_> = paths
        .iter()
        .filter_map(|p| snapshot.entries.get(p).map(|e| (p, e)))
        .collect();
    let [(path, entry)] = candidates.as_slice() else {
        return None;
    };
    if entry.path.as_str() != path.as_str() || entry.mode != 0o100644 || entry.bytes.len() > LIMIT {
        return None;
    }
    let source = std::str::from_utf8(&entry.bytes).ok()?;
    let parsed: syn::File = syn::parse_str(source).ok()?;
    if !parsed.attrs.is_empty() || parsed.items.is_empty() {
        return None;
    }
    let mut statements = 0usize;
    for item in parsed.items {
        let syn::Item::Fn(function) = item else {
            return None;
        };
        if !function.attrs.is_empty() {
            return None;
        }
        for statement in function.block.stmts {
            if !matches!(statement, syn::Stmt::Expr(syn::Expr::Call(_), _)) {
                return None;
            }
            statements = statements.checked_add(1)?;
            if statements > 256 {
                return None;
            }
        }
    }
    let sites = rust_syntax_slice::parse(&entry.bytes).ok()?;
    if sites.is_empty() || sites.len() != statements {
        return None;
    }
    let module = format!("crate::{name}");
    let mut bytes = 0usize;
    let mut result = Vec::new();
    for site in sites {
        let added = path.len().checked_add(module.len())?;
        if !fits(bytes, added) {
            return None;
        }
        bytes += added;
        result.push(Relation {
            path: (*path).clone(),
            module: module.clone(),
            site,
        });
    }
    Some(result)
}

fn range(actual: &std::ops::Range<usize>, expected: &Value) -> bool {
    expected[0].as_u64() == Some(actual.start as u64)
        && expected[1].as_u64() == Some(actual.end as u64)
}

pub(crate) fn matches(record: &Relation, witness: &Value) -> bool {
    witness["physical_path"].as_str() == Some(record.path.as_str())
        && witness["logical_module"].as_str() == Some(record.module.as_str())
        && range(&record.site.owner, &witness["owner_fn_byte_range"])
        && range(&record.site.call, &witness["call_byte_range"])
        && range(&record.site.output.0, &witness["output_literal_byte_range"])
        && range(&record.site.body.0, &witness["body_literal_byte_range"])
}

#[test]
fn frozen_p04_relation() {
    fn copy(snapshot: &Snapshot) -> Snapshot {
        Snapshot {
            entries: snapshot.entries.clone(),
            untracked: snapshot.untracked.clone(),
            ignored: snapshot.ignored.clone(),
        }
    }
    fn synthetic(original: &Snapshot, name: &str, calls: usize) -> Snapshot {
        let mut snapshot = copy(original);
        let mut target = snapshot.entries.remove("src/emit.rs").unwrap();
        let path = format!("src/{name}.rs");
        target.path = path.clone();
        target.bytes = format!(
            "fn f() {{ {} }}",
            "::std::fs::write(\"a\", \"b\");".repeat(calls)
        )
        .into_bytes();
        snapshot.entries.insert(path, target);
        snapshot.entries.get_mut("src/lib.rs").unwrap().bytes = format!("mod {name};").into_bytes();
        snapshot
    }
    let case = super::materialize("P04");
    let records = relation(&case.snapshot).unwrap();
    assert_eq!(records.len(), 1);
    assert!(matches(&records[0], &case.witnesses[0]));
    for key in ["physical_path", "logical_module"] {
        let mut wrong = case.witnesses[0].clone();
        wrong[key] = serde_json::json!("wrong");
        assert!(!matches(&records[0], &wrong));
    }
    let mut wrong = case.witnesses[0].clone();
    wrong["call_byte_range"][0] = serde_json::json!(records[0].site.call.start + 1);
    assert!(!matches(&records[0], &wrong));

    for mutation in [
        "both",
        "neither",
        "link",
        "utf8",
        "root",
        "path_mismatch",
        "attribute",
        "duplicate",
        "nested",
        "include",
        "cycle",
    ] {
        let mut fixture = copy(&case.snapshot);
        match mutation {
            "both" => {
                let entry = fixture.entries["src/emit.rs"].clone();
                fixture.entries.insert("src/emit/mod.rs".into(), entry);
            }
            "neither" => {
                fixture.entries.remove("src/emit.rs");
            }
            "link" => fixture.entries.get_mut("src/emit.rs").unwrap().mode = 0o120000,
            "utf8" => fixture.entries.get_mut("src/emit.rs").unwrap().bytes = vec![0xff],
            "root" => {
                let entry = fixture.entries["src/lib.rs"].clone();
                fixture.entries.insert("src/main.rs".into(), entry);
            }
            "path_mismatch" => {
                fixture.entries.get_mut("src/emit.rs").unwrap().path = "other.rs".into()
            }
            "attribute" => {
                fixture.entries.get_mut("src/lib.rs").unwrap().bytes =
                    b"#[path=\"emit.rs\"] mod emit;".to_vec()
            }
            "duplicate" => {
                fixture.entries.get_mut("src/lib.rs").unwrap().bytes =
                    b"mod emit; mod emit;".to_vec()
            }
            "nested" => {
                fixture.entries.get_mut("src/emit.rs").unwrap().bytes =
                    b"mod inner { fn f() {} }".to_vec()
            }
            "include" => {
                fixture.entries.get_mut("src/lib.rs").unwrap().bytes =
                    b"include!(\"other.rs\"); mod emit;".to_vec()
            }
            _ => fixture.entries.get_mut("src/emit.rs").unwrap().bytes = b"mod emit;".to_vec(),
        }
        assert!(relation(&fixture).is_none(), "{mutation}");
    }
    for path in ["src/lib.rs", "src/emit.rs"] {
        let mut fixture = copy(&case.snapshot);
        fixture
            .entries
            .get_mut(path)
            .unwrap()
            .bytes
            .resize(LIMIT, b' ');
        assert!(relation(&fixture).is_some(), "exact {path}");
        fixture.entries.get_mut(path).unwrap().bytes.push(b' ');
        assert!(relation(&fixture).is_none(), "over {path}");
    }
    assert!(relation(&synthetic(&case.snapshot, &"a".repeat(256), 1)).is_some());
    assert!(relation(&synthetic(&case.snapshot, &"a".repeat(257), 1)).is_none());
    assert!(relation(&synthetic(&case.snapshot, &"a".repeat(121), 256)).is_some());
    assert!(relation(&synthetic(&case.snapshot, &"a".repeat(121), 257)).is_none());
    assert!(relation(&synthetic(&case.snapshot, &"a".repeat(138), 226)).is_none());
    assert!(fits(65_535, 1));
    assert!(!fits(65_536, 1));
}
