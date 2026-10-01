//! Filesystem scoping: every path coming from the UI must resolve inside the open project root.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    /// Path relative to the project root, forward slashes.
    pub path: String,
    pub is_dir: bool,
}

/// Resolve `rel` (relative to `root`) and ensure the result stays inside `root`.
/// Works for paths that do not exist yet (new files) by checking lexically first
/// and then canonicalising the deepest existing ancestor (defeats symlink escapes).
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
    {
        return Err(format!("path escapes the project: {rel}"));
    }
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    let full = root_canon.join(rel_path);

    let mut existing = full.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or("invalid path")?;
    }
    let existing_canon = existing.canonicalize().map_err(|e| e.to_string())?;
    if !existing_canon.starts_with(&root_canon) {
        return Err(format!("path escapes the project: {rel}"));
    }
    Ok(full)
}

const HIDDEN_DIRS: [&str; 3] = ["node_modules", ".git", "target"];

pub fn list_dir(root: &Path, rel: &str) -> Result<Vec<DirEntry>, String> {
    let dir = resolve_in_root(root, rel)?;
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = e.file_type().ok()?.is_dir();
            if is_dir && HIDDEN_DIRS.contains(&name.as_str()) {
                return None;
            }
            let path = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel.trim_end_matches('/'), name) };
            Some(DirEntry { name, path, is_dir })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

const SKIPPED_DIRS: [&str; 7] = ["node_modules", ".git", "target", ".reflow", "out", "dist", ".next"];

/// Relative file paths (forward slashes) for quick-open, capped at `limit`.
pub fn list_files(root: &Path, limit: usize) -> Vec<String> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(Result::ok) {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name().to_string_lossy().to_string();
            if ft.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) {
                    stack.push(e.path());
                }
            } else if ft.is_file() {
                if let Ok(rel) = e.path().strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                    if out.len() >= limit {
                        out.sort();
                        return out;
                    }
                }
            }
        }
    }
    out.sort();
    out
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub file: String,
    pub line: u32,
    pub text: String,
}

const CODE_EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "jsx", "json", "css"];

/// Plain substring search over the project's source files (no regex, no execution). Capped at `limit` hits.
pub fn search_project(root: &Path, query: &str, limit: usize) -> Vec<SearchHit> {
    let mut hits = vec![];
    if query.trim().len() < 2 {
        return hits;
    }
    for rel in list_files(root, 20_000) {
        let ext = rel.rsplit('.').next().unwrap_or("");
        if !CODE_EXTENSIONS.contains(&ext) {
            continue;
        }
        let Ok(text) = read_text(root, &rel) else { continue };
        for (i, line) in text.lines().enumerate() {
            if line.contains(query) {
                hits.push(SearchHit { file: rel.clone(), line: i as u32 + 1, text: line.trim().chars().take(160).collect() });
                if hits.len() >= limit {
                    return hits;
                }
            }
        }
    }
    hits
}

const MAX_TEXT_FILE: u64 = 5 * 1024 * 1024;

pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let p = resolve_in_root(root, rel)?;
    let len = std::fs::metadata(&p).map_err(|e| e.to_string())?.len();
    if len > MAX_TEXT_FILE {
        return Err("file is too large to open in the editor".into());
    }
    String::from_utf8(std::fs::read(&p).map_err(|e| e.to_string())?)
        .map_err(|_| "file is not valid UTF-8 text".to_string())
}

pub fn write_text(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let p = resolve_in_root(root, rel)?;
    // new files (for example from an accepted AI proposal) may live in folders that do not exist yet
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_parent_and_absolute() {
        let d = tempfile::tempdir().unwrap();
        assert!(resolve_in_root(d.path(), "../x").is_err());
        assert!(resolve_in_root(d.path(), "a/../../x").is_err());
        assert!(resolve_in_root(d.path(), if cfg!(windows) { "C:\\Windows" } else { "/etc/passwd" }).is_err());
    }

    #[test]
    fn allows_new_and_nested_paths() {
        let d = tempfile::tempdir().unwrap();
        assert!(resolve_in_root(d.path(), "src/new/file.tsx").is_ok());
    }

    #[test]
    fn read_write_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("src")).unwrap();
        write_text(d.path(), "src/a.tsx", "hello").unwrap();
        assert_eq!(read_text(d.path(), "src/a.tsx").unwrap(), "hello");
    }

    #[test]
    fn writing_a_new_nested_file_creates_its_folders_but_never_escapes() {
        let d = tempfile::tempdir().unwrap();
        write_text(d.path(), "src/new/Deep.tsx", "x").unwrap();
        assert_eq!(read_text(d.path(), "src/new/Deep.tsx").unwrap(), "x");
        assert!(write_text(d.path(), "../outside.txt", "x").is_err());
        assert!(!d.path().parent().unwrap().join("outside.txt").exists());
    }

    #[test]
    fn listing_sorts_dirs_first_and_hides_node_modules() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("node_modules")).unwrap();
        fs::create_dir(d.path().join("src")).unwrap();
        fs::write(d.path().join("a.json"), "").unwrap();
        fs::write(d.path().join("B.md"), "").unwrap();
        let names: Vec<_> = list_dir(d.path(), "").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["src", "a.json", "B.md"]);
        let sub = list_dir(d.path(), "src").unwrap();
        assert!(sub.is_empty());
    }

    #[test]
    fn quick_open_listing_skips_generated_folders_and_respects_the_cap() {
        let d = tempfile::tempdir().unwrap();
        for dir in ["src", "node_modules/x", ".reflow/preview", "out"] {
            fs::create_dir_all(d.path().join(dir)).unwrap();
        }
        for f in ["src/a.tsx", "src/b.tsx", "package.json", "node_modules/x/i.js", ".reflow/preview/m.tsx", "out/v.mp4"] {
            fs::write(d.path().join(f), "").unwrap();
        }
        assert_eq!(list_files(d.path(), 100), ["package.json", "src/a.tsx", "src/b.tsx"]);
        assert_eq!(list_files(d.path(), 1).len(), 1);
    }

    #[test]
    fn search_finds_lines_skips_generated_folders_and_respects_limits() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("src")).unwrap();
        fs::create_dir_all(d.path().join("node_modules/x")).unwrap();
        fs::write(d.path().join("src/a.tsx"), "const x = 1;
<Sequence name=\"opening\" />
").unwrap();
        fs::write(d.path().join("src/b.ts"), "export const opening = 5; // opening
").unwrap();
        fs::write(d.path().join("src/c.md"), "opening
").unwrap();
        fs::write(d.path().join("node_modules/x/i.js"), "opening
").unwrap();
        let hits = search_project(d.path(), "opening", 10);
        let got: Vec<_> = hits.iter().map(|h| (h.file.as_str(), h.line)).collect();
        assert_eq!(got, [("src/a.tsx", 2), ("src/b.ts", 1)]);
        assert_eq!(search_project(d.path(), "opening", 1).len(), 1);
        assert!(search_project(d.path(), "o", 10).is_empty(), "too short to be useful");
    }

    #[test]
    fn rejects_binary_as_text() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("x.bin"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_text(d.path(), "x.bin").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_blocked() {
        let d = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        assert!(resolve_in_root(d.path(), "link/secret").is_err());
    }
}
