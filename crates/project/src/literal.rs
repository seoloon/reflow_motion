//! Minimal, span-aware reader for JS/TS literals (objects, arrays, strings, numbers, booleans, null).
//! Used to read `defaultProps` / `motionMetadata` and to patch values in place.
//! It never evaluates anything: unknown expressions simply fail to convert to JSON.

use std::ops::Range;

use serde_json::{Map, Number, Value};

/// Replace comments with spaces, keeping **byte** offsets identical to the input.
pub fn mask_comments(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == b'/' && b.get(i + 1) == Some(&b'/') {
            while i < b.len() && b[i] != b'\n' {
                out[i] = b' ';
                i += 1;
            }
            continue;
        }
        if c == b'/' && b.get(i + 1) == Some(&b'*') {
            while i < b.len() && !(b[i] == b'*' && b.get(i + 1) == Some(&b'/')) {
                if b[i] != b'\n' {
                    out[i] = b' ';
                }
                i += 1;
            }
            if i < b.len() {
                out[i] = b' ';
                out[i + 1] = b' ';
                i += 2;
            }
            continue;
        }
        if matches!(c, b'"' | b'\'' | b'`') {
            quote = Some(c);
        }
        i += 1;
    }
    // only ASCII bytes were overwritten with spaces inside comments; multi-byte chars in comments
    // become runs of spaces, which is valid UTF-8
    String::from_utf8(out).unwrap_or_else(|_| src.to_string())
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// End (exclusive) of the string literal starting at `i`.
fn string_end(b: &[u8], i: usize) -> Option<usize> {
    let q = b[i];
    let mut j = i + 1;
    while j < b.len() {
        if b[j] == b'\\' {
            j += 2;
            continue;
        }
        if b[j] == q {
            return Some(j + 1);
        }
        j += 1;
    }
    None
}

/// End (exclusive) of the expression starting at `i`, stopping at a top-level `,` `}` `]` `)`.
pub fn skip_value(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i;
    let mut depth = 0i32;
    while j < b.len() {
        match b[j] {
            b'"' | b'\'' | b'`' => j = string_end(b, j)? - 1,
            b'{' | b'[' | b'(' => depth += 1,
            b'}' | b']' | b')' => {
                if depth == 0 {
                    return Some(trim_end(b, i, j));
                }
                depth -= 1;
            }
            b',' if depth == 0 => return Some(trim_end(b, i, j)),
            _ => {}
        }
        j += 1;
    }
    (depth == 0).then(|| trim_end(b, i, b.len()))
}

fn trim_end(b: &[u8], start: usize, mut end: usize) -> usize {
    while end > start && b[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    end
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub key: String,
    /// Byte range of the value expression in the source.
    pub value: Range<usize>,
}

/// Entries of the object literal whose `{` is at `open`, plus the index of its closing `}`.
/// Spread elements and shorthand properties are skipped (they cannot be patched in place).
pub fn object_entries(src: &str, open: usize) -> Option<(Vec<Entry>, usize)> {
    let b = src.as_bytes();
    if b.get(open) != Some(&b'{') {
        return None;
    }
    let mut i = open + 1;
    let mut entries = vec![];
    loop {
        i = skip_ws(b, i);
        match b.get(i)? {
            b'}' => return Some((entries, i)),
            b',' => {
                i += 1;
                continue;
            }
            _ => {}
        }
        // key
        let (key, after_key) = if matches!(b[i], b'"' | b'\'') {
            let e = string_end(b, i)?;
            (src[i + 1..e - 1].to_string(), e)
        } else {
            let mut e = i;
            while e < b.len() && (b[e].is_ascii_alphanumeric() || b[e] == b'_' || b[e] == b'$') {
                e += 1;
            }
            (src[i..e].to_string(), e)
        };
        let colon = skip_ws(b, after_key);
        if key.is_empty() || b.get(colon) != Some(&b':') {
            // spread / shorthand / method: skip to the next top-level comma
            i = skip_value(b, i)?;
            continue;
        }
        let vstart = skip_ws(b, colon + 1);
        let vend = skip_value(b, vstart)?;
        entries.push(Entry { key, value: vstart..vend });
        i = vend;
    }
}

/// Convert a whole literal expression to JSON; `None` if it contains anything non-literal.
pub fn parse_value(src: &str) -> Option<Value> {
    let masked = mask_comments(src);
    let t = masked.trim();
    let b = t.as_bytes();
    let (v, end) = parse_at(t, b, 0)?;
    (skip_ws(b, end) == b.len()).then_some(v)
}

fn parse_at(s: &str, b: &[u8], i: usize) -> Option<(Value, usize)> {
    let i = skip_ws(b, i);
    match *b.get(i)? {
        b'{' => {
            let (entries, close) = object_entries(s, i)?;
            // spreads/shorthand would be silently lost: refuse unless every top-level item is a pair
            let mut map = Map::new();
            for e in entries {
                map.insert(e.key, parse_at(s, b, e.value.start).filter(|(_, end)| *end == e.value.end)?.0);
            }
            if count_top_level_items(b, i + 1, close) != map.len() {
                return None;
            }
            Some((Value::Object(map), close + 1))
        }
        b'[' => {
            let mut j = i + 1;
            let mut items = vec![];
            loop {
                j = skip_ws(b, j);
                match *b.get(j)? {
                    b']' => return Some((Value::Array(items), j + 1)),
                    b',' => j += 1,
                    _ => {
                        let (v, end) = parse_at(s, b, j)?;
                        items.push(v);
                        j = end;
                    }
                }
            }
        }
        q @ (b'"' | b'\'' | b'`') => {
            let e = string_end(b, i)?;
            let inner = &s[i + 1..e - 1];
            if q == b'`' && inner.contains("${") {
                return None;
            }
            Some((Value::String(unescape(inner)), e))
        }
        _ => {
            let end = skip_value(b, i)?;
            let tok = &s[i..end];
            let v = match tok {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                "null" => Value::Null,
                _ => {
                    let n: f64 = tok.replace('_', "").parse().ok()?;
                    Value::Number(if n.fract() == 0.0 && n.abs() < 9e15 { Number::from(n as i64) } else { Number::from_f64(n)? })
                }
            };
            Some((v, end))
        }
    }
}

fn count_top_level_items(b: &[u8], from: usize, to: usize) -> usize {
    let mut i = from;
    let mut n = 0;
    while i < to {
        i = skip_ws(b, i);
        if i >= to {
            break;
        }
        if b[i] == b',' {
            i += 1;
            continue;
        }
        n += 1;
        i = match skip_value(b, i) {
            Some(e) if e > i => e,
            _ => break,
        };
    }
    n
}

fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some(o) => out.push(o),
            None => {}
        }
    }
    out
}

/// Serialise JSON as a JS literal that reads naturally in source (unquoted identifier keys, double-quoted strings).
pub fn to_js(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            if m.is_empty() {
                return "{}".into();
            }
            let items: Vec<String> = m
                .iter()
                .map(|(k, v)| {
                    let ident = !k.is_empty()
                        && !k.chars().next().unwrap().is_ascii_digit()
                        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                    let key = if ident { k.clone() } else { serde_json::to_string(k).unwrap() };
                    format!("{key}: {}", to_js(v))
                })
                .collect();
            format!("{{ {} }}", items.join(", "))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(to_js).collect::<Vec<_>>().join(", ")),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_objects_with_loose_syntax() {
        let v = parse_value("{ title: 'Hi', n: -1.5, ok: true, nested: { a: [1, 2, 3,], \"b-c\": null, }, }").unwrap();
        assert_eq!(v, json!({"title":"Hi","n":-1.5,"ok":true,"nested":{"a":[1,2,3],"b-c":null}}));
    }

    #[test]
    fn refuses_non_literals() {
        assert!(parse_value("{ a: foo }").is_none());
        assert!(parse_value("{ a: 1, ...rest }").is_none());
        assert!(parse_value("{ a, b: 1 }").is_none());
        assert!(parse_value("{ a: `x${y}` }").is_none());
        assert!(parse_value("{ a: 1 + 2 }").is_none());
    }

    #[test]
    fn comments_are_ignored_and_offsets_preserved() {
        let src = "{ a: 1, // héllo\n b: /* x */ 2 }";
        assert_eq!(mask_comments(src).len(), src.len());
        assert_eq!(parse_value(src).unwrap(), json!({"a":1,"b":2}));
    }

    #[test]
    fn object_entries_report_value_ranges() {
        let src = "{ x: 10, 'y': [1, 2], z: { k: 1 } }";
        let (entries, close) = object_entries(src, 0).unwrap();
        assert_eq!(close, src.len() - 1);
        let got: Vec<_> = entries.iter().map(|e| (e.key.as_str(), &src[e.value.clone()])).collect();
        assert_eq!(got, [("x", "10"), ("y", "[1, 2]"), ("z", "{ k: 1 }")]);
    }

    #[test]
    fn strings_with_delimiters_inside() {
        let v = parse_value(r#"{ t: "a, b } c", u: 'it\'s' }"#).unwrap();
        assert_eq!(v, json!({"t":"a, b } c","u":"it's"}));
    }

    #[test]
    fn to_js_is_readable() {
        assert_eq!(to_js(&json!({"a":1,"b-c":"x","d":[1,2]})), r#"{ a: 1, "b-c": "x", d: [1, 2] }"#);
    }
}
