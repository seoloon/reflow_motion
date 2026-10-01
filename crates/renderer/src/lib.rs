//! Render orchestration for Remotion projects. Pure logic: nothing here spawns processes.
//! ReFlow never renders frames itself; it builds the `remotion render` invocation, reads its output
//! and keeps the queue state.

mod settings;

use reflow_project::PackageManager;
use serde::{Deserialize, Serialize};

pub use settings::{
    valid_bitrate, AudioCodec, Codec, ColorSpace, HardwareAcceleration, ImageFormat, PixelFormat, ProresProfile, RenderSettings,
    SettingsError, X264Preset,
};

/// A ready-made set of settings for a common destination.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    /// destinations / systems the result suits (for filtering in the UI)
    pub tags: Vec<String>,
    pub settings: RenderSettings,
}

const PRESETS_JSON: &str = include_str!("../presets.json");

pub fn presets() -> Vec<Preset> {
    serde_json::from_str(PRESETS_JSON).expect("presets.json is valid (checked by tests)")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RenderRequest {
    pub composition: String,
    /// Project-relative output path, forward slashes. A folder for image sequences.
    pub output: String,
    /// Still compositions render a single image.
    #[serde(default)]
    pub still: bool,
    /// Output size shown in the queue (informational).
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub settings: RenderSettings,
}

pub fn default_output(composition: &str, settings: &RenderSettings, still: bool) -> String {
    let safe: String = composition
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if still {
        let ext = if settings.image_format == Some(ImageFormat::Jpeg) { "jpg" } else { "png" };
        format!("out/{safe}.{ext}")
    } else if settings.image_sequence {
        format!("out/{safe}-frames")
    } else {
        format!("out/{safe}.{}", settings.codec.extension())
    }
}

#[derive(Debug, PartialEq)]
pub enum RequestError {
    EmptyComposition,
    UnsafeOutput,
    Settings(SettingsError),
}

impl RenderRequest {
    /// Output must stay inside the project (no absolute paths, no `..`), and the settings must be coherent.
    pub fn validate(&self) -> Result<(), RequestError> {
        if self.composition.trim().is_empty() {
            return Err(RequestError::EmptyComposition);
        }
        let p = std::path::Path::new(&self.output);
        let unsafe_path = self.output.is_empty()
            || p.is_absolute()
            || p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_)));
        if unsafe_path {
            return Err(RequestError::UnsafeOutput);
        }
        self.settings.validate(self.still).map_err(RequestError::Settings)
    }
}

/// Program and arguments, as an array (never a shell string).
pub fn render_command(pm: PackageManager, entry: Option<&str>, req: &RenderRequest) -> (String, Vec<String>) {
    let (program, mut args): (&str, Vec<String>) = match pm {
        PackageManager::Npm => ("npx", vec!["remotion".into()]),
        PackageManager::Pnpm => ("pnpm", vec!["exec".into(), "remotion".into()]),
        PackageManager::Yarn => ("yarn", vec!["remotion".into()]),
        PackageManager::Bun => ("bun", vec!["x".into(), "remotion".into()]),
    };
    args.push(if req.still { "still".into() } else { "render".into() });
    if let Some(e) = entry {
        args.push(e.to_string());
    }
    args.push(req.composition.clone());
    args.push(req.output.clone());
    args.extend(req.settings.to_args(req.still));
    args.push("--overwrite".into());
    (program.into(), args)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Bundling,
    Rendering,
    Encoding,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Progress {
    pub stage: Stage,
    /// 0..=1 within the stage
    pub fraction: f64,
}

impl Progress {
    /// Single 0..=1 number for the queue's bar: bundling 10 %, rendering 75 %, encoding 15 %.
    pub fn overall(&self) -> f64 {
        let (base, span) = match self.stage {
            Stage::Bundling => (0.0, 0.10),
            Stage::Rendering => (0.10, 0.75),
            Stage::Encoding => (0.85, 0.15),
        };
        base + span * self.fraction.clamp(0.0, 1.0)
    }
}

/// Parse a line of `remotion render` output. Handles carriage-return progress updates.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line = line.rsplit('\r').next().unwrap_or(line).trim();
    if let Some(rest) = line.strip_prefix("Bundling ") {
        let pct: f64 = rest.trim_end_matches('%').trim().parse().ok()?;
        return Some(Progress { stage: Stage::Bundling, fraction: pct / 100.0 });
    }
    for (prefix, stage) in [("Rendered ", Stage::Rendering), ("Encoded ", Stage::Encoding)] {
        if let Some(rest) = line.strip_prefix(prefix) {
            let frac = rest.split(',').next()?;
            let (a, b) = frac.split_once('/')?;
            let (a, b): (f64, f64) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
            if b > 0.0 {
                return Some(Progress { stage, fraction: a / b });
            }
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Waiting,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: u32,
    pub request: RenderRequest,
    pub status: Status,
    pub progress: f64,
    pub stage: Option<Stage>,
    /// user-readable failure summary
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct Queue {
    jobs: Vec<Job>,
    next_id: u32,
}

impl Queue {
    pub fn enqueue(&mut self, request: RenderRequest) -> u32 {
        self.next_id += 1;
        self.jobs.push(Job { id: self.next_id, request, status: Status::Waiting, progress: 0.0, stage: None, error: None });
        self.next_id
    }

    pub fn jobs(&self) -> &[Job] {
        &self.jobs
    }

    pub fn get(&self, id: u32) -> Option<&Job> {
        self.jobs.iter().find(|j| j.id == id)
    }

    fn get_mut(&mut self, id: u32) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    pub fn running(&self) -> Option<&Job> {
        self.jobs.iter().find(|j| j.status == Status::Running)
    }

    /// Start the oldest waiting job, unless one is already running (jobs run one at a time).
    pub fn start_next(&mut self) -> Option<Job> {
        if self.running().is_some() {
            return None;
        }
        let job = self.jobs.iter_mut().find(|j| j.status == Status::Waiting)?;
        job.status = Status::Running;
        Some(job.clone())
    }

    pub fn set_progress(&mut self, id: u32, p: Progress) {
        if let Some(j) = self.get_mut(id).filter(|j| j.status == Status::Running) {
            // progress never moves backwards (bundling lines may repeat)
            j.progress = j.progress.max(p.overall());
            j.stage = Some(p.stage);
        }
    }

    pub fn finish(&mut self, id: u32, result: Result<(), String>) {
        if let Some(j) = self.get_mut(id) {
            if j.status == Status::Cancelled {
                return;
            }
            match result {
                Ok(()) => {
                    j.status = Status::Done;
                    j.progress = 1.0;
                }
                Err(e) => {
                    j.status = Status::Failed;
                    j.error = Some(e);
                }
            }
        }
    }

    /// Marks a waiting or running job as cancelled; the caller kills the process for a running one.
    pub fn cancel(&mut self, id: u32) -> bool {
        match self.get_mut(id) {
            Some(j) if matches!(j.status, Status::Waiting | Status::Running) => {
                j.status = Status::Cancelled;
                true
            }
            _ => false,
        }
    }

    pub fn remove(&mut self, id: u32) -> bool {
        let before = self.jobs.len();
        self.jobs.retain(|j| !(j.id == id && j.status != Status::Running));
        self.jobs.len() != before
    }

    pub fn clear_finished(&mut self) {
        self.jobs.retain(|j| matches!(j.status, Status::Waiting | Status::Running));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(name: &str) -> RenderRequest {
        RenderRequest {
            composition: name.into(),
            output: format!("out/{name}.mp4"),
            still: false,
            width: None,
            height: None,
            settings: RenderSettings::new(Codec::H264),
        }
    }

    #[test]
    fn builds_commands_per_package_manager() {
        let (p, a) = render_command(PackageManager::Npm, Some("src/index.ts"), &req("Main"));
        assert_eq!(p, "npx");
        assert_eq!(a.join(" "), "remotion render src/index.ts Main out/Main.mp4 --codec h264 --overwrite");
        let (p, a) = render_command(PackageManager::Pnpm, None, &req("Main"));
        assert_eq!((p.as_str(), a[0].as_str(), a[1].as_str()), ("pnpm", "exec", "remotion"));
        let (p, a) = render_command(PackageManager::Bun, None, &req("Main"));
        assert_eq!((p.as_str(), a[0].as_str()), ("bun", "x"));
    }

    #[test]
    fn stills_use_the_still_command() {
        let mut r = req("A");
        r.still = true;
        r.output = "out/A.png".into();
        let (_, a) = render_command(PackageManager::Yarn, None, &r);
        assert_eq!(a[1], "still");
        assert!(!a.iter().any(|x| x == "--codec"));
    }

    #[test]
    fn composition_names_are_arguments_not_shell() {
        let r = req("a; rm -rf /");
        let (_, a) = render_command(PackageManager::Npm, None, &r);
        assert!(a.contains(&"a; rm -rf /".to_string()));
    }

    #[test]
    fn validation_rejects_unsafe_requests() {
        let mut r = req("A");
        assert_eq!(r.validate(), Ok(()));
        r.output = "../evil.mp4".into();
        assert_eq!(r.validate(), Err(RequestError::UnsafeOutput));
        r.output = if cfg!(windows) { "C:\\x.mp4".into() } else { "/x.mp4".into() };
        assert_eq!(r.validate(), Err(RequestError::UnsafeOutput));
        r.output = "out/a.mp4".into();
        r.settings.crf = Some(0);
        assert!(matches!(r.validate(), Err(RequestError::Settings(_))));
        r.settings.crf = None;
        r.composition = " ".into();
        assert_eq!(r.validate(), Err(RequestError::EmptyComposition));
    }

    #[test]
    fn default_outputs_are_sanitised_and_typed() {
        let h = RenderSettings::new(Codec::H264);
        assert_eq!(default_output("Intro", &h, false), "out/Intro.mp4");
        assert_eq!(default_output("My Comp/1", &RenderSettings::new(Codec::Prores), false), "out/My_Comp_1.mov");
        assert_eq!(default_output("Poster", &h, true), "out/Poster.png");
        let mut seq = h.clone();
        seq.image_sequence = true;
        assert_eq!(default_output("A", &seq, false), "out/A-frames");
        let mut jpg = h;
        jpg.image_format = Some(ImageFormat::Jpeg);
        assert_eq!(default_output("P", &jpg, true), "out/P.jpg");
    }

    #[test]
    fn every_preset_is_valid_unique_and_builds_a_command() {
        let all = presets();
        assert!(all.len() >= 10, "ship at least ten presets");
        let mut ids: Vec<_> = all.iter().map(|p| p.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all.len(), "preset ids are unique");
        for p in &all {
            let r = RenderRequest {
                composition: "Main".into(),
                output: default_output("Main", &p.settings, false),
                still: false,
                width: None,
                height: None,
                settings: p.settings.clone(),
            };
            assert_eq!(r.validate(), Ok(()), "preset {} must be valid", p.id);
            assert!(!p.name.is_empty() && !p.description.is_empty() && !p.tags.is_empty(), "{}", p.id);
            let (_, args) = render_command(PackageManager::Npm, None, &r);
            assert!(args.contains(&"--overwrite".to_string()));
        }
    }

    #[test]
    fn presets_cover_the_main_destinations() {
        let all = presets();
        let tagged = |t: &str| all.iter().any(|p| p.tags.iter().any(|x| x == t));
        for t in ["web", "mac", "windows", "editing", "alpha", "mobile", "audio", "vfx"] {
            assert!(tagged(t), "no preset tagged {t}");
        }
    }

    #[test]
    fn parses_real_remotion_output() {
        assert_eq!(parse_progress("Bundling 80%").unwrap().stage, Stage::Bundling);
        assert_eq!(parse_progress("Bundling 80%").unwrap().fraction, 0.8);
        let p = parse_progress("Rendered 3/10, time remaining: 1s").unwrap();
        assert_eq!((p.stage, p.fraction), (Stage::Rendering, 0.3));
        let p = parse_progress("Encoded 10/10").unwrap();
        assert_eq!((p.stage, p.fraction), (Stage::Encoding, 1.0));
        assert!(parse_progress("Getting composition").is_none());
        assert!(parse_progress("Rendered x/y").is_none());
        assert_eq!(parse_progress("Rendered 1/10\rRendered 2/10").unwrap().fraction, 0.2);
    }

    #[test]
    fn overall_progress_is_monotonic_across_stages() {
        let o = |stage, f| Progress { stage, fraction: f }.overall();
        assert!(o(Stage::Bundling, 1.0) <= o(Stage::Rendering, 0.0) + 1e-9);
        assert!(o(Stage::Rendering, 1.0) <= o(Stage::Encoding, 0.0) + 1e-9);
        assert!((o(Stage::Encoding, 1.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn queue_runs_one_job_at_a_time_in_order() {
        let mut q = Queue::default();
        let a = q.enqueue(req("A"));
        let b = q.enqueue(req("B"));
        assert_eq!(q.start_next().unwrap().id, a);
        assert!(q.start_next().is_none(), "second job must wait");
        q.set_progress(a, Progress { stage: Stage::Rendering, fraction: 0.5 });
        q.set_progress(a, Progress { stage: Stage::Bundling, fraction: 0.2 });
        assert!((q.get(a).unwrap().progress - 0.475).abs() < 1e-9, "progress must not go backwards");
        q.finish(a, Ok(()));
        assert_eq!(q.get(a).unwrap().status, Status::Done);
        assert_eq!(q.start_next().unwrap().id, b);
        q.finish(b, Err("boom".into()));
        assert_eq!(q.get(b).unwrap().error.as_deref(), Some("boom"));
    }

    #[test]
    fn cancel_remove_and_clear() {
        let mut q = Queue::default();
        let a = q.enqueue(req("A"));
        let b = q.enqueue(req("B"));
        q.start_next();
        assert!(q.cancel(a));
        q.finish(a, Err("killed".into()));
        assert_eq!(q.get(a).unwrap().status, Status::Cancelled, "a cancelled job stays cancelled");
        assert!(!q.cancel(a));
        assert!(q.cancel(b));
        assert!(!q.remove(999));
        q.clear_finished();
        assert!(q.jobs().is_empty());
    }

    #[test]
    fn running_jobs_cannot_be_removed() {
        let mut q = Queue::default();
        let a = q.enqueue(req("A"));
        q.start_next();
        assert!(!q.remove(a));
    }
}
