//! Runs the *user's own* Remotion Studio as a child process (see docs/licensing.md).
//! Only started after an explicit user action.

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use reflow_project::PackageManager;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub source: &'static str,
    pub level: &'static str,
    pub message: String,
}

pub struct PreviewProcess {
    pub child: Child,
    pub port: u16,
}

/// Program + args for `remotion studio`, using the project's own package manager so the
/// project-local Remotion version is the one that runs.
pub fn studio_command(pm: PackageManager, entry: Option<&str>, port: u16) -> (String, Vec<String>) {
    let mut args: Vec<String> = match pm {
        PackageManager::Npm => vec!["npx".into(), "remotion".into()],
        PackageManager::Pnpm => vec!["exec".into(), "remotion".into()],
        PackageManager::Yarn => vec!["remotion".into()],
        PackageManager::Bun => vec!["x".into(), "remotion".into()],
    };
    let program = match pm {
        PackageManager::Npm => {
            // `npx` is the executable itself
            args.remove(0);
            "npx"
        }
        other => other.command(),
    };
    args.push("studio".into());
    if let Some(e) = entry {
        args.push(e.to_string());
    }
    args.extend(["--port".into(), port.to_string(), "--no-open".into()]);
    (program.to_string(), args)
}

pub fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

pub fn is_listening(port: u16) -> bool {
    let addrs = [
        SocketAddr::from(([127, 0, 0, 1], port)),
        SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
    ];
    addrs
        .iter()
        .any(|a| TcpStream::connect_timeout(a, Duration::from_millis(200)).is_ok())
}

/// Typed failure so the UI can show a friendly message.
#[derive(Debug, Serialize)]
pub struct StartError {
    pub title: String,
    pub hint: String,
    pub details: String,
}

pub fn spawn_program(program: &str, args: &[String], cwd: &Path) -> std::io::Result<Child> {
    let build = |p: &str| {
        let mut c = Command::new(p);
        c.args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        c
    };
    match build(program).spawn() {
        // Windows package-manager shims are .cmd files that CreateProcess does not resolve.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && cfg!(windows) => {
            build(&format!("{program}.cmd")).spawn()
        }
        other => other,
    }
}

/// The project's dependencies must be installed before anything can run.
pub fn check_dependencies(root: &Path, pm: PackageManager) -> Result<(), StartError> {
    if root.join("node_modules").is_dir() {
        return Ok(());
    }
    Err(StartError {
        title: "Project dependencies are not installed.".into(),
        hint: format!("Run \"{} install\" in the project folder, then start the preview again.", pm.command()),
        details: "node_modules not found".into(),
    })
}

/// Which preview server to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// ReFlow's controllable player app (Vite).
    Player,
    /// The project's own Remotion Studio.
    Studio,
}

/// Windows "verbatim" paths (`\\?\D:\x`) are valid for the OS but Node cannot resolve them
/// (it fails with EISDIR on `D:`), so every path handed to a child process is normalised first.
pub fn plain_path(p: &Path) -> String {
    let s = p.display().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// Program + args for the generated player app. `vite_js` is ReFlow's own Vite entry script.
pub fn player_command(vite_js: &Path, config: &Path, port: u16) -> (String, Vec<String>) {
    (
        "node".to_string(),
        vec![
            plain_path(vite_js),
            "--config".into(),
            plain_path(config),
            "--port".into(),
            port.to_string(),
            "--strictPort".into(),
        ],
    )
}

pub fn start(
    root: &Path,
    program: String,
    args: Vec<String>,
    port: u16,
    mut on_log: impl FnMut(LogLine) + Send + Clone + 'static,
) -> Result<PreviewProcess, StartError> {
    on_log(LogLine { source: "app", level: "INFO", message: format!("$ {program} {}", args.join(" ")) });

    let mut child = spawn_program(&program, &args, root).map_err(|e| StartError {
        title: "Could not start the project.".into(),
        hint: if e.kind() == std::io::ErrorKind::NotFound {
            format!("\"{program}\" was not found. Check your installation (is it on your PATH?) or choose another package manager.")
        } else {
            "The preview process could not be launched. See the diagnostics log for details.".into()
        },
        details: e.to_string(),
    })?;

    for (stream, source) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), "remotion"),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), "remotion"),
    ] {
        if let Some(s) = stream {
            let mut cb = on_log.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(s).lines().map_while(Result::ok) {
                    cb(LogLine { source, level: "INFO", message: strip_ansi(&line) });
                }
            });
        }
    }

    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if is_listening(port) {
            return Ok(PreviewProcess { child, port });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(StartError {
                title: "The preview server stopped unexpectedly.".into(),
                hint: "Open the diagnostics log to see why Remotion Studio exited.".into(),
                details: format!("exit status: {status}"),
            });
        }
        if Instant::now() > deadline {
            stop(&mut child);
            return Err(StartError {
                title: "The preview server took too long to start.".into(),
                hint: "Check the diagnostics log. The first start can be slow while Remotion bundles.".into(),
                details: "timeout after 90s".into(),
            });
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Remove ANSI colour/cursor escape sequences (`ESC [ ... letter`) from process output.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for n in chars.by_ref() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Kill a whole process tree (the package manager spawns node, which spawns the real work).
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .output();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-TERM", &format!("-{pid}")]).output();
    }
}

pub fn stop(child: &mut Child) {
    kill_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_per_package_manager() {
        let (p, a) = studio_command(PackageManager::Npm, Some("src/index.ts"), 3123);
        assert_eq!((p.as_str(), a.join(" ")), ("npx", "remotion studio src/index.ts --port 3123 --no-open".to_string()));
        let (p, a) = studio_command(PackageManager::Pnpm, None, 1);
        assert_eq!((p.as_str(), a.join(" ")), ("pnpm", "exec remotion studio --port 1 --no-open".to_string()));
        let (p, a) = studio_command(PackageManager::Yarn, None, 1);
        assert_eq!((p.as_str(), a.join(" ")), ("yarn", "remotion studio --port 1 --no-open".to_string()));
        let (p, a) = studio_command(PackageManager::Bun, None, 1);
        assert_eq!((p.as_str(), a.join(" ")), ("bun", "x remotion studio --port 1 --no-open".to_string()));
    }

    #[test]
    fn missing_dependencies_is_a_friendly_error() {
        let d = tempfile::tempdir().unwrap();
        let err = check_dependencies(d.path(), PackageManager::Pnpm).unwrap_err();
        assert!(err.title.contains("dependencies"));
        assert!(err.hint.contains("pnpm install"));
        std::fs::create_dir(d.path().join("node_modules")).unwrap();
        assert!(check_dependencies(d.path(), PackageManager::Pnpm).is_ok());
    }

    #[test]
    fn verbatim_windows_paths_are_normalised_for_node() {
        assert_eq!(plain_path(Path::new(r"\\?\D:\DEV\x\vite.js")), r"D:\DEV\x\vite.js");
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\a")), r"\\server\share\a");
        assert_eq!(plain_path(Path::new("/plain/path")), "/plain/path");
    }

    #[test]
    fn player_command_runs_vite_with_strict_port() {
        let (p, a) = player_command(Path::new("/v/vite.js"), Path::new("/c/vite.config.mjs"), 5100);
        assert_eq!(p, "node");
        assert_eq!(a.last().unwrap(), "--strictPort");
        assert!(a.contains(&"5100".to_string()));
    }

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[31mred\u{1b}[39m text"), "red text");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn free_port_is_usable_and_not_listening() {
        let p = free_port().unwrap();
        assert!(!is_listening(p));
    }
}
