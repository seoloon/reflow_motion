import { Bug, Clapperboard, Code2, Film, Image } from "lucide-react";
import type { ReactNode } from "react";
import { WORKSPACES, type WorkspaceId } from "../lib/workspace";
import { percent } from "../lib/render";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useRender } from "../stores/render";
import { useWorkspace } from "../stores/workspace";

const ICONS: Record<WorkspaceId, ReactNode> = {
  motion: <Clapperboard size={17} />,
  code: <Code2 size={17} />,
  assets: <Image size={17} />,
  render: <Film size={17} />,
  debug: <Bug size={17} />,
};

const KEYS: Record<WorkspaceId, string> = { motion: "Alt+1", code: "Alt+2", assets: "Alt+3", render: "Alt+4", debug: "Alt+5" };

/** DaVinci-style page bar: one tab per working page, project status on the right. */
export function PageBar() {
  const { current, setWorkspace } = useWorkspace();
  const info = useProject((s) => s.info);
  const status = usePreview((s) => s.status);
  const running = useRender((s) => s.jobs.find((j) => j.status === "running"));
  const waiting = useRender((s) => s.jobs.filter((j) => j.status === "waiting").length);

  return (
    <footer className="pagebar">
      <nav className="pages" aria-label="Pages">
        {WORKSPACES.map((w) => (
          <button key={w.id} className={`page-tab${current === w.id ? " active" : ""}`} onClick={() => setWorkspace(w.id)} title={`${w.label} (${KEYS[w.id]})`} aria-current={current === w.id ? "page" : undefined}>
            {ICONS[w.id]}
            <span>{w.label}</span>
          </button>
        ))}
      </nav>
      <div className="status">
        {running && (
          <button className="status-item" onClick={() => setWorkspace("render")} title="Open the render queue">
            <span className="mini-bar"><span style={{ width: percent(running.progress) }} /></span>
            Rendering {running.request.composition} {percent(running.progress)}
            {waiting > 0 && ` · +${waiting}`}
          </button>
        )}
        {info && <span className="status-item muted">{info.name ?? "project"} · Remotion {info.remotion_version} · {info.package_manager}</span>}
        <span className="status-item">
          <span className={`dot ${status}`} />
          {status === "running" ? "Preview running" : status === "starting" ? "Starting…" : status === "error" ? "Preview error" : "Preview off"}
        </span>
      </div>
    </footer>
  );
}
