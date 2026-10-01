//! Integrated terminal: a real PTY in the project folder (portable-pty). Only opened by an explicit user action.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

pub type OnData = Arc<dyn Fn(u32, String) + Send + Sync>;
pub type OnExit = Arc<dyn Fn(u32) + Send + Sync>;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Session>>,
    next: Mutex<u32>,
}

/// Shell to start: PowerShell on Windows (cmd as the documented fallback is handled by the user), `$SHELL` elsewhere.
pub fn default_shell(windows: bool, env_shell: Option<&str>) -> (String, Vec<String>) {
    if windows {
        ("powershell.exe".into(), vec!["-NoLogo".into()])
    } else {
        (env_shell.filter(|s| !s.is_empty()).unwrap_or("/bin/sh").to_string(), vec![])
    }
}

/// Splits a byte stream into valid UTF-8 strings, holding back an incomplete trailing sequence
/// so multi-byte characters are never cut in half between reads.
#[derive(Default)]
pub struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).expect("validated prefix"));
                    match e.error_len() {
                        // incomplete sequence at the end: keep it for the next read
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                        // invalid bytes in the middle: replace and continue
                        Some(n) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + n);
                        }
                    }
                }
            }
        }
    }
}

impl Terminals {
    pub fn open(&self, cwd: &Path, cols: u16, rows: u16, on_data: OnData, on_exit: OnExit) -> Result<u32, String> {
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let (program, args) = default_shell(cfg!(windows), std::env::var("SHELL").ok().as_deref());
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let id = {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            *n
        };
        self.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, child });

        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut chunker = Utf8Chunker::default();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = chunker.push(&buf[..n]);
                        if !text.is_empty() {
                            on_data(id, text);
                        }
                    }
                }
            }
            on_exit(id);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut s = self.sessions.lock().unwrap();
        let session = s.get_mut(&id).ok_or("terminal not found")?;
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let s = self.sessions.lock().unwrap();
        let session = s.get(&id).ok_or("terminal not found")?;
        session
            .master
            .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    pub fn close(&self, id: u32) {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(&id) {
            let _ = s.child.kill();
        }
    }

    pub fn close_all(&self) {
        let ids: Vec<u32> = self.sessions.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.close(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_selection_does_not_assume_bash() {
        assert_eq!(default_shell(true, Some("/bin/bash")).0, "powershell.exe");
        assert_eq!(default_shell(false, Some("/bin/zsh")).0, "/bin/zsh");
        assert_eq!(default_shell(false, None).0, "/bin/sh");
        assert_eq!(default_shell(false, Some("")).0, "/bin/sh");
    }

    #[test]
    fn utf8_chunker_never_splits_characters() {
        let mut c = Utf8Chunker::default();
        let bytes = "héllo ✓".as_bytes();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&c.push(&[*b]));
        }
        assert_eq!(out, "héllo ✓");
        assert_eq!(Utf8Chunker::default().push(b"plain"), "plain");
    }

    #[test]
    fn utf8_chunker_replaces_invalid_bytes() {
        let mut c = Utf8Chunker::default();
        assert_eq!(c.push(&[b'a', 0xff, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn real_pty_echoes_a_command() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let tx = Mutex::new(tx);
        let t = Terminals::default();
        let dir = std::env::temp_dir();
        let id = t
            .open(
                &dir,
                80,
                24,
                Arc::new(move |_, s| {
                    let _ = tx.lock().unwrap().send(s);
                }),
                Arc::new(|_| {}),
            )
            .expect("pty opens");
        t.write(id, "echo reflow-pty-ok\r").unwrap();
        let mut seen = String::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while std::time::Instant::now() < deadline && !seen.matches("reflow-pty-ok").count().ge(&2) {
            if let Ok(s) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                // Windows ConPTY asks for the cursor position and waits; xterm.js answers this in the app
                if s.contains("\u{1b}[6n") {
                    t.write(id, "\u{1b}[1;1R").unwrap();
                }
                seen.push_str(&s);
            }
        }
        t.close(id);
        // the typed command is echoed once and its output appears once
        assert!(seen.matches("reflow-pty-ok").count() >= 2, "terminal output: {seen:?}");
    }
}
