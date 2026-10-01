# Roadmap

Rule: every item must make creating Remotion motion graphics substantially easier or faster.

- [x] **M0** architecture, dependency research, licensing audit, skeleton
- [x] **M1** Tauri app, open project, file explorer, project detection, Monaco editor, preview via Remotion Studio
- [x] **M2** composition browser, controllable preview bridge (play/seek), timeline playhead + scrubbing, basic layers
- [x] **M3** inspector, element selection (composition / layer / animation / keyframe), `motionMetadata`
- [x] **M4** code ↔ visual synchronisation (source patching), undo/redo history
- [x] **M5** render queue, asset browser (drag-and-drop import), integrated terminal
- [x] **M6** workspaces (Motion / Code / Render / Debug), command palette + quick open, customisable shortcuts, Git, diagnostics, toasts / context menu / dialogs, preview engine packaging
- [x] **M7** keyframes (read, move, add, delete), project templates, AI architecture (context, tools, reviewable proposals)

## UI redesign (post-M7)

Radix UI primitives (the foundation shadcn/ui is built on) + Lucide icons + a CSS-variable design system (`theme.css`).
VS Code-style menu bar with a command centre, DaVinci-style page bar (Motion, Code, Media, Render, Debug), collapsible side bar / bottom panel / inspector
(buttons, shortcuts, and a rail to reopen), fullscreen preview, Remotion-blue accent, SFX layers in green (other audio in teal).
Everything is sized in `rem` and the root font size follows the window (16px at 1440 wide, 24px at 4K), so the same layout suits a 13" laptop and a 32" 4K display.
Default shortcuts follow Premiere Pro (Space, J/K/L, arrows, Up/Down edit points, I/O in/out, M markers, Home/End, `=`/`-`/`\` timeline zoom, Alt+wheel zoom, Shift+wheel pan, middle-drag pan);
the command palette opens with Ctrl/Cmd+Shift+P, Ctrl/Cmd+K or F1. All bindings are rebindable.
The Render page exposes every Remotion encoding option (codec, CRF / bitrate, x264 speed, ProRes profile, pixel format, colour space, fps and size overrides,
audio, GIF, concurrency, props) with 11 presets (web, 4K, social, small file, HEVC, ProRes 422 HQ, ProRes 4444 + alpha, WebM + alpha, GIF, PNG sequence, WAV);
every preset is verified by a real render in an integration test, and users can save their own.

## Motion mode: runtime introspection (post-M7)

Static analysis cannot see values computed by the project (imported constants, helper functions, `.map()` over data, `calculateMetadata`),
so the preview runtime now reads the truth from the running project: real composition size / fps / duration / default props, and the real
`<Sequence>` tree (via Player's own timeline hook, discovered by a one-off sweep of the timeline). The timeline shows nested layers with
hide / solo / lock, click-to-select on the canvas with an outline, and drag/trim for layers that map to a literal `<Sequence>` in the source.
Props without `motionMetadata` get controls inferred from their real values. Edits persist when the value is a literal (inline, or in a
`const defaults = {…}` in the same file); otherwise they stay preview-only and ReFlow says so.
Still open: linking computed layers to their source (needs source maps), editing data-driven timings (e.g. a `SCENES` table), transforms
(position/scale/rotation) on arbitrary layers, value graph editor, and keyframes outside `interpolate()` with literal arrays.

## Known gaps (honest list)

Preview / timeline
- Continuous playback was never watched end-to-end in an automated browser (it throttles `requestAnimationFrame`); seek, load, props and events were. Needs a manual check.
- No FPS readout, safe-area overlays, timeline marker editing UI beyond add/jump, layer visibility/lock, multi-selection, copy/paste, snapping.
- Layers and keyframes come from a static scan of the component's own file: `Sequence`/`interpolate` calls in other files, with non-literal arguments, or relative to a `Sequence` are shown read-only or not at all.
- Vite reloads the preview page on source changes (no React state preservation); the current frame is restored.

Editing
- Only values that are plain literals can be patched. Everything else is refused with an explanation (never guessed).
- Easing, spring and colour keyframes are not editable; only numeric `interpolate()` arrays.
- Monaco shows syntax errors only; the project's `node_modules` types are not loaded (LSP planned).

Platform
- Verified on Windows only. macOS/Linux (WebKit webviews, `$SHELL`, PTY, packaging per platform) are untested.
- The packaged build includes ReFlow's Vite as a resource (`scripts/prepare-engine.mjs`); an installer was never produced or smoke-tested.
- The Tauri window itself was launched but not driven by hand; UI behaviour was verified in a browser harness (`apps/desktop/dev`) against the real Rust code and a real preview server.

AI
- No provider is bundled. The interface, tools, review/apply flow and agent loop are tested with scripted providers only.

Rendering
- One job at a time; codec/scale/frame-range only. No props override per render, no still/sequence output formats beyond PNG still, no cancel-in-bundling guarantees on every OS.
