import { useCallback, useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { useEditor } from "../stores/editor";
import { useProject } from "../stores/project";
import type { DirEntry } from "../types";

function Node({ entry, depth }: { entry: DirEntry; depth: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const active = useEditor((s) => s.active === entry.path);
  const openFile = useEditor((s) => s.openFile);

  const toggle = useCallback(async () => {
    if (!entry.is_dir) return void openFile(entry.path);
    if (!open && children === null) setChildren(await ipc.listDir(entry.path).catch(() => []));
    setOpen((o) => !o);
  }, [entry, open, children, openFile]);

  return (
    <>
      <div
        className={`tree-row${active ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={toggle}
        title={entry.path}
      >
        <span className="tree-caret">{entry.is_dir ? (open ? "▾" : "▸") : ""}</span>
        <span className={entry.is_dir ? "tree-dir" : ""}>{entry.name}</span>
      </div>
      {open && children?.map((c) => <Node key={c.path} entry={c} depth={depth + 1} />)}
    </>
  );
}

export function Explorer() {
  const root = useProject((s) => s.info?.root);
  const [entries, setEntries] = useState<DirEntry[]>([]);

  useEffect(() => {
    if (root) ipc.listDir("").then(setEntries).catch(() => setEntries([]));
  }, [root]);

  return (
    <div className="tree">
      {entries.map((e) => (
        <Node key={e.path} entry={e} depth={0} />
      ))}
    </div>
  );
}
