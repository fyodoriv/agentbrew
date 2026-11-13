use std::ops::Range;

const SOURCE_LIMIT: usize = 2_097_152;

pub(crate) struct SyntaxSite {
    pub(crate) owner: Range<usize>,
    pub(crate) call: Range<usize>,
    pub(crate) output: (Range<usize>, String),
    pub(crate) body: (Range<usize>, String),
}

pub(crate) fn parse(input: &[u8]) -> Result<Vec<SyntaxSite>, ()> {
    if input.len() > SOURCE_LIMIT {
        return Err(());
    }
    let mut source = input.to_vec();
    if source.starts_with(&[0xef, 0xbb, 0xbf]) {
        source[..3].copy_from_slice(b"   ");
    }
    let source = std::str::from_utf8(&source).map_err(|_| ())?;
    let file: syn::File = syn::parse_str(source).map_err(|_| ())?;
    let mut sites = Vec::new();
    for item in file.items {
        let syn::Item::Fn(function) = item else {
            continue;
        };
        let owner = function.sig.fn_token.span.byte_range().start
            ..function.block.brace_token.span.close().byte_range().end;
        for stmt in function.block.stmts {
            let syn::Stmt::Expr(syn::Expr::Call(call), _) = stmt else {
                continue;
            };
            let syn::Expr::Path(path) = &*call.func else {
                continue;
            };
            let Some(colon) = &path.path.leading_colon else {
                continue;
            };
            let names: Vec<_> = path
                .path
                .segments
                .iter()
                .map(|part| part.ident.to_string())
                .collect();
            if names != ["std", "fs", "write"]
                || path
                    .path
                    .segments
                    .iter()
                    .any(|part| !matches!(part.arguments, syn::PathArguments::None))
            {
                continue;
            }
            let mut args = call.args.iter();
            let Some(syn::Expr::Lit(first)) = args.next() else {
                continue;
            };
            let Some(syn::Expr::Lit(second)) = args.next() else {
                continue;
            };
            if args.next().is_some() {
                continue;
            }
            let (syn::Lit::Str(first), syn::Lit::Str(second)) = (&first.lit, &second.lit) else {
                continue;
            };
            if sites.len() == 256 {
                return Err(());
            }
            sites.push(SyntaxSite {
                owner: owner.clone(),
                call: colon.spans[0].byte_range().start
                    ..call.paren_token.span.close().byte_range().end,
                output: (first.span().byte_range(), first.value()),
                body: (second.span().byte_range(), second.value()),
            });
        }
    }
    Ok(sites)
}

fn same_range(actual: &Range<usize>, expected: &serde_json::Value) -> bool {
    Some(actual.start as u64) == expected[0].as_u64()
        && Some(actual.end as u64) == expected[1].as_u64()
}

fn matches(site: &SyntaxSite, witness: &serde_json::Value) -> bool {
    same_range(&site.owner, &witness["owner_fn_byte_range"])
        && same_range(&site.call, &witness["call_byte_range"])
        && same_range(&site.output.0, &witness["output_literal_byte_range"])
        && same_range(&site.body.0, &witness["body_literal_byte_range"])
        && witness["owner_fn_byte"].as_u64() == Some(site.owner.start as u64)
        && witness["literal_output"].as_str() == Some(site.output.1.as_str())
        && witness["decoded_body_utf8"].as_str() == Some(site.body.1.as_str())
}

#[test]
fn frozen_syntax_controls() {
    for (id, digest, count) in [
        (
            "P01",
            "cbb3e8b2afdcffcd271cf0f5c4074a300980351f007c5a9fd93de7ee97dfeb3c",
            1,
        ),
        (
            "P02",
            "56e549e2ecc503cbb3ab1c42cdca94d5774bcf071324ef202df5a2d5d07411f3",
            2,
        ),
        (
            "P03",
            "68cb609774cb6f8beb61b774e99a978f20b2b0784d64e6e799bb4718c2741c4b",
            1,
        ),
        (
            "N15a",
            "81f645f1b6c6b020c3034b946b304eedd181390f68280d87207b1295b7af990c",
            0,
        ),
        (
            "N15b",
            "f6bd9e56e6a4d0d2909fb516b9abc650a1708e6b757405422f77173523dffbd1",
            0,
        ),
    ] {
        let case = super::materialize(id);
        let source = &case.snapshot.entries["src/lib.rs"].bytes;
        assert_eq!(super::sha(source), digest);
        let sites = parse(source).unwrap();
        assert_eq!(sites.len(), count, "{id}");
        for (site, witness) in sites.iter().zip(&case.witnesses) {
            assert!(matches(site, witness), "{id}");
            let mut shifted = witness.clone();
            shifted["call_byte_range"][0] = serde_json::json!(site.call.start + 1);
            assert!(!matches(site, &shifted), "{id}");
        }
    }
    assert!(parse(b"fn broken( {").is_err());
    assert!(parse(&vec![b' '; SOURCE_LIMIT]).unwrap().is_empty());
    assert!(parse(&vec![b' '; SOURCE_LIMIT + 1]).is_err());
}
