mod preview;
mod preview_app;
mod render_runner;
mod scope;
mod terminal;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use reflow_project::{detect_project, PackageManager, ProjectInfo, UserMessage};
use serde::Serialize;
use reflow_renderer::{Job, RenderRequest};
use tauri::{AppHandle, Emitter, Manager, State};

use render_runner::{Project, RenderManager};
use terminal::Terminals;

#[derive(Default)]
struct AppState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    root: Option<PathBuf>,
    package_manager: Option<PackageManager>,
    entry_point: Option<String>,
    preview: Option<preview::PreviewProcess>,
    preview_mode: Option<preview::Mode>,
}

fn open_root(state: &State<AppState>) -> Result<PathBuf, UserMessage> {
    state.inner.lock().unwrap().root.clone().ok_or_else(|| UserMessage {
        title: "No project is open.".into(),
        hint: "Open a Remotion project first.".into(),
        details: "root not set".into(),
    })
}

fn fs_error(details: String) -> UserMessage {
    UserMessage {
        title: "That file operation was not possible.".into(),
        hint: "Check that the file exists inside the project and that you have permission.".into(),
        details,
    }
}

#[tauri::command]
fn open_project(app: AppHandle, path: String, state: State<AppState>, renders: State<RenderManager>) -> Result<ProjectInfo, UserMessage> {
    let root = PathBuf::from(&path);
    let info = detect_project(&root).map_err(|e| e.user_message())?;
    stop_preview_inner(&state);
    renders.shutdown();
    // the webview may read media from this project (thumbnails, audio/video metadata) and nothing else
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    let mut inner = state.inner.lock().unwrap();
    inner.root = Some(root);
    inner.package_manager = Some(info.package_manager);
    inner.entry_point = info.entry_point.clone();
    Ok(info)
}

#[tauri::command]
fn refresh_project(state: State<AppState>) -> Result<ProjectInfo, UserMessage> {
    let root = open_root(&state)?;
    let info = detect_project(&root).map_err(|e| e.user_message())?;
    // keep a running player app in sync with the source (Vite reloads on registry change)
    if state.inner.lock().unwrap().preview_mode == Some(preview::Mode::Player) {
        let _ = preview_app::write(&root, &preview_app::generate_for(&info));
    }
    Ok(info)
}

/// Pure source transformation (no I/O): the UI keeps ownership of file contents and history.
#[tauri::command]
fn apply_edit(source: String, edit: reflow_project::patch::Edit) -> Result<String, UserMessage> {
    reflow_project::patch::apply_edit(&source, &edit).map_err(|e| UserMessage {
        title: "That change cannot be applied to the source.".into(),
        hint: "The value is not a plain literal in your code. Edit it in the code editor instead.".into(),
        details: e.to_string(),
    })
}

fn notifier(app: &AppHandle) -> Arc<dyn Fn(Vec<Job>) + Send + Sync> {
    let app = app.clone();
    Arc::new(move |jobs| {
        let _ = app.emit("render-update", jobs);
    })
}

fn render_log(app: &AppHandle) -> Arc<dyn Fn(preview::LogLine) + Send + Sync> {
    let app = app.clone();
    Arc::new(move |line| {
        let _ = app.emit("log", line);
    })
}

#[tauri::command]
fn render_enqueue(
    app: AppHandle,
    request: RenderRequest,
    state: State<AppState>,
    renders: State<RenderManager>,
) -> Result<u32, UserMessage> {
    request.validate().map_err(|e| match e {
        reflow_renderer::RequestError::Settings(s) => UserMessage {
            title: "That render setting is not valid.".into(),
            hint: s.message.clone(),
            details: format!("{}: {}", s.field, s.message),
        },
        other => UserMessage {
            title: "That render setting is not valid.".into(),
            hint: "Check the composition and that the output path is inside the project.".into(),
            details: format!("{other:?}"),
        },
    })?;
    let (root, pm, entry) = {
        let inner = state.inner.lock().unwrap();
        let root = inner.root.clone().ok_or_else(|| UserMessage {
            title: "No project is open.".into(),
            hint: "Open a Remotion project first.".into(),
            details: "root not set".into(),
        })?;
        (root, inner.package_manager.unwrap_or(PackageManager::Npm), inner.entry_point.clone())
    };
    Ok(renders.enqueue(Project { root, pm, entry }, request, notifier(&app), render_log(&app)))
}

#[tauri::command]
fn render_presets() -> Vec<reflow_renderer::Preset> {
    reflow_renderer::presets()
}

#[tauri::command]
fn render_jobs(renders: State<RenderManager>) -> Vec<Job> {
    renders.jobs()
}

#[tauri::command]
fn render_cancel(app: AppHandle, id: u32, renders: State<RenderManager>) {
    renders.cancel(id, &notifier(&app));
}

#[tauri::command]
fn render_remove(app: AppHandle, id: u32, renders: State<RenderManager>) {
    renders.remove(id, &notifier(&app));
}

#[tauri::command]
fn render_clear_finished(app: AppHandle, renders: State<RenderManager>) {
    renders.clear_finished(&notifier(&app));
}

#[derive(Serialize, Clone)]
struct TerminalData {
    id: u32,
    data: String,
}

/// Opens a shell in the project folder. Only called when the user opens the terminal panel.
#[tauri::command]
fn terminal_open(app: AppHandle, cols: u16, rows: u16, state: State<AppState>, terms: State<Terminals>) -> Result<u32, UserMessage> {
    let root = open_root(&state)?;
    let (a1, a2) = (app.clone(), app.clone());
    terms
        .open(
            &root,
            cols,
            rows,
            Arc::new(move |id, data| {
                let _ = a1.emit("terminal-data", TerminalData { id, data });
            }),
            Arc::new(move |id| {
                let _ = a2.emit("terminal-exit", id);
            }),
        )
        .map_err(|d| UserMessage {
            title: "The terminal could not be started.".into(),
            hint: "Check that a shell is available on this system.".into(),
            details: d,
        })
}

#[tauri::command]
fn terminal_write(id: u32, data: String, terms: State<Terminals>) -> Result<(), UserMessage> {
    terms.write(id, &data).map_err(fs_error)
}

#[tauri::command]
fn terminal_resize(id: u32, cols: u16, rows: u16, terms: State<Terminals>) -> Result<(), UserMessage> {
    terms.resize(id, cols, rows).map_err(fs_error)
}

#[tauri::command]
fn terminal_close(id: u32, terms: State<Terminals>) {
    terms.close(id);
}

/// Copies dropped files into `public/`. The paths come from the OS drag-and-drop event.
#[tauri::command]
fn import_assets(paths: Vec<String>, state: State<AppState>) -> Result<reflow_project::assets::ImportResult, UserMessage> {
    let root = open_root(&state)?;
    let sources: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    reflow_project::assets::import_assets(&root, &sources).map_err(|e| fs_error(e.to_string()))
}

fn git_error(e: reflow_git::GitError) -> UserMessage {
    use reflow_git::GitError::*;
    let (title, hint, details) = match e {
        NotInstalled => ("Git was not found.", "Install Git and make sure it is on your PATH.".to_string(), "git executable missing".to_string()),
        NotARepository => ("This project is not a Git repository.", "Run \"git init\" in the terminal to start tracking it.".to_string(), "not a git repository".to_string()),
        InvalidName(n) => ("That name or message is not valid.", "Use a plain branch name without spaces or special characters, and a non-empty message.".to_string(), n),
        Failed(d) => ("Git could not complete that action.", "Details are in the diagnostics log.".to_string(), d),
    };
    UserMessage { title: title.into(), hint, details }
}

/// Relative paths from the UI must stay inside the project before they are handed to git.
fn checked_paths(root: &std::path::Path, paths: &[String]) -> Result<(), UserMessage> {
    for p in paths {
        scope::resolve_in_root(root, p).map_err(fs_error)?;
    }
    Ok(())
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>) -> Result<reflow_git::Status, UserMessage> {
    let root = open_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::status(&root)).await.map_err(|e| fs_error(e.to_string()))?.map_err(git_error)
}

#[tauri::command]
async fn git_branches(state: State<'_, AppState>) -> Result<Vec<reflow_git::Branch>, UserMessage> {
    let root = open_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::branches(&root)).await.map_err(|e| fs_error(e.to_string()))?.map_err(git_error)
}

#[tauri::command]
async fn git_diff(path: String, staged: bool, untracked: bool, state: State<'_, AppState>) -> Result<String, UserMessage> {
    let root = open_root(&state)?;
    checked_paths(&root, std::slice::from_ref(&path))?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::diff(&root, &path, staged, untracked))
        .await
        .map_err(|e| fs_error(e.to_string()))?
        .map_err(git_error)
}

#[tauri::command]
async fn git_stage(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), UserMessage> {
    let root = open_root(&state)?;
    checked_paths(&root, &paths)?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::stage(&root, &paths)).await.map_err(|e| fs_error(e.to_string()))?.map_err(git_error)
}

#[tauri::command]
async fn git_unstage(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), UserMessage> {
    let root = open_root(&state)?;
    checked_paths(&root, &paths)?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::unstage(&root, &paths)).await.map_err(|e| fs_error(e.to_string()))?.map_err(git_error)
}

#[tauri::command]
async fn git_commit(message: String, state: State<'_, AppState>) -> Result<(), UserMessage> {
    let root = open_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || reflow_git::commit(&root, &message)).await.map_err(|e| fs_error(e.to_string()))?.map_err(git_error)
}

#[tauri::command]
async fn git_checkout(branch: String, create: bool, state: State<'_, AppState>) -> Result<(), UserMessage> {
    let root = open_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || if create { reflow_git::create_branch(&root, &branch) } else { reflow_git::checkout(&root, &branch) })
        .await
        .map_err(|e| fs_error(e.to_string()))?
        .map_err(git_error)
}

/// Substring search in the project's source files (used to link a runtime layer to its code).
#[tauri::command]
async fn search_project(query: String, state: State<'_, AppState>) -> Result<Vec<scope::SearchHit>, UserMessage> {
    let root = open_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || scope::search_project(&root, &query, 60)).await.map_err(|e| fs_error(e.to_string()))
}

/// Project files for quick-open (Ctrl+P). Skips dependency, VCS and generated folders.
#[tauri::command]
fn list_files(state: State<AppState>) -> Result<Vec<String>, UserMessage> {
    let root = open_root(&state)?;
    Ok(scope::list_files(&root, 20_000))
}

/// Remotion version new projects are pinned to (what ReFlow is tested against).
const TEMPLATE_REMOTION_VERSION: &str = "4.0.532";

#[tauri::command]
fn list_templates() -> Vec<reflow_project::templates::Template> {
    reflow_project::templates::list()
}

/// Creates `<parent>/<name>` from a template. Nothing is executed; installing dependencies is a separate explicit step.
#[tauri::command]
fn create_project(template: String, parent: String, name: String) -> Result<String, UserMessage> {
    use reflow_project::templates::{create, TemplateError};
    create(&template, std::path::Path::new(&parent), &name, TEMPLATE_REMOTION_VERSION)
        .map(|p| p.display().to_string())
        .map_err(|e| match e {
            TemplateError::InvalidName => UserMessage {
                title: "That project name is not valid.".into(),
                hint: "Use lowercase letters, digits, - and _ (for example my-intro).".into(),
                details: name.clone(),
            },
            TemplateError::AlreadyExists(p) => UserMessage {
                title: "A folder with that name already exists.".into(),
                hint: "Choose another name or another location.".into(),
                details: p,
            },
            TemplateError::UnknownTemplate => UserMessage { title: "That template does not exist.".into(), hint: "Pick one from the list.".into(), details: template.clone() },
            TemplateError::Io(d) => fs_error(d),
        })
}

/// Runs `<package manager> install` in the open project. Only called from an explicit user action.
#[tauri::command]
async fn project_install(app: AppHandle, state: State<'_, AppState>) -> Result<(), UserMessage> {
    let (root, pm) = {
        let inner = state.inner.lock().unwrap();
        let root = inner.root.clone().ok_or_else(|| UserMessage {
            title: "No project is open.".into(),
            hint: "Open a Remotion project first.".into(),
            details: "root not set".into(),
        })?;
        (root, inner.package_manager.unwrap_or(PackageManager::Npm))
    };
    let log = render_log(&app);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), UserMessage> {
        let args = vec!["install".to_string()];
        log(preview::LogLine { source: "install", level: "INFO", message: format!("$ {} install", pm.command()) });
        let mut child = preview::spawn_program(pm.command(), &args, &root).map_err(|e| UserMessage {
            title: "Could not run the package manager.".into(),
            hint: format!("\"{}\" was not found. Check your installation or choose another package manager.", pm.command()),
            details: e.to_string(),
        })?;
        let mut readers = vec![];
        let streams: [Option<Box<dyn std::io::Read + Send>>; 2] = [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        ];
        for s in streams.into_iter().flatten() {
            let log = log.clone();
            readers.push(std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(s).lines().map_while(Result::ok) {
                    log(preview::LogLine { source: "install", level: "INFO", message: preview::strip_ansi(&line) });
                }
            }));
        }
        let status = child.wait().map_err(|e| fs_error(e.to_string()))?;
        for r in readers {
            let _ = r.join();
        }
        if status.success() {
            Ok(())
        } else {
            Err(UserMessage {
                title: "Installing dependencies failed.".into(),
                hint: "Open the diagnostics log to see the package manager's output.".into(),
                details: format!("exit status: {status}"),
            })
        }
    })
    .await
    .map_err(|e| fs_error(e.to_string()))?
}

#[tauri::command]
fn list_dir(path: String, state: State<AppState>) -> Result<Vec<scope::DirEntry>, UserMessage> {
    scope::list_dir(&open_root(&state)?, &path).map_err(fs_error)
}

#[tauri::command]
fn read_file(path: String, state: State<AppState>) -> Result<String, UserMessage> {
    scope::read_text(&open_root(&state)?, &path).map_err(fs_error)
}

#[tauri::command]
fn write_file(path: String, content: String, state: State<AppState>) -> Result<(), UserMessage> {
    scope::write_text(&open_root(&state)?, &path, &content).map_err(fs_error)
}

#[derive(Serialize)]
struct PreviewInfo {
    port: u16,
    mode: &'static str,
    /// Compositions the player app cannot show, with a user-readable reason.
    skipped: Vec<preview_app::Skipped>,
}

fn mode_name(m: preview::Mode) -> &'static str {
    match m {
        preview::Mode::Player => "player",
        preview::Mode::Studio => "studio",
    }
}

/// ReFlow's own Vite (never the project's): `REFLOW_VITE_JS` overrides, otherwise the dev install.
fn vite_entry(app: Option<&AppHandle>) -> Result<PathBuf, UserMessage> {
    const REL: &str = "node_modules/vite/bin/vite.js";
    let resource = |sub: &str| app.and_then(|a| a.path().resource_dir().ok()).map(|d| d.join(sub).join(REL));
    let candidates = [
        std::env::var_os("REFLOW_VITE_JS").map(PathBuf::from),
        // packaged app: bundled resource (see scripts/prepare-engine.mjs)
        resource("resources/preview-engine"),
        resource("preview-engine"),
        // development: the engine installed by `pnpm install` / prepare-engine
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/preview-engine").join(REL)),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../node_modules/vite/bin/vite.js")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .ok_or_else(|| UserMessage {
            title: "The preview engine is missing.".into(),
            hint: "Reinstall ReFlow Motion, or use the Studio preview mode.".into(),
            details: "vite entry script not found".into(),
        })
}

/// Starts a preview server. Runs on a blocking thread so the UI never freezes.
#[tauri::command]
async fn start_preview(app: AppHandle, state: State<'_, AppState>, mode: String) -> Result<PreviewInfo, UserMessage> {
    let mode = if mode == "studio" { preview::Mode::Studio } else { preview::Mode::Player };
    let (root, pm, entry) = {
        let inner = state.inner.lock().unwrap();
        if let Some(p) = &inner.preview {
            if inner.preview_mode == Some(mode) {
                return Ok(PreviewInfo { port: p.port, mode: mode_name(mode), skipped: vec![] });
            }
        }
        let root = inner.root.clone().ok_or_else(|| UserMessage {
            title: "No project is open.".into(),
            hint: "Open a Remotion project first.".into(),
            details: "root not set".into(),
        })?;
        (root, inner.package_manager.unwrap_or(PackageManager::Npm), inner.entry_point.clone())
    };
    // switching mode replaces the running server
    stop_preview_inner(&state);

    let to_msg = |e: preview::StartError| UserMessage { title: e.title, hint: e.hint, details: e.details };
    preview::check_dependencies(&root, pm).map_err(to_msg)?;
    let port = preview::free_port().map_err(|d| fs_error(d))?;

    let mut skipped = vec![];
    let (program, args) = match mode {
        preview::Mode::Studio => preview::studio_command(pm, entry.as_deref(), port),
        preview::Mode::Player => {
            let info = detect_project(&root).map_err(|e| e.user_message())?;
            let generated = preview_app::generate_for(&info);
            let dir = preview_app::write(&root, &generated).map_err(|e| fs_error(e.to_string()))?;
            skipped = generated.skipped;
            preview::player_command(&vite_entry(Some(&app))?, &dir.join("vite.config.mjs"), port)
        }
    };

    let log_app = app.clone();
    let log_root = root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        preview::start(&log_root, program, args, port, move |line| {
            let _ = log_app.emit("log", line);
        })
    })
    .await
    .map_err(|e| fs_error(e.to_string()))?;

    match result {
        Ok(proc) => {
            let mut inner = state.inner.lock().unwrap();
            inner.preview = Some(proc);
            inner.preview_mode = Some(mode);
            Ok(PreviewInfo { port, mode: mode_name(mode), skipped })
        }
        Err(e) => {
            let _ = app.emit(
                "log",
                preview::LogLine { source: "app", level: "ERROR", message: format!("{}: {}", e.title, e.details) },
            );
            Err(to_msg(e))
        }
    }
}

fn stop_preview_inner(state: &State<AppState>) {
    let proc = {
        let mut inner = state.inner.lock().unwrap();
        inner.preview_mode = None;
        inner.preview.take()
    };
    if let Some(mut p) = proc {
        preview::stop(&mut p.child);
    }
}

#[tauri::command]
fn stop_preview(state: State<AppState>) {
    stop_preview_inner(&state);
}

/// Test hooks for integration tests (not part of the app's runtime surface).
#[doc(hidden)]
pub fn __test_start_preview(
    root: &std::path::Path,
    pm: PackageManager,
    entry: Option<&str>,
) -> Result<preview::PreviewProcess, String> {
    let port = preview::free_port()?;
    let (program, args) = preview::studio_command(pm, entry, port);
    preview::start(root, program, args, port, |l| eprintln!("[{}] {}", l.source, l.message))
        .map_err(|e| format!("{}: {}", e.title, e.details))
}

/// Starts the generated player app (needs ReFlow's Vite installed).
#[doc(hidden)]
pub fn __test_start_player(root: &std::path::Path) -> Result<preview::PreviewProcess, String> {
    let info = detect_project(root).map_err(|e| e.to_string())?;
    let generated = preview_app::generate_for(&info);
    let dir = preview_app::write(root, &generated).map_err(|e| e.to_string())?;
    let port = preview::free_port()?;
    let vite = vite_entry(None).map_err(|e| e.details)?;
    let (program, args) = preview::player_command(&vite, &dir.join("vite.config.mjs"), port);
    preview::start(root, program, args, port, |l| eprintln!("[{}] {}", l.source, l.message))
        .map_err(|e| format!("{}: {}", e.title, e.details))
}

/// Runs one render to completion through the real queue and returns the final job list.
#[doc(hidden)]
pub fn __test_render(root: &std::path::Path, pm: PackageManager, entry: Option<&str>, req: RenderRequest) -> Vec<Job> {
    let mgr = RenderManager::default();
    let (tx, rx) = std::sync::mpsc::channel::<Vec<Job>>();
    let tx = Mutex::new(tx);
    let notify: Arc<dyn Fn(Vec<Job>) + Send + Sync> = Arc::new(move |j| {
        let _ = tx.lock().unwrap().send(j);
    });
    let log: Arc<dyn Fn(preview::LogLine) + Send + Sync> = Arc::new(|l| eprintln!("[{}] {}", l.source, l.message));
    mgr.enqueue(Project { root: root.into(), pm, entry: entry.map(String::from) }, req, notify, log);
    loop {
        let jobs = rx.recv_timeout(std::time::Duration::from_secs(300)).expect("render finishes");
        if jobs.iter().all(|j| !matches!(j.status, reflow_renderer::Status::Waiting | reflow_renderer::Status::Running)) {
            return jobs;
        }
    }
}

/// Writes the generated preview app for a project (used by the dev harness).
#[doc(hidden)]
pub fn __write_preview_app(root: &std::path::Path) -> Result<(), String> {
    let info = detect_project(root).map_err(|e| e.to_string())?;
    preview_app::write(root, &preview_app::generate_for(&info)).map(|_| ()).map_err(|e| e.to_string())
}

#[doc(hidden)]
pub fn __test_stop_preview(p: &mut preview::PreviewProcess) {
    preview::stop(&mut p.child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(RenderManager::default())
        .manage(Terminals::default())
        .invoke_handler(tauri::generate_handler![
            open_project,
            refresh_project,
            apply_edit,
            render_enqueue,
            list_templates,
            create_project,
            project_install,
            git_status,
            git_branches,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_checkout,
            list_files,
            search_project,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
            import_assets,
            render_jobs,
            render_presets,
            render_cancel,
            render_remove,
            render_clear_finished,
            list_dir,
            read_file,
            write_file,
            start_preview,
            stop_preview
        ])
        .build(tauri::generate_context!())
        .expect("error while building ReFlow Motion")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<RenderManager>().shutdown();
                app.state::<Terminals>().close_all();
                let state = app.state::<AppState>();
                let proc = state.inner.lock().unwrap().preview.take();
                if let Some(mut p) = proc {
                    preview::stop(&mut p.child);
                }
            }
        });
}
