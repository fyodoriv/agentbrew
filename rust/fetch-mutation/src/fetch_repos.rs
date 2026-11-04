use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Serialize, Deserialize))]
pub struct Options {
    pub jobs: usize,
    pub timeout_seconds: u64,
    pub repos: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Failure {
    Usage,
    MissingCapability,
    UnsupportedSsh,
}

#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Debug, Serialize, Deserialize))]
pub struct Policy {
    pub owner_env: BTreeMap<String, String>,
    pub ssh_command: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Debug, Serialize, Deserialize))]
pub struct Request {
    pub cwd: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub work_ms: u64,
    pub cleanup_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Serialize, Deserialize))]
pub struct Repo {
    pub path: String,
    pub common_dir_identity: String,
    pub valid: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Serialize, Deserialize), serde(rename_all = "kebab-case"))]
pub enum Outcome {
    Ok,
    Fail,
    Timeout,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Serialize, Deserialize), serde(rename_all = "kebab-case"))]
pub enum Cleanup {
    Verified,
    Unknown,
    PermissionDenied,
    LeaseLost,
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(Serialize, Deserialize))]
pub struct Completion {
    pub outcome: Outcome,
    pub cleanup: Cleanup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub ordinal: usize,
    pub status: String,
    pub diagnostic: Option<String>,
}

fn positive_number(value: &str) -> Result<u64, Failure> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Failure::Usage);
    }
    value.parse().ok().filter(|v| *v > 0).ok_or(Failure::Usage)
}

fn work_budget(seconds: u64) -> Result<u64, Failure> {
    let work = seconds.checked_mul(1000).ok_or(Failure::Usage)?;
    if seconds == 0 || work.checked_add(2000).is_none() {
        return Err(Failure::Usage);
    }
    Ok(work)
}

pub fn parse(args: &[String]) -> Result<Options, Failure> {
    let mut options = Options {
        jobs: 8,
        timeout_seconds: 60,
        repos: Vec::new(),
    };
    let mut i = 0;
    let mut positional_only = false;
    while i < args.len() {
        let arg = &args[i];
        if positional_only {
            options.repos.push(arg.clone());
        } else if arg == "--" {
            positional_only = true;
        } else if matches!(arg.as_str(), "--jobs" | "--timeout") {
            i += 1;
            let value = positive_number(args.get(i).ok_or(Failure::Usage)?)?;
            if arg == "--jobs" {
                options.jobs = usize::try_from(value).map_err(|_| Failure::Usage)?;
            } else {
                work_budget(value)?;
                options.timeout_seconds = value;
            }
        } else if arg.starts_with('-') || arg.is_empty() {
            return Err(Failure::Usage);
        } else {
            options.repos.push(arg.clone());
        }
        i += 1;
    }
    if options.repos.is_empty() || options.repos.iter().any(String::is_empty) {
        return Err(Failure::Usage);
    }
    Ok(options)
}

// This pure subset does not qualify arbitrary shell-form SSH configuration.
fn noninteractive_ssh(command: &str) -> Result<String, Failure> {
    if command.is_empty()
        || command
            .bytes()
            .any(|b| !b.is_ascii_alphanumeric() && !b" _./:@%+=,-".contains(&b))
    {
        return Err(Failure::UnsupportedSsh);
    }
    let words: Vec<_> = command.split_ascii_whitespace().collect();
    if words.first().and_then(|s| s.rsplit('/').next()) != Some("ssh")
        || words.first().is_some_and(|s| s.contains('='))
    {
        return Err(Failure::UnsupportedSsh);
    }
    let mut batch = false;
    let mut i = 1;
    while i < words.len() {
        match words[i] {
            "-o" => {
                i += 1;
                let option = words.get(i).ok_or(Failure::UnsupportedSsh)?;
                if !option.eq_ignore_ascii_case("BatchMode=yes") {
                    return Err(Failure::UnsupportedSsh);
                }
                batch = true;
            }
            "-i" | "-p" | "-l" => {
                let flag = words[i];
                i += 1;
                let value = words.get(i).ok_or(Failure::UnsupportedSsh)?;
                if value.is_empty()
                    || value.starts_with('-')
                    || (flag == "-p" && positive_number(value).is_err())
                {
                    return Err(Failure::UnsupportedSsh);
                }
            }
            option if option.eq_ignore_ascii_case("-oBatchMode=yes") => batch = true,
            _ => return Err(Failure::UnsupportedSsh),
        }
        i += 1;
    }
    Ok(if batch {
        command.into()
    } else {
        format!("{command} -o BatchMode=yes")
    })
}

pub fn prepare(cwd: &str, timeout_seconds: u64, policy: &Policy) -> Result<Request, Failure> {
    let work_ms = work_budget(timeout_seconds)?;
    let ssh = policy
        .ssh_command
        .as_deref()
        .or_else(|| policy.owner_env.get("GIT_SSH_COMMAND").map(String::as_str))
        .or_else(|| policy.owner_env.get("GIT_SSH").map(String::as_str))
        .unwrap_or("ssh");
    let ssh = noninteractive_ssh(ssh)?;
    let mut env = policy.owner_env.clone();
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_PREFIX",
        "GIT_INTERNAL_SUPER_PREFIX",
        "GIT_IMPLICIT_WORK_TREE",
        "GIT_GRAFT_FILE",
        "GIT_SHALLOW_FILE",
        "GIT_REPLACE_REF_BASE",
    ] {
        env.remove(name);
    }
    env.insert("GIT_TERMINAL_PROMPT".into(), "0".into());
    env.insert("GIT_ASKPASS".into(), String::new());
    env.insert("GCM_INTERACTIVE".into(), "never".into());
    env.insert("GIT_SSH_COMMAND".into(), ssh);
    Ok(Request {
        cwd: cwd.into(),
        args: [
            "fetch",
            "--quiet",
            "--prune",
            "--no-tags",
            "--no-prune-tags",
            "--no-write-fetch-head",
            "--refmap=",
            "--recurse-submodules=no",
            "--no-auto-maintenance",
            "origin",
            "+refs/heads/*:refs/remotes/origin/*",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        env,
        work_ms,
        cleanup_ms: 2000,
    })
}

pub fn receipt(ordinal: usize, completion: &Completion) -> Receipt {
    let (status, diagnostic) = if completion.cleanup != Cleanup::Verified {
        (
            "fail",
            Some(if completion.outcome == Outcome::Timeout {
                "timeout-cleanup-unverified"
            } else {
                "cleanup-unverified"
            }),
        )
    } else {
        match completion.outcome {
            Outcome::Ok => ("ok", None),
            Outcome::Fail => ("fail", Some("git-failure")),
            Outcome::Timeout => ("timeout", Some("work-timeout")),
            Outcome::Cancelled => ("fail", Some("cancelled")),
        }
    };
    Receipt {
        ordinal,
        status: status.into(),
        diagnostic: diagnostic.map(String::from),
    }
}

// A production caller has no fetch dispatcher until owned cleanup qualifies.
pub fn native_available() -> bool {
    false
}

// One fetch invocation owns this queue; no process or signal is created here.
pub struct Queue {
    jobs: usize,
    work_ms: u64,
    entries: Vec<Entry>,
    cancelled: bool,
}

enum State {
    Pending,
    Active(u64),
    Finished(Receipt),
}

struct Entry {
    repo: Repo,
    state: State,
}

impl Queue {
    pub fn new(jobs: usize, timeout_seconds: u64, repos: Vec<Repo>) -> Self {
        let budget = work_budget(timeout_seconds);
        let cancelled = jobs == 0 || budget.is_err();
        let entries = repos
            .into_iter()
            .enumerate()
            .map(|(ordinal, repo)| {
                let state = if cancelled {
                    State::Finished(Receipt {
                        ordinal,
                        status: "fail".into(),
                        diagnostic: Some("invalid-budget".into()),
                    })
                } else if !repo.valid || repo.path.is_empty() || repo.common_dir_identity.is_empty()
                {
                    State::Finished(Receipt {
                        ordinal,
                        status: "fail".into(),
                        diagnostic: Some("invalid-repository".into()),
                    })
                } else {
                    State::Pending
                };
                Entry { repo, state }
            })
            .collect();
        Self {
            jobs,
            work_ms: budget.unwrap_or(0),
            entries,
            cancelled,
        }
    }

    pub fn admit(&mut self, now_ms: u64) -> Vec<usize> {
        if self.cancelled {
            return Vec::new();
        }
        let Some(deadline) = now_ms.checked_add(self.work_ms) else {
            self.cancel();
            return Vec::new();
        };
        let mut active: std::collections::BTreeSet<_> = self
            .entries
            .iter()
            .filter(|entry| matches!(entry.state, State::Active(_)))
            .map(|entry| entry.repo.common_dir_identity.clone())
            .collect();
        let mut admitted = Vec::new();
        for (ordinal, entry) in self.entries.iter_mut().enumerate() {
            if active.len() >= self.jobs {
                break;
            }
            if matches!(entry.state, State::Pending)
                && !active.contains(&entry.repo.common_dir_identity)
            {
                active.insert(entry.repo.common_dir_identity.clone());
                entry.state = State::Active(deadline);
                admitted.push(ordinal);
            }
        }
        admitted
    }

    pub fn deadline(&self, ordinal: usize) -> Option<u64> {
        match self.entries.get(ordinal).map(|e| &e.state) {
            Some(State::Active(deadline)) => Some(*deadline),
            _ => None,
        }
    }

    pub fn expired(&self, now_ms: u64) -> Vec<usize> {
        self.entries
            .iter()
            .enumerate()
            .filter_map(|(ordinal, entry)| match entry.state {
                State::Active(deadline) if now_ms >= deadline => Some(ordinal),
                _ => None,
            })
            .collect()
    }

    pub fn finish(&mut self, ordinal: usize, completion: Completion) {
        let Some(entry) = self.entries.get_mut(ordinal) else {
            return;
        };
        if !matches!(entry.state, State::Active(_)) {
            return;
        }
        entry.state = State::Finished(receipt(ordinal, &completion));
        if completion.cleanup != Cleanup::Verified {
            self.cancel();
        }
    }

    pub fn cancel(&mut self) {
        self.cancelled = true;
        for (ordinal, entry) in self.entries.iter_mut().enumerate() {
            if matches!(entry.state, State::Pending) {
                entry.state = State::Finished(receipt(
                    ordinal,
                    &Completion {
                        outcome: Outcome::Cancelled,
                        cleanup: Cleanup::Verified,
                    },
                ));
            }
        }
    }

    pub fn results(&self) -> Vec<Receipt> {
        self.entries
            .iter()
            .filter_map(|entry| match &entry.state {
                State::Finished(receipt) => Some(receipt.clone()),
                _ => None,
            })
            .collect()
    }
}
