use crate::discovery::{discover, discover_with_test_producer, TestProducer};
use crate::snapshot::{Entry, Snapshot};

fn entry(path: &str, source: &str) -> Entry {
    Entry {
        path: path.into(),
        mode: 0o100644,
        blob: "0000000000000000000000000000000000000000".into(),
        bytes: source.as_bytes().to_vec(),
    }
}

fn input<'a>(path: &'a str, source: &'a str) -> TestProducer<'a> {
    let call_text = "write(\"tools/out\", \"#!/bin/sh\\n:\\n\")";
    let output_text = "\"tools/out\"";
    let body_text = "\"#!/bin/sh\\n:\\n\"";
    let call = source.find(call_text).unwrap();
    let output = source.find(output_text).unwrap();
    let body = source.find(body_text).unwrap();
    TestProducer {
        path,
        source: source.as_bytes(),
        call: call..call + call_text.len(),
        call_text,
        output: output..output + output_text.len(),
        output_text,
        output_value: "tools/out",
        body: body..body + body_text.len(),
        body_text,
        body_value: "#!/bin/sh\n:\n",
    }
}

fn copy(snapshot: &Snapshot) -> Snapshot {
    Snapshot {
        entries: snapshot.entries.clone(),
        untracked: snapshot.untracked.clone(),
        ignored: snapshot.ignored.clone(),
    }
}

#[test]
fn synthetic_host_conflict() {
    let base = super::materialize("C01");
    let source = "write(\"tools/out\", \"#!/bin/sh\\n:\\n\");\n";
    let mut host = copy(&base.snapshot);
    host.entries
        .insert("src/conflict.ts".into(), entry("src/conflict.ts", source));
    let injected = discover_with_test_producer(&host, &input("src/conflict.ts", source));
    assert!(injected
        .diagnostics
        .iter()
        .any(|d| d.code == "reviewed-native-contradiction"
            && d.path.as_deref() == Some("src/conflict.ts")));
    assert!(!injected
        .boundaries
        .values()
        .any(|b| b.site.path == "src/conflict.ts"));
    let clean = discover(&host);
    assert!(!clean
        .diagnostics
        .iter()
        .any(|d| d.code == "reviewed-native-contradiction"
            && d.path.as_deref() == Some("src/conflict.ts")));

    let rust_source = "fn fixture() { write(\"tools/out\", \"#!/bin/sh\\n:\\n\"); }\n";
    let mut nonhost = copy(&base.snapshot);
    nonhost.entries.insert(
        "src/fixture.rs".into(),
        entry("src/fixture.rs", rust_source),
    );
    let value = input("src/fixture.rs", rust_source);
    let existing = discover(&nonhost).reviewed_producers.len();
    let found = discover_with_test_producer(&nonhost, &value);
    assert_eq!(found.reviewed_producers.len(), existing + 1);
    assert!(found
        .boundaries
        .values()
        .any(|b| b.site.path == "src/fixture.rs"));
    assert!(!discover(&nonhost)
        .boundaries
        .values()
        .any(|b| b.site.path == "src/fixture.rs"));
    let mut wrong = value.clone();
    wrong.call.start += 1;
    assert_eq!(
        discover_with_test_producer(&nonhost, &wrong)
            .reviewed_producers
            .len(),
        existing
    );
    let mut missing = value.clone();
    missing.path = "src/missing.rs";
    assert_eq!(
        discover_with_test_producer(&nonhost, &missing)
            .reviewed_producers
            .len(),
        existing
    );
    let mut changed = copy(&nonhost);
    changed
        .entries
        .get_mut("src/fixture.rs")
        .unwrap()
        .bytes
        .push(b' ');
    assert_eq!(
        discover_with_test_producer(&changed, &value)
            .reviewed_producers
            .len(),
        discover(&changed).reviewed_producers.len()
    );
    crate::discovery::synthetic_inspector_error_control();
    crate::discovery::producer_helper_controls(&nonhost, &value);
    // The existing exact observer test separately checks retained B0 projections.
}
