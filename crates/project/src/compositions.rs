//! Static discovery of `<Composition>` / `<Still>` elements.
//!
//! This is a deliberately conservative text scan (see docs/dependencies.md). It resolves
//! numeric literals, same-file numeric constants and simple `a * b + c` expressions.
//! Anything dynamic (`calculateMetadata`, imported constants, spreads) is left as `None`
//! rather than guessed.

use std::collections::HashMap;
use std::path::Path;

use regex::Regex;
use serde::Serialize;
use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Composition {
    pub id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub duration_in_frames: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub is_still: bool,
    /// Path relative to the project root, forward slashes.
    pub file: String,
    /// 1-based line of the element.
    pub line: u32,
    /// Identifier passed as `component={X}`, if it is a plain identifier.
    pub component: Option<String>,
    /// Where `component` can be imported from. Filled by `scan_compositions` (needs the filesystem).
    pub component_ref: Option<ComponentRef>,
    /// `<Sequence>` elements found in the component's source file (basic layer model).
    pub layers: Vec<Layer>,
    /// Keyframe animations (`interpolate()` with literal arrays) in the component's file.
    pub animations: Vec<crate::animation::Animation>,
    /// Literal `defaultProps` of the element, if statically readable.
    pub default_props: Option<serde_json::Value>,
    /// `motionMetadata` exported by the component's module (what the inspector may edit).
    pub metadata: Option<serde_json::Value>,
}

/// A `<Sequence>` (time range) found statically in a component file.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Layer {
    pub name: String,
    pub from: u32,
    pub duration_in_frames: Option<u32>,
    pub file: String,
    pub line: u32,
}

/// How to import a composition's component from the project root.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ComponentRef {
    /// Project-relative path of the module, forward slashes, with extension.
    pub file: String,
    /// `None` = default export.
    pub export: Option<String>,
}

/// Scan every source file of the project (excluding `node_modules`).
/// `entry_point` is accepted so a future version can follow imports from it;
/// for now all `src/` files are scanned.
pub fn scan_compositions(root: &Path, _entry_point: Option<&str>) -> Vec<Composition> {
    let src = root.join("src");
    let base = if src.is_dir() { src } else { root.to_path_buf() };
    let mut out = vec![];
    for entry in WalkDir::new(&base)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != ".git")
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "tsx" | "jsx" | "ts" | "js") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let rel = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let mut found = scan_source(&text, &rel);
        for c in &mut found {
            if let Some(ident) = &c.component {
                c.component_ref = resolve_component(root, &rel, &text, ident);
            }
            c.default_props = crate::patch::read_default_props(&text, c.line);
            if let Some(r) = &c.component_ref {
                let src = if r.file == rel { Some(text.clone()) } else { std::fs::read_to_string(root.join(&r.file)).ok() };
                if let Some(src) = src {
                    c.layers = scan_layers(&src, &r.file);
                    c.animations = crate::animation::scan_animations(&src, &r.file);
                    c.metadata = crate::patch::read_motion_metadata(&src);
                }
            }
        }
        out.extend(found);
    }
    out.sort_by(|a, b| (&a.file, a.line).cmp(&(&b.file, b.line)));
    out
}

pub fn scan_source(source: &str, file: &str) -> Vec<Composition> {
    let clean = blank_comments(source);
    let consts = numeric_constants(&clean);
    let tag = Regex::new(r"<(Composition|Still)\b").expect("static regex");
    let attr = Regex::new(
        r#"\b(id|width|height|fps|durationInFrames)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})"#,
    )
    .expect("static regex");

    let component_attr =
        Regex::new(r"\bcomponent\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}").expect("static regex");

    let mut out = vec![];
    for m in tag.captures_iter(&clean) {
        let whole = m.get(0).unwrap();
        let is_still = &m[1] == "Still";
        let Some(attrs) = element_attributes(&clean[whole.end()..]) else {
            continue;
        };

        let mut id = None;
        let mut width = None;
        let mut height = None;
        let mut fps = None;
        let mut duration = None;
        let component = component_attr.captures(attrs).map(|c| c[1].to_string());
        for a in attr.captures_iter(attrs) {
            let quoted = a.get(2).or_else(|| a.get(3)).map(|s| s.as_str());
            let expr = a.get(4).map(|s| s.as_str());
            match &a[1] {
                "id" => id = quoted.map(str::to_string).or_else(|| expr.and_then(string_literal)),
                "width" => width = number(quoted, expr, &consts).map(|v| v as u32),
                "height" => height = number(quoted, expr, &consts).map(|v| v as u32),
                "fps" => fps = number(quoted, expr, &consts),
                "durationInFrames" => duration = number(quoted, expr, &consts).map(|v| v as u32),
                _ => {}
            }
        }
        let Some(id) = id else { continue };
        if is_still {
            duration = Some(1);
        }
        let duration_seconds = match (duration, fps) {
            (Some(d), Some(f)) if f > 0.0 && !is_still => Some(d as f64 / f),
            _ => None,
        };
        out.push(Composition {
            id,
            width,
            height,
            fps,
            duration_in_frames: duration,
            duration_seconds,
            is_still,
            file: file.to_string(),
            line: clean[..whole.start()].matches('\n').count() as u32 + 1,
            component,
            component_ref: None,
            layers: vec![],
            animations: vec![],
            default_props: None,
            metadata: None,
        });
    }
    out
}

/// Text between the tag name and the closing `>`/`/>`, honouring `{}` nesting and strings.
fn element_attributes(rest: &str) -> Option<&str> {
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    for (i, c) in rest.char_indices() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' | '`' => quote = Some(c),
            '{' => depth += 1,
            '}' => depth -= 1,
            '>' if depth == 0 => return Some(rest[..i].trim_end_matches('/')),
            _ => {}
        }
    }
    None
}

fn string_literal(expr: &str) -> Option<String> {
    let t = expr.trim();
    for q in ['"', '\'', '`'] {
        if t.len() >= 2 && t.starts_with(q) && t.ends_with(q) && !t[1..t.len() - 1].contains("${") {
            return Some(t[1..t.len() - 1].to_string());
        }
    }
    None
}

fn number(quoted: Option<&str>, expr: Option<&str>, consts: &HashMap<String, f64>) -> Option<f64> {
    quoted
        .and_then(|q| q.trim().parse().ok())
        .or_else(|| expr.and_then(|e| eval(e, consts)))
}

/// `a * b + c` with numbers and same-file constants. No parentheses, no division.
/// Pure arithmetic over parsed numbers: this never executes any project code.
fn eval(expr: &str, consts: &HashMap<String, f64>) -> Option<f64> {
    let mut total = 0.0;
    for term in expr.split('+') {
        let mut product = 1.0;
        for factor in term.split('*') {
            let f = factor.trim();
            let v = f.parse::<f64>().ok().or_else(|| consts.get(f).copied())?;
            product *= v;
        }
        total += product;
    }
    Some(total)
}

fn numeric_constants(source: &str) -> HashMap<String, f64> {
    let re = Regex::new(
        r"(?m)^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number)?\s*=\s*([^;\n]+?)\s*;?\s*$",
    )
    .expect("static regex");
    let mut consts = HashMap::new();
    // two passes so constants can refer to earlier ones regardless of order
    for _ in 0..2 {
        for c in re.captures_iter(source) {
            if let Some(v) = eval(&c[2], &consts) {
                consts.insert(c[1].to_string(), v);
            }
        }
    }
    consts
}

/// Replace comments with spaces, preserving newlines so line numbers stay valid.
fn blank_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let b: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut quote: Option<char> = None;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 1;
            } else if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == '/' && b.get(i + 1) == Some(&'/') {
            while i < b.len() && b[i] != '\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if c == '/' && b.get(i + 1) == Some(&'*') {
            while i < b.len() && !(b[i] == '*' && b.get(i + 1) == Some(&'/')) {
                out.push(if b[i] == '\n' { '\n' } else { ' ' });
                i += 1;
            }
            if i < b.len() {
                out.push_str("  ");
                i += 2;
            }
            continue;
        }
        if c == '"' || c == '\'' || c == '`' {
            quote = Some(c);
        }
        out.push(c);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_values() {
        let c = scan_source(
            r#"<Composition id="Main" width={1920} height={1080} fps={30} durationInFrames={150} component={Main} />"#,
            "src/Root.tsx",
        );
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].id, "Main");
        assert_eq!(c[0].width, Some(1920));
        assert_eq!(c[0].height, Some(1080));
        assert_eq!(c[0].fps, Some(30.0));
        assert_eq!(c[0].duration_in_frames, Some(150));
        assert_eq!(c[0].duration_seconds, Some(5.0));
        assert!(!c[0].is_still);
        assert_eq!(c[0].line, 1);
    }

    #[test]
    fn constants_and_expressions() {
        let src = "const FPS = 60;\nexport const W: number = 1080\n\
                   <Composition\n  id=\"A\"\n  width={W}\n  height={W * 2}\n  fps={FPS}\n  durationInFrames={FPS * 2 + 10}\n  component={A}\n/>";
        let c = scan_source(src, "f.tsx");
        assert_eq!(c[0].width, Some(1080));
        assert_eq!(c[0].height, Some(2160));
        assert_eq!(c[0].fps, Some(60.0));
        assert_eq!(c[0].duration_in_frames, Some(130));
        assert_eq!(c[0].line, 3);
    }

    #[test]
    fn nested_braces_in_props_do_not_break_scan() {
        let src = r#"<Composition id="X" component={C} defaultProps={{ title: "a>b", n: {x: 1} }} width={100} height={50} fps={24} durationInFrames={48} />
<Composition id="Y" component={C} width={1} height={1} fps={1} durationInFrames={1} />"#;
        let c = scan_source(src, "f.tsx");
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].width, Some(100));
        assert_eq!(c[1].id, "Y");
    }

    #[test]
    fn stills_have_one_frame() {
        let c = scan_source(r#"<Still id="Thumb" component={T} width={1200} height={630} />"#, "f.tsx");
        assert!(c[0].is_still);
        assert_eq!(c[0].duration_in_frames, Some(1));
        assert_eq!(c[0].duration_seconds, None);
    }

    #[test]
    fn dynamic_values_stay_unknown() {
        let c = scan_source(
            r#"<Composition id="D" component={C} width={imported} height={720} fps={30} calculateMetadata={cm} />"#,
            "f.tsx",
        );
        assert_eq!(c[0].width, None);
        assert_eq!(c[0].height, Some(720));
        assert_eq!(c[0].duration_in_frames, None);
    }

    #[test]
    fn commented_out_compositions_are_ignored() {
        let src = "// <Composition id=\"Old\" />\n/* <Composition id=\"Old2\" /> */\n<Composition id=\"New\" width={1} height={1} fps={1} durationInFrames={1} component={C} />";
        let c = scan_source(src, "f.tsx");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].id, "New");
        assert_eq!(c[0].line, 3);
    }

    #[test]
    fn captures_component_identifier() {
        let c = scan_source(r#"<Composition id="A" component={Hello} width={1} />"#, "f.tsx");
        assert_eq!(c[0].component.as_deref(), Some("Hello"));
        let c = scan_source(r#"<Composition id="A" lazyComponent={() => import("./x")} />"#, "f.tsx");
        assert_eq!(c[0].component, None);
    }

    #[test]
    fn resolves_component_imports() {
        let dir = tempfile::tempdir().unwrap();
        let w = |rel: &str| {
            let p = dir.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "").unwrap();
        };
        w("src/Hello.tsx");
        w("src/scenes/index.ts");
        w("src/shared/Def.jsx");
        let src = "import { Hello } from './Hello';
import { Orig as Alias, type T } from './scenes';
import Def, { Other } from '../src/shared/Def';
export const Local = () => null;
";
        let r = |id: &str| resolve_component(dir.path(), "src/Root.tsx", src, id);
        assert_eq!(r("Hello"), Some(ComponentRef { file: "src/Hello.tsx".into(), export: Some("Hello".into()) }));
        assert_eq!(r("Alias"), Some(ComponentRef { file: "src/scenes/index.ts".into(), export: Some("Orig".into()) }));
        assert_eq!(r("Def"), Some(ComponentRef { file: "src/shared/Def.jsx".into(), export: None }));
        assert_eq!(r("Other"), Some(ComponentRef { file: "src/shared/Def.jsx".into(), export: Some("Other".into()) }));
        assert_eq!(r("Local"), Some(ComponentRef { file: "src/Root.tsx".into(), export: Some("Local".into()) }));
        assert_eq!(r("Missing"), None);
    }

    #[test]
    fn scans_sequences_as_layers() {
        let src = "const D = 30;\n<Sequence from={10} durationInFrames={D * 2} name=\"Title\"><X/></Sequence>\n<Sequence from={D}><Y/></Sequence>\n// <Sequence from={1} />";
        let l = scan_layers(src, "src/A.tsx");
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].name.as_str(), l[0].from, l[0].duration_in_frames), ("Title", 10, Some(60)));
        assert_eq!((l[1].from, l[1].duration_in_frames, l[1].line), (30, None, 3));
        assert!(l[1].name.contains("line 3"));
    }

    #[test]
    fn string_expression_id() {
        let c = scan_source(r#"<Composition id={"Braced"} component={C} />"#, "f.tsx");
        assert_eq!(c[0].id, "Braced");
    }

    #[test]
    fn single_quoted_attributes_and_missing_id() {
        let c = scan_source("<Composition id='Q' width='640' component={C} />\n<Composition component={C} />", "f.tsx");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].width, Some(640));
    }
}

const EXTENSIONS: [&str; 4] = ["tsx", "ts", "jsx", "js"];

/// Find the module that provides `ident` as seen from `file` (project-relative).
/// Handles named, aliased and default relative imports, and components declared in the same file.
pub fn resolve_component(root: &Path, file: &str, source: &str, ident: &str) -> Option<ComponentRef> {
    let clean = blank_comments(source);
    let import = Regex::new(
        r#"import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"](\.[^'"]*)['"]"#,
    )
    .expect("static regex");

    for m in import.captures_iter(&clean) {
        let spec = &m[3];
        let default_name = m.get(1).map(|d| d.as_str());
        let named = m.get(2).map(|n| n.as_str()).unwrap_or("");
        let export = if default_name == Some(ident) {
            Some(None)
        } else {
            named.split(',').find_map(|part| {
                let part = part.trim().trim_start_matches("type ").trim();
                let (orig, local) = match part.split_once(" as ") {
                    Some((o, l)) => (o.trim(), l.trim()),
                    None => (part, part),
                };
                (local == ident && !orig.is_empty()).then(|| Some(orig.to_string()))
            })
        };
        if let Some(export) = export {
            let target = resolve_module(root, file, spec)?;
            return Some(ComponentRef { file: target, export });
        }
    }

    // Declared in this file and exported?
    let decl = Regex::new(&format!(
        r"export\s+(?:const|function|class)\s+{}\b|export\s*\{{[^}}]*\b{}\b[^}}]*\}}",
        regex::escape(ident),
        regex::escape(ident)
    ))
    .ok()?;
    if decl.is_match(&clean) {
        return Some(ComponentRef { file: file.to_string(), export: Some(ident.to_string()) });
    }
    let default_decl = Regex::new(&format!(r"export\s+default\s+(?:function|class)?\s*{}\b", regex::escape(ident))).ok()?;
    default_decl
        .is_match(&clean)
        .then(|| ComponentRef { file: file.to_string(), export: None })
}

fn resolve_module(root: &Path, from_file: &str, spec: &str) -> Option<String> {
    let base = Path::new(from_file).parent().unwrap_or(Path::new(""));
    let mut parts: Vec<String> = vec![];
    for c in base.join(spec).components() {
        match c {
            std::path::Component::ParentDir => {
                parts.pop()?;
            }
            std::path::Component::CurDir => {}
            other => parts.push(other.as_os_str().to_string_lossy().to_string()),
        }
    }
    let joined = parts.join("/");
    let mut candidates = vec![joined.clone()];
    for e in EXTENSIONS {
        candidates.push(format!("{joined}.{e}"));
    }
    for e in EXTENSIONS {
        candidates.push(format!("{joined}/index.{e}"));
    }
    candidates.into_iter().find(|c| Path::new(c).extension().is_some() && root.join(c).is_file())
}

/// `<Sequence from={..} durationInFrames={..} name="..">` elements, in source order.
pub fn scan_layers(source: &str, file: &str) -> Vec<Layer> {
    let clean = blank_comments(source);
    let consts = numeric_constants(&clean);
    let tag = Regex::new(r"<Sequence\b").expect("static regex");
    let attr = Regex::new(
        r#"\b(from|durationInFrames|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})"#,
    )
    .expect("static regex");
    let mut out = vec![];
    for m in tag.find_iter(&clean) {
        let Some(attrs) = element_attributes(&clean[m.end()..]) else { continue };
        let (mut from, mut duration, mut name) = (0u32, None, None);
        for a in attr.captures_iter(attrs) {
            let quoted = a.get(2).or_else(|| a.get(3)).map(|x| x.as_str());
            let expr = a.get(4).map(|x| x.as_str());
            match &a[1] {
                "from" => from = number(quoted, expr, &consts).map(|v| v.max(0.0) as u32).unwrap_or(0),
                "durationInFrames" => duration = number(quoted, expr, &consts).map(|v| v as u32),
                "name" => name = quoted.map(str::to_string).or_else(|| expr.and_then(string_literal)),
                _ => {}
            }
        }
        let line = clean[..m.start()].matches('\n').count() as u32 + 1;
        out.push(Layer {
            name: name.unwrap_or_else(|| format!("Sequence (line {line})")),
            from,
            duration_in_frames: duration,
            file: file.to_string(),
            line,
        });
    }
    out
}
