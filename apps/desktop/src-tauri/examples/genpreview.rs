//! Regenerates <project>/.reflow/preview for a project (dev harness): `cargo run -p reflow-desktop --example genpreview -- <dir>`
fn main() {
    let dir = std::env::args().nth(1).expect("usage: genpreview <project dir>");
    reflow_desktop_lib::__write_preview_app(std::path::Path::new(&dir)).expect("generate");
}
