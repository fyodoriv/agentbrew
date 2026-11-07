use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Terminal {
    Success,
    Failure,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Reservation {
    Held,
    NotHeld,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Ownership {
    Owned,
    NotOwned,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Identity {
    Matches,
    Mismatch,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Term {
    Sent,
    PermissionDenied,
    OtherError,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Cleanup {
    Success,
    Failure,
    Unknown,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    terminal: Terminal,
    reservation: Reservation,
    target: Ownership,
    group: Ownership,
    identity: Identity,
    term: Term,
    cleanup: Cleanup,
}

#[derive(Debug, PartialEq)]
enum Qualification {
    Complete,
    Unqualified,
}

fn validate(value: Value) -> Result<(String, Qualification), &'static str> {
    let receipt: Receipt = serde_json::from_value(value).map_err(|_| "invalid receipt")?;
    let complete = receipt.terminal != Terminal::Unknown
        && receipt.reservation == Reservation::Held
        && receipt.target == Ownership::Owned
        && receipt.group == Ownership::Owned
        && receipt.identity == Identity::Matches
        && receipt.term != Term::Unknown
        && receipt.cleanup != Cleanup::Unknown
        && !(matches!(receipt.term, Term::PermissionDenied | Term::OtherError)
            && receipt.cleanup == Cleanup::Success);
    let encoded = serde_json::to_string(&receipt).map_err(|_| "invalid receipt")?;
    Ok((
        encoded,
        if complete {
            Qualification::Complete
        } else {
            Qualification::Unqualified
        },
    ))
}

fn valid() -> Value {
    json!({"terminal":"success", "reservation":"held", "target":"owned", "group":"owned", "identity":"matches", "term":"sent", "cleanup":"success"})
}

#[test]
fn complete_record_accepted() {
    let (encoded, qualification) = validate(valid()).expect("complete record");
    assert_eq!(qualification, Qualification::Complete);
    assert_eq!(serde_json::from_str::<Value>(&encoded).unwrap(), valid());
}

#[test]
fn missing_field_refused() {
    for field in [
        "terminal",
        "reservation",
        "target",
        "group",
        "identity",
        "term",
        "cleanup",
    ] {
        let mut value = valid();
        value.as_object_mut().unwrap().remove(field);
        assert_eq!(validate(value).unwrap_err(), "invalid receipt");
    }
}

#[test]
fn unknown_terminal_unqualified() {
    let mut value = valid();
    value["terminal"] = json!("unknown");
    assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
}

#[test]
fn unknown_reservation_unqualified() {
    let mut value = valid();
    value["reservation"] = json!("unknown");
    assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
}

#[test]
fn unknown_ownership_unqualified() {
    for field in ["target", "group", "identity"] {
        let mut value = valid();
        value[field] = json!("unknown");
        assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
    }
}

#[test]
fn invalid_enum_refused() {
    for field in [
        "terminal",
        "reservation",
        "target",
        "group",
        "identity",
        "term",
        "cleanup",
    ] {
        let mut value = valid();
        value[field] = json!("invalid");
        assert_eq!(validate(value).unwrap_err(), "invalid receipt");
    }
}

#[test]
fn private_fields_refused() {
    for field in ["pid", "command", "environment", "payload"] {
        let marker = format!("private-{field}-marker");
        let mut value = valid();
        value[field] = json!(marker);
        let error = validate(value).unwrap_err();
        assert_eq!(error, "invalid receipt");
        assert!(!error.contains(&marker));
    }
}

#[test]
fn cleanup_outcome_unchanged() {
    for (term, cleanup, expected) in [
        ("sent", "success", Qualification::Complete),
        ("permission_denied", "failure", Qualification::Complete),
        ("unknown", "failure", Qualification::Unqualified),
        ("sent", "unknown", Qualification::Unqualified),
    ] {
        let mut value = valid();
        value["term"] = json!(term);
        value["cleanup"] = json!(cleanup);
        let (encoded, qualification) = validate(value).expect("closed values");
        let actual: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(actual["term"], term);
        assert_eq!(actual["cleanup"], cleanup);
        assert_eq!(qualification, expected);
    }
}

#[test]
fn eperm_success_conflict_unqualified() {
    for term in ["permission_denied", "other_error"] {
        let mut value = valid();
        value["term"] = json!(term);
        value["cleanup"] = json!("success");
        let (encoded, qualification) = validate(value).expect("closed values");
        let actual: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(actual["cleanup"], "success");
        assert_eq!(
            qualification,
            Qualification::Unqualified,
            "conflicting EPERM marked complete"
        );
    }
}
