import { useState, useSyncExternalStore } from "react";
import { commands, eventToKeybinding, formatKeybinding, persistOverrides } from "../commands/registry";
import { usePalette } from "../stores/palette";
import { Dialog } from "../ui/overlays";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function ShortcutsDialog() {
  const open = usePalette((s) => s.shortcutsOpen);
  const close = () => usePalette.getState().setShortcutsOpen(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  useSyncExternalStore(
    (cb) => commands.subscribe(cb),
    () => JSON.stringify(commands.getOverrides()),
  );
  if (!open) return null;

  const overrides = commands.getOverrides();
  const rows = [...commands.list()].sort((a, b) => a.title.localeCompare(b.title));

  const onKey = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(null);
    const kb = eventToKeybinding(e.nativeEvent);
    if (!kb) return;
    const clash = commands.conflicts(kb, id);
    setWarning(clash.length ? `${formatKeybinding(kb, isMac)} was used by “${clash.map((c) => c.title).join(", ")}” — that command is now unbound.` : null);
    for (const c of clash) commands.setOverride(c.id, null);
    commands.setOverride(id, kb);
    persistOverrides();
    setRecording(null);
  };

  return (
    <Dialog title="Keyboard Shortcuts" onClose={close} width={640}>
      {warning && <div className="banner warn-banner">{warning}</div>}
      <div className="shortcuts">
        {rows.map((c) => {
          const kb = commands.bindingFor(c);
          return (
            <div key={c.id} className="shortcut-row">
              <span className="sc-title">{c.title}</span>
              <button
                className={`sc-key${recording === c.id ? " recording" : ""}`}
                onClick={() => setRecording(c.id)}
                onKeyDown={(e) => recording === c.id && onKey(e, c.id)}
                onBlur={() => setRecording((r) => (r === c.id ? null : r))}
                autoFocus={recording === c.id}
              >
                {recording === c.id ? "Press keys…" : kb ? formatKeybinding(kb, isMac) : "—"}
              </button>
              <button
                disabled={!(c.id in overrides) && !kb}
                title={c.id in overrides ? "Reset to default" : "Remove shortcut"}
                onClick={() => {
                  if (c.id in overrides) commands.resetOverride(c.id);
                  else commands.setOverride(c.id, null);
                  persistOverrides();
                }}
              >
                {c.id in overrides ? "Reset" : "Clear"}
              </button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
