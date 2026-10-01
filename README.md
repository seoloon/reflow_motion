# ReFlow Motion

An open-source desktop environment for building, previewing, editing and rendering
[Remotion](https://www.remotion.dev) projects. Code and visual editing are two views of the same project:
no proprietary format, your `package.json` / `src/` / `public/` stay as they are.

License: **GNU GPL v3 or later**. See `docs/licensing.md` — notably, Remotion itself has its own license and is
**never bundled**: ReFlow runs the Remotion installed in *your* project.

## What works

- Open or create (templates) a Remotion project; detection of package manager, Remotion version, entry point, compositions, layers, keyframes, assets.
- Player preview with play/pause/step/loop/speed/zoom, timeline with playhead, scrubbing, markers, layers and keyframes.
- Inspector for composition settings, layer timing, keyframes and any prop the component exposes through `motionMetadata`; every change is a minimal edit of your own source, with undo/redo.
- Monaco code editor, command palette (Ctrl/Cmd+Shift+P), quick open (Ctrl/Cmd+P), customisable shortcuts, four workspaces.
- Render queue (Remotion CLI), asset browser with drag-and-drop, integrated terminal, Git panel, diagnostics log.
- AI-ready architecture (no model required): project context, read-only tools, diff review before anything is written.

See `docs/roadmap.md` for the honest list of gaps.

## Develop

Requirements: Node 20+, pnpm, Rust (stable), the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev                 # run the desktop app
pnpm test                # frontend tests + cargo tests
pnpm typecheck
```

Run the UI in a plain browser against the real Rust code (no Tauri window): `node apps/desktop/dev/bridge.mjs`, `pnpm --filter @reflow/desktop exec vite`, then open `http://localhost:1420/dev/mock.html`.

Try it on the bundled sample: `cd fixtures/sample-project && npm install`, then "Open Project…" and pick that folder.
End-to-end check of the real Remotion Studio launch:
`cargo test -p reflow-desktop --test sample_project -- --ignored`

## Layout

```
apps/desktop/          Tauri app (React UI in src/, Rust shell in src-tauri/)
crates/project/        project detection, composition/layer/keyframe scan, source patching, templates (pure Rust)
crates/renderer/       render command building, progress parsing, job queue (pure Rust)
crates/git/            Git CLI wrapper + porcelain parser
fixtures/              sample Remotion project used by tests
docs/                  architecture, dependencies, licensing, roadmap
```

## Safety

Opening a project executes nothing. The preview server starts only when you click **Start preview**; the exact
command is written to the diagnostics log (Ctrl/Cmd+J).
