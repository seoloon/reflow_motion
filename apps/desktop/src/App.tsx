import { listen } from "@tauri-apps/api/event";
import { ChevronLeft, FolderOpen, Plus } from "lucide-react";
import { useEffect } from "react";
import { registerBuiltins, syncCompositionCommands } from "./commands/builtin";
import { commands, loadSavedOverrides } from "./commands/registry";
import { AssetBrowser } from "./components/AssetBrowser";
import { CompositionList } from "./components/CompositionList";
import { Dock } from "./components/Dock";
import { EditorPane } from "./components/EditorPane";
import { Explorer } from "./components/Explorer";
import { DiffView, GitPanel } from "./components/GitPanel";
import { Inspector } from "./components/Inspector";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { PageBar } from "./components/PageBar";
import { Palette } from "./components/Palette";
import { PreviewPane } from "./components/PreviewPane";
import { RenderPage } from "./components/RenderPage";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Splitter } from "./components/Splitter";
import { TitleBar } from "./components/TitleBar";
import { useUiScale } from "./lib/uiScale";
import { type SideTab } from "./lib/workspace";
import { useLog } from "./stores/log";
import { useDialogs } from "./stores/dialogs";
import { useProject } from "./stores/project";
import { useRender } from "./stores/render";
import { useTimeline } from "./stores/timeline";
import { toast } from "./stores/toasts";
import { useWorkspace } from "./stores/workspace";
import type { LogLine, RenderJob } from "./types";
import { TooltipProvider } from "./ui/kit";
import { ContextMenu, Toasts } from "./ui/overlays";

const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: "compositions", label: "Compositions" },
  { id: "files", label: "Files" },
  { id: "assets", label: "Assets" },
  { id: "git", label: "Git" },
];

const MARKERS_KEY = "reflow.markers";

/** Markers are remembered per project root. */
function useMarkerPersistence(root: string | undefined) {
  useEffect(() => {
    if (!root) return;
    try {
      const all = JSON.parse(localStorage.getItem(MARKERS_KEY) ?? "{}") as Record<string, Record<string, number[]>>;
      useTimeline.getState().setMarkers(all[root] ?? {});
    } catch {
      useTimeline.getState().setMarkers({});
    }
    return useTimeline.subscribe((s, prev) => {
      if (s.markers === prev.markers) return;
      try {
        const all = JSON.parse(localStorage.getItem(MARKERS_KEY) ?? "{}");
        all[root] = s.markers;
        localStorage.setItem(MARKERS_KEY, JSON.stringify(all));
      } catch {
        /* not persisted */
      }
    });
  }, [root]);
}

export function App() {
  const info = useProject((s) => s.info);
  const error = useProject((s) => s.error);
  const { layout, current, patch, setSideTab, togglePanel } = useWorkspace();
  const scale = useUiScale();
  const compositionIds = useProject((s) => s.info?.compositions.map((c) => c.id).join("\n") ?? "");
  const installing = useDialogs((s) => s.installing);

  useMarkerPersistence(info?.root);

  useEffect(() => {
    loadSavedOverrides();
    const offBuiltins = registerBuiltins();
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && el.closest("input, textarea, select, [contenteditable=true], .monaco-editor, .xterm, [role=menuitem]") !== null;
      // keep the webview from handling Ctrl+S / Ctrl+O / Ctrl+P / F1 itself
      if (commands.claims(e)) e.preventDefault();
      if (!typing && [" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) e.preventDefault();
      void commands.handleKey(e, typing);
    };
    window.addEventListener("keydown", onKey);

    // frontend errors end up in the diagnostics log too
    const onError = (e: ErrorEvent) => useLog.getState().push({ source: "frontend", level: "ERROR", message: e.message });
    const onRejection = (e: PromiseRejectionEvent) => useLog.getState().push({ source: "frontend", level: "ERROR", message: String(e.reason) });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    const unlisten = listen<LogLine>("log", (ev) => useLog.getState().push(ev.payload));
    let prevStatus = new Map<number, RenderJob["status"]>();
    const unlistenRender = listen<RenderJob[]>("render-update", (ev) => {
      useRender.getState().setJobs(ev.payload);
      for (const j of ev.payload) {
        const before = prevStatus.get(j.id);
        if (before && before !== j.status) {
          if (j.status === "done") toast.success(`Rendered ${j.request.composition} → ${j.request.output}`);
          if (j.status === "failed") toast.error(`Render of ${j.request.composition} failed.`);
        }
      }
      prevStatus = new Map(ev.payload.map((j) => [j.id, j.status]));
    });
    return () => {
      offBuiltins();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      void unlisten.then((f) => f());
      void unlistenRender.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const ids = compositionIds ? compositionIds.split("\n") : [];
    return syncCompositionCommands(ids);
  }, [compositionIds]);

  const v = layout.visible;
  const renderPage = current === "render";
  // widths are stored at the 16px baseline and scale with the window
  const px = (n: number) => n * scale;

  return (
    <TooltipProvider>
      <div className="app">
        <TitleBar />

        {!info ? (
          <main className="welcome">
            <div className="hero">
              <span className="logo big" />
              <h1>ReFlow Motion</h1>
              <p>Open a Remotion project, or start from a template. Nothing in your project runs until you start the preview.</p>
              {error && (
                <div className="message error">
                  <strong>{error.title}</strong>
                  <p>{error.hint}</p>
                </div>
              )}
              <div className="welcome-actions">
                <button className="primary lg" onClick={() => void commands.run("project.open")}>
                  <FolderOpen size={16} /> Open project…
                </button>
                <button className="lg" onClick={() => void commands.run("project.new")}>
                  <Plus size={16} /> New project…
                </button>
              </div>
            </div>
          </main>
        ) : (
          <>
            {!info.has_node_modules && (
              <div className="notice">
                Dependencies are not installed in this project.
                <button className="primary" disabled={installing} onClick={() => void commands.run("project.install")} title={`Runs “${info.package_manager} install” in the project`}>
                  {installing ? "Installing…" : "Install dependencies"}
                </button>
              </div>
            )}
            {/* all pages stay mounted so the preview, editor tabs and terminal keep their state */}
            <div className="main-col" style={{ display: renderPage ? "none" : undefined }}>
              <main className="workspace">
                {v.sidebar && (
                  <>
                    <aside className="sidebar" style={{ width: px(layout.sideW) }}>
                      <div className="side-tabs">
                        {SIDE_TABS.map((t) => (
                          <button key={t.id} className={layout.sideTab === t.id ? "active" : ""} onClick={() => setSideTab(t.id)}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="side-body">
                        {layout.sideTab === "compositions" && <CompositionList />}
                        {layout.sideTab === "files" && <Explorer />}
                        {layout.sideTab === "assets" && <AssetBrowser />}
                        {layout.sideTab === "git" && <GitPanel />}
                      </div>
                    </aside>
                    <Splitter onDrag={(dx) => patch({ sideW: layout.sideW + dx / scale })} />
                  </>
                )}
                {/* the editor stays mounted when hidden so open tabs and undo history survive */}
                <section className="center" style={{ display: v.editor ? undefined : "none" }}>
                  <EditorPane />
                </section>
                {v.editor && v.preview && <Splitter onDrag={(dx) => patch({ previewW: layout.previewW - dx / scale })} />}
                <section className="right" style={{ display: v.preview ? undefined : "none", width: v.editor ? px(layout.previewW) : undefined, flex: v.editor ? "none" : 1 }}>
                  <PreviewPane />
                </section>
                {v.inspector ? (
                  <>
                    <Splitter onDrag={(dx) => patch({ inspectorW: layout.inspectorW - dx / scale })} />
                    <aside className="inspector-col" style={{ width: px(layout.inspectorW), flex: v.preview || v.editor ? "none" : 1 }}>
                      <div className="panel-head">
                        <span>Inspector</span>
                        <button className="ibtn" aria-label="Collapse inspector" title="Collapse inspector (Ctrl+Alt+I)" onClick={() => togglePanel("inspector")}>
                          <ChevronLeft size={15} style={{ transform: "rotate(180deg)" }} />
                        </button>
                      </div>
                      <Inspector />
                    </aside>
                  </>
                ) : (
                  <button className="rail" onClick={() => togglePanel("inspector")} title="Show inspector (Ctrl+Alt+I)" aria-label="Show inspector">
                    <ChevronLeft size={14} />
                    <span>Inspector</span>
                  </button>
                )}
              </main>
              {v.dock && (
                <>
                  <Splitter orientation="horizontal" onDrag={(d) => patch({ dockH: layout.dockH - d / scale })} />
                  <div className="timeline-wrap" style={{ height: px(layout.dockH) }}>
                    <Dock />
                  </div>
                </>
              )}
            </div>
            {renderPage && <RenderPage />}
          </>
        )}

        <PageBar />
        <Palette />
        <ShortcutsDialog />
        <NewProjectDialog />
        <DiffView />
        <ContextMenu />
        <Toasts />
      </div>
    </TooltipProvider>
  );
}
