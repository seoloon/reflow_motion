# Dependency research & decisions

Licenses were read from the npm / crates.io registry metadata (October 2026) and must be
re-verified when versions are bumped. See `THIRD_PARTY.md` for the registry of what actually ships.

## Desktop shell

| Option | License | Verdict |
|--------|---------|---------|
| **Tauri 2** | MIT / Apache-2.0 | **Chosen.** Small, Rust backend, system WebView, permission model. |
| Electron | MIT | Compatible, but heavy and no Rust core. Rejected (prompt asks for Tauri). |
| Wails / Neutralino | MIT | Less mature plugin/IPC/security model. |
| Tauri 3 (alpha) | MIT / Apache-2.0 | Alpha; stay on 2.x. |

Caveat: Tauri uses WebView2 (Win), WKWebView (mac), WebKitGTK (Linux). Preview iframes load the
Remotion dev server in these webviews; Remotion Studio targets Chromium, so WebKit
rendering differences are a known risk. Mitigation: final renders always go through Remotion's
Chromium; preview fidelity on WebKitGTK/WKWebView to be validated in milestone 2.

## Code editor

| Option | License | Verdict |
|--------|---------|---------|
| **Monaco Editor** | MIT | **Chosen.** Built-in TS/TSX language service, diagnostics, search/replace, minimap, command palette. Bundled locally (no CDN). |
| CodeMirror 6 | MIT | Lighter, but TS language service requires extra work. Revisit if Monaco is too heavy. |
| Code-OSS embedding | MIT (source), but MS branding/marketplace restricted | Too heavy, forks drift. Rejected for now. |

Monaco's TS worker does not know about the project's `node_modules` types by default; we will
feed it `.d.ts` via `addExtraLib` / later an LSP (`typescript-language-server`, Apache-2.0, as a process).

## Frontend

| Dependency | License | Use |
|-----------|---------|-----|
| React 19 | MIT | UI |
| Vite | MIT | bundler / dev server |
| TypeScript | Apache-2.0 | language |
| Vitest | MIT | frontend tests |
| zustand | MIT | small independent state stores (one per boundary) |
| @xterm/xterm | MIT | terminal front end (milestone 5) |
| Lucide icons | ISC | icons (later) |

## Rust

| Crate | License | Use |
|-------|---------|-----|
| tauri, tauri-build | MIT / Apache-2.0 | shell |
| serde, serde_json | MIT / Apache-2.0 | IPC + parsing |
| regex | MIT / Apache-2.0 | lightweight composition scanning (see below) |
| walkdir | Unlicense / MIT | filesystem traversal |
| thiserror | MIT / Apache-2.0 | error types |
| portable-pty (milestone 5) | MIT | PTY for terminal |
| git2 vs `git` CLI (milestone 6) | git2: MIT/Apache; libgit2 GPLv2+linking exception | Prefer shelling out to `git` (process boundary). |

## Remotion

| Item | License | Decision |
|------|---------|----------|
| `remotion`, `@remotion/*` | Remotion License (source-available) | **Never bundled**; run from the user's project as a child process. See `licensing.md`. |
| Remotion Studio | same | Used as the preview server (iframe) in the first slice. |
| `@remotion/player` | same | Not used by ReFlow; may appear only inside user projects. |

## Composition discovery strategy

Options considered:

1. **Run Remotion's bundler/`getCompositions()` via Node** — authoritative, but executes
   untrusted project code and is slow.
2. **Static scan** of `<Composition ... />` / `<Still ... />` JSX with a parser — safe, instant,
   works offline; fails on dynamically generated compositions.
3. **Query the running Remotion Studio** — authoritative, but requires the user to have started it.

Decision: milestone 1 uses (2) in Rust (regex over the sources found from the entry point, tolerant
of `fps={30}` constants-in-same-file). Later: optionally (1) behind an explicit "Run project" user action
for authoritative data, with the static scan used as a fast preview. Replace regex by `oxc`/`swc` (both MIT/Apache)
when the regex approach shows real failures.

## Terminal

xterm.js (MIT) front end + `portable-pty` (MIT) in Rust. No existing GPL-compatible
all-in-one component is better. Milestone 5.

## Existing motion design apps

Rive, Cavalry, After Effects, Figma are proprietary: used for UX inspiration only, no code reuse.
Remotion Studio's timeline is under the Remotion License: no code reuse. Timeline UI will be our own.
