use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub owner: String,
    pub reviewed_revision: String,
    pub slices: Vec<String>,
    pub files: Vec<FileRecord>,
    pub components: Vec<Component>,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub allowances: Vec<Allowance>,
    #[serde(default)]
    pub registries: Vec<Registry>,
    #[serde(default)]
    pub non_source_allowances: Vec<NonSourceAllowance>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileRecord {
    pub path: String,
    pub reviewed_git_blob: Option<String>,
    pub disposition: String,
    pub reason: String,
    pub components: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Component {
    pub id: String,
    pub source: Region,
    pub owner: String,
    pub caller_boundary: String,
    pub migration_slice: Option<String>,
    pub disposition: String,
    pub exception_reason: Option<String>,
    #[serde(default)]
    pub generated_targets: Vec<GeneratedTarget>,
    pub resolution: Option<Resolution>,
    #[serde(default)]
    pub contracts: Vec<String>,
    #[serde(default)]
    pub call_receipts: Vec<crate::observations::CallReceipt>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    pub path: String,
    pub anchor: String,
    pub start_line: usize,
    pub end_line: usize,
    pub language: String,
    pub form: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeneratedTarget {
    pub id: String,
    pub path: String,
    pub condition: Option<String>,
    pub consumer: String,
    #[serde(default)]
    pub output_receipt: Option<crate::host_graph::Datum>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resolution {
    pub kind: String,
    pub targets: Vec<String>,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Allowance {
    pub component: String,
    pub disposition: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub id: String,
    pub source: String,
    pub kind: String,
    pub anchor: String,
    pub path_prefix: String,
    pub consumer: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub code: String,
    pub path: Option<String>,
    #[cfg(unix)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<crate::transport::TransportContext>,
}

impl Diagnostic {
    pub fn new(code: &str, path: Option<&str>) -> Self {
        Self {
            code: code.into(),
            path: path.map(str::to_owned),
            #[cfg(unix)]
            transport: None,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CheckReport {
    pub schema_version: u32,
    pub checked_files: usize,
    pub classified_components: usize,
    pub checked_edges: usize,
    pub unresolved_frozen: usize,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NonSourceAllowance {
    pub path: String,
    pub kind: String,
    pub reason: String,
}
