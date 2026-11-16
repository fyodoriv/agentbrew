#[cfg(owner_hosted_experiment)]
compile_error!("owner_hosted_experiment is forbidden in the main package");

use std::path::PathBuf;

use migration_check::check_repository;

fn main() {
    if let Some(status) = migration_check::snapshot::worker_entry() {
        std::process::exit(status);
    }
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("inventory") {
        usage();
    }
    let mut root = std::env::current_dir().unwrap_or_else(|_| std::process::exit(2));
    let mut manifest = String::from("rust/inventory.json");
    let mut check = false;
    let mut json = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => check = true,
            "--json" => json = true,
            "--root" => root = PathBuf::from(args.next().unwrap_or_else(|| usage())),
            "--manifest" => manifest = args.next().unwrap_or_else(|| usage()),
            _ => usage(),
        }
    }
    if !check {
        usage();
    }
    match check_repository(&root, &manifest) {
        Ok(report) => {
            if json {
                println!(
                    "{}",
                    serde_json::to_string(&report).expect("serializable report")
                );
            } else {
                for error in &report.diagnostics {
                    println!("{} {}", error.code, error.path.as_deref().unwrap_or(""));
                }
                println!(
                    "inventory: {} (files={}, components={}, edges={}, unresolved-frozen={})",
                    if report.diagnostics.is_empty() {
                        "ok"
                    } else {
                        "failed"
                    },
                    report.checked_files,
                    report.classified_components,
                    report.checked_edges,
                    report.unresolved_frozen
                );
            }
            if !report.diagnostics.is_empty() {
                std::process::exit(1);
            }
        }
        Err(error) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "schema_version": 1, "ok": false, "error": error })
                );
            } else {
                eprintln!("inventory: {}", error.code);
            }
            std::process::exit(2);
        }
    }
}

fn usage() -> ! {
    eprintln!(
        "usage: migration-check inventory --check [--root DIR] [--manifest RELATIVE_PATH] [--json]"
    );
    std::process::exit(2)
}
