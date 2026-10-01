//! Source patching: visual edits become minimal text edits of the user's own file.
//! The file stays human-authored; only the touched attribute / property value changes.

use std::ops::Range;

use serde::Deserialize;
use serde_json::Value;

use crate::literal::{mask_comments, object_entries, skip_value, to_js};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Edit {
    /// Set `name={expr}` on the `<tag>` element whose `<` is on `line` (1-based).
    SetAttribute { tag: String, line: u32, name: String, expr: String },
    /// Set `key` inside the `defaultProps={{…}}` of the `<Composition>`/`<Still>` on `line`.
    SetDefaultProp { line: u32, key: String, value: Value },
    /// Change the time and/or value of keyframe `index` of the `interpolate()` call on `line`.
    SetKeyframe { line: u32, index: usize, frame: Option<f64>, value: Option<f64> },
    InsertKeyframe { line: u32, frame: f64, value: f64 },
    RemoveKeyframe { line: u32, index: usize },
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PatchError {
    #[error("element <{0}> not found on line {1}")]
    ElementNotFound(String, u32),
    #[error("{0} is not a literal object and cannot be edited visually")]
    NotLiteral(String),
    #[error("malformed element")]
    Malformed,
}

#[derive(Debug)]
struct Attr {
    name: String,
    /// whole `name=value`
    whole: Range<usize>,
    /// range of the expression: inside the braces, or the quoted string including quotes
    value: Option<Range<usize>>,
    braced: bool,
}

pub fn apply_edit(source: &str, edit: &Edit) -> Result<String, PatchError> {
    match edit {
        Edit::SetAttribute { tag, line, name, expr } => set_attribute(source, tag, *line, name, expr),
        Edit::SetDefaultProp { line, key, value } => set_default_prop(source, *line, key, value),
        Edit::SetKeyframe { line, index, frame, value } => {
            use crate::animation::{edit_keyframes, KeyframeEdit};
            edit_keyframes(source, *line, &KeyframeEdit::Set { index: *index, frame: *frame, value: *value })
        }
        Edit::InsertKeyframe { line, frame, value } => {
            use crate::animation::{edit_keyframes, KeyframeEdit};
            edit_keyframes(source, *line, &KeyframeEdit::Insert { frame: *frame, value: *value })
        }
        Edit::RemoveKeyframe { line, index } => {
            use crate::animation::{edit_keyframes, KeyframeEdit};
            edit_keyframes(source, *line, &KeyframeEdit::Remove { index: *index })
        }
    }
}

/// Byte range of the attribute list of the `<tag` on `line`.
fn locate(masked: &str, tag: &str, line: u32) -> Result<Range<usize>, PatchError> {
    let nf = || PatchError::ElementNotFound(tag.to_string(), line);
    let line_start: usize = masked
        .split_inclusive('\n')
        .take(line.saturating_sub(1) as usize)
        .map(str::len)
        .sum();
    let rest = &masked[line_start..];
    let needle = format!("<{tag}");
    let mut from = 0;
    let at = loop {
        let p = rest[from..].find(&needle).ok_or_else(nf)? + from;
        // must be on that line and followed by a non-identifier char
        if rest[..p].contains('\n') {
            return Err(nf());
        }
        let next = rest.as_bytes().get(p + needle.len()).copied().unwrap_or(b' ');
        if !(next.is_ascii_alphanumeric() || next == b'_') {
            break p;
        }
        from = p + needle.len();
    };
    let start = line_start + at + needle.len();
    let b = masked.as_bytes();
    let (mut depth, mut i) = (0i32, start);
    while i < b.len() {
        match b[i] {
            q @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while i < b.len() && b[i] != q {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b'>' if depth == 0 => {
                let end = if masked[start..i].ends_with('/') { i - 1 } else { i };
                return Ok(start..end);
            }
            _ => {}
        }
        i += 1;
    }
    Err(PatchError::Malformed)
}

fn matching_brace(b: &[u8], open: usize) -> Option<usize> {
    let (mut depth, mut i) = (0i32, open);
    while i < b.len() {
        match b[i] {
            q @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while i < b.len() && b[i] != q {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn attributes(masked: &str, range: Range<usize>) -> Vec<Attr> {
    let b = masked.as_bytes();
    let mut out = vec![];
    let mut i = range.start;
    while i < range.end {
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i] == b'{' {
            // spread attribute
            i = matching_brace(b, i).map_or(range.end, |e| e + 1);
            continue;
        }
        let name_start = i;
        while i < range.end && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$' | b'-' | b':')) {
            i += 1;
        }
        if i == name_start {
            i += 1;
            continue;
        }
        let name = masked[name_start..i].to_string();
        let mut j = i;
        while j < range.end && b[j].is_ascii_whitespace() {
            j += 1;
        }
        if b.get(j) != Some(&b'=') {
            out.push(Attr { name, whole: name_start..i, value: None, braced: false });
            continue;
        }
        j += 1;
        while j < range.end && b[j].is_ascii_whitespace() {
            j += 1;
        }
        match b.get(j) {
            Some(b'{') => {
                let Some(close) = matching_brace(b, j) else { break };
                out.push(Attr { name, whole: name_start..close + 1, value: Some(j + 1..close), braced: true });
                i = close + 1;
            }
            Some(&q) if q == b'"' || q == b'\'' => {
                let mut e = j + 1;
                while e < range.end && b[e] != q {
                    e += 1;
                }
                out.push(Attr { name, whole: name_start..e + 1, value: Some(j..e + 1), braced: false });
                i = e + 1;
            }
            _ => {
                let e = skip_value(b, j).unwrap_or(range.end).min(range.end);
                out.push(Attr { name, whole: name_start..e, value: Some(j..e), braced: false });
                i = e.max(j + 1);
            }
        }
    }
    out
}

fn set_attribute(source: &str, tag: &str, line: u32, name: &str, expr: &str) -> Result<String, PatchError> {
    let masked = mask_comments(source);
    let range = locate(&masked, tag, line)?;
    let attrs = attributes(&masked, range.clone());
    let mut out = source.to_string();

    if let Some(a) = attrs.iter().find(|a| a.name == name) {
        match (&a.value, a.braced) {
            (Some(v), true) => out.replace_range(v.clone(), &format!(" {expr} ").replace("  ", " ").trim().to_string()),
            (Some(v), false) => out.replace_range(v.clone(), &format!("{{{expr}}}")),
            (None, _) => out.replace_range(a.whole.clone(), &format!("{name}={{{expr}}}")),
        }
        return Ok(out);
    }

    // insert after the last attribute, matching multi-line layout
    let multiline = masked[range.clone()].contains('\n');
    match attrs.last() {
        Some(last) => {
            let at = last.whole.end;
            let insert = if multiline {
                let line_start = masked[..last.whole.start].rfind('\n').map_or(0, |p| p + 1);
                let indent: String = masked[line_start..last.whole.start].chars().take_while(|c| c.is_whitespace()).collect();
                format!("\n{indent}{name}={{{expr}}}")
            } else {
                format!(" {name}={{{expr}}}")
            };
            out.insert_str(at, &insert);
        }
        None => out.insert_str(range.start, &format!(" {name}={{{expr}}}")),
    }
    Ok(out)
}

fn set_default_prop(source: &str, line: u32, key: &str, value: &Value) -> Result<String, PatchError> {
    let masked = mask_comments(source);
    let range = ["Composition", "Still"]
        .iter()
        .find_map(|t| locate(&masked, t, line).ok().map(|r| (*t, r)))
        .ok_or_else(|| PatchError::ElementNotFound("Composition".into(), line))?;
    let (tag, range) = range;
    let attrs = attributes(&masked, range);
    let literal = to_js(value);

    let Some(dp) = attrs.iter().find(|a| a.name == "defaultProps") else {
        return set_attribute(source, tag, line, "defaultProps", &format!("{{ {key}: {literal} }}"));
    };
    let inner = dp.value.clone().filter(|_| dp.braced).ok_or_else(|| PatchError::NotLiteral("defaultProps".into()))?;
    let open = default_props_object(&masked, &inner)?;
    let (entries, close) = object_entries(&masked, open).ok_or_else(|| PatchError::NotLiteral("defaultProps".into()))?;

    let mut out = source.to_string();
    if let Some(e) = entries.iter().find(|e| e.key == key) {
        out.replace_range(e.value.clone(), &literal);
    } else if let Some(last) = entries.last() {
        out.insert_str(last.value.end, &format!(", {key}: {literal}"));
    } else {
        out.replace_range(open..close + 1, &format!("{{ {key}: {literal} }}"));
    }
    Ok(out)
}


/// Byte index of the `{` of the object literal that supplies `defaultProps`: either written inline
/// (`defaultProps={{ … }}`) or declared in the same file (`const defaults: Props = { … }`).
fn default_props_object(masked: &str, inner: &Range<usize>) -> Result<usize, PatchError> {
    let nl = || PatchError::NotLiteral("defaultProps".into());
    let text = masked[inner.clone()].trim();
    if text.starts_with('{') {
        return masked[inner.clone()].find('{').map(|p| inner.start + p).ok_or_else(nl);
    }
    let is_ident = !text.is_empty() && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if !is_ident {
        return Err(nl());
    }
    let re = regex::Regex::new(&format!(r"(?:const|let|var)\s+{}\b\s*(?::[^=;]+)?=\s*\{{", regex::escape(text))).map_err(|_| nl())?;
    let m = re.find(masked).ok_or_else(nl)?;
    Ok(m.end() - 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn attr(tag: &str, line: u32, name: &str, expr: &str) -> Edit {
        Edit::SetAttribute { tag: tag.into(), line, name: name.into(), expr: expr.into() }
    }

    #[test]
    fn replaces_braced_attribute_value() {
        let src = "<Composition id=\"A\" width={1920} height={1080} />";
        let out = apply_edit(src, &attr("Composition", 1, "width", "1280")).unwrap();
        assert_eq!(out, "<Composition id=\"A\" width={1280} height={1080} />");
    }

    #[test]
    fn replaces_expression_values_and_quoted_values() {
        let src = "<Composition id=\"A\" fps={FPS} durationInFrames=\"90\" />";
        let out = apply_edit(src, &attr("Composition", 1, "fps", "24")).unwrap();
        assert!(out.contains("fps={24}"));
        let out = apply_edit(&out, &attr("Composition", 1, "durationInFrames", "120")).unwrap();
        assert!(out.contains("durationInFrames={120}"));
    }

    #[test]
    fn inserts_missing_attribute_inline_and_multiline() {
        let out = apply_edit("<Sequence from={0}><A/></Sequence>", &attr("Sequence", 1, "durationInFrames", "30")).unwrap();
        assert_eq!(out, "<Sequence from={0} durationInFrames={30}><A/></Sequence>");
        let src = "const x = 1;\n<Sequence\n  from={5}\n  name=\"T\"\n>\n  <A/>\n</Sequence>";
        let out = apply_edit(src, &attr("Sequence", 2, "durationInFrames", "30")).unwrap();
        assert!(out.contains("  name=\"T\"\n  durationInFrames={30}\n>"), "{out}");
    }

    #[test]
    fn targets_the_right_line_and_does_not_confuse_prefixes() {
        let src = "<SequenceGroup from={1}/>\n<Sequence from={2} />\n<Sequence from={3} />";
        let out = apply_edit(src, &attr("Sequence", 3, "from", "9")).unwrap();
        assert_eq!(out, "<SequenceGroup from={1}/>\n<Sequence from={2} />\n<Sequence from={9} />");
        assert!(matches!(apply_edit(src, &attr("Sequence", 1, "from", "9")), Err(PatchError::ElementNotFound(..))));
    }

    #[test]
    fn comments_do_not_confuse_patching_and_are_preserved() {
        let src = "// <Composition id=\"x\" width={1} />\n<Composition id=\"A\" /* w */ width={10} />";
        let out = apply_edit(src, &attr("Composition", 2, "width", "20")).unwrap();
        assert_eq!(out, "// <Composition id=\"x\" width={1} />\n<Composition id=\"A\" /* w */ width={20} />");
    }

    #[test]
    fn arrow_functions_in_props_do_not_end_the_tag() {
        let src = "<Composition id=\"A\" calculateMetadata={async () => ({ x: 1 })} width={5} />";
        let out = apply_edit(src, &attr("Composition", 1, "width", "6")).unwrap();
        assert!(out.ends_with("width={6} />"));
    }

    #[test]
    fn default_props_replace_insert_and_create() {
        let src = "<Composition id=\"A\" defaultProps={{ title: \"Hi\", opacity: 1 }} width={1} />";
        let set = |s: &str, k: &str, v: Value| apply_edit(s, &Edit::SetDefaultProp { line: 1, key: k.into(), value: v }).unwrap();
        let a = set(src, "opacity", json!(0.5));
        assert!(a.contains("opacity: 0.5 }}"), "{a}");
        let b = set(&a, "pos", json!({"x": 1, "y": 2}));
        assert!(b.contains("opacity: 0.5, pos: { x: 1, y: 2 } }}"), "{b}");
        let c = set("<Composition id=\"A\" width={1} />", "title", json!("New"));
        assert_eq!(c, "<Composition id=\"A\" width={1} defaultProps={{ title: \"New\" }} />");
        let d = set("<Composition id=\"A\" defaultProps={{}} />", "n", json!(3));
        assert_eq!(d, "<Composition id=\"A\" defaultProps={{ n: 3 }} />");
    }

    #[test]
    fn default_props_declared_as_a_variable_are_patched_at_the_declaration() {
        let src = "const defaults: AdProps = { music: \"a.wav\", volume: 0.85, voiceover: null };

export const Root = () => (
  <Composition id=\"Ad\" component={Ad} defaultProps={defaults} />
);
";
        let set = |k: &str, v: Value| apply_edit(src, &Edit::SetDefaultProp { line: 4, key: k.into(), value: v }).unwrap();
        let a = set("volume", json!(0.4));
        assert!(a.contains("volume: 0.4, voiceover: null }"), "{a}");
        assert!(a.contains("defaultProps={defaults}"), "the element is untouched");
        let b = set("sfx", json!(true));
        assert!(b.contains("voiceover: null, sfx: true }"), "{b}");
        assert_eq!(read_default_props(src, 4), Some(json!({"music":"a.wav","volume":0.85,"voiceover":null})));
    }

    #[test]
    fn variables_that_are_not_object_literals_are_still_refused() {
        let src = "const defaults = makeDefaults();
<Composition id=\"A\" defaultProps={defaults} />";
        let r = apply_edit(src, &Edit::SetDefaultProp { line: 2, key: "a".into(), value: json!(1) });
        assert!(matches!(r, Err(PatchError::NotLiteral(_))));
        let imported = "<Composition id=\"A\" defaultProps={elsewhere} />";
        assert!(apply_edit(imported, &Edit::SetDefaultProp { line: 1, key: "a".into(), value: json!(1) }).is_err());
    }

    #[test]
    fn non_literal_default_props_are_refused() {
        let src = "<Composition id=\"A\" defaultProps={props} />";
        let r = apply_edit(src, &Edit::SetDefaultProp { line: 1, key: "a".into(), value: json!(1) });
        assert!(matches!(r, Err(PatchError::NotLiteral(_))));
    }

    #[test]
    fn edit_deserialises_from_ipc_json() {
        let e: Edit = serde_json::from_value(json!({"kind":"setAttribute","tag":"Sequence","line":3,"name":"from","expr":"4"})).unwrap();
        assert!(matches!(e, Edit::SetAttribute { .. }));
        let e: Edit = serde_json::from_value(json!({"kind":"setDefaultProp","line":1,"key":"a","value":2})).unwrap();
        assert!(matches!(e, Edit::SetDefaultProp { .. }));
    }
}

/// `defaultProps` of the `<Composition>`/`<Still>` on `line`, if it is a plain literal.
pub fn read_default_props(source: &str, line: u32) -> Option<Value> {
    let masked = mask_comments(source);
    let range = ["Composition", "Still"].iter().find_map(|t| locate(&masked, t, line).ok())?;
    let dp = attributes(&masked, range).into_iter().find(|a| a.name == "defaultProps")?;
    let inner = dp.value.filter(|_| dp.braced)?;
    let open = default_props_object(&masked, &inner).ok()?;
    let (_, close) = object_entries(&masked, open)?;
    crate::literal::parse_value(&source[open..=close])
}

/// The `motionMetadata` object exported by a component file, if it is a plain literal.
pub fn read_motion_metadata(source: &str) -> Option<Value> {
    let masked = mask_comments(source);
    let re = regex::Regex::new(r"\bmotionMetadata\b\s*(?::[^=]+)?=\s*\{").ok()?;
    let m = re.find(&masked)?;
    let open = m.end() - 1;
    let (_, close) = object_entries(&masked, open)?;
    crate::literal::parse_value(&source[open..=close])
}

#[cfg(test)]
mod read_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_default_props_and_metadata() {
        let src = "<Composition id=\"A\" defaultProps={{ title: 'Hi', n: 2 }} />";
        assert_eq!(read_default_props(src, 1), Some(json!({"title":"Hi","n":2})));
        assert_eq!(read_default_props("<Composition id=\"A\" defaultProps={p} />", 1), None);
        let meta = "export const motionMetadata = {\n  editable: { opacity: { type: 'number', min: 0, max: 1 } }\n};";
        assert_eq!(read_motion_metadata(meta), Some(json!({"editable":{"opacity":{"type":"number","min":0,"max":1}}})));
        assert_eq!(read_motion_metadata("const x = 1"), None);
        let typed = "export const motionMetadata: MotionMetadata = { editable: {} } as const;";
        assert_eq!(read_motion_metadata(typed), None.or(Some(json!({"editable":{}}))));
    }
}

#[cfg(test)]
mod keyframe_edit_tests {
    use super::*;

    #[test]
    fn keyframe_edits_deserialise_and_apply() {
        let src = "const o = interpolate(frame, [0, 30], [0, 1]);";
        let e: Edit = serde_json::from_value(serde_json::json!({"kind":"setKeyframe","line":1,"index":1,"frame":45,"value":null})).unwrap();
        assert_eq!(apply_edit(src, &e).unwrap(), "const o = interpolate(frame, [0, 45], [0, 1]);");
        let e: Edit = serde_json::from_value(serde_json::json!({"kind":"insertKeyframe","line":1,"frame":15,"value":0.5})).unwrap();
        assert_eq!(apply_edit(src, &e).unwrap(), "const o = interpolate(frame, [0, 15, 30], [0, 0.5, 1]);");
        let e: Edit = serde_json::from_value(serde_json::json!({"kind":"removeKeyframe","line":1,"index":0})).unwrap();
        assert!(apply_edit(src, &e).is_err(), "two keyframes is the minimum");
    }
}
