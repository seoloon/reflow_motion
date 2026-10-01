//! Applies one visual edit: reads {"source": "...", "edit": {...}} from stdin, prints the patched source.
use std::io::Read;

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let v: serde_json::Value = serde_json::from_str(&input).expect("json");
    let edit: reflow_project::patch::Edit = serde_json::from_value(v["edit"].clone()).expect("edit");
    match reflow_project::patch::apply_edit(v["source"].as_str().unwrap(), &edit) {
        Ok(s) => print!("{s}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    }
}
