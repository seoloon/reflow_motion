import { create } from "zustand";
import {
  PRESETS,
  parseSaved,
  sanitizeLayout,
  type Layout,
  type PanelName,
  type SideTab,
  type WorkspaceId,
} from "../lib/workspace";
import { useDock } from "./dock";

const KEY = "reflow.workspace";

function load() {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return parseSaved(null);
  }
}

interface WorkspaceState {
  current: WorkspaceId;
  /** layouts the user has changed; presets fill in the rest */
  layouts: Partial<Record<WorkspaceId, Layout>>;
  layout: Layout;
  setWorkspace: (id: WorkspaceId) => void;
  patch: (p: Partial<Pick<Layout, "sideW" | "previewW" | "inspectorW" | "dockH" | "sideTab">>) => void;
  togglePanel: (p: PanelName) => void;
  setSideTab: (t: SideTab) => void;
  /** Forget the user's changes for the current workspace. */
  resetLayout: () => void;
}

const layoutFor = (id: WorkspaceId, layouts: WorkspaceState["layouts"]) => layouts[id] ?? PRESETS[id];

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const saved = load();
  const persist = () => {
    const { current, layouts } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ current, layouts }));
    } catch {
      /* storage unavailable: layout simply isn't remembered */
    }
  };
  const update = (id: WorkspaceId, layout: Layout) => {
    set((s) => ({ layouts: { ...s.layouts, [id]: layout }, layout }));
    persist();
  };
  return {
    current: saved.current,
    layouts: saved.layouts,
    layout: layoutFor(saved.current, saved.layouts),
    setWorkspace(id) {
      const layout = layoutFor(id, get().layouts);
      set({ current: id, layout });
      useDock.getState().setTab(layout.dockTab);
      persist();
    },
    patch(p) {
      const { current, layout } = get();
      update(current, sanitizeLayout({ ...layout, ...p }, current));
    },
    togglePanel(p) {
      const { current, layout } = get();
      update(current, { ...layout, visible: { ...layout.visible, [p]: !layout.visible[p] } });
    },
    setSideTab(t) {
      get().patch({ sideTab: t });
    },
    resetLayout() {
      const { current } = get();
      const layouts = { ...get().layouts };
      delete layouts[current];
      set({ layouts, layout: PRESETS[current] });
      useDock.getState().setTab(PRESETS[current].dockTab);
      persist();
    },
  };
});
