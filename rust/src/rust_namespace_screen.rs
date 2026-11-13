const LIMIT: usize = 2_097_152;

fn screen(manifest: &[u8], source: &[u8]) -> bool {
    if manifest.len() > LIMIT || source.len() > LIMIT {
        return false;
    }
    let Ok(manifest) = std::str::from_utf8(manifest) else {
        return false;
    };
    let Ok(manifest) = toml::from_str::<toml::Value>(manifest) else {
        return false;
    };
    let Some(root) = manifest.as_table() else {
        return false;
    };
    if root.keys().any(|key| key != "package" && key != "lib") {
        return false;
    }
    let Some(package) = root.get("package").and_then(toml::Value::as_table) else {
        return false;
    };
    if package
        .keys()
        .any(|key| !["name", "version", "edition"].contains(&key.as_str()))
        || package.get("edition").and_then(toml::Value::as_str) != Some("2021")
    {
        return false;
    }
    let Some(lib) = root.get("lib").and_then(toml::Value::as_table) else {
        return false;
    };
    if lib.len() != 1 || lib.get("path").and_then(toml::Value::as_str) != Some("src/lib.rs") {
        return false;
    }
    let mut source = source.to_vec();
    if source.starts_with(&[0xef, 0xbb, 0xbf]) {
        source[..3].copy_from_slice(b"   ");
    }
    let Ok(source) = std::str::from_utf8(&source) else {
        return false;
    };
    let Ok(file) = syn::parse_str::<syn::File>(source) else {
        return false;
    };
    if file.attrs.iter().any(|attr| {
        !attr.path().is_ident("allow")
            || !attr
                .parse_args::<syn::Ident>()
                .is_ok_and(|ident| ident == "dead_code")
    }) {
        return false;
    }
    file.items.iter().all(|item| {
        let syn::Item::Fn(function) = item else {
            return false;
        };
        if !function.attrs.is_empty() || !function.sig.inputs.is_empty() {
            return false;
        }
        function.block.stmts.iter().all(|stmt| {
            let syn::Stmt::Expr(syn::Expr::Call(call), _) = stmt else {
                return false;
            };
            let syn::Expr::Path(path) = &*call.func else {
                return false;
            };
            if path.qself.is_some()
                || path.path.leading_colon.is_none()
                || path.path.segments.len() != 3
            {
                return false;
            }
            let names: Vec<_> = path
                .path
                .segments
                .iter()
                .map(|part| part.ident.to_string())
                .collect();
            names == ["std", "fs", "write"]
                && path
                    .path
                    .segments
                    .iter()
                    .all(|part| matches!(part.arguments, syn::PathArguments::None))
                && call.args.len() == 2
                && call.args.iter().all(|arg| {
                    matches!(
                        arg,
                        syn::Expr::Lit(syn::ExprLit {
                            lit: syn::Lit::Str(_),
                            ..
                        })
                    )
                })
        })
    })
}

#[test]
fn frozen_namespace_controls() {
    let cargo_hash = "3f540105e1b87557b037ea20d70f55a135fea3d9312cee6e51f97256eb9c1bcc";
    for (id, source_hash, expected) in [
        (
            "P01",
            "cbb3e8b2afdcffcd271cf0f5c4074a300980351f007c5a9fd93de7ee97dfeb3c",
            true,
        ),
        (
            "P02",
            "56e549e2ecc503cbb3ab1c42cdca94d5774bcf071324ef202df5a2d5d07411f3",
            true,
        ),
        (
            "P03",
            "68cb609774cb6f8beb61b774e99a978f20b2b0784d64e6e799bb4718c2741c4b",
            true,
        ),
        (
            "N04a",
            "6933d010d1506e4e8b494686d5a2c160351dc960b31675cea03bc5609f59ef91",
            false,
        ),
        (
            "N04b",
            "03c9640a239216281f196f698dae0d9e2deb83a8651040845a3f0dc4aec9e605",
            false,
        ),
        (
            "N04c",
            "da88484e20576edeb017134ea3dc57aad02fc4bcbde3d12bd46cd19a55b638a4",
            false,
        ),
        (
            "N04d",
            "14203d197246ed7e0cd80c37ae3d414f13876efe8ff0321bf6f7093bca6f14f2",
            false,
        ),
        (
            "N04e",
            "d6d11b32d9c6ddd774b9ef2290b37c862966e208f469c441fea5c9b06760de88",
            false,
        ),
        (
            "N04f",
            "cbb3e8b2afdcffcd271cf0f5c4074a300980351f007c5a9fd93de7ee97dfeb3c",
            false,
        ),
    ] {
        let case = super::materialize(id);
        let source = &case.snapshot.entries["src/lib.rs"].bytes;
        let cargo = &case.snapshot.entries["Cargo.toml"].bytes;
        assert_eq!(super::sha(source), source_hash);
        assert_eq!(
            super::sha(cargo),
            if id == "N04f" {
                "645b6b1087b1981581b6f7a9f38bbfe942ce277a8673a6d113649f28c0038abd"
            } else {
                cargo_hash
            }
        );
        assert_eq!(screen(cargo, source), expected, "{id}");
    }
    let case = super::materialize("P01");
    let source = &case.snapshot.entries["src/lib.rs"].bytes;
    let cargo = &case.snapshot.entries["Cargo.toml"].bytes;
    let source_text = std::str::from_utf8(source).unwrap();
    let cargo_text = std::str::from_utf8(cargo).unwrap();
    let mutations = [
        (
            cargo_text.to_owned(),
            source_text.replacen("{", "{ let std = 0;", 1),
        ),
        (
            cargo_text.to_owned(),
            source_text.replacen("{", "{ unknown!();", 1),
        ),
        (
            cargo_text.to_owned(),
            format!("#[cfg(unix)]\n{source_text}"),
        ),
        (
            cargo_text.replace("edition = \"2021\"\n", ""),
            source_text.to_owned(),
        ),
        (
            cargo_text.replace("edition = \"2021\"", "edition.workspace = true"),
            source_text.to_owned(),
        ),
        (
            format!("{cargo_text}\n[dependencies]\nother = \"1\"\n"),
            source_text.to_owned(),
        ),
    ];
    for (changed_cargo, changed_source) in mutations {
        assert!(screen(cargo, source));
        assert!(!screen(changed_cargo.as_bytes(), changed_source.as_bytes()));
    }
    for source_input in [true, false] {
        let mut at_limit = if source_input {
            source.clone()
        } else {
            cargo.clone()
        };
        at_limit.resize(LIMIT, b' ');
        assert!(if source_input {
            screen(cargo, &at_limit)
        } else {
            screen(&at_limit, source)
        });
        at_limit.push(b' ');
        assert!(!if source_input {
            screen(cargo, &at_limit)
        } else {
            screen(&at_limit, source)
        });
    }
    assert!(!screen(cargo, &[0xff]));
    assert!(!screen(&[0xff], source));
    assert!(!screen(cargo, b"fn broken( {"));
    assert!(!screen(b"[invalid", source));
}
