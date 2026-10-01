# Architecture

> Code and visual editing are two interfaces to the same Remotion project.
> The project on disk is the single source of truth. There is no proprietary project format.

## Overview

```
┌──────────────── Tauri app (apps/desktop) ────────────────┐
│ WebView: React UI                                         │
│  stores: app | project | editor | preview | timeline ...  │
│        │ invoke() / events                                │
│ ───────┼──────────────────────────────────────────────── │
│ Rust (src-tauri): thin command layer                      │
│   └── crates/project  (pure Rust, unit-tested)            │
│        detect project, package manager, versions,         │
│        entry point, scripts, assets, compositions         │
│   └── process manager (spawn/kill dev server, later render)│
└───────────────┬───────────────────────────────────────────┘
                │ child process (explicit user action only)
        ┌───────▼────────┐   http://localhost:PORT
        │ remotion studio │◄──── iframe in Preview panel
        │ (user project)  │
        └─────────────────┘
```

## Decisions

### ADR-1 Tauri 2 + React/TypeScript
Rust owns filesystem, processes, project analysis; the web side owns UI. Rust crates contain
logic with no Tauri dependency so it is testable with `cargo test`.

### ADR-2 Remotion is never linked (see `licensing.md`)
Preview and render both run the user's installed Remotion as a child process.

### ADR-3 Two preview modes: Player (default) and Studio
Remotion Studio exposes no API to drive its playhead from outside (checked in 4.0.532: no frame
URL parameter, no message channel; its BroadcastChannel is only for media extraction), and the
renderer's page protocol (`window.remotion_setFrame`, bundle `siteVersion`) is internal and versioned.

**Player mode** (default): ReFlow generates a small Vite app in `<project>/.reflow/preview/`
(self-ignoring via `.reflow/.gitignore`). It imports each composition's component (resolved
statically from `component={X}` and the imports of the file that declares it) and plays it with the
project's own `@remotion/player` (resolved from the project, falling back to the location of `@remotion/studio`
or `@remotion/cli` for pnpm layouts). Vite is ReFlow's own copy; it runs as a child process on 127.0.0.1.
The host talks to it through a `postMessage` protocol (`apps/desktop/src/lib/previewProtocol.ts`):
load / play / pause / toggle / seek / loop / rate / zoom / alpha, and ready / loaded / frame / playing / error back.
This is what the timeline drives.

Trade-offs: compositions with `lazyComponent`, non-identifier `component`, or components that are not exported are
listed as "cannot preview" with a reason (never silently dropped). Values we cannot resolve statically
(imported constants, `calculateMetadata`) fall back to 1920x1080 / 30fps / 150f and are flagged `estimated`.
`remotion.config.ts` webpack overrides do not apply in Vite. Audio and `staticFile()` rely on the project's `public/` dir (served as Vite's publicDir).

**Studio mode**: the previous behaviour (iframe on the project's `remotion studio`), useful for exact parity with the
project's own webpack setup. No external control.

### ADR-4 Static composition discovery first
Regex scan in Rust now; AST (oxc/swc) when it fails in practice. Authoritative discovery via running
Remotion is opt-in because it executes project code.

### ADR-5 Security
- Project code is untrusted. Nothing is executed on "open". Dev server / scripts start only
  after an explicit user click ("Start preview"), shown with the exact command.
- Spawned commands are built from argument arrays (no shell string interpolation).
- Filesystem commands are scoped: every path is canonicalised and must lie within the open project root.
- Tauri capabilities grant only the commands we define; no broad `fs`/`shell` plugin scope.

### ADR-6 State boundaries
One zustand store per boundary: `app`, `project`, `editor`, `preview`, `timeline`, `inspector`, `render`.
No cross-store imports of internals; coordination through explicit actions or the command registry.

### ADR-7 Commands and history
All user actions go through a central **command registry** (`id`, `title`, `keybinding`, `run`).
Visual edits become `Edit` objects (`apply`/`invert`) pushed to one history stack (milestone 4).
Code ↔ visual sync is performed by *source-patching* the TSX (AST rewrite) so the file remains human-authored.

### ADR-8 Component metadata (milestone 3)
Components opt in via an exported plain object, no ReFlow import needed:
```ts
export const motionMetadata = { editable: { opacity: { type: "number", min: 0, max: 1 } } };
```
Similar in spirit to Remotion's `schema` (zod) props and Storybook `argTypes`/Figma component props;
the format is ours, JSON-serialisable and statically extractable.

### ADR-9 Errors
Rust returns typed errors with `code`, `title`, `hint`, `details`. UI shows title+hint;
details go to the diagnostics log. Never raw `spawn ENOENT`.

## Layout of the repo

```
apps/desktop/        Tauri + React app (src/ UI, src-tauri/ Rust shell)
crates/project/      Remotion project detection & composition discovery (pure Rust)
packages/            created only when code is actually shared (YAGNI)
docs/
```
Crates/packages from the original sketch (`renderer`, `terminal`, `git`, `timeline`...) are
**not created yet**; they appear when their milestone starts.

## Timeline (M2)

`lib/timeline.ts` is a pure model (frame<->pixel, timecode, ruler ticks, layer bars) with unit tests.
The playhead/scrub UI only emits `seek(frame)`; the preview app is the source of truth for the current frame and reports it back,
so Player, timeline and (later) inspector cannot drift. Scrubbing is coalesced to one seek per animation frame.
Only ruler ticks in the visible range are rendered. Layers are `<Sequence>` elements found statically in the component's file.

## Milestone 1 vertical slice

open folder → `detect_project` → composition list → "Start preview" spawns studio →
iframe shows composition → Monaco edits file → save writes to disk → Remotion HMR refreshes.

## Visual editing pipeline (M3–M4)

Inspector, timeline and keyframe edits never keep their own copy of the project. Each one becomes a typed
`Edit` (`crates/project/src/patch.rs`, `animation.rs`): `setAttribute`, `setDefaultProp`, `setKeyframe`,
`insertKeyframe`, `removeKeyframe`. The Rust side is a pure function `apply_edit(source, edit) -> source`
that rewrites only the touched value (comments preserved, byte offsets kept, non-literals refused).
The UI (`stores/edits.ts`) reads the current text (open tab first, then disk), applies the edit, writes the file,
pushes `{before, after}` on **one** history stack (`lib/history.ts`; drags coalesce into one step) and refreshes
project detection. Undo/redo restores whole-file text, so it is exact whatever produced the change.
Live feedback while dragging goes to the preview as `props` messages (no file write until release).

`motionMetadata` (exported plain object, no ReFlow import) decides what the inspector may edit; ReFlow does not try to infer
editable props from arbitrary React code.

## Rendering (M5)

`crates/renderer` is pure: it builds the `remotion render|still` invocation as an argument array, parses
`Bundling n%` / `Rendered a/b` / `Encoded a/b` lines into a monotonic progress value and owns the queue state machine.
`render_runner.rs` runs one job at a time on its own thread, streams logs, and kills the whole process tree on cancel.
Outputs must stay inside the project (validated in Rust). FFmpeg is Remotion's, never bundled.

## Terminal, assets, Git (M5–M6)

- Terminal: real PTY (`portable-pty`) + xterm.js; started only by an explicit click.
- Assets: filesystem only (`public/`); drag-and-drop copies files (never overwrites), media is read through Tauri's asset protocol scoped to the open project at runtime.
- Git: `crates/git` runs the user's `git` with argument arrays, parses `status --porcelain=v2 -z`, validates branch names, and refuses to switch branch with unsaved editor changes.

## Workspaces and commands (M6)

`lib/workspace.ts` holds pure layout presets (Motion hides the editor, Code hides the inspector, Render and Debug pick
their dock tab) plus sanitising of saved layouts. Panels the user hides stay mounted (editor tabs, terminal session, timeline scroll survive).
Every action is a registered command; key bindings are data (`id -> binding | null`) and user overrides persist locally.

## ADR-10 AI assistant (M7)

No model is bundled or required. `src/ai` defines the contract a provider plugs into:
- **Context** (`context.ts`): a pure snapshot of what the assistant may know — compositions, props, layers, keyframes, timeline, selection, open files, git status, recent errors. No absolute paths, no dependency list.
- **Tools** (`tools.ts`): `get_project_context`, `read_file`, `list_files`, `get_logs`, `propose_change`. There is deliberately **no write tool**.
- **Proposals** (`proposals.ts`): `propose_change` stores `{before, after}`; the user reviews a diff and applies it. Applying checks the file did not change since, writes through the undoable pipeline, and can be undone with Ctrl+Z.
- **Agent loop** (`agent.ts`): ask → run tools → feed results → repeat, with a step limit and abort.
Providers register with `useAi.getState().registerProvider(...)`. Without one, the AI tab still offers "copy project context" for use with any external assistant.

## ADR-11 Browser harness (development only)

`apps/desktop/dev` runs the real UI in a plain browser against `bridge.mjs`, which uses the real Rust detection and patching
(cargo examples) and a real preview server on a *copy* of the sample project. It exists because typechecking and unit tests did not catch
two runtime bugs that the harness did. It is not shipped.
