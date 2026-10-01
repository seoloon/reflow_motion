import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { commands, formatKeybinding } from "../commands/registry";
import { fuzzyFilter } from "../lib/fuzzy";
import { ipc } from "../lib/ipc";
import { useEditor } from "../stores/editor";
import { usePalette } from "../stores/palette";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

interface Item {
  key: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

/** Command palette (Ctrl/Cmd+Shift+P) and quick open (Ctrl/Cmd+P) share one list UI. */
export function Palette() {
  const { open, mode, hide } = usePalette();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  // re-read bindings when the registry changes (user rebinds)
  useSyncExternalStore(
    (cb) => commands.subscribe(cb),
    // snapshots must be referentially stable between changes: a string, not a fresh object
    () => JSON.stringify(commands.getOverrides()),
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    if (mode === "files") void ipc.listFiles().then(setFiles).catch(() => setFiles([]));
  }, [open, mode]);

  const items: Item[] = useMemo(() => {
    if (!open) return [];
    if (mode === "files") {
      return fuzzyFilter(files, query, (f) => f, 60).map((f) => ({ key: f, label: f.split("/").pop() ?? f, hint: f, run: () => useEditor.getState().openFile(f) }));
    }
    const enabled = commands.list().filter((c) => !c.enabled || c.enabled());
    return fuzzyFilter(enabled, query, (c) => c.title, 60).map((c) => ({
      key: c.id,
      label: c.title,
      hint: formatKeybinding(commands.bindingFor(c), isMac),
      run: () => void commands.run(c.id),
    }));
  }, [open, mode, query, files]);

  useEffect(() => {
    setIndex(0);
  }, [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".pal-item.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;
  const choose = (it?: Item) => {
    if (!it) return;
    hide();
    // let the palette close (and focus return) before the command runs
    setTimeout(() => void it.run(), 0);
  };

  return (
    <div className="overlay top" onPointerDown={hide}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={mode === "files" ? "Go to file…" : "Type a command…"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") hide();
            else if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(items.length - 1, i + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
            else if (e.key === "Enter") choose(items[index]);
          }}
        />
        <div className="pal-list" ref={list}>
          {items.length === 0 && <div className="pal-empty">No matches</div>}
          {items.map((it, i) => (
            <div key={it.key} className={`pal-item${i === index ? " active" : ""}`} onMouseMove={() => setIndex(i)} onClick={() => choose(it)}>
              <span>{it.label}</span>
              {it.hint && <span className="pal-hint">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
