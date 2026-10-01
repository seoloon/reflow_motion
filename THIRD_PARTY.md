# Third-party registry

Only dependencies that ship in (or are required to build) the application. Versions are those resolved in lockfiles.
Reasoning: `docs/dependencies.md`, `docs/licensing.md`.

| Dependency | Version | Repository | License | Purpose | Integration | GPLv3 notes |
|-----------|---------|-----------|---------|---------|-------------|-------------|
| tauri / tauri-build | 2.x | github.com/tauri-apps/tauri | MIT OR Apache-2.0 | desktop shell | static (Rust) | compatible |
| serde / serde_json | 1.x | github.com/serde-rs/serde | MIT OR Apache-2.0 | IPC/serialisation | static | compatible |
| regex | 1.x | github.com/rust-lang/regex | MIT OR Apache-2.0 | composition scan | static | compatible |
| walkdir | 2.x | github.com/BurntSushi/walkdir | Unlicense OR MIT | fs traversal | static | compatible |
| thiserror | 2.x | github.com/dtolnay/thiserror | MIT OR Apache-2.0 | errors | static | compatible |
| react / react-dom | 19.x | github.com/facebook/react | MIT | UI | bundled | compatible |
| monaco-editor | 0.5x | github.com/microsoft/monaco-editor | MIT | code editor | bundled locally | compatible |
| @monaco-editor/react | 4.x | github.com/suren-atoyan/monaco-react | MIT | React wrapper | bundled | compatible |
| tauri-plugin-dialog / @tauri-apps/plugin-dialog | 2.x | github.com/tauri-apps/plugins-workspace | MIT OR Apache-2.0 | native folder picker | static / bundled | compatible. Pulls `tauri-plugin-fs` transitively; its permissions are NOT granted (see capabilities/default.json). |
| tempfile | 3.x | github.com/Stebalien/tempfile | MIT OR Apache-2.0 | tests only | dev only | not distributed |
| vite | 8.x | github.com/vitejs/vite | MIT | runs the generated preview app in the user's project | separate Node process (ReFlow's own copy) | compatible. Must be shipped as a resource when packaging. |
| zustand | 5.x | github.com/pmndrs/zustand | MIT | state | bundled | compatible |
| @tauri-apps/api | 2.x | github.com/tauri-apps/tauri | MIT OR Apache-2.0 | IPC client | bundled | compatible |
| vite, @vitejs/plugin-react, vitest, typescript, @tauri-apps/cli | – | – | MIT / Apache-2.0 | build & test tooling | dev only | not distributed |

## Used at runtime from the user's project (not ours)

`@remotion/player` is imported by the generated preview app from the user's `node_modules`. It is never copied into ReFlow;
the user's Remotion license terms apply to their project (see docs/licensing.md).

## Explicitly NOT bundled

| Dependency | License | Reason |
|-----------|---------|--------|
| remotion, @remotion/* | Remotion License (source-available) | Not GPL-compatible to bundle. Used only from the user's project, as a separate process. |
| FFmpeg | LGPL/GPL depending on build | Provided by Remotion/user environment. |

## Added in milestones 3–7

| Dependency | Version | Repository | License | Purpose | Integration | GPLv3 notes |
|-----------|---------|-----------|---------|---------|-------------|-------------|
| portable-pty | 0.9 | github.com/wezterm/wezterm (pty crate) | MIT | terminal PTY | static (Rust) | compatible |
| imagesize | 0.15 | github.com/Roughsketch/imagesize | MIT | image dimensions from file headers | static | compatible |
| @xterm/xterm, @xterm/addon-fit | 6.x | github.com/xtermjs/xterm.js | MIT | terminal front end | bundled | compatible |
| git (executable) | user's | git-scm.com | GPL-2.0 | Git operations | separate process, not bundled | aggregate, no linking |
| vite | 8.x | github.com/vitejs/vite | MIT | preview engine (bundled as a resource at packaging) | separate Node process | compatible; ships with its own dependency licenses (see `resources/preview-engine/node_modules` at packaging time — to be audited before a release) |
