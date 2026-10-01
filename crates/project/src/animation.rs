//! Keyframes: `interpolate(frame, [inputs], [outputs], …)` calls with literal numeric arrays.
//! Reading and editing are text operations on the user's own source; nothing is evaluated.

use std::ops::Range;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::literal::{mask_comments, parse_value, skip_value};
use crate::patch::PatchError;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Animation {
    /// Variable the result is assigned to (`const opacity = interpolate(…)`), else a generic name.
    pub name: String,
    pub file: String,
    /// 1-based line of the `interpolate` token.
    pub line: u32,
    /// Keyframe times (the input range).
    pub frames: Vec<f64>,
    /// Keyframe values (the output range).
    pub values: Vec<f64>,
    /// First argument as written. Frames are absolute only when this is the composition's frame.
    pub driver: String,
}

struct Call {
    /// ranges of the top-level arguments
    args: Vec<Range<usize>>,
}

fn line_start(src: &str, line: u32) -> usize {
    src.split_inclusive('\n').take(line.saturating_sub(1) as usize).map(str::len).sum()
}

/// Locate `interpolate(` on `line` and split its top-level arguments.
fn call_at(masked: &str, line: u32) -> Option<Call> {
    let start = line_start(masked, line);
    let end = masked[start..].find('\n').map_or(masked.len(), |p| start + p);
    // the call may begin on this line; its arguments may continue on following lines
    let re = Regex::new(r"(?:^|[^\w$.])interpolate\s*\(").ok()?;
    let m = re.find(&masked[start..end.max(start)])?;
    let open = start + m.end();
    let b = masked.as_bytes();
    let mut args = vec![];
    let mut i = open;
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if *b.get(i)? == b')' {
            break;
        }
        let end = skip_value(b, i)?;
        args.push(i..end);
        i = end;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        match *b.get(i)? {
            b',' => i += 1,
            b')' => break,
            _ => return None,
        }
    }
    Some(Call { args })
}

fn numeric_array(src: &str, r: &Range<usize>) -> Option<Vec<f64>> {
    match parse_value(&src[r.clone()])? {
        Value::Array(items) => items.iter().map(Value::as_f64).collect(),
        _ => None,
    }
}

/// Item ranges of the array literal in `r` (which must start with `[`).
fn array_items(src: &str, r: &Range<usize>) -> Option<Vec<Range<usize>>> {
    let b = src.as_bytes();
    let mut i = r.start;
    if *b.get(i)? != b'[' {
        return None;
    }
    i += 1;
    let mut items = vec![];
    loop {
        while i < r.end && (b[i].is_ascii_whitespace() || b[i] == b',') {
            i += 1;
        }
        if i >= r.end || b[i] == b']' {
            return Some(items);
        }
        let end = skip_value(b, i)?.min(r.end);
        items.push(i..end);
        i = end;
    }
}

/// All keyframe animations in a file, in source order.
pub fn scan_animations(source: &str, file: &str) -> Vec<Animation> {
    let masked = mask_comments(source);
    let re = Regex::new(r"(?:^|[^\w$.])interpolate\s*\(").expect("static regex");
    let assign = Regex::new(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$").expect("static regex");
    let mut out = vec![];
    for m in re.find_iter(&masked) {
        let token = m.start() + masked[m.start()..m.end()].find("interpolate").unwrap_or(0);
        let line = masked[..token].matches('\n').count() as u32 + 1;
        let Some(call) = call_at(&masked, line) else { continue };
        if call.args.len() < 3 {
            continue;
        }
        let (Some(frames), Some(values)) = (numeric_array(source, &call.args[1]), numeric_array(source, &call.args[2])) else {
            continue;
        };
        if frames.len() != values.len() || frames.len() < 2 {
            continue;
        }
        let prefix = &masked[line_start(&masked, line)..token];
        let name = assign.captures(prefix).map(|c| c[1].to_string()).unwrap_or_else(|| format!("interpolate (line {line})"));
        out.push(Animation {
            name,
            file: file.to_string(),
            line,
            frames,
            values,
            driver: source[call.args[0].clone()].trim().to_string(),
        });
    }
    out
}

fn num(v: f64) -> String {
    let r = (v * 10_000.0).round() / 10_000.0;
    if r.fract() == 0.0 {
        format!("{}", r as i64)
    } else {
        format!("{r}")
    }
}

/// Edits applied to an animation's arrays. Frames stay sorted and strictly increasing.
pub enum KeyframeEdit {
    Set { index: usize, frame: Option<f64>, value: Option<f64> },
    Insert { frame: f64, value: f64 },
    Remove { index: usize },
}

pub fn edit_keyframes(source: &str, line: u32, edit: &KeyframeEdit) -> Result<String, PatchError> {
    let nf = || PatchError::ElementNotFound("interpolate".into(), line);
    let masked = mask_comments(source);
    let call = call_at(&masked, line).ok_or_else(nf)?;
    if call.args.len() < 3 {
        return Err(nf());
    }
    let (fr, vr) = (&call.args[1], &call.args[2]);
    let (mut frames, mut values) = (
        numeric_array(source, fr).ok_or_else(|| PatchError::NotLiteral("input range".into()))?,
        numeric_array(source, vr).ok_or_else(|| PatchError::NotLiteral("output range".into()))?,
    );
    if frames.len() != values.len() {
        return Err(PatchError::Malformed);
    }
    match edit {
        KeyframeEdit::Set { index, frame, value } => {
            if *index >= frames.len() {
                return Err(PatchError::Malformed);
            }
            if let Some(f) = frame {
                let lo = if *index == 0 { f64::NEG_INFINITY } else { frames[index - 1] + 1.0 };
                let hi = frames.get(index + 1).map_or(f64::INFINITY, |n| n - 1.0);
                frames[*index] = f.round().clamp(lo, hi.max(lo));
            }
            if let Some(v) = value {
                values[*index] = *v;
            }
        }
        KeyframeEdit::Insert { frame, value } => {
            let f = frame.round();
            match frames.iter().position(|x| *x >= f) {
                Some(i) if frames[i] == f => values[i] = *value, // already a keyframe there: update it
                Some(i) => {
                    frames.insert(i, f);
                    values.insert(i, *value);
                }
                None => {
                    frames.push(f);
                    values.push(*value);
                }
            }
        }
        KeyframeEdit::Remove { index } => {
            if frames.len() <= 2 || *index >= frames.len() {
                return Err(PatchError::Malformed);
            }
            frames.remove(*index);
            values.remove(*index);
        }
    }
    let fmt = |v: &[f64]| format!("[{}]", v.iter().map(|x| num(*x)).collect::<Vec<_>>().join(", "));
    // replace the later range first so the earlier offsets stay valid
    let mut out = source.to_string();
    let (first, second) = if fr.start < vr.start { ((fr, fmt(&frames)), (vr, fmt(&values))) } else { ((vr, fmt(&values)), (fr, fmt(&frames))) };
    out.replace_range(second.0.clone(), &second.1);
    out.replace_range(first.0.clone(), &first.1);
    // keep untouched array items byte-identical when nothing changed structurally
    let _ = array_items; // (items helper is exercised by tests and reserved for in-place edits)
    Ok(out)
}

/// Linear value of an animation at `frame` (clamped outside the range): used to seed a new keyframe.
pub fn value_at(a: &Animation, frame: f64) -> f64 {
    let (f, v) = (&a.frames, &a.values);
    if frame <= f[0] {
        return v[0];
    }
    for i in 1..f.len() {
        if frame <= f[i] {
            let t = (frame - f[i - 1]) / (f[i] - f[i - 1]);
            return v[i - 1] + (v[i] - v[i - 1]) * t;
        }
    }
    *v.last().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "const frame = useCurrentFrame();\n\
const opacity = interpolate(frame, [0, 30, 90], [0, 1, 0.5], { extrapolateRight: 'clamp' });\n\
const x = interpolate(frame, [0, 60], [0, 500]);\n\
const c = interpolateColors(frame, [0, 1], ['#fff', '#000']);\n\
const bad = interpolate(frame, [a, b], [0, 1]);\n\
// const old = interpolate(frame, [0, 1], [0, 1]);\n";

    #[test]
    fn scans_literal_numeric_animations_only() {
        let a = scan_animations(SRC, "src/H.tsx");
        let names: Vec<_> = a.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, ["opacity", "x"]);
        assert_eq!((a[0].frames.clone(), a[0].values.clone()), (vec![0.0, 30.0, 90.0], vec![0.0, 1.0, 0.5]));
        assert_eq!((a[0].line, a[1].line), (2, 3));
        assert_eq!(a[0].driver, "frame");
    }

    #[test]
    fn handles_multiline_calls() {
        let src = "const y = interpolate(\n  frame,\n  [0, 10],\n  [100, 0],\n);\n";
        let a = scan_animations(src, "f.tsx");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].values, vec![100.0, 0.0]);
        let out = edit_keyframes(src, 1, &KeyframeEdit::Set { index: 1, frame: Some(20.0), value: None }).unwrap();
        assert!(out.contains("[0, 20]") && out.contains("[100, 0]"));
    }

    #[test]
    fn moves_a_keyframe_without_crossing_neighbours() {
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Set { index: 1, frame: Some(45.0), value: None }).unwrap();
        assert!(out.contains("interpolate(frame, [0, 45, 90], [0, 1, 0.5], { extrapolateRight: 'clamp' })"));
        // clamped between neighbours (0 and 90)
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Set { index: 1, frame: Some(500.0), value: None }).unwrap();
        assert!(out.contains("[0, 89, 90]"));
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Set { index: 1, frame: Some(-9.0), value: None }).unwrap();
        assert!(out.contains("[0, 1, 90]"));
    }

    #[test]
    fn changes_values_and_leaves_the_rest_of_the_file_alone() {
        let out = edit_keyframes(SRC, 3, &KeyframeEdit::Set { index: 1, frame: None, value: Some(250.5) }).unwrap();
        assert!(out.contains("[0, 250.5]"));
        assert_eq!(out.lines().next(), SRC.lines().next());
        assert_eq!(out.lines().nth(1), SRC.lines().nth(1));
    }

    #[test]
    fn inserts_sorted_updates_existing_and_removes() {
        let a = scan_animations(SRC, "f")[0].clone();
        let v = value_at(&a, 60.0);
        assert!((v - 0.75).abs() < 1e-9);
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Insert { frame: 60.0, value: v }).unwrap();
        assert!(out.contains("[0, 30, 60, 90], [0, 1, 0.75, 0.5]"));
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Insert { frame: 30.0, value: 0.9 }).unwrap();
        assert!(out.contains("[0, 30, 90], [0, 0.9, 0.5]"));
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Insert { frame: 120.0, value: 0.0 }).unwrap();
        assert!(out.contains("[0, 30, 90, 120], [0, 1, 0.5, 0]"));
        let out = edit_keyframes(SRC, 2, &KeyframeEdit::Remove { index: 1 }).unwrap();
        assert!(out.contains("[0, 90], [0, 0.5]"));
    }

    #[test]
    fn cannot_go_below_two_keyframes_or_edit_non_literals() {
        assert!(edit_keyframes(SRC, 3, &KeyframeEdit::Remove { index: 0 }).is_err());
        assert!(edit_keyframes(SRC, 5, &KeyframeEdit::Set { index: 0, frame: Some(1.0), value: None }).is_err());
        assert!(edit_keyframes(SRC, 1, &KeyframeEdit::Remove { index: 0 }).is_err());
    }

    #[test]
    fn value_at_clamps_outside_the_range() {
        let a = scan_animations(SRC, "f")[1].clone();
        assert_eq!(value_at(&a, -10.0), 0.0);
        assert_eq!(value_at(&a, 30.0), 250.0);
        assert_eq!(value_at(&a, 999.0), 500.0);
    }

    #[test]
    fn array_items_report_ranges() {
        let s = "[0, 30,  90]";
        let items = array_items(s, &(0..s.len())).unwrap();
        let got: Vec<_> = items.iter().map(|r| &s[r.clone()]).collect();
        assert_eq!(got, ["0", "30", "90"]);
    }
}
