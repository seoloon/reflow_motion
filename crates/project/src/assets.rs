//! Importing files into the project's `public/` folder (drag-and-drop). Plain filesystem, no database.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::detect::asset_kind;

#[derive(Debug, Serialize, PartialEq)]
pub struct Imported {
    /// Project-relative destination, forward slashes.
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Rejected {
    pub source: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct ImportResult {
    pub imported: Vec<Imported>,
    pub rejected: Vec<Rejected>,
}

/// Copy `sources` into `<root>/public/`, never overwriting: `a.png` -> `a-1.png` on conflict.
/// Only known media/font types are accepted.
pub fn import_assets(root: &Path, sources: &[PathBuf]) -> std::io::Result<ImportResult> {
    let dest_dir = root.join("public");
    std::fs::create_dir_all(&dest_dir)?;
    let mut result = ImportResult::default();
    for src in sources {
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let reject = |reason: &str| Rejected { source: name.clone(), reason: reason.into() };
        if !src.is_file() {
            result.rejected.push(reject("not a file"));
            continue;
        }
        if asset_kind(ext).is_none() {
            result.rejected.push(reject("unsupported file type"));
            continue;
        }
        let dest = unique_destination(&dest_dir, &name);
        std::fs::copy(src, &dest)?;
        let file = dest.file_name().unwrap().to_string_lossy();
        result.imported.push(Imported { path: format!("public/{file}") });
    }
    Ok(result)
}

fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|i| dir.join(format!("{stem}-{i}{ext}")))
        .find(|c| !c.exists())
        .expect("infinite range")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_supported_files_and_rejects_others() {
        let proj = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("logo.png"), b"x").unwrap();
        std::fs::write(src.path().join("notes.txt"), b"x").unwrap();
        let r = import_assets(proj.path(), &[src.path().join("logo.png"), src.path().join("notes.txt"), src.path().join("missing.mp4")]).unwrap();
        assert_eq!(r.imported, vec![Imported { path: "public/logo.png".into() }]);
        assert_eq!(r.rejected.len(), 2);
        assert!(proj.path().join("public/logo.png").is_file());
    }

    #[test]
    fn never_overwrites_existing_files() {
        let proj = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        std::fs::create_dir(proj.path().join("public")).unwrap();
        std::fs::write(proj.path().join("public/a.mp3"), b"old").unwrap();
        std::fs::write(proj.path().join("public/a-1.mp3"), b"old").unwrap();
        std::fs::write(src.path().join("a.mp3"), b"new").unwrap();
        let r = import_assets(proj.path(), &[src.path().join("a.mp3")]).unwrap();
        assert_eq!(r.imported[0].path, "public/a-2.mp3");
        assert_eq!(std::fs::read(proj.path().join("public/a.mp3")).unwrap(), b"old");
    }
}
