//! Vertical-slice checks against fixtures/sample-project.
//! The preview test needs `npm install` in the fixture, so it is `#[ignore]`d:
//!   cargo test -p reflow-desktop --test sample_project -- --ignored

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;

use reflow_project::{detect_project, PackageManager};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/sample-project")
}

#[test]
fn detects_sample_project_and_compositions() {
    let info = detect_project(&fixture()).expect("fixture is a Remotion project");
    assert_eq!(info.remotion_version, "4.0.532");
    assert_eq!(info.entry_point.as_deref(), Some("src/index.ts"));
    let ids: Vec<_> = info.compositions.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["HelloWorld", "Poster"]);
    let hello = &info.compositions[0];
    assert_eq!((hello.width, hello.height, hello.fps), (Some(1920), Some(1080), Some(30.0)));
    assert_eq!(hello.duration_in_frames, Some(120));
    assert_eq!(hello.duration_seconds, Some(4.0));
    assert!(info.compositions[1].is_still);
    let _ = PackageManager::Npm;
}

fn http_get(port: u16, path: &str) -> String {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    s.write_all(request.as_bytes()).unwrap();
    let mut body = String::new();
    s.read_to_string(&mut body).unwrap();
    body
}

#[test]
#[ignore = "requires `npm install` in fixtures/sample-project; starts ReFlow's Vite player app"]
fn starts_player_app_and_compiles_runtime() {
    let mut proc = reflow_desktop_lib::__test_start_player(&fixture()).expect("player app starts");
    let index = http_get(proc.port, "/");
    let main = http_get(proc.port, "/main.tsx");
    let registry = http_get(proc.port, "/registry.ts");
    let player = http_get(proc.port, "/@id/@remotion/player");
    reflow_desktop_lib::__test_stop_preview(&mut proc);
    assert!(index.starts_with("HTTP/1.1 200"), "index: {}", &index[..index.len().min(300)]);
    assert!(main.starts_with("HTTP/1.1 200"), "main: {}", &main[..main.len().min(600)]);
    assert!(registry.starts_with("HTTP/1.1 200") && registry.contains("HelloWorld"), "registry: {}", &registry[..registry.len().min(600)]);
    let _ = player;
}

#[test]
#[ignore = "requires `npm install` in fixtures/sample-project and starts a real Remotion Studio"]
fn starts_remotion_studio_and_serves_composition() {
    let info = detect_project(&fixture()).unwrap();
    assert!(info.has_node_modules, "run `npm install` in fixtures/sample-project first");
    // reuse the real process manager through the library crate
    let mut proc = reflow_desktop_lib::__test_start_preview(&fixture(), info.package_manager, info.entry_point.as_deref())
        .expect("studio starts");
    let mut s = TcpStream::connect(("127.0.0.1", proc.port)).unwrap();
    s.write_all(b"GET /HelloWorld HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").unwrap();
    let mut body = String::new();
    s.read_to_string(&mut body).unwrap();
    reflow_desktop_lib::__test_stop_preview(&mut proc);
    assert!(body.starts_with("HTTP/1.1 200"), "unexpected response: {}", &body[..body.len().min(200)]);
}

#[test]
fn reads_metadata_and_patches_the_sample_source() {
    use reflow_project::patch::{apply_edit, Edit};
    let info = detect_project(&fixture()).unwrap();
    let hello = &info.compositions[0];
    // metadata exported by the component module + literal defaultProps of the element
    let editable = hello.metadata.as_ref().unwrap()["editable"].as_object().unwrap().clone();
    assert_eq!(editable.len(), 5);
    assert_eq!(editable["opacity"]["max"], 1);
    assert_eq!(hello.default_props.as_ref().unwrap()["title"], "Hello ReFlow");
    assert_eq!(hello.layers.len(), 1);
    assert_eq!(hello.layers[0].name, "Subtitle");
    assert_eq!((hello.layers[0].from, hello.layers[0].duration_in_frames), (45, Some(60)));

    // visual edits round-trip through the real source files
    let root = std::fs::read_to_string(fixture().join(&hello.file)).unwrap();
    let patched = apply_edit(
        &root,
        &Edit::SetDefaultProp { line: hello.line, key: "opacity".into(), value: serde_json::json!(0.4) },
    )
    .unwrap();
    assert!(patched.contains("opacity: 0.4,"));
    assert_eq!(patched.matches("opacity").count(), root.matches("opacity").count());
    let patched = apply_edit(
        &patched,
        &Edit::SetAttribute { tag: "Composition".into(), line: hello.line, name: "width".into(), expr: "1280".into() },
    )
    .unwrap();
    assert!(patched.contains("width={1280}"));
    // the line that was not touched is byte-identical
    assert!(patched.contains("durationInFrames={FPS * 4}"));
}

#[test]
#[ignore = "requires `npm install` in fixtures/sample-project; downloads/uses headless Chrome and renders real frames"]
fn renders_frames_through_the_queue() {
    use reflow_renderer::{Codec, RenderRequest, RenderSettings, Status};
    let info = detect_project(&fixture()).unwrap();
    let out = fixture().join("out/reflow-test.mp4");
    let _ = std::fs::remove_file(&out);
    let jobs = reflow_desktop_lib::__test_render(
        &fixture(),
        info.package_manager,
        info.entry_point.as_deref(),
        RenderRequest {
            composition: "HelloWorld".into(),
            output: "out/reflow-test.mp4".into(),
            still: false,
            width: None,
            height: None,
            settings: {
                let mut s = RenderSettings::new(Codec::H264);
                s.scale = 0.25;
                s.frames = Some((0, 9));
                s
            },
        },
    );
    assert_eq!(jobs[0].status, Status::Done, "error: {:?}", jobs[0].error);
    assert_eq!(jobs[0].progress, 1.0);
    assert!(out.metadata().unwrap().len() > 1000);
}

#[test]
#[ignore = "network: runs npm install for a freshly created template, then previews and renders it"]
fn new_template_project_installs_previews_and_renders() {
    use reflow_renderer::{Codec, RenderRequest, RenderSettings, Status};
    let parent = tempfile_dir();
    let path = reflow_project::templates::create("title", &parent, "e2e-title", "4.0.532").unwrap();
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let ok = std::process::Command::new(npm)
        .args(["install", "--no-audit", "--no-fund"])
        .current_dir(&path)
        .status()
        .unwrap()
        .success();
    assert!(ok, "npm install failed");

    let info = detect_project(&path).unwrap();
    assert!(info.has_node_modules);
    let mut proc = reflow_desktop_lib::__test_start_player(&path).expect("player starts for a template project");
    let registry = http_get(proc.port, "/registry.ts");
    reflow_desktop_lib::__test_stop_preview(&mut proc);
    assert!(registry.contains("\"Title\"") && registry.contains("Hello, motion"), "{}", &registry[..registry.len().min(500)]);

    let jobs = reflow_desktop_lib::__test_render(
        &path,
        info.package_manager,
        info.entry_point.as_deref(),
        RenderRequest {
            composition: "Title".into(),
            output: "out/t.mp4".into(),
            still: false,
            width: None,
            height: None,
            settings: {
                let mut s = RenderSettings::new(Codec::H264);
                s.scale = 0.25;
                s.frames = Some((0, 4));
                s
            },
        },
    );
    assert_eq!(jobs[0].status, Status::Done, "{:?}", jobs[0].error);
    let _ = std::fs::remove_dir_all(&path);
}

fn tempfile_dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("reflow-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
#[ignore = "requires `npm install` in fixtures/sample-project; renders a few frames with EVERY shipped preset"]
fn every_render_preset_really_renders() {
    use reflow_renderer::{default_output, presets, RenderRequest, Status};
    let info = detect_project(&fixture()).unwrap();
    let mut failures = vec![];
    for p in presets() {
        let mut settings = p.settings.clone();
        settings.scale = 0.25; // keep it quick
        settings.frames = Some((0, 5));
        let output = default_output("HelloWorld", &settings, false).replace("out/", &format!("out/preset-{}-", p.id));
        let jobs = reflow_desktop_lib::__test_render(
            &fixture(),
            info.package_manager,
            info.entry_point.as_deref(),
            RenderRequest { composition: "HelloWorld".into(), output: output.clone(), still: false, width: None, height: None, settings },
        );
        let ok = jobs[0].status == Status::Done;
        let path = fixture().join(&output);
        let produced = path.exists() && (path.is_file() && path.metadata().unwrap().len() > 0 || path.is_dir() && path.read_dir().unwrap().count() > 0);
        eprintln!("preset {:<18} {}", p.id, if ok && produced { "ok".to_string() } else { format!("FAILED {:?}", jobs[0].error) });
        if !(ok && produced) {
            failures.push(format!("{}: {:?}", p.id, jobs[0].error));
        }
    }
    assert!(failures.is_empty(), "presets that do not render:
{}", failures.join("
"));
}
