import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { ipc, toUserMessage } from "../lib/ipc";
import { openProjectAt } from "../commands/builtin";
import { useDialogs } from "../stores/dialogs";
import { toast } from "../stores/toasts";
import type { TemplateInfo, UserMessage } from "../types";
import { Dialog } from "../ui/overlays";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function NewProjectDialog() {
  const open = useDialogs((s) => s.newProjectOpen);
  const close = () => useDialogs.getState().setNewProjectOpen(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState("title");
  const [name, setName] = useState("my-video");
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<UserMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      void ipc.listTemplates().then(setTemplates).catch(() => setTemplates([]));
    }
  }, [open]);

  if (!open) return null;
  const nameOk = NAME_RE.test(name);

  const create = async () => {
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      const path = await ipc.createProject(template, parent, name);
      close();
      await openProjectAt(path);
      toast.success("Project created. Install its dependencies to start the preview.");
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New Project" onClose={close} width={560}>
      <div className="newproj">
        <div className="tpl-grid">
          {templates.map((t) => (
            <button key={t.id} className={`tpl${template === t.id ? " active" : ""}`} onClick={() => setTemplate(t.id)}>
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
        <label>
          Project name
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />
          {!nameOk && <span className="field-error">Lowercase letters, digits, - and _ only.</span>}
        </label>
        <label>
          Location
          <div className="loc-row">
            <input readOnly value={parent ?? ""} placeholder="Choose a folder…" />
            <button
              onClick={async () => {
                const p = await pickFolder({ directory: true, multiple: false, title: "Where should the project be created?" });
                if (typeof p === "string") setParent(p);
              }}
            >
              Browse…
            </button>
          </div>
        </label>
        {error && (
          <div className="message error">
            <strong>{error.title}</strong>
            <p>{error.hint}</p>
          </div>
        )}
        <div className="dialog-actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" disabled={!nameOk || !parent || busy} onClick={() => void create()}>
            Create project
          </button>
        </div>
      </div>
    </Dialog>
  );
}
