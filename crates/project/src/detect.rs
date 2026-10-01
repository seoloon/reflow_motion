use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::Serialize;
use walkdir::WalkDir;

use crate::compositions::{scan_compositions, Composition};
use crate::error::ProjectError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    /// Executable name to spawn (platform shims such as `.cmd` are handled by the process layer).
    pub fn command(self) -> &'static str {
        match self {
            PackageManager::Npm => "npm",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Yarn => "yarn",
            PackageManager::Bun => "bun",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Video,
    Audio,
    Font,
}

#[derive(Debug, Clone, Serialize)]
pub struct Asset {
    /// Path relative to the project root, with forward slashes.
    pub path: String,
    pub kind: AssetKind,
    pub size: u64,
    /// Pixel size, read from the file header for common image formats.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub fn asset_kind(ext: &str) -> Option<AssetKind> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" => AssetKind::Image,
        "mp4" | "webm" | "mov" | "mkv" => AssetKind::Video,
        "mp3" | "wav" | "aac" | "ogg" | "m4a" | "flac" => AssetKind::Audio,
        "ttf" | "otf" | "woff" | "woff2" => AssetKind::Font,
        _ => return None,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    pub root: String,
    pub name: Option<String>,
    pub package_manager: PackageManager,
    /// Version range declared in package.json.
    pub remotion_version: String,
    /// Entry point relative to the root, forward slashes.
    pub entry_point: Option<String>,
    pub scripts: BTreeMap<String, String>,
    pub dependencies: BTreeMap<String, String>,
    pub compositions: Vec<Composition>,
    pub assets: Vec<Asset>,
    pub has_node_modules: bool,
}

pub fn detect_project(root: &Path) -> Result<ProjectInfo, ProjectError> {
    if !root.is_dir() {
        return Err(ProjectError::NotADirectory(root.display().to_string()));
    }
    let pkg_path = root.join("package.json");
    if !pkg_path.is_file() {
        return Err(ProjectError::NoPackageJson(root.display().to_string()));
    }
    let pkg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&pkg_path)?)
        .map_err(|e| ProjectError::InvalidPackageJson(e.to_string()))?;

    let dependencies = string_map(&pkg, &["dependencies", "devDependencies"]);
    let scripts = string_map(&pkg, &["scripts"]);

    let remotion_version = dependencies
        .get("remotion")
        .cloned()
        .ok_or_else(|| ProjectError::NotRemotion(root.display().to_string()))?;

    let entry_point = find_entry_point(root, &scripts);
    let compositions = scan_compositions(root, entry_point.as_deref());

    Ok(ProjectInfo {
        root: root.display().to_string(),
        name: pkg.get("name").and_then(|n| n.as_str()).map(String::from),
        package_manager: detect_package_manager(root, &pkg),
        remotion_version,
        entry_point,
        scripts,
        dependencies,
        compositions,
        assets: list_assets(root),
        has_node_modules: root.join("node_modules").is_dir(),
    })
}

fn string_map(pkg: &serde_json::Value, keys: &[&str]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for key in keys {
        if let Some(obj) = pkg.get(*key).and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    out.entry(k.clone()).or_insert_with(|| s.to_string());
                }
            }
        }
    }
    out
}

fn detect_package_manager(root: &Path, pkg: &serde_json::Value) -> PackageManager {
    // 1. lockfiles are the strongest signal
    let lockfiles = [
        ("pnpm-lock.yaml", PackageManager::Pnpm),
        ("bun.lockb", PackageManager::Bun),
        ("bun.lock", PackageManager::Bun),
        ("yarn.lock", PackageManager::Yarn),
        ("package-lock.json", PackageManager::Npm),
    ];
    for (file, pm) in lockfiles {
        if root.join(file).is_file() {
            return pm;
        }
    }
    // 2. corepack `packageManager` field, e.g. "pnpm@9.1.0"
    if let Some(field) = pkg.get("packageManager").and_then(|v| v.as_str()) {
        match field.split('@').next().unwrap_or("") {
            "pnpm" => return PackageManager::Pnpm,
            "yarn" => return PackageManager::Yarn,
            "bun" => return PackageManager::Bun,
            "npm" => return PackageManager::Npm,
            _ => {}
        }
    }
    PackageManager::Npm
}

fn find_entry_point(root: &Path, scripts: &BTreeMap<String, String>) -> Option<String> {
    // Scripts like `remotion studio src/index.ts` or `remotion render src/index.ts Main out.mp4`
    let re = Regex::new(r"remotion\s+(?:studio|preview|render|still|bundle|compositions|benchmark)\s+(?:--\S+\s+)*([^\s-][^\s]*\.[jt]sx?)")
        .expect("static regex");
    for script in scripts.values() {
        if let Some(c) = re.captures(script) {
            let candidate = c[1].trim_start_matches("./");
            if root.join(candidate).is_file() {
                return Some(candidate.to_string());
            }
        }
    }
    // Remotion's documented default is src/index.ts
    for candidate in ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"] {
        if root.join(candidate).is_file() {
            return Some(candidate.to_string());
        }
    }
    None
}

fn list_assets(root: &Path) -> Vec<Asset> {
    let public: PathBuf = root.join("public");
    if !public.is_dir() {
        return vec![];
    }
    let mut out = vec![];
    for entry in WalkDir::new(&public)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        let Some(kind) = asset_kind(ext) else { continue };
        let (width, height) = match kind {
            AssetKind::Image => imagesize::size(entry.path()).map(|d| (Some(d.width as u32), Some(d.height as u32))).unwrap_or((None, None)),
            _ => (None, None),
        };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if let Ok(rel) = entry.path().strip_prefix(root) {
            out.push(Asset {
                path: rel.to_string_lossy().replace('\\', "/"),
                kind,
                size,
                width,
                height,
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    #[test]
    fn rejects_missing_package_json() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            detect_project(dir.path()),
            Err(ProjectError::NoPackageJson(_))
        ));
    }

    #[test]
    fn rejects_non_remotion_project() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "package.json", r#"{"dependencies":{"react":"19"}}"#);
        let err = detect_project(dir.path()).unwrap_err();
        assert!(matches!(err, ProjectError::NotRemotion(_)));
        assert!(!err.user_message().title.contains("ENOENT"));
    }

    #[test]
    fn rejects_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "package.json", "{ nope");
        assert!(matches!(
            detect_project(dir.path()),
            Err(ProjectError::InvalidPackageJson(_))
        ));
    }

    #[test]
    fn detects_full_project() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "package.json",
            r#"{"name":"demo","scripts":{"dev":"remotion studio src/main.ts","build":"remotion render"},
               "dependencies":{"remotion":"^4.0.100","react":"19"},"devDependencies":{"@remotion/cli":"4.0.100"}}"#,
        );
        write(r, "pnpm-lock.yaml", "");
        write(r, "src/main.ts", "");
        write(r, "public/logo.PNG", "");
        write(r, "public/sub/song.mp3", "");
        write(r, "public/readme.txt", "");
        write(
            r,
            "src/Root.tsx",
            r#"export const R = () => <Composition id="Main" width={1920} height={1080} fps={30} durationInFrames={90} component={X} />;"#,
        );

        let info = detect_project(r).unwrap();
        assert_eq!(info.name.as_deref(), Some("demo"));
        assert_eq!(info.package_manager, PackageManager::Pnpm);
        assert_eq!(info.remotion_version, "^4.0.100");
        assert_eq!(info.entry_point.as_deref(), Some("src/main.ts"));
        assert!(info.dependencies.contains_key("@remotion/cli"));
        assert!(!info.has_node_modules);
        assert_eq!(info.compositions.len(), 1);
        let assets: Vec<_> = info.assets.iter().map(|a| a.path.as_str()).collect();
        assert_eq!(assets, ["public/logo.PNG", "public/sub/song.mp3"]);
    }

    #[test]
    fn package_manager_priority() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = serde_json::json!({"packageManager":"yarn@4.0.0"});
        assert_eq!(detect_package_manager(dir.path(), &pkg), PackageManager::Yarn);
        write(dir.path(), "bun.lockb", "");
        assert_eq!(detect_package_manager(dir.path(), &pkg), PackageManager::Bun);
        let empty = serde_json::json!({});
        let d2 = tempfile::tempdir().unwrap();
        assert_eq!(detect_package_manager(d2.path(), &empty), PackageManager::Npm);
    }

    #[test]
    fn default_entry_point_fallback() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/index.tsx", "");
        assert_eq!(
            find_entry_point(dir.path(), &BTreeMap::new()).as_deref(),
            Some("src/index.tsx")
        );
    }
}

#[cfg(test)]
mod asset_tests {
    use super::*;

    #[test]
    fn lists_sizes_and_image_dimensions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("public")).unwrap();
        // 1x1 PNG
        let png: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15,
            0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0, 5, 0xfe, 2, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0,
            0, 0, 0, 0x49, 0x45, 0x4e, 0x44,
        ];
        std::fs::write(dir.path().join("public/dot.png"), png).unwrap();
        std::fs::write(dir.path().join("public/clip.mp4"), b"abc").unwrap();
        let assets = list_assets(dir.path());
        let dot = assets.iter().find(|a| a.path.ends_with("dot.png")).unwrap();
        assert_eq!((dot.width, dot.height), (Some(1), Some(1)));
        let clip = assets.iter().find(|a| a.path.ends_with("clip.mp4")).unwrap();
        assert_eq!((clip.size, clip.width), (3, None));
    }
}
