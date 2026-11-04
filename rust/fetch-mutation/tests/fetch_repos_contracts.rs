#[allow(dead_code)]
#[path = "../src/fetch_repos.rs"]
mod fetch_repos;

use fetch_repos::{Cleanup, Completion, Outcome, Policy, Queue, Repo};
use serde_json::{json, Value};

fn result<T: serde::Serialize>(r: Result<T, fetch_repos::Failure>) -> Value {
    match r {
        Ok(v) => json!({"ok":v}),
        Err(e) => json!({"error":e}),
    }
}

fn actual(case: &Value) -> Value {
    let input = &case["input"];
    match case["operation"].as_str().unwrap() {
        "parse" => result(fetch_repos::parse(
            &serde_json::from_value::<Vec<String>>(input.clone()).unwrap(),
        )),
        "request" => result(fetch_repos::prepare(
            input["cwd"].as_str().unwrap(),
            input["timeout_seconds"].as_u64().unwrap(),
            &serde_json::from_value::<Policy>(input["policy"].clone()).unwrap(),
        )),
        "receipt" => json!(fetch_repos::receipt(
            input["ordinal"].as_u64().unwrap() as usize,
            &serde_json::from_value::<Completion>(input["completion"].clone()).unwrap(),
        )),
        "queue" => {
            let mut queue = Queue::new(
                input["jobs"].as_u64().unwrap() as usize,
                input["timeout_seconds"].as_u64().unwrap(),
                serde_json::from_value::<Vec<Repo>>(input["repos"].clone()).unwrap(),
            );
            let mut observations = Vec::new();
            for step in input["steps"].as_array().unwrap() {
                match step["op"].as_str().unwrap() {
                    "admit" => observations.push(json!(queue.admit(step["now"].as_u64().unwrap()))),
                    "deadline" => observations.push(json!(
                        queue.deadline(step["ordinal"].as_u64().unwrap() as usize)
                    )),
                    "expired" => {
                        observations.push(json!(queue.expired(step["now"].as_u64().unwrap())))
                    }
                    "finish" => queue.finish(
                        step["ordinal"].as_u64().unwrap() as usize,
                        serde_json::from_value::<Completion>(step["completion"].clone()).unwrap(),
                    ),
                    "cancel" => queue.cancel(),
                    "results" => observations.push(json!(queue.results())),
                    _ => panic!("unregistered fixture operation"),
                }
            }
            json!(observations)
        }
        "native-availability" => json!({"available": fetch_repos::native_available()}),
        _ => panic!("unregistered fixture operation"),
    }
}

fn check(id: &str) {
    let registry: Value =
        serde_json::from_str(include_str!("fixtures/fetch-contracts.json")).unwrap();
    let case = registry["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap();
    assert_eq!(case["layer"], "pure-executor");
    assert_eq!(actual(case), case["expected"], "fixed contract {id}");
}

macro_rules! cases {
    ($($name:ident),+ $(,)?) => {$(#[test] fn $name() { check(stringify!($name)); })+};
}

cases!(
    f01_eight_admissions,
    f02_two_admissions,
    f03_mixed_results,
    f04_shared_head_does_not_block_independent_job,
    f05_defaults,
    f05_explicit,
    f05_no_repositories,
    f05_zero_jobs,
    f05_negative_timeout,
    f05_fractional_timeout,
    f05_overflow_timeout,
    f05_unknown_option,
    f05_missing_value,
    f05_delimiter,
    f06_deadline_at_admission,
    f06_expiration_does_not_release_without_cleanup,
    f07_default_ssh,
    f07_owner_ssh_key,
    f07_batchmode_no,
    f07_unsupported_ssh,
    f08_literal_path,
    f10_common_identity_serialization,
    f11_bad_input_does_not_block_good,
    f14_cancel_stops_queued_starts,
    f15_unknown_cleanup,
    f15_eperm_cleanup,
    f15_lease_lost,
    f15_incomplete_group,
    f15_timeout_cause_retained,
    f17_owner_context_and_redirects,
    f18_fixed_receipt_fields,
    f19_exact_namespace,
    f20_native_unavailable,
    f21_no_tag_prune,
    f21_no_recursion,
    f21_no_maintenance,
);

#[test]
fn fixture_registry_has_unique_variants_and_no_kernel_claim() {
    let registry: Value =
        serde_json::from_str(include_str!("fixtures/fetch-contracts.json")).unwrap();
    let cases = registry["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 36);
    let ids: std::collections::BTreeSet<_> =
        cases.iter().map(|v| v["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), cases.len());
    assert!(cases.iter().all(|v| v["layer"] == "pure-executor"));
    assert_eq!(registry["kernel_qualification"], "pending-not-run");
    assert_eq!(
        registry["shared_source_tree"],
        "187687c9aa6c674fc47fc71b5cfc02b456e8a6f3"
    );
    let negative = Completion {
        outcome: Outcome::Ok,
        cleanup: Cleanup::Unknown,
    };
    assert_ne!(fetch_repos::receipt(0, &negative).status, "ok");
}
