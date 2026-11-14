//! Compare independently discovered executable identities with a reviewed inventory.
//! Discovery completeness belongs to the caller; an incomplete input is not an audit.

use std::collections::BTreeSet;
use std::path::{Component, Path};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum Kind {
    File,
    Embedded,
    Generated,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Identity {
    pub path: String,
    pub kind: Kind,
    /// A stable source boundary or generated-target identity.
    pub boundary: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum State {
    Ported,
    Exception,
    Frozen,
    Grandfathered,
    OutOfScope,
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub identity: Identity,
    pub owner: String,
    pub caller: String,
    pub state: State,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Error {
    EmptyDiscovery,
    InvalidIdentity(Identity),
    DuplicateObserved(Identity),
    DuplicateEntry(Identity),
    MissingEntry(Identity),
    UndiscoveredEntry(Identity),
    MissingOwnerOrCaller(Identity),
    MissingReason(Identity),
}

fn valid_identity(id: &Identity) -> bool {
    !id.boundary.trim().is_empty()
        && id.path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
        && Path::new(&id.path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

/// Report all differences; callers must reject a nonempty result.
pub fn validate(observed: &[Identity], entries: &[Entry]) -> Vec<Error> {
    let mut errors = Vec::new();
    let mut facts = BTreeSet::new();
    let mut recorded = BTreeSet::new();
    if observed.is_empty() {
        errors.push(Error::EmptyDiscovery);
    }
    for id in observed {
        if !valid_identity(id) {
            errors.push(Error::InvalidIdentity(id.clone()));
        }
        if !facts.insert(id.clone()) {
            errors.push(Error::DuplicateObserved(id.clone()));
        }
    }
    for entry in entries {
        let id = &entry.identity;
        if !valid_identity(id) {
            errors.push(Error::InvalidIdentity(id.clone()));
        }
        if !recorded.insert(id.clone()) {
            errors.push(Error::DuplicateEntry(id.clone()));
        }
        if entry.owner.trim().is_empty() || entry.caller.trim().is_empty() {
            errors.push(Error::MissingOwnerOrCaller(id.clone()));
        }
        if matches!(entry.state, State::Exception | State::Frozen | State::OutOfScope)
            && entry.reason.trim().is_empty()
        {
            errors.push(Error::MissingReason(id.clone()));
        }
    }
    errors.extend(facts.difference(&recorded).cloned().map(Error::MissingEntry));
    errors.extend(recorded.difference(&facts).cloned().map(Error::UndiscoveredEntry));
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Vec<Identity>, Vec<Entry>) {
        let ids = vec![
            Identity { path: "bin/start".into(), kind: Kind::File, boundary: "entry".into() },
            Identity { path: "bin/start".into(), kind: Kind::Embedded, boundary: "python-body".into() },
            Identity { path: "scripts/build".into(), kind: Kind::Generated, boundary: "generated-tool".into() },
        ];
        let entries = ids.iter().map(|id| Entry { identity: id.clone(), owner: "tools".into(), caller: "cli".into(), state: State::Ported, reason: String::new() }).collect();
        (ids, entries)
    }

    #[test]
    fn matching_inventory_passes_and_each_omission_fails() {
        let (ids, entries) = fixture();
        assert!(validate(&ids, &entries).is_empty());
        for n in 0..ids.len() {
            let mut missing = entries.clone();
            missing.remove(n);
            assert!(validate(&ids, &missing).contains(&Error::MissingEntry(ids[n].clone())));
        }
    }

    #[test]
    fn duplicates_unobserved_entries_and_missing_metadata_fail() {
        let (ids, entries) = fixture();
        let mut duplicate = entries.clone();
        duplicate.push(entries[0].clone());
        assert!(validate(&ids, &duplicate).contains(&Error::DuplicateEntry(ids[0].clone())));
        assert!(validate(&ids[..2], &entries).contains(&Error::UndiscoveredEntry(ids[2].clone())));
        let mut bad = entries.clone();
        bad[0].owner.clear();
        bad[1].state = State::Exception;
        assert!(validate(&ids, &bad).contains(&Error::MissingOwnerOrCaller(ids[0].clone())));
        assert!(validate(&ids, &bad).contains(&Error::MissingReason(ids[1].clone())));
        assert_eq!(validate(&[], &[]), vec![Error::EmptyDiscovery]);
    }

    #[test]
    fn duplicate_discovery_and_unsafe_paths_fail() {
        let (mut ids, entries) = fixture();
        ids.push(ids[0].clone());
        assert!(validate(&ids, &entries).contains(&Error::DuplicateObserved(ids[0].clone())));
        for path in ["../outside", "bin//start", "bin/./start", "bin/start/"] {
            ids[0].path = path.into();
            assert!(validate(&ids, &entries).contains(&Error::InvalidIdentity(ids[0].clone())));
        }
    }
}
