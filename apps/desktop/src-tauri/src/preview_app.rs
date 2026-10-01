//! Generates the controllable preview app into `<project>/.reflow/preview/`.
//!
//! The app is a tiny Vite project that imports each composition's component from the user's source
//! and plays it with the project's own `@remotion/player`. It talks to the host window through
//! `postMessage` (protocol: packages/preview-protocol). Nothing here imports Remotion into ReFlow itself.

use std::path::{Path, PathBuf};

use reflow_project::Composition;
use serde::Serialize;

pub const APP_DIR: &str = ".reflow/preview";

/// Defaults used when a composition's numeric props cannot be resolved statically.
const DEFAULT_WIDTH: u32 = 1920;
const DEFAULT_HEIGHT: u32 = 1080;
const DEFAULT_FPS: f64 = 30.0;
const DEFAULT_DURATION: u32 = 150;

#[derive(Debug, Serialize, PartialEq)]
pub struct Skipped {
    pub id: String,
    pub reason: String,
}

pub struct GeneratedApp {
    pub files: Vec<(&'static str, String)>,
    pub skipped: Vec<Skipped>,
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).expect("string serialises")
}

/// Relative import specifier from `.reflow/preview/` to a project-relative file.
fn import_path(project_file: &str) -> String {
    format!("../../{project_file}")
}

pub fn generate_for(info: &reflow_project::ProjectInfo) -> GeneratedApp {
    generate_with_entry(&info.compositions, info.entry_point.as_deref())
}

pub fn generate(compositions: &[Composition]) -> GeneratedApp {
    generate_with_entry(compositions, None)
}

/// `entry` is the project's own entry file (it calls `registerRoot`); importing it lets the runtime
/// render the user's real Root to read true composition metadata.
pub fn generate_with_entry(compositions: &[Composition], entry: Option<&str>) -> GeneratedApp {
    let mut imports = String::new();
    if let Some(e) = entry {
        imports.push_str(&format!("import {};
", js_string(&import_path(e))));
    }
    let mut entries = String::new();
    let mut skipped = vec![];

    for (i, c) in compositions.iter().enumerate() {
        let Some(r) = &c.component_ref else {
            skipped.push(Skipped {
                id: c.id.clone(),
                reason: if c.component.is_some() {
                    "its component could not be located (is it imported from a relative path?)".into()
                } else {
                    "it does not use a plain `component={Name}` prop".into()
                },
            });
            continue;
        };
        let module = format!("M{i}");
        imports.push_str(&format!("import * as {module} from {};\n", js_string(&import_path(&r.file))));
        let component = match &r.export {
            Some(name) => format!("{module}[{}]", js_string(name)),
            None => format!("{module}.default"),
        };
        let estimated = c.width.is_none() || c.height.is_none() || c.fps.is_none() || c.duration_in_frames.is_none();
        entries.push_str(&format!(
            "  {}: {{ component: {component}, width: {}, height: {}, fps: {}, durationInFrames: {}, estimated: {estimated}, still: {}, defaultProps: {} }},\n",
            js_string(&c.id),
            c.width.unwrap_or(DEFAULT_WIDTH),
            c.height.unwrap_or(DEFAULT_HEIGHT),
            c.fps.unwrap_or(DEFAULT_FPS),
            c.duration_in_frames.unwrap_or(DEFAULT_DURATION),
            c.is_still,
            c.default_props.as_ref().map_or("{}".to_string(), |v| v.to_string()),
        ));
    }

    let registry = format!("{imports}\nexport const registry: Record<string, any> = {{\n{entries}}};\n");
    GeneratedApp {
        files: vec![
            (".gitignore", "*\n".to_string()),
            ("index.html", INDEX_HTML.to_string()),
            ("registry.ts", registry),
            ("main.tsx", MAIN_TSX.to_string()),
            ("vite.config.mjs", VITE_CONFIG.to_string()),
        ],
        skipped,
    }
}

/// Writes only files whose content changed, so Vite does not reload needlessly.
pub fn write(root: &Path, app: &GeneratedApp) -> std::io::Result<PathBuf> {
    let dir = root.join(APP_DIR);
    std::fs::create_dir_all(&dir)?;
    // `.reflow/.gitignore` keeps the whole generated folder out of the user's repo.
    std::fs::write(root.join(".reflow").join(".gitignore"), "*\n")?;
    for (name, content) in &app.files {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(content.as_str()) {
            std::fs::write(path, content)?;
        }
    }
    Ok(dir)
}

const INDEX_HTML: &str = r##"<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>ReFlow preview</title>
    <style>html,body,#root{margin:0;height:100%;background:#0e0f11;overflow:hidden}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
"##;

const MAIN_TSX: &str = include_str!("../preview-runtime/main.tsx");
const VITE_CONFIG: &str = include_str!("../preview-runtime/vite.config.mjs");

#[cfg(test)]
mod tests {
    use super::*;
    use reflow_project::ComponentRef;

    fn comp(id: &str, file: Option<&str>, export: Option<&str>) -> Composition {
        Composition {
            id: id.into(),
            width: Some(1280),
            height: Some(720),
            fps: Some(24.0),
            duration_in_frames: Some(48),
            duration_seconds: Some(2.0),
            is_still: false,
            file: "src/Root.tsx".into(),
            line: 1,
            component: Some("X".into()),
            layers: vec![],
            animations: vec![],
            default_props: None,
            metadata: None,
            component_ref: file.map(|f| ComponentRef { file: f.into(), export: export.map(String::from) }),
        }
    }

    #[test]
    fn registry_imports_named_and_default_components() {
        let app = generate(&[comp("A", Some("src/A.tsx"), Some("A")), comp("B", Some("src/B.tsx"), None)]);
        let registry = &app.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1;
        assert!(registry.contains(r#"import * as M0 from "../../src/A.tsx";"#));
        assert!(registry.contains(r#""A": { component: M0["A"], width: 1280, height: 720, fps: 24, durationInFrames: 48, estimated: false, still: false, defaultProps: {} }"#));
        assert!(registry.contains("component: M1.default"));
        assert!(app.skipped.is_empty());
    }

    #[test]
    fn the_project_entry_is_imported_first_so_registerroot_runs() {
        let app = generate_with_entry(&[], Some("src/index.ts"));
        let registry = &app.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1;
        assert!(registry.starts_with("import \"../../src/index.ts\";"));
        let none = generate(&[]);
        assert!(!none.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1.contains("index.ts"));
    }

    #[test]
    fn unresolvable_components_are_skipped_with_reason() {
        let mut dynamic = comp("C", None, None);
        dynamic.component = None;
        let app = generate(&[comp("A", None, None), dynamic]);
        assert_eq!(app.skipped.len(), 2);
        assert!(app.skipped[0].reason.contains("could not be located"));
        assert!(app.skipped[1].reason.contains("plain"));
        let registry = &app.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1;
        assert!(!registry.contains("component:"));
    }

    #[test]
    fn unknown_metadata_falls_back_and_is_flagged_estimated() {
        let mut c = comp("D", Some("src/D.tsx"), Some("D"));
        c.width = None;
        c.duration_in_frames = None;
        let app = generate(&[c]);
        let registry = &app.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1;
        assert!(registry.contains("width: 1920"));
        assert!(registry.contains("durationInFrames: 150"));
        assert!(registry.contains("estimated: true"));
    }

    #[test]
    fn ids_are_escaped_in_generated_code() {
        let app = generate(&[comp("a\"b", Some("src/A.tsx"), Some("A"))]);
        let registry = &app.files.iter().find(|(n, _)| *n == "registry.ts").unwrap().1;
        assert!(registry.contains(r#""a\"b":"#));
    }

    #[test]
    fn write_is_idempotent_and_gitignores_itself() {
        let d = tempfile::tempdir().unwrap();
        let app = generate(&[]);
        let dir = write(d.path(), &app).unwrap();
        let m1 = std::fs::metadata(dir.join("registry.ts")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(d.path(), &app).unwrap();
        let m2 = std::fs::metadata(dir.join("registry.ts")).unwrap().modified().unwrap();
        assert_eq!(m1, m2);
        assert_eq!(std::fs::read_to_string(d.path().join(".reflow/.gitignore")).unwrap(), "*\n");
    }
}
