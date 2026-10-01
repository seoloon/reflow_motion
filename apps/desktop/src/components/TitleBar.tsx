import * as Menubar from "@radix-ui/react-menubar";
import { Check, ChevronRight, Maximize2, PanelBottom, PanelLeft, PanelRight, Redo2, Search, Undo2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { MENUS, type MenuEntry } from "../commands/menus";
import { commands, formatKeybinding } from "../commands/registry";
import { history, redo, undo, useHistoryVersion } from "../stores/edits";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { IconButton } from "../ui/kit";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function Entry({ e }: { e: MenuEntry }) {
  const compositions = useProject((s) => s.info?.compositions ?? []);
  const select = usePreview((s) => s.select);
  const current = usePreview((s) => s.compositionId);
  const { layout, current: page } = useWorkspace();
  // commands may be rebound or (un)registered while a menu is open
  useSyncExternalStore(
    (cb) => commands.subscribe(cb),
    () => JSON.stringify(commands.getOverrides()),
  );

  if ("sep" in e) return <Menubar.Separator className="mb-sep" />;

  if ("compositions" in e) {
    if (compositions.length === 0) return <Menubar.Item className="mb-item" disabled>No compositions</Menubar.Item>;
    return (
      <>
        {compositions.map((c) => (
          <Menubar.CheckboxItem key={`${c.file}:${c.line}`} className="mb-item" checked={current === c.id} onSelect={() => select(c.id)}>
            <Menubar.ItemIndicator className="mb-check"><Check size={13} /></Menubar.ItemIndicator>
            {c.id}
          </Menubar.CheckboxItem>
        ))}
      </>
    );
  }

  if ("sub" in e) {
    return (
      <Menubar.Sub>
        <Menubar.SubTrigger className="mb-item">
          {e.sub}
          <ChevronRight size={14} className="mb-right" />
        </Menubar.SubTrigger>
        <Menubar.Portal>
          <Menubar.SubContent className="mb-content" alignOffset={-4}>
            {e.items.map((x, i) => <Entry key={i} e={x} />)}
          </Menubar.SubContent>
        </Menubar.Portal>
      </Menubar.Sub>
    );
  }

  const cmd = commands.get(e.cmd);
  if (!cmd) return null;
  const enabled = !cmd.enabled || cmd.enabled();
  const shortcut = formatKeybinding(commands.bindingFor(cmd), isMac);
  const toggled: Record<string, boolean> = {
    "view.toggleSidebar": layout.visible.sidebar,
    "view.toggleInspector": layout.visible.inspector,
    "view.toggleTimeline": layout.visible.dock,
    "view.toggleEditor": layout.visible.editor,
    "view.togglePreview": layout.visible.preview,
  };
  const isPage = e.cmd.startsWith("workspace.") && e.cmd === `workspace.${page}`;
  return (
    <Menubar.Item className="mb-item" disabled={!enabled} onSelect={() => void commands.run(e.cmd)}>
      {(e.cmd in toggled || e.cmd.startsWith("workspace.")) && (
        <span className="mb-check">{(toggled[e.cmd] || isPage) && <Check size={13} />}</span>
      )}
      <span className="mb-label">{cmd.title}</span>
      {shortcut && <span className="mb-shortcut">{shortcut}</span>}
    </Menubar.Item>
  );
}

export function TitleBar() {
  const info = useProject((s) => s.info);
  const { layout, togglePanel } = useWorkspace();
  const fullscreen = useUi((s) => s.previewFullscreen);
  useHistoryVersion((s) => s.version);

  return (
    <header className="titlebar">
      <div className="tb-brand" aria-label="ReFlow Motion">
        <span className="logo" />
      </div>

      <Menubar.Root className="menubar">
        {MENUS.map((m) => (
          <Menubar.Menu key={m.label}>
            <Menubar.Trigger className="mb-trigger">{m.label}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="mb-content" align="start" sideOffset={4} loop>
                {m.items.map((e, i) => <Entry key={i} e={e} />)}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>

      <button className="command-center" onClick={() => void commands.run("palette.commands")} aria-label="Open the command palette">
        <Search size={14} />
        <span className="cc-text">{info ? (info.name ?? "project") : "ReFlow Motion"}</span>
        <kbd>{isMac ? "⌘K" : "Ctrl+K"}</kbd>
      </button>

      <div className="tb-actions">
        <IconButton label="Undo" shortcut={isMac ? "⌘Z" : "Ctrl+Z"} disabled={!history.canUndo} onClick={() => void undo()}><Undo2 size={16} /></IconButton>
        <IconButton label="Redo" shortcut={isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"} disabled={!history.canRedo} onClick={() => void redo()}><Redo2 size={16} /></IconButton>
        <span className="tb-sep" />
        <IconButton label="Toggle side bar" shortcut={isMac ? "⌘B" : "Ctrl+B"} active={layout.visible.sidebar} onClick={() => togglePanel("sidebar")}><PanelLeft size={16} /></IconButton>
        <IconButton label="Toggle bottom panel" shortcut={isMac ? "⌘J" : "Ctrl+J"} active={layout.visible.dock} onClick={() => togglePanel("dock")}><PanelBottom size={16} /></IconButton>
        <IconButton label="Toggle inspector" shortcut={isMac ? "⌥⌘I" : "Ctrl+Alt+I"} active={layout.visible.inspector} onClick={() => togglePanel("inspector")}><PanelRight size={16} /></IconButton>
        <span className="tb-sep" />
        <IconButton label="Fullscreen preview" shortcut={isMac ? "⇧⌘F" : "Ctrl+Shift+F"} active={fullscreen} onClick={() => void commands.run("preview.fullscreen")}><Maximize2 size={16} /></IconButton>
      </div>
    </header>
  );
}
