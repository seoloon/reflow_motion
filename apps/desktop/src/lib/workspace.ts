/** Workspace layouts: pure data + helpers (no React, no storage access) so they are easy to test. */
export type WorkspaceId = "motion" | "code" | "assets" | "render" | "debug";
export type SideTab = "compositions" | "files" | "assets" | "git";
export type DockTab = "timeline" | "terminal" | "diagnostics" | "ai";
export type PanelName = "sidebar" | "editor" | "preview" | "inspector" | "dock";

export interface Layout {
  sideW: number;
  previewW: number;
  inspectorW: number;
  dockH: number;
  sideTab: SideTab;
  dockTab: DockTab;
  visible: Record<PanelName, boolean>;
}

export const WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: "motion", label: "Motion" },
  { id: "code", label: "Code" },
  { id: "assets", label: "Media" },
  { id: "render", label: "Render" },
  { id: "debug", label: "Debug" },
];

const all = { sidebar: true, editor: true, preview: true, inspector: true, dock: true };

export const PRESETS: Record<WorkspaceId, Layout> = {
  // canvas + timeline + inspector first; code is one click away
  motion: { inspectorW: 340, sideW: 240, previewW: 760, dockH: 240, sideTab: "compositions", dockTab: "timeline", visible: { ...all, editor: false } },
  // editor first, small preview, no inspector
  code: { inspectorW: 320, sideW: 260, previewW: 420, dockH: 220, sideTab: "files", dockTab: "terminal", visible: { ...all, inspector: false } },
  // media pool first: a wide asset browser next to the preview
  assets: { inspectorW: 320, sideW: 560, previewW: 520, dockH: 200, sideTab: "assets", dockTab: "timeline", visible: { ...all, editor: false, inspector: false } },
  render: { inspectorW: 320, sideW: 240, previewW: 520, dockH: 340, sideTab: "compositions", dockTab: "timeline", visible: { ...all, editor: false } },
  debug: { inspectorW: 320, sideW: 260, previewW: 520, dockH: 300, sideTab: "files", dockTab: "diagnostics", visible: all },
};

export const LIMITS = {
  sideW: [160, 800],
  previewW: [280, 1400],
  inspectorW: [240, 640],
  dockH: [110, 700],
} as const;

const bound = (n: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;

const SIDE_TABS: SideTab[] = ["compositions", "files", "assets", "git"];
const DOCK_TABS: DockTab[] = ["timeline", "terminal", "diagnostics", "ai"];

/** Make any (possibly stale or hand-edited) layout valid, falling back to the preset for that workspace. */
export function sanitizeLayout(input: unknown, id: WorkspaceId): Layout {
  const base = PRESETS[id];
  const l = (input && typeof input === "object" ? input : {}) as Partial<Layout>;
  const vis = (l.visible && typeof l.visible === "object" ? l.visible : {}) as Partial<Record<PanelName, unknown>>;
  const visible = { ...base.visible };
  for (const k of Object.keys(visible) as PanelName[]) if (typeof vis[k] === "boolean") visible[k] = vis[k] as boolean;
  return {
    sideW: bound(l.sideW, LIMITS.sideW, base.sideW),
    previewW: bound(l.previewW, LIMITS.previewW, base.previewW),
    inspectorW: bound(l.inspectorW, LIMITS.inspectorW, base.inspectorW),
    dockH: bound(l.dockH, LIMITS.dockH, base.dockH),
    sideTab: SIDE_TABS.includes(l.sideTab as SideTab) ? (l.sideTab as SideTab) : base.sideTab,
    dockTab: DOCK_TABS.includes(l.dockTab as DockTab) ? (l.dockTab as DockTab) : base.dockTab,
    visible,
  };
}

export interface SavedWorkspace {
  current: WorkspaceId;
  layouts: Partial<Record<WorkspaceId, Layout>>;
}

export function parseSaved(raw: string | null): SavedWorkspace {
  const fallback: SavedWorkspace = { current: "motion", layouts: {} };
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Partial<SavedWorkspace>;
    const ids = WORKSPACES.map((w) => w.id);
    const current = ids.includes(data.current as WorkspaceId) ? (data.current as WorkspaceId) : "motion";
    const layouts: SavedWorkspace["layouts"] = {};
    for (const id of ids) if (data.layouts?.[id]) layouts[id] = sanitizeLayout(data.layouts[id], id);
    return { current, layouts };
  } catch {
    return fallback;
  }
}
