//! Runs the render queue: one `remotion render` child process at a time, never on the UI thread.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use reflow_project::PackageManager;
use reflow_renderer::{parse_progress, render_command, Job, Queue, RenderRequest};

use crate::preview::{self, LogLine};

type Notify = Arc<dyn Fn(Vec<Job>) + Send + Sync>;
type Log = Arc<dyn Fn(LogLine) + Send + Sync>;

#[derive(Clone)]
pub struct Project {
    pub root: PathBuf,
    pub pm: PackageManager,
    pub entry: Option<String>,
}

#[derive(Default)]
struct Inner {
    queue: Queue,
    /// (job id, pid) of the running process, so cancel can kill it
    running: Option<(u32, u32)>,
}

#[derive(Clone, Default)]
pub struct RenderManager {
    inner: Arc<Mutex<Inner>>,
}

impl RenderManager {
    pub fn jobs(&self) -> Vec<Job> {
        self.inner.lock().unwrap().queue.jobs().to_vec()
    }

    pub fn enqueue(&self, project: Project, req: RenderRequest, notify: Notify, log: Log) -> u32 {
        let id = self.inner.lock().unwrap().queue.enqueue(req);
        notify(self.jobs());
        self.pump(project, notify, log);
        id
    }

    pub fn cancel(&self, id: u32, notify: &Notify) {
        let pid = {
            let mut inner = self.inner.lock().unwrap();
            if !inner.queue.cancel(id) {
                return;
            }
            inner.running.filter(|(job, _)| *job == id).map(|(_, pid)| pid)
        };
        if let Some(pid) = pid {
            preview::kill_tree(pid);
        }
        notify(self.jobs());
    }

    pub fn remove(&self, id: u32, notify: &Notify) {
        self.inner.lock().unwrap().queue.remove(id);
        notify(self.jobs());
    }

    pub fn clear_finished(&self, notify: &Notify) {
        self.inner.lock().unwrap().queue.clear_finished();
        notify(self.jobs());
    }

    /// Cancel everything and kill the running process (app exit / project switch).
    pub fn shutdown(&self) {
        let pids: Vec<u32> = {
            let mut inner = self.inner.lock().unwrap();
            let ids: Vec<u32> = inner.queue.jobs().iter().map(|j| j.id).collect();
            for id in ids {
                inner.queue.cancel(id);
            }
            inner.running.take().map(|(_, p)| p).into_iter().collect()
        };
        for pid in pids {
            preview::kill_tree(pid);
        }
    }

    fn pump(&self, project: Project, notify: Notify, log: Log) {
        let Some(job) = self.inner.lock().unwrap().queue.start_next() else { return };
        notify(self.jobs());
        let this = self.clone();
        std::thread::spawn(move || {
            let result = this.run(&project, &job, &notify, &log);
            this.inner.lock().unwrap().running = None;
            this.inner.lock().unwrap().queue.finish(job.id, result);
            notify(this.jobs());
            this.pump(project, notify, log);
        });
    }

    fn run(&self, project: &Project, job: &Job, notify: &Notify, log: &Log) -> Result<(), String> {
        preview::check_dependencies(&project.root, project.pm).map_err(|e| format!("{} {}", e.title, e.hint))?;
        if let Some(parent) = Path::new(&job.request.output).parent() {
            std::fs::create_dir_all(project.root.join(parent)).map_err(|e| format!("Could not create the output folder: {e}"))?;
        }
        let (program, args) = render_command(project.pm, project.entry.as_deref(), &job.request);
        log(LogLine { source: "render", level: "INFO", message: format!("$ {program} {}", args.join(" ")) });
        let mut child = preview::spawn_program(&program, &args, &project.root).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("\"{program}\" was not found. Check your installation or choose another package manager.")
            } else {
                format!("The render could not be started: {e}")
            }
        })?;
        self.inner.lock().unwrap().running = Some((job.id, child.id()));
        // a cancel that arrived between start_next and spawn
        if self.inner.lock().unwrap().queue.get(job.id).is_some_and(|j| j.status == reflow_renderer::Status::Cancelled) {
            preview::stop(&mut child);
            return Err("cancelled".into());
        }

        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut readers = vec![];
        let streams: [Option<Box<dyn Read + Send>>; 2] = [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        ];
        for stream in streams.into_iter().flatten() {
            let (this, notify, log, tail, id) = (self.clone(), notify.clone(), log.clone(), tail.clone(), job.id);
            readers.push(std::thread::spawn(move || {
                let mut last_sent = -1.0f64;
                for raw in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                    let line = preview::strip_ansi(&String::from_utf8_lossy(&raw));
                    if let Some(p) = parse_progress(&line) {
                        let changed = {
                            let mut inner = this.inner.lock().unwrap();
                            inner.queue.set_progress(id, p);
                            let now = inner.queue.get(id).map_or(0.0, |j| j.progress);
                            let c = (now - last_sent).abs() >= 0.005;
                            if c {
                                last_sent = now;
                            }
                            c
                        };
                        if changed {
                            notify(this.jobs());
                        }
                        continue;
                    }
                    let msg = line.trim().to_string();
                    if msg.is_empty() {
                        continue;
                    }
                    let mut t = tail.lock().unwrap();
                    t.push(msg.clone());
                    if t.len() > 6 {
                        t.remove(0);
                    }
                    drop(t);
                    log(LogLine { source: "render", level: "INFO", message: msg });
                }
            }));
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        for r in readers {
            let _ = r.join();
        }
        if status.success() {
            return Ok(());
        }
        let last = tail.lock().unwrap().last().cloned().unwrap_or_default();
        Err(format!("Remotion stopped with an error. {last}").trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_dependencies_fail_the_job_with_a_friendly_message() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = RenderManager::default();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<Job>>();
        let tx = Mutex::new(tx);
        let notify: Notify = Arc::new(move |jobs| {
            let _ = tx.lock().unwrap().send(jobs);
        });
        let log: Log = Arc::new(|_| {});
        let req = RenderRequest {
            composition: "A".into(),
            output: "out/a.mp4".into(),
            still: false,
            width: None,
            height: None,
            settings: reflow_renderer::RenderSettings::new(reflow_renderer::Codec::H264),
        };
        mgr.enqueue(Project { root: dir.path().into(), pm: PackageManager::Npm, entry: None }, req, notify, log);
        let failed = loop {
            let jobs = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("job should finish");
            if jobs[0].status == reflow_renderer::Status::Failed {
                break jobs;
            }
        };
        assert!(failed[0].error.as_deref().unwrap().contains("dependencies are not installed"));
    }
}
