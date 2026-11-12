//! Compile-only fixture. It does not start the worker or signal a process.
#![allow(dead_code)]

#[cfg(not(owner_hosted_experiment))]
compile_error!("owner-hosted-fixture requires target-scoped owner_hosted_experiment cfg");

#[path = "../../src/transport.rs"]
mod transport;
#[path = "../../src/worker_owner.rs"]
mod worker_owner;

mod model {
    pub struct Diagnostic {
        pub transport: Option<crate::transport::TransportContext>,
    }
    impl Diagnostic {
        pub fn new(_code: &str, _path: Option<&str>) -> Self {
            Self { transport: None }
        }
    }
}

fn main() {}
