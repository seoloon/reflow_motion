import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { currentContext } from "../ai/session";
import { editorHandle } from "../lib/editorHandle";
import { ipc, toUserMessage } from "../lib/ipc";
import { previewBridge } from "../lib/previewProtocol";
import { BASE_SETTINGS, buildRequest, defaultOutput } from "../lib/render";
import { editPoints, nextEditPoint, prevEditPoint, workAreaRange } from "../lib/timeline";
import { isTrusted } from "../lib/trust";
import { useDialogs } from "../stores/dialogs";
import { useDock } from "../stores/dock";
import { useEditor } from "../stores/editor";
import { redo, undo } from "../stores/edits";
import { useGit } from "../stores/git";
import { usePalette } from "../stores/palette";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useRender } from "../stores/render";
import { useRuntime } from "../stores/runtime";
import { useTimeline } from "../stores/timeline";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { commands } from "./registry";

export async function openProjectAt(path: string) {
  usePreview.getState().reset();
  useTimeline.getState().reset();
  useEditor.getState().reset();
  if (await useProject.getState().open(path)) {
    const first = useProject.getState().info?.compositions[0];
    if (first) usePreview.getState().select(first.id);
    const entry = useProject.getState().info?.entry_point;
    const file = first?.file ?? entry;
    if (file) void useEditor.getState().openFile(file, first?.line);
    void useGit.getState().refresh();
    // only folders the user trusted start their own code without a click
    const info = useProject.getState().info;
    if (info && info.has_node_modules && isTrusted(info.root)) void usePreview.getState().start();
  }
}

export async function openProjectDialog() {
  const picked = await pickFolder({ directory: true, multiple: false, title: "Open Remotion project" });
  if (typeof picked === "string") await openProjectAt(picked);
}

/** Installing runs the project's package manager, so it only happens from an explicit click or command. */
export async function installDependencies() {
  const dialogs = useDialogs.getState();
  if (dialogs.installing || !useProject.getState().info) return;
  dialogs.setInstalling(true);
  toast.info("Installing dependencies… output is in Diagnostics.");
  try {
    await ipc.projectInstall();
    await useProject.getState().refresh();
    toast.success("Dependencies installed.");
  } catch (e) {
    const err = toUserMessage(e);
    toast.error(`${err.title} ${err.hint}`);
  } finally {
    dialogs.setInstalling(false);
  }
}

const SOURCE_FILE = /\.(tsx?|jsx?)$/;

export async function saveActive() {
  const path = useEditor.getState().active;
  if (!path) return;
  if (await useEditor.getState().save(path)) {
    // composition metadata may have changed
    if (SOURCE_FILE.test(path)) void useProject.getState().refresh();
    void useGit.getState().refresh();
  } else {
    toast.error(`Could not save ${path}.`);
  }
}

/** Queue the selected composition with the last-used render settings (the Render page lets you change them). */
function renderSelected() {
  const id = usePreview.getState().compositionId;
  const comp = useProject.getState().info?.compositions.find((c) => c.id === id);
  if (!comp) return toast.error("Select a composition first.");
  let settings = BASE_SETTINGS;
  try {
    const last = JSON.parse(localStorage.getItem("reflow.render.last") ?? "null");
    if (last?.codec) settings = { ...BASE_SETTINGS, ...last };
  } catch {
    /* defaults */
  }
  const tl = useTimeline.getState();
  const range = tl.meta?.id === comp.id ? workAreaRange(tl.workArea[comp.id], tl.meta.durationInFrames - 1) : null;
  void useRender.getState().enqueue(buildRequest(comp, { ...settings, frames: comp.is_still ? null : range }, defaultOutput(comp, settings)));
  toast.info(`Queued ${comp.id}${range ? ` (frames ${range[0]}–${range[1]})` : ""}. Open the Render page to adjust settings.`);
}

const step = (n: number) => () => useTimeline.getState().step(n);

function jumpEdit(dir: 1 | -1) {
  const tl = useTimeline.getState();
  if (!tl.meta) return;
  const points = editPoints(useRuntime.getState().layers, tl.meta.durationInFrames);
  const target = dir === 1 ? nextEditPoint(points, tl.frame) : prevEditPoint(points, tl.frame);
  if (target !== null) tl.seek(target);
}

const goto = (id: "motion" | "code" | "assets" | "render" | "debug") => () => useWorkspace.getState().setWorkspace(id);

export async function togglePreviewFullscreen() {
  const ui = useUi.getState();
  const next = !ui.previewFullscreen;
  ui.setPreviewFullscreen(next);
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(next);
  } catch {
    /* running without the Tauri window (browser harness): the in-app fullscreen still works */
  }
}

/**
 * Every user action lives here. Default shortcuts follow Adobe Premiere Pro where an equivalent exists
 * (Space, J/K/L, arrows, Up/Down edit points, I/O, M, Home/End, Ctrl+Z / Ctrl+Shift+Z); everything can be
 * rebound from Help → Keyboard Shortcuts.
 */
export function registerBuiltins(): () => void {
  const typing = { ignoreWhileTyping: true } as const;
  const offs = [
    // project / files
    commands.register({ id: "project.new", title: "New Project…", keybinding: "Mod+N", run: () => useDialogs.getState().setNewProjectOpen(true) }),
    commands.register({ id: "project.open", title: "Open Project…", keybinding: "Mod+O", run: openProjectDialog }),
    commands.register({ id: "project.install", title: "Install Dependencies", enabled: () => !!useProject.getState().info, run: installDependencies }),
    commands.register({ id: "file.save", title: "Save", keybinding: "Mod+S", run: saveActive }),
    commands.register({ id: "file.quickOpen", title: "Go to File…", keybinding: "Mod+P", run: () => usePalette.getState().show("files") }),
    commands.register({ id: "palette.commands", title: "Command Palette", keybinding: "Mod+Shift+P", alsoBound: ["Mod+K", "F1"], run: () => usePalette.getState().show("commands") }),
    commands.register({ id: "help.shortcuts", title: "Keyboard Shortcuts", keybinding: "Mod+Alt+K", run: () => usePalette.getState().setShortcutsOpen(true) }),
    // edit
    commands.register({ id: "edit.undo", title: "Undo", keybinding: "Mod+Z", ...typing, run: undo }),
    commands.register({ id: "edit.redo", title: "Redo", keybinding: "Mod+Shift+Z", alsoBound: ["Mod+Y"], ...typing, run: redo }),
    commands.register({ id: "editor.find", title: "Find in File", run: () => editorHandle.find() }),
    commands.register({ id: "editor.replace", title: "Replace in File", run: () => editorHandle.replace() }),
    commands.register({ id: "editor.format", title: "Format Code", keybinding: "Shift+Alt+F", run: () => editorHandle.format() }),
    commands.register({ id: "editor.focus", title: "Focus Code", keybinding: "Mod+1", run: () => editorHandle.focus() }),
    commands.register({ id: "preview.focus", title: "Focus Preview", keybinding: "Mod+2", run: () => previewBridge.focus() }),
    // transport (Premiere Pro style)
    commands.register({ id: "preview.playPause", title: "Play / Pause", keybinding: "Space", ...typing, run: () => useTimeline.getState().togglePlay() }),
    commands.register({ id: "transport.reverse", title: "Play Backward (repeat to speed up)", keybinding: "J", ...typing, run: () => useTimeline.getState().shuttleKey("J") }),
    commands.register({ id: "transport.stop", title: "Stop", keybinding: "K", ...typing, run: () => useTimeline.getState().shuttleKey("K") }),
    commands.register({ id: "transport.forward", title: "Play Forward (repeat to speed up)", keybinding: "L", ...typing, run: () => useTimeline.getState().shuttleKey("L") }),
    commands.register({ id: "timeline.nextFrame", title: "Next Frame", keybinding: "ArrowRight", ...typing, run: step(1) }),
    commands.register({ id: "timeline.prevFrame", title: "Previous Frame", keybinding: "ArrowLeft", ...typing, run: step(-1) }),
    commands.register({ id: "timeline.next5", title: "Forward 5 Frames", keybinding: "Shift+ArrowRight", ...typing, run: step(5) }),
    commands.register({ id: "timeline.prev5", title: "Back 5 Frames", keybinding: "Shift+ArrowLeft", ...typing, run: step(-5) }),
    commands.register({ id: "timeline.nextEdit", title: "Go to Next Edit Point", keybinding: "ArrowDown", ...typing, run: () => jumpEdit(1) }),
    commands.register({ id: "timeline.prevEdit", title: "Go to Previous Edit Point", keybinding: "ArrowUp", ...typing, run: () => jumpEdit(-1) }),
    commands.register({ id: "timeline.start", title: "Go to Start", keybinding: "Home", ...typing, run: () => useTimeline.getState().seek(0) }),
    commands.register({ id: "timeline.end", title: "Go to End", keybinding: "End", ...typing, run: () => useTimeline.getState().seek(Number.MAX_SAFE_INTEGER) }),
    commands.register({ id: "timeline.markIn", title: "Mark In", keybinding: "I", ...typing, run: () => useTimeline.getState().markWorkArea("in") }),
    commands.register({ id: "timeline.markOut", title: "Mark Out", keybinding: "O", ...typing, run: () => useTimeline.getState().markWorkArea("out") }),
    commands.register({ id: "timeline.clearInOut", title: "Clear In and Out", keybinding: "Mod+Shift+X", ...typing, run: () => useTimeline.getState().clearWorkArea() }),
    commands.register({ id: "timeline.addMarker", title: "Add Marker", keybinding: "M", ...typing, run: () => useTimeline.getState().toggleMarkerAtPlayhead() }),
    commands.register({ id: "timeline.nextMarker", title: "Go to Next Marker", keybinding: "Shift+M", ...typing, run: () => useTimeline.getState().jumpMarker(1) }),
    commands.register({ id: "timeline.prevMarker", title: "Go to Previous Marker", keybinding: "Mod+Shift+M", ...typing, run: () => useTimeline.getState().jumpMarker(-1) }),
    commands.register({ id: "timeline.zoomIn", title: "Timeline: Zoom In", keybinding: "=", ...typing, run: () => useTimeline.getState().requestZoom("in") }),
    commands.register({ id: "timeline.zoomOut", title: "Timeline: Zoom Out", keybinding: "-", ...typing, run: () => useTimeline.getState().requestZoom("out") }),
    commands.register({ id: "timeline.zoomFit", title: "Timeline: Fit to Window", keybinding: "\\", ...typing, run: () => useTimeline.getState().requestZoom("fit") }),
    // preview
    commands.register({ id: "preview.start", title: "Start Preview", run: () => usePreview.getState().start() }),
    commands.register({ id: "preview.stop", title: "Stop Preview", run: () => usePreview.getState().stop() }),
    commands.register({ id: "preview.fullscreen", title: "Toggle Preview Fullscreen", keybinding: "Mod+Shift+F", alsoBound: ["F11"], run: togglePreviewFullscreen }),
    // render
    commands.register({ id: "render.composition", title: "Render Composition (queue)", keybinding: "Mod+Shift+R", run: renderSelected }),
    // git
    commands.register({ id: "git.refresh", title: "Git: Refresh Status", run: () => useGit.getState().refresh() }),
    // ai
    commands.register({ id: "ai.show", title: "AI: Show Assistant and Review", run: () => useDock.getState().setTab("ai") }),
    commands.register({
      id: "ai.copyContext",
      title: "AI: Copy Project Context",
      enabled: () => !!useProject.getState().info,
      run: () => {
        void navigator.clipboard?.writeText(JSON.stringify(currentContext(), null, 2));
        toast.info("Project context copied.");
      },
    }),
    // view
    commands.register({ id: "view.toggleSidebar", title: "Toggle Side Bar", keybinding: "Mod+B", run: () => useWorkspace.getState().togglePanel("sidebar") }),
    commands.register({ id: "view.toggleInspector", title: "Toggle Inspector", keybinding: "Mod+Alt+I", alsoBound: ["Mod+I"], run: () => useWorkspace.getState().togglePanel("inspector") }),
    commands.register({ id: "view.toggleTimeline", title: "Toggle Bottom Panel", keybinding: "Mod+J", run: () => useWorkspace.getState().togglePanel("dock") }),
    commands.register({ id: "view.toggleEditor", title: "Toggle Code Editor", keybinding: "Mod+Alt+E", run: () => useWorkspace.getState().togglePanel("editor") }),
    commands.register({ id: "view.togglePreview", title: "Toggle Preview", run: () => useWorkspace.getState().togglePanel("preview") }),
    commands.register({ id: "view.resetLayout", title: "Reset Layout", run: () => useWorkspace.getState().resetLayout() }),
    commands.register({ id: "view.timeline", title: "Show Timeline", run: () => useDock.getState().setTab("timeline") }),
    commands.register({ id: "view.terminal", title: "Show Terminal", keybinding: "Ctrl+`", run: () => useDock.getState().setTab("terminal") }),
    commands.register({ id: "view.diagnostics", title: "Show Diagnostics", keybinding: "Mod+Shift+D", run: () => useDock.getState().setTab("diagnostics") }),
    // pages (like DaVinci's bottom bar)
    commands.register({ id: "workspace.motion", title: "Page: Motion", keybinding: "Alt+1", run: goto("motion") }),
    commands.register({ id: "workspace.code", title: "Page: Code", keybinding: "Alt+2", run: goto("code") }),
    commands.register({ id: "workspace.assets", title: "Page: Media", keybinding: "Alt+3", run: goto("assets") }),
    commands.register({ id: "workspace.render", title: "Page: Render", keybinding: "Alt+4", run: goto("render") }),
    commands.register({ id: "workspace.debug", title: "Page: Debug", keybinding: "Alt+5", run: goto("debug") }),
  ];
  return () => offs.forEach((off) => off());
}

/** "Open Composition: X" commands follow the project's composition list. */
export function syncCompositionCommands(ids: string[]): () => void {
  const offs = ids.map((id) =>
    commands.register({
      id: `composition.open.${id}`,
      title: `Open Composition: ${id}`,
      run: () => usePreview.getState().select(id),
    }),
  );
  return () => offs.forEach((off) => off());
}
