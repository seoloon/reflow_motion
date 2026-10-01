//! Git integration by running the user's `git` executable (no Git implementation of our own).
//! Every call passes arguments as an array, user-supplied paths come after `--`,
//! and branch names are validated so they can never be parsed as options.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileChange {
    pub path: String,
    /// original path for renames
    pub orig_path: Option<String>,
    /// change recorded in the index (staged), if any
    pub staged: Option<ChangeKind>,
    /// change in the working tree (unstaged), if any
    pub unstaged: Option<ChangeKind>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Status {
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Branch {
    pub name: String,
    pub current: bool,
}

#[derive(Debug, PartialEq)]
pub enum GitError {
    /// `git` could not be started.
    NotInstalled,
    NotARepository,
    InvalidName(String),
    Failed(String),
}

fn kind_from_xy(c: char) -> Option<ChangeKind> {
    match c {
        'M' | 'T' => Some(ChangeKind::Modified),
        'A' => Some(ChangeKind::Added),
        'D' => Some(ChangeKind::Deleted),
        'R' | 'C' => Some(ChangeKind::Renamed),
        _ => None,
    }
}

/// Parse `git status --porcelain=v2 --branch -z`.
pub fn parse_status(out: &str) -> Status {
    let mut status = Status::default();
    let mut parts = out.split('\0').filter(|p| !p.is_empty()).peekable();
    while let Some(entry) = parts.next() {
        if let Some(h) = entry.strip_prefix("# branch.head ") {
            status.branch = (h != "(detached)").then(|| h.to_string());
        } else if let Some(ab) = entry.strip_prefix("# branch.ab ") {
            for tok in ab.split_whitespace() {
                if let Some(n) = tok.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = tok.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        } else if entry.starts_with('#') {
            continue;
        } else if let Some(rest) = entry.strip_prefix("1 ") {
            // 1 XY sub mH mI mW hH hI path
            let f: Vec<&str> = rest.splitn(8, ' ').collect();
            if f.len() == 8 {
                let mut xy = f[0].chars();
                status.files.push(FileChange {
                    path: f[7].to_string(),
                    orig_path: None,
                    staged: kind_from_xy(xy.next().unwrap_or('.')),
                    unstaged: kind_from_xy(xy.next().unwrap_or('.')),
                });
            }
        } else if let Some(rest) = entry.strip_prefix("2 ") {
            // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
            let f: Vec<&str> = rest.splitn(9, ' ').collect();
            if f.len() == 9 {
                let mut xy = f[0].chars();
                status.files.push(FileChange {
                    path: f[8].to_string(),
                    orig_path: parts.next().map(str::to_string),
                    staged: kind_from_xy(xy.next().unwrap_or('.')),
                    unstaged: kind_from_xy(xy.next().unwrap_or('.')),
                });
            }
        } else if let Some(rest) = entry.strip_prefix("u ") {
            let f: Vec<&str> = rest.splitn(10, ' ').collect();
            if let Some(path) = f.get(9) {
                status.files.push(FileChange {
                    path: path.to_string(),
                    orig_path: None,
                    staged: Some(ChangeKind::Conflicted),
                    unstaged: Some(ChangeKind::Conflicted),
                });
            }
        } else if let Some(path) = entry.strip_prefix("? ") {
            status.files.push(FileChange { path: path.to_string(), orig_path: None, staged: None, unstaged: Some(ChangeKind::Untracked) });
        }
    }
    status
}

/// Branch names are passed to `git checkout`; reject anything that could be read as an option or path trick.
pub fn validate_branch(name: &str) -> Result<(), GitError> {
    let bad = name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.chars().any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c));
    if bad {
        Err(GitError::InvalidName(name.to_string()))
    } else {
        Ok(())
    }
}

fn run(root: &Path, args: &[&str]) -> Result<String, GitError> {
    let out = Command::new("git").args(args).current_dir(root).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::NotInstalled
        } else {
            GitError::Failed(e.to_string())
        }
    })?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    if err.contains("not a git repository") {
        Err(GitError::NotARepository)
    } else {
        Err(GitError::Failed(err.trim().to_string()))
    }
}

pub fn status(root: &Path) -> Result<Status, GitError> {
    Ok(parse_status(&run(root, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])?))
}

pub fn branches(root: &Path) -> Result<Vec<Branch>, GitError> {
    let out = run(root, &["branch", "--format=%(HEAD)|%(refname:short)"])?;
    Ok(out
        .lines()
        .filter_map(|l| l.split_once('|'))
        .map(|(h, n)| Branch { name: n.to_string(), current: h == "*" })
        .filter(|b| !b.name.starts_with('('))
        .collect())
}

/// Unified diff of one path, staged or unstaged. Untracked files are shown against /dev/null.
pub fn diff(root: &Path, path: &str, staged: bool, untracked: bool) -> Result<String, GitError> {
    if untracked {
        // exits 1 when files differ; that is expected here
        let out = Command::new("git")
            .args(["diff", "--no-index", "--no-color", "--", if cfg!(windows) { "NUL" } else { "/dev/null" }, path])
            .current_dir(root)
            .output()
            .map_err(|e| GitError::Failed(e.to_string()))?;
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let mut args = vec!["diff", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    run(root, &args)
}

pub fn stage(root: &Path, paths: &[String]) -> Result<(), GitError> {
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(root, &args).map(|_| ())
}

pub fn unstage(root: &Path, paths: &[String]) -> Result<(), GitError> {
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(root, &args).map(|_| ())
}

pub fn commit(root: &Path, message: &str) -> Result<(), GitError> {
    if message.trim().is_empty() {
        return Err(GitError::InvalidName("empty commit message".into()));
    }
    run(root, &["commit", "-m", message]).map(|_| ())
}

pub fn checkout(root: &Path, branch: &str) -> Result<(), GitError> {
    validate_branch(branch)?;
    run(root, &["checkout", branch]).map(|_| ())
}

pub fn create_branch(root: &Path, branch: &str) -> Result<(), GitError> {
    validate_branch(branch)?;
    run(root, &["checkout", "-b", branch]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_porcelain_v2() {
        let out = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 a b src/a.tsx\0\
1 A. N... 000000 100644 100644 a b new file.ts\0\
2 R. N... 100644 100644 100644 a b R100 src/new.ts\0src/old.ts\0\
? notes.txt\0\
u UU N... 1 2 3 4 a b c conflict.ts\0";
        let s = parse_status(out);
        assert_eq!((s.branch.as_deref(), s.ahead, s.behind), (Some("main"), 2, 1));
        assert_eq!(s.files.len(), 5);
        assert_eq!((s.files[0].staged, s.files[0].unstaged), (None, Some(ChangeKind::Modified)));
        assert_eq!(s.files[1].path, "new file.ts");
        assert_eq!(s.files[1].staged, Some(ChangeKind::Added));
        assert_eq!((s.files[2].path.as_str(), s.files[2].orig_path.as_deref()), ("src/new.ts", Some("src/old.ts")));
        assert_eq!(s.files[3].unstaged, Some(ChangeKind::Untracked));
        assert_eq!(s.files[4].staged, Some(ChangeKind::Conflicted));
    }

    #[test]
    fn detached_head_has_no_branch() {
        assert_eq!(parse_status("# branch.head (detached)\0").branch, None);
    }

    #[test]
    fn branch_names_cannot_be_options() {
        for bad in ["", "-f", "--orphan", "a..b", "a b", "a~1", "a:b", "x\ny"] {
            assert!(validate_branch(bad).is_err(), "{bad:?}");
        }
        for ok in ["main", "feature/intro-anim", "v1.2"] {
            assert!(validate_branch(ok).is_ok(), "{ok:?}");
        }
    }

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").args(args).current_dir(dir).output().unwrap().status.success();
        assert!(ok, "git {args:?} failed");
    }

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        git(d.path(), &["config", "user.email", "t@example.com"]);
        git(d.path(), &["config", "user.name", "Test"]);
        git(d.path(), &["config", "commit.gpgsign", "false"]);
        d
    }

    #[test]
    fn not_a_repository_is_reported() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(status(d.path()), Err(GitError::NotARepository));
    }

    #[test]
    fn full_workflow_against_a_real_repository() {
        let d = repo();
        let p = d.path();
        fs::write(p.join("a.txt"), "one\n").unwrap();
        // untracked
        let s = status(p).unwrap();
        assert_eq!(s.files[0].unstaged, Some(ChangeKind::Untracked));
        assert!(diff(p, "a.txt", false, true).unwrap().contains("+one"));
        // stage + commit
        stage(p, &["a.txt".into()]).unwrap();
        assert_eq!(status(p).unwrap().files[0].staged, Some(ChangeKind::Added));
        commit(p, "first").unwrap();
        assert!(status(p).unwrap().files.is_empty());
        // modify: unstaged diff, then staged diff
        fs::write(p.join("a.txt"), "one\ntwo\n").unwrap();
        assert!(diff(p, "a.txt", false, false).unwrap().contains("+two"));
        stage(p, &["a.txt".into()]).unwrap();
        assert!(diff(p, "a.txt", true, false).unwrap().contains("+two"));
        unstage(p, &["a.txt".into()]).unwrap();
        assert_eq!(status(p).unwrap().files[0].staged, None);
        // branches
        create_branch(p, "feature/x").unwrap();
        let b = branches(p).unwrap();
        assert!(b.iter().any(|b| b.name == "feature/x" && b.current));
        checkout(p, "main").unwrap();
        assert!(branches(p).unwrap().iter().any(|b| b.name == "main" && b.current));
        assert!(checkout(p, "--force").is_err());
        assert!(commit(p, "  ").is_err());
    }

    #[test]
    fn paths_with_spaces_and_dash_prefix_are_safe() {
        let d = repo();
        fs::write(d.path().join("-weird name.txt"), "x").unwrap();
        stage(d.path(), &["-weird name.txt".into()]).unwrap();
        assert_eq!(status(d.path()).unwrap().files[0].path, "-weird name.txt");
    }
}
