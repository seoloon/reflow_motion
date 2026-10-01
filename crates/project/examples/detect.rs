//! Prints the detection result for a project as JSON: `cargo run -p reflow-project --example detect -- <dir>`
fn main() {
    let dir = std::env::args().nth(1).expect("usage: detect <project dir>");
    match reflow_project::detect_project(std::path::Path::new(&dir)) {
        Ok(info) => println!("{}", serde_json::to_string_pretty(&info).unwrap()),
        Err(e) => {
            eprintln!("{}", e.user_message().title);
            std::process::exit(1);
        }
    }
}
