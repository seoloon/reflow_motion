import { formatDuration, formatFps, formatSize } from "../lib/format";
import { useEditor } from "../stores/editor";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useWorkspace } from "../stores/workspace";
import { useContextMenu } from "../ui/overlays";

export function CompositionList() {
  const compositions = useProject((s) => s.info?.compositions ?? []);
  const selected = usePreview((s) => s.compositionId);
  const select = usePreview((s) => s.select);
  const openFile = useEditor((s) => s.openFile);
  const openMenu = useContextMenu((s) => s.open);

  if (compositions.length === 0) {
    return (
      <div className="empty">
        No compositions found.
        <br />
        <span className="muted">Looking for &lt;Composition&gt; and &lt;Still&gt; in src/.</span>
      </div>
    );
  }
  return (
    <div className="comp-list">
      {compositions.map((c) => (
        <div
          key={`${c.file}:${c.line}`}
          className={`comp-row${selected === c.id ? " active" : ""}`}
          onClick={() => select(c.id)}
          onDoubleClick={() => openFile(c.file, c.line)}
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "Preview", run: () => select(c.id) },
              { label: "Open source", run: () => void openFile(c.file, c.line) },
              { separator: true, label: "" },
              {
                label: "Render…",
                run: () => {
                  select(c.id);
                  useWorkspace.getState().setWorkspace("render");
                },
              },
            ])
          }
          title="Click to preview · double-click to open the source"
        >
          <div className="comp-id">{c.id}</div>
          <div className="comp-meta">
            {formatSize(c)} · {formatFps(c)} · {formatDuration(c)}
            {c.duration_in_frames != null && !c.is_still ? ` · ${c.duration_in_frames}f` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
