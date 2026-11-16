use std::ops::Range;

fn matches_range(actual: Range<usize>, expected: &serde_json::Value) -> bool {
    actual.start as u64 == expected[0].as_u64().unwrap()
        && actual.end as u64 == expected[1].as_u64().unwrap()
}

#[test]
fn p03_original_byte_ranges() {
    let case = super::materialize("P03");
    let witness = &case.witnesses[0];
    let original = &case.snapshot.entries["src/lib.rs"].bytes;
    assert_eq!(original.len(), 108);
    assert_eq!(
        super::sha(original),
        "68cb609774cb6f8beb61b774e99a978f20b2b0784d64e6e799bb4718c2741c4b"
    );
    assert!(original.starts_with(&[0xef, 0xbb, 0xbf]));
    let mut parser_bytes = original.clone();
    parser_bytes[..3].copy_from_slice(b"   ");
    let parsed: syn::File = syn::parse_str(std::str::from_utf8(&parser_bytes).unwrap()).unwrap();
    let syn::Item::Fn(function) = &parsed.items[0] else {
        panic!("expected fixture function")
    };
    let start = function.sig.fn_token.span.byte_range().start;
    let function_range = start..function.block.brace_token.span.close().byte_range().end;
    assert_eq!(start as u64, witness["owner_fn_byte"].as_u64().unwrap());
    assert!(matches_range(
        function_range.clone(),
        &witness["owner_fn_byte_range"]
    ));
    assert!(!matches_range(
        function_range.start + 1..function_range.end,
        &witness["owner_fn_byte_range"]
    ));
    let syn::Stmt::Expr(syn::Expr::Call(call), _) = &function.block.stmts[0] else {
        panic!("expected fixture call")
    };
    let syn::Expr::Path(path) = &*call.func else {
        panic!("expected fixture path")
    };
    let start = path.path.leading_colon.as_ref().unwrap().spans[0]
        .byte_range()
        .start;
    let call_range = start..call.paren_token.span.close().byte_range().end;
    assert!(matches_range(
        call_range.clone(),
        &witness["call_byte_range"]
    ));
    let call_source = witness["call_source_utf8"].as_str().unwrap().as_bytes();
    assert_eq!(&original[call_range.clone()], call_source);
    let expected_function = format!(
        "fn emit() {{ {}; }}",
        witness["call_source_utf8"].as_str().unwrap()
    );
    assert_eq!(&original[function_range], expected_function.as_bytes());
    let mut args = call.args.iter();
    for (range_key, value_key) in [
        ("output_literal_byte_range", "literal_output"),
        ("body_literal_byte_range", "decoded_body_utf8"),
    ] {
        let syn::Expr::Lit(literal) = args.next().unwrap() else {
            panic!("expected fixture literal")
        };
        let syn::Lit::Str(literal) = &literal.lit else {
            panic!("expected string")
        };
        let range = literal.span().byte_range();
        assert!(matches_range(range.clone(), &witness[range_key]));
        assert_eq!(
            &original[range.clone()],
            &call_source[range.start - call_range.start..range.end - call_range.start]
        );
        assert_eq!(literal.value(), witness[value_key].as_str().unwrap());
    }
    assert!(args.next().is_none());
}
