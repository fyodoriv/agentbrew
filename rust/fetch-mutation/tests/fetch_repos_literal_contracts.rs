#[allow(dead_code)]
#[path = "../src/fetch_repos.rs"]
mod fetch_repos;

use fetch_repos::{Failure, Policy};
use serde_json::Value;
use std::collections::BTreeMap;

fn check(id: &str) {
    let registry: Value =
        serde_json::from_str(include_str!("fixtures/fetch-literal-contracts.json")).unwrap();
    let case = registry["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == id)
        .unwrap();
    let result = fetch_repos::prepare(
        "fixture-repo",
        60,
        &Policy {
            owner_env: BTreeMap::new(),
            ssh_command: Some(case["ssh_command"].as_str().unwrap().into()),
        },
    );
    let actual = match result {
        Ok(_) => "permitted",
        Err(Failure::UnsupportedSsh) => "unsupported-ssh",
        Err(Failure::Usage) => "usage",
        Err(Failure::MissingCapability) => "missing-capability",
    };
    assert_eq!(
        actual,
        case["expected"].as_str().unwrap(),
        "fixed literal contract {id}"
    );
}

#[test]
fn f22_identity_glob() {
    check("f22_identity_glob");
}

#[test]
fn f22_executable_glob() {
    check("f22_executable_glob");
}
