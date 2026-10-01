/** Menu bar structure. Items reference registered commands, so titles and shortcuts always match the registry. */
export type MenuEntry =
  | { cmd: string }
  | { sep: true }
  | { sub: string; items: MenuEntry[] }
  /** one entry per composition of the open project */
  | { compositions: true };

export interface Menu {
  label: string;
  items: MenuEntry[];
}

const sep: MenuEntry = { sep: true };

export const MENUS: Menu[] = [
  {
    label: "File",
    items: [{ cmd: "project.new" }, { cmd: "project.open" }, sep, { cmd: "file.save" }, { cmd: "file.quickOpen" }, sep, { cmd: "project.install" }],
  },
  {
    label: "Edit",
    items: [{ cmd: "edit.undo" }, { cmd: "edit.redo" }, sep, { cmd: "editor.find" }, { cmd: "editor.replace" }, { cmd: "editor.format" }],
  },
  {
    label: "View",
    items: [
      {
        sub: "Pages",
        items: [{ cmd: "workspace.motion" }, { cmd: "workspace.code" }, { cmd: "workspace.assets" }, { cmd: "workspace.render" }, { cmd: "workspace.debug" }],
      },
      sep,
      { cmd: "view.toggleSidebar" },
      { cmd: "view.toggleInspector" },
      { cmd: "view.toggleTimeline" },
      { cmd: "view.toggleEditor" },
      { cmd: "view.togglePreview" },
      sep,
      { cmd: "preview.fullscreen" },
      sep,
      { cmd: "view.timeline" },
      { cmd: "view.terminal" },
      { cmd: "view.diagnostics" },
      { cmd: "ai.show" },
      sep,
      { cmd: "view.resetLayout" },
    ],
  },
  {
    label: "Timeline",
    items: [
      { cmd: "preview.playPause" },
      { cmd: "transport.reverse" },
      { cmd: "transport.stop" },
      { cmd: "transport.forward" },
      sep,
      { cmd: "timeline.prevFrame" },
      { cmd: "timeline.nextFrame" },
      { cmd: "timeline.prev5" },
      { cmd: "timeline.next5" },
      { cmd: "timeline.prevEdit" },
      { cmd: "timeline.nextEdit" },
      { cmd: "timeline.start" },
      { cmd: "timeline.end" },
      sep,
      { cmd: "timeline.markIn" },
      { cmd: "timeline.markOut" },
      { cmd: "timeline.clearInOut" },
      { cmd: "timeline.addMarker" },
      { cmd: "timeline.prevMarker" },
      { cmd: "timeline.nextMarker" },
      sep,
      { cmd: "timeline.zoomIn" },
      { cmd: "timeline.zoomOut" },
      { cmd: "timeline.zoomFit" },
    ],
  },
  {
    label: "Composition",
    items: [{ compositions: true }, sep, { cmd: "preview.start" }, { cmd: "preview.stop" }, sep, { cmd: "render.composition" }, { cmd: "workspace.render" }],
  },
  {
    label: "Help",
    items: [{ cmd: "palette.commands" }, { cmd: "help.shortcuts" }, sep, { cmd: "ai.copyContext" }, { cmd: "git.refresh" }],
  },
];

/** Every command id a menu mentions (used by tests to catch typos). */
export function menuCommandIds(items: MenuEntry[] = MENUS.flatMap((m) => m.items)): string[] {
  const out: string[] = [];
  for (const e of items) {
    if ("cmd" in e) out.push(e.cmd);
    else if ("sub" in e) out.push(...menuCommandIds(e.items));
  }
  return out;
}
