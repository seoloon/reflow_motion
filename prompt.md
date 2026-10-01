# Project: Remotion Motion Design IDE

You are the lead engineer and architect of a new open-source desktop application dedicated to building, previewing, editing, and rendering Remotion projects.

The project is intended to be released under **GNU GPL v3**.

The goal is NOT to create another generic code editor.

The goal is to create a **professional motion-design development environment for Remotion**, combining:

* the power and flexibility of React/TypeScript/Remotion
* a visual motion-design workflow
* a professional code editor
* a real-time composition preview
* a timeline
* visual property editing
* AI-assisted development in the future
* deterministic Remotion rendering

The application should feel like a serious creative tool rather than a developer utility.

---

# 1. Core product vision

The application should sit somewhere between:

* VS Code / Cursor
* After Effects
* Cavalry
* Rive
* Figma
* Remotion Studio

But it must NOT attempt to clone any of them.

The fundamental idea is:

> **Code and visual editing are two interfaces to the same Remotion project.**

A user should be able to:

1. open an existing Remotion project
2. see its compositions
3. preview them in real time
4. inspect visual elements
5. modify supported properties visually
6. see the corresponding code update
7. edit the code directly
8. immediately see the visual result
9. scrub through the timeline
10. render the final result using Remotion

The application should support both:

### Developer workflow

```text
Files
Code
Terminal
Git
Dependencies
Debugging
```

and:

### Motion designer workflow

```text
Canvas
Timeline
Layers
Inspector
Keyframes
Animation controls
Assets
Composition settings
```

A hybrid user should be able to switch between both workflows naturally.

---

# 2. First task: research before implementation

DO NOT immediately start writing large amounts of code.

First inspect the ecosystem and determine what can be reused.

Investigate existing open-source projects and libraries for:

* VS Code
* Code-OSS
* Monaco Editor
* CodeMirror
* Remotion
* Remotion Studio
* React DevTools
* timeline components
* animation editors
* keyframe editors
* graph editors
* scene graphs
* property inspectors
* media players
* video rendering
* terminal emulation
* file explorers
* project/workspace management
* Git integration
* TypeScript language services
* LSP
* Rust desktop application frameworks
* Tauri
* WebView implementations
* Electron alternatives
* existing open-source motion-design applications

Look specifically for projects that can legally coexist with a **GPLv3 application**.

For every potentially reused dependency:

* identify its license
* determine whether it is compatible with GPLv3
* determine whether it creates obligations for the final application
* determine whether it should be dynamically or statically integrated
* document the decision

Create:

```text
docs/architecture.md
docs/dependencies.md
docs/licensing.md
docs/roadmap.md
```

before major implementation begins.

Do not copy code from projects without verifying their license.

---

# 3. Licensing

The application itself must be:

**GNU GPL v3**

Add an appropriate LICENSE file.

Every third-party dependency must be tracked.

Maintain a dependency/license registry such as:

```text
THIRD_PARTY.md
```

Document:

* dependency
* version
* repository
* license
* purpose
* integration method
* compatibility considerations

Avoid dependencies with licenses that are incompatible with GPLv3.

Do not introduce proprietary SDKs as core dependencies.

Optional integrations may use different licensing strategies if they are properly isolated.

---

# 4. Architecture

Prefer:

```text
Rust
└── Tauri
    ├── application shell
    ├── filesystem
    ├── process management
    ├── project management
    ├── rendering orchestration
    ├── terminal
    ├── Git integration
    ├── IPC
    └── native OS integration

TypeScript
└── React
    ├── IDE UI
    ├── code editor
    ├── composition preview
    ├── timeline
    ├── inspector
    ├── project explorer
    ├── asset browser
    └── future AI interface
```

Use Rust for functionality that benefits from:

* native performance
* filesystem access
* process management
* rendering orchestration
* project management
* system integration
* concurrency
* large-file handling

Use TypeScript/React for:

* UI
* editor integration
* visual composition editing
* timeline
* inspector
* interaction-heavy interfaces

Do not force Rust to handle functionality that is naturally implemented in the web frontend.

---

# 5. Tauri

Use Tauri as the desktop application framework unless a clearly superior GPL-compatible architecture is discovered.

Target:

* Windows
* macOS
* Linux

Do not make platform-specific functionality the foundation of the architecture.

Abstract platform-specific functionality behind Rust interfaces.

---

# 6. UI philosophy

The interface must feel like a professional creative application.

Avoid:

* generic SaaS dashboards
* excessive rounded cards
* excessive gradients
* excessive glassmorphism
* excessive animations
* visual noise
* unnecessary buttons
* developer-tool aesthetics everywhere

The design should be:

* precise
* calm
* dense where appropriate
* highly readable
* keyboard friendly
* customizable
* professional
* visually hierarchical

Think:

**professional creative software + modern developer tooling**

rather than:

**web application pretending to be an IDE.**

The UI should eventually have a coherent design system.

Create reusable primitives for:

* panels
* tabs
* toolbars
* inspectors
* property rows
* numeric inputs
* sliders
* color pickers
* timeline controls
* tree views
* context menus
* command palette
* notifications
* dialogs

---

# 7. Initial layout

The initial workspace should roughly resemble:

```text
┌──────────────────────────────────────────────────────────────┐
│ App / Project / Search / Commands                    Window  │
├────────┬───────────────────────┬─────────────────────────────┤
│        │                       │                             │
│ Files  │                       │         Inspector           │
│        │       Preview         │                             │
│ Assets │                       │                             │
│        │                       │                             │
│ Scenes │                       │                             │
│        │                       │                             │
├────────┴───────────────────────┴─────────────────────────────┤
│                         Timeline                              │
│                                                              │
│  00:00      00:02      00:04      00:06      00:08           │
│                                                              │
│  Layer 1   ────────────────●──────────────                  │
│  Layer 2   ───────●──────────────────────                  │
│  Layer 3   ────────────────●──────────────                  │
└──────────────────────────────────────────────────────────────┘
```

This is only a starting point.

The layout must eventually be fully dockable/customizable.

---

# 8. Workspace system

Implement a workspace architecture inspired by professional IDEs.

The user should be able to:

* open a project
* save workspace state
* resize panels
* collapse panels
* rearrange panels
* switch workspaces
* reset layout
* customize shortcuts

Potential workspace modes:

```text
Motion
Code
Render
Debug
```

Do not implement every workspace immediately.

Build the underlying architecture so this is possible later.

---

# 9. Remotion project support

The application must understand a standard Remotion project.

Do not require users to migrate their projects into a proprietary format.

The application should work with:

```text
package.json
src/
public/
remotion.config.ts
...
```

and normal Remotion conventions.

Opening an existing Remotion project should be a first-class workflow.

Detect:

* project root
* package manager
* Remotion version
* entry point
* compositions
* available scripts
* dependencies
* assets

Support common package managers where practical:

* npm
* pnpm
* yarn
* bun

Do not hard-code npm assumptions.

---

# 10. Composition discovery

The application must discover Remotion compositions.

Show them in a composition browser.

Example:

```text
COMPOSITIONS

▸ Main
▸ Intro
▸ Outro
▸ InstagramPost
▸ YouTubeShort
```

For each composition display:

* ID
* width
* height
* FPS
* duration
* estimated frame count

Allow:

* preview
* duplicate/open
* render
* inspect

---

# 11. Preview engine

The preview is one of the most important parts of the application.

It should support:

* real-time playback
* frame stepping
* scrubbing
* pause/play
* loop
* FPS display
* resolution scaling
* transparent background preview when relevant
* zoom
* fit-to-window
* actual-pixel mode
* safe area overlays eventually

The preview should communicate clearly when:

* rendering is occurring
* code is recompiling
* an error exists
* assets are loading

Avoid freezing the entire application during preview updates.

---

# 12. Timeline

The timeline is a major differentiator.

Build an architecture capable of representing:

```text
Composition
 ├── Layer
 │    ├── property
 │    ├── keyframes
 │    └── animation
 ├── Layer
 └── Layer
```

The timeline should eventually support:

* frame ruler
* zoom
* playhead
* scrubbing
* layers
* visibility
* locking
* duration
* keyframes
* markers
* selection
* snapping
* multi-selection
* copy/paste
* undo/redo

Do not attempt to implement every feature at once.

First make:

```text
playhead
scrubbing
composition duration
basic layer representation
```

robust.

---

# 13. Visual inspector

Selecting a visual element should expose an inspector.

Example:

```text
TRANSFORM

Position
X    540
Y    320

Scale
X    1.00
Y    1.00

Rotation
0°

Opacity
100%
```

Eventually support:

* transform
* opacity
* colors
* typography
* dimensions
* border radius
* shadows
* filters
* layout
* animation
* custom component properties

The inspector must NOT pretend that every arbitrary React component can automatically be edited.

Instead, build a system where components can expose editable metadata.

---

# 14. Component metadata system

Design a future-compatible metadata system.

For example:

```ts
export const motionMetadata = {
  editable: {
    opacity: {
      type: "number",
      min: 0,
      max: 1
    },

    position: {
      type: "vector2"
    }
  }
}
```

The exact API can change.

The important idea:

> Components should be able to explicitly expose properties to the visual editor.

This avoids trying to reverse-engineer arbitrary React code.

Research how existing systems solve this before implementing the API.

---

# 15. Code editor

The application must include a serious code editor.

Possible technologies:

* Monaco
* CodeMirror
* Code-OSS integration

Research them first.

Required capabilities:

* TypeScript
* TSX
* syntax highlighting
* autocomplete
* diagnostics
* formatting
* search
* replace
* multiple tabs
* minimap optionally
* command palette
* keyboard shortcuts
* Go to definition eventually

Do not build a code editor from scratch.

---

# 16. Terminal

Provide an integrated terminal.

It should allow users to execute:

```bash
npm
pnpm
yarn
bun
npx remotion
git
```

and project scripts.

Terminal implementation should be native where appropriate.

Research existing GPL-compatible terminal components before implementing one.

---

# 17. Rendering

Rendering should use Remotion's rendering capabilities rather than reimplementing video rendering.

The application should orchestrate:

```text
Project
   ↓
Remotion
   ↓
Chromium / renderer
   ↓
Frames
   ↓
FFmpeg
   ↓
Output
```

Provide a render panel with:

* composition
* output format
* resolution
* FPS
* codec
* output path
* progress
* cancel
* queue

Eventually:

```text
Render Queue

01  Intro       1920x1080  H264     █████████░ 90%
02  Main        3840x2160  ProRes   waiting
03  Outro       1080x1920  H264     waiting
```

Rendering must never block the UI.

---

# 18. Asset management

Provide a basic asset browser.

Support:

* images
* videos
* audio
* fonts

Show:

* thumbnail
* filename
* dimensions
* duration
* format

Allow drag-and-drop into the project.

Do not initially create a proprietary asset database.

Use the project filesystem.

---

# 19. Undo / redo

Undo/redo must be treated as a core architectural requirement.

Operations that affect the visual editing model should be undoable.

Examples:

* transform change
* keyframe creation
* keyframe movement
* deletion
* inspector edits
* timeline edits

Avoid implementing undo separately in every component.

Create a coherent command/history architecture.

---

# 20. State architecture

Do not create one giant global React state.

Separate:

```text
Application state
Project state
Editor state
Preview state
Timeline state
Inspector state
Render state
```

Prefer explicit state boundaries.

Document important architectural decisions.

---

# 21. Performance

Performance is critical.

The application must remain responsive with:

* large projects
* many timeline layers
* large compositions
* frequent preview updates
* large assets
* long timelines

Avoid unnecessary React re-renders.

Use virtualization where appropriate.

Do not render thousands of timeline elements unnecessarily.

Rust should handle expensive filesystem/process operations where appropriate.

---

# 22. Error handling

Errors must be understandable.

Never expose raw stack traces as the primary user-facing message.

For example:

Instead of:

```text
Error: spawn ENOENT
```

show:

```text
Could not start the project.

The configured package manager was not found.

Check your installation or select another package manager.
```

Technical details should still be available in a diagnostics panel/log.

---

# 23. Developer diagnostics

Provide a developer console eventually.

It should expose:

* application logs
* Remotion logs
* renderer logs
* Rust logs
* frontend errors
* process output

Logs should have levels:

```text
DEBUG
INFO
WARN
ERROR
```

Use structured logging where possible.

---

# 24. Keyboard-first interaction

The application must be usable heavily from the keyboard.

Implement a command system.

Example:

```text
⌘/Ctrl + P
```

Command palette.

Potential commands:

```text
Open Project
Open Composition
Render Composition
Toggle Timeline
Toggle Inspector
Focus Code
Focus Preview
Play/Pause
Next Frame
Previous Frame
Add Marker
Save
Format Code
```

Do not hard-code shortcuts throughout the UI.

Use a centralized command registry.

---

# 25. AI architecture

Do NOT make AI mandatory for the MVP.

However, architect the application so an AI assistant can later:

* inspect project structure
* inspect compositions
* read source files
* modify code
* explain errors
* generate animations
* modify animations
* understand timeline state

The AI should operate on the actual project rather than generating isolated snippets.

Potential future interaction:

```text
User:
Make the title 30% slower and give it
a subtle spring overshoot.

AI:
Modified Intro.tsx.

[Preview changes]
[Review diff]
[Apply]
```

Always use a reviewable diff for destructive AI changes.

---

# 26. Git

Git integration should eventually support:

* status
* diff
* branches
* commits
* checkout
* staging

Do not build a full Git implementation.

Use existing Git tooling or libraries where appropriate.

---

# 27. Cross-platform

Primary targets:

```text
Windows
macOS
Linux
```

Test filesystem paths, process spawning and shell behavior independently.

Do not assume:

```text
/
bash
node
npm
```

exist in the same way everywhere.

---

# 28. Security

Treat project code as untrusted input.

Be particularly careful with:

* npm scripts
* child processes
* shell execution
* project plugins
* external binaries
* filesystem access

Do not silently execute arbitrary commands without a clear user action.

---

# 29. Project structure

Use a clean monorepo structure.

A possible initial structure:

```text
/
├── apps/
│   └── desktop/
│
├── crates/
│   ├── core/
│   ├── project/
│   ├── renderer/
│   ├── filesystem/
│   ├── terminal/
│   └── git/
│
├── packages/
│   ├── ui/
│   ├── timeline/
│   ├── editor/
│   ├── preview/
│   ├── inspector/
│   └── motion-model/
│
├── docs/
│   ├── architecture.md
│   ├── dependencies.md
│   ├── licensing.md
│   └── roadmap.md
│
├── LICENSE
└── THIRD_PARTY.md
```

Adapt this structure if research suggests a better architecture.

Do not create unnecessary crates/packages purely for theoretical separation.

---

# 30. Development methodology

Work incrementally.

Do NOT attempt to implement the entire product in one pass.

Milestone 0:

* architecture
* dependency research
* licensing audit
* project skeleton

Milestone 1:

* Tauri application
* project opening
* filesystem explorer
* Remotion project detection
* basic code editor
* basic preview

Milestone 2:

* composition discovery
* preview controls
* timeline
* scrubbing

Milestone 3:

* inspector
* element selection
* basic editable properties

Milestone 4:

* code ↔ visual synchronization
* undo/redo

Milestone 5:

* render queue
* asset browser
* terminal

Milestone 6:

* polished UI
* keyboard system
* Git
* diagnostics

Milestone 7:

* advanced animation editing
* keyframes
* templates
* AI architecture

---

# 31. Important engineering principle

Do not prematurely build abstractions for features that do not exist.

Prefer:

```text
working simple implementation
        ↓
measure
        ↓
identify actual architectural problem
        ↓
refactor
```

rather than:

```text
massive abstraction
        ↓
hundreds of interfaces
        ↓
nothing works
```

---

# 32. Quality requirements

Every important feature must have tests where practical.

Prioritize tests for:

* project detection
* composition parsing
* filesystem operations
* renderer orchestration
* timeline model
* keyframe model
* serialization
* undo/redo
* IPC
* command system

Use Rust tests for Rust logic.

Use appropriate frontend tests for UI/model logic.

---

# 33. Documentation

Documentation is part of the product.

Maintain:

```text
README.md
CONTRIBUTING.md
LICENSE
THIRD_PARTY.md
docs/architecture.md
docs/licensing.md
docs/roadmap.md
```

Architecture decisions should be documented when they have long-term consequences.

---

# 34. Design direction

The product should eventually have its own visual identity.

Do not simply reproduce VS Code.

VS Code can be used as an architectural or implementation reference where legally appropriate, but the final application should feel like its own product.

The visual language should communicate:

```text
Motion
Precision
Code
Creativity
Control
```

Avoid unnecessary visual effects.

Motion itself should be subtle and intentional.

The application is a tool for creating motion — the UI does not need to constantly animate.

---

# 35. First execution

Before coding:

1. inspect the repository
2. inspect available files
3. inspect existing configuration
4. research reusable open-source technologies
5. evaluate licenses
6. propose architecture
7. document the architecture
8. create the project skeleton
9. implement the smallest vertical slice

The first vertical slice should prove:

```text
Open Remotion project
        ↓
Detect project
        ↓
Discover composition
        ↓
Display composition
        ↓
Preview it
        ↓
Edit code
        ↓
See updated preview
```

If this works reliably, continue toward the timeline and visual editing system.

---

# 36. Critical rule

Do not build features simply because they sound impressive.

At every stage ask:

> Does this make creating Remotion motion graphics substantially easier or faster?

If not, postpone it.

The product's competitive advantage must ultimately come from the workflow, not from the number of features.

Build the foundation first, then iterate toward a professional motion-design environment.
