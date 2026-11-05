use crate::{host_graph::Site, model::Diagnostic, snapshot::Snapshot};
use syn::visit::Visit;

const ROOT: &str = "rust/vendor/libproc-0.14.11";
const MANIFEST: &str = "rust/Cargo.toml";
const CALLER: &str = "rust/src/darwin_group.rs";
const MODULE: &str = "rust/src/lib.rs";
const CALL: &str = "libproc::processes::bounded_group_pids";
const OWNED: &str = "../vendor/libproc-0.14.11/src/libproc/sys/bounded_group.rs";

#[derive(Clone, Debug)]
pub struct Consumer {
    pub dependency: Site,
    pub call: Site,
    pub owned_include: Site,
    pub conditions: Vec<String>,
    pub library: String,
    pub build_script: String,
    pub owned_source: String,
}

fn error() -> Diagnostic {
    Diagnostic::new("upstream-consumer-mismatch", Some(MANIFEST))
}
fn text<'a>(snapshot: &'a Snapshot, path: &str) -> Result<&'a str, Diagnostic> {
    let entry = snapshot.entries.get(path).ok_or_else(error)?;
    if entry.mode != 0o100644 || entry.bytes.len() > 2 * 1024 * 1024 {
        return Err(error());
    }
    std::str::from_utf8(&entry.bytes).map_err(|_| error())
}
fn table(snapshot: &Snapshot, path: &str) -> Result<toml::Table, Diagnostic> {
    toml::from_str(text(snapshot, path)?).map_err(|_| error())
}
fn string<'a>(table: &'a toml::Value, key: &str) -> Option<&'a str> {
    table.get(key)?.as_str()
}
fn site(path: &str, text: &str, needle: &str) -> Result<Site, Diagnostic> {
    let start = text.find(needle).ok_or_else(error)?;
    if text[start + needle.len()..].contains(needle) {
        return Err(error());
    }
    Ok(Site {
        path: path.into(),
        start: start.try_into().map_err(|_| error())?,
        end: (start + needle.len()).try_into().map_err(|_| error())?,
        body: None,
    })
}
fn test_cfg(attr: &syn::Attribute) -> bool {
    attr.path().is_ident("cfg")
        && attr
            .parse_args::<syn::Path>()
            .is_ok_and(|path| path.is_ident("test"))
}
fn mac_cfg(attr: &syn::Attribute) -> bool {
    if !attr.path().is_ident("cfg") {
        return false;
    }
    matches!(attr.parse_args::<syn::Meta>(),Ok(syn::Meta::NameValue(pair))
        if pair.path.is_ident("target_os") && matches!(pair.value,syn::Expr::Lit(syn::ExprLit{lit:syn::Lit::Str(ref value),..}) if value.value()=="macos"))
}
fn shadows(tree: &syn::UseTree) -> bool {
    match tree {
        syn::UseTree::Name(name) => name.ident == "libproc",
        syn::UseTree::Rename(name) => name.rename == "libproc" || name.ident == "libproc",
        syn::UseTree::Path(path) => shadows(&path.tree),
        syn::UseTree::Group(group) => group.items.iter().any(shadows),
        syn::UseTree::Glob(_) => true,
    }
}
fn item_shadow(item: &syn::Item) -> bool {
    match item {
        syn::Item::Mod(item) => item.ident == "libproc",
        syn::Item::Use(item) => shadows(&item.tree),
        syn::Item::ExternCrate(item) => item
            .rename
            .as_ref()
            .map_or(item.ident == "libproc", |(_, name)| name == "libproc"),
        _ => false,
    }
}
#[derive(Default)]
struct Calls {
    tests: usize,
    test_function: bool,
    count: usize,
    invalid: bool,
}
impl<'ast> Visit<'ast> for Calls {
    fn visit_attribute(&mut self, node: &'ast syn::Attribute) {
        if node.path().is_ident("cfg") {
            self.invalid |= !test_cfg(node);
        } else if !node.path().is_ident("test") && !node.path().is_ident("path") {
            self.invalid = true;
        }
    }
    fn visit_item_mod(&mut self, node: &'ast syn::ItemMod) {
        if node.ident == "libproc" {
            self.invalid = true;
        }
        let has_test = node.attrs.iter().any(test_cfg);
        if node
            .attrs
            .iter()
            .any(|attr| attr.path().is_ident("cfg") && !test_cfg(attr))
        {
            self.invalid = true;
        }
        self.tests += usize::from(has_test);
        syn::visit::visit_item_mod(self, node);
        self.tests -= usize::from(has_test);
    }
    fn visit_item_use(&mut self, node: &'ast syn::ItemUse) {
        self.invalid |= shadows(&node.tree);
    }
    fn visit_item_extern_crate(&mut self, node: &'ast syn::ItemExternCrate) {
        self.invalid |= node.ident == "libproc"
            || node
                .rename
                .as_ref()
                .is_some_and(|(_, name)| name == "libproc");
    }
    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {
        let before = self.test_function;
        self.test_function = node.attrs.iter().any(|attr| attr.path().is_ident("test"));
        if node.attrs.iter().any(|attr| attr.path().is_ident("cfg")) {
            self.invalid = true;
        }
        syn::visit::visit_item_fn(self, node);
        self.test_function = before;
    }
    fn visit_expr_call(&mut self, node: &'ast syn::ExprCall) {
        if let syn::Expr::Path(expr) = node.func.as_ref() {
            let names: Vec<_> = expr
                .path
                .segments
                .iter()
                .map(|part| part.ident.to_string())
                .collect();
            if names == ["libproc", "processes", "bounded_group_pids"] {
                self.count += 1;
                self.invalid |= self.tests != 1
                    || !self.test_function
                    || node.args.len() != 2
                    || expr.qself.is_some()
                    || expr
                        .path
                        .segments
                        .iter()
                        .any(|part| !matches!(part.arguments, syn::PathArguments::None));
            }
        }
        syn::visit::visit_expr_call(self, node);
    }
}

pub fn declares_local_package(snapshot: &Snapshot) -> Result<bool, Diagnostic> {
    if !snapshot.entries.contains_key(MANIFEST) {
        return Ok(false);
    }
    let cargo = table(snapshot, MANIFEST)?;
    let mut scopes = vec![&cargo];
    if let Some(targets) = cargo.get("target") {
        let targets = targets.as_table().ok_or_else(error)?;
        for target in targets.values() {
            scopes.push(target.as_table().ok_or_else(error)?);
        }
    }
    for scope in scopes {
        for name in ["dependencies", "dev-dependencies", "build-dependencies"] {
            let Some(dependencies) = scope.get(name) else {
                continue;
            };
            for dependency in dependencies.as_table().ok_or_else(error)?.values() {
                let Some(path) = dependency.get("path") else {
                    continue;
                };
                let path = path.as_str().ok_or_else(error)?;
                if crate::discovery::owned_path(path, Some(MANIFEST)).as_deref() == Some(ROOT) {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

pub fn inspect(snapshot: &Snapshot) -> Result<Consumer, Diagnostic> {
    let cargo = table(snapshot, MANIFEST)?;
    if cargo.get("patch").is_some() || cargo.get("replace").is_some() {
        return Err(error());
    }
    let package = cargo.get("package").ok_or_else(error)?;
    if string(package, "name") != Some("migration-check")
        || string(package, "version") != Some("0.1.0")
    {
        return Err(error());
    }
    let dependency = cargo
        .get("target")
        .and_then(|v| v.get("cfg(target_os = \"macos\")"))
        .and_then(|v| v.get("dependencies"))
        .and_then(|v| v.get("libproc"))
        .ok_or_else(error)?;
    if string(dependency, "version") != Some("=0.14.11")
        || string(dependency, "path") != Some("vendor/libproc-0.14.11")
        || dependency.as_table().is_none_or(|table| table.len() != 2)
    {
        return Err(error());
    }
    let upstream = table(snapshot, &format!("{ROOT}/Cargo.toml"))?;
    let package = upstream.get("package").ok_or_else(error)?;
    let lib = upstream.get("lib").ok_or_else(error)?;
    if string(package, "name") != Some("libproc")
        || string(package, "version") != Some("0.14.11")
        || string(package, "license") != Some("MIT")
        || string(package, "build") != Some("build.rs")
        || string(lib, "name") != Some("libproc")
        || string(lib, "path") != Some("src/lib.rs")
    {
        return Err(error());
    }
    let lock = table(snapshot, "rust/Cargo.lock")?;
    let packages = lock
        .get("package")
        .and_then(toml::Value::as_array)
        .ok_or_else(error)?;
    let selected: Vec<_> = packages
        .iter()
        .filter(|p| string(p, "name") == Some("libproc"))
        .collect();
    let roots: Vec<_> = packages
        .iter()
        .filter(|p| string(p, "name") == Some("migration-check"))
        .collect();
    if selected.len() != 1
        || roots.len() != 1
        || string(selected[0], "version") != Some("0.14.11")
        || selected[0].get("source").is_some()
        || selected[0].get("checksum").is_some()
        || roots[0]
            .get("dependencies")
            .and_then(toml::Value::as_array)
            .is_none_or(|deps| {
                deps.iter()
                    .filter(|v| v.as_str() == Some("libproc"))
                    .count()
                    != 1
            })
    {
        return Err(error());
    }
    let module_text = text(snapshot, MODULE)?;
    let root = syn::parse_file(module_text).map_err(|_| error())?;
    if root.items.iter().any(item_shadow) {
        return Err(error());
    }
    let modules: Vec<_> = root
        .items
        .iter()
        .filter_map(|item| match item {
            syn::Item::Mod(module) if module.ident == "darwin_group" => Some(module),
            _ => None,
        })
        .collect();
    if modules.len() != 1
        || modules[0].content.is_some()
        || modules[0].attrs.len() != 1
        || !mac_cfg(&modules[0].attrs[0])
    {
        return Err(error());
    }
    let caller_text = text(snapshot, CALLER)?;
    let caller = syn::parse_file(caller_text).map_err(|_| error())?;
    let includes: Vec<_> = caller
        .items
        .iter()
        .filter_map(|item| match item {
            syn::Item::Mod(module) if module.ident == "bounded_group" => Some(module),
            _ => None,
        })
        .collect();
    if includes.len()!=1 || includes[0].content.is_some() || includes[0].attrs.len()!=2
        || !includes[0].attrs.iter().any(test_cfg)
        || !includes[0].attrs.iter().any(|attr|matches!(&attr.meta,syn::Meta::NameValue(pair)
            if pair.path.is_ident("path") && matches!(&pair.value,syn::Expr::Lit(syn::ExprLit{lit:syn::Lit::Str(value),..}) if value.value()==OWNED))) {return Err(error());}
    let mut calls = Calls::default();
    calls.visit_file(&caller);
    if calls.invalid || calls.count != 1 {
        return Err(error());
    }
    Ok(Consumer {
        dependency: site(
            MANIFEST,
            text(snapshot, MANIFEST)?,
            "libproc = { version = \"=0.14.11\", path = \"vendor/libproc-0.14.11\" }",
        )?,
        call: site(CALLER, caller_text, CALL)?,
        owned_include: site(CALLER, caller_text, OWNED)?,
        conditions: vec!["target_os=macos".into(), "test".into()],
        library: format!("{ROOT}/src/lib.rs"),
        build_script: format!("{ROOT}/build.rs"),
        owned_source: format!("{ROOT}/src/libproc/sys/bounded_group.rs"),
    })
}
