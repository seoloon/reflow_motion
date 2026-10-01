import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { useEditor } from "../stores/editor";
import { useGit } from "../stores/git";
import { useLog } from "../stores/log";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useSelection } from "../stores/selection";
import { useTimeline } from "../stores/timeline";
import { runAgent } from "./agent";
import { buildContext } from "./context";
import { currentText, useProposals } from "./proposals";
import type { ToolDeps } from "./tools";
import type { AiProvider, ChatMessage, ProjectContext } from "./types";

export function currentContext(): ProjectContext {
  const tl = useTimeline.getState();
  return buildContext({
    info: useProject.getState().info,
    timeline: { compositionId: usePreview.getState().compositionId, frame: tl.frame, playing: tl.playing, markers: tl.markers },
    selection: useSelection.getState().selection,
    tabs: useEditor.getState().tabs,
    git: useGit.getState().status,
    logs: useLog.getState().lines,
  });
}

export function liveDeps(): ToolDeps {
  return {
    context: currentContext,
    // the user's current text (including unsaved edits), so the assistant never reasons about stale code
    readFile: async (path) => {
      const text = await currentText(path);
      if (text === "") await ipc.readFile(path); // surfaces "file not found" / scope errors to the model
      return text;
    },
    listFiles: () => ipc.listFiles(),
    logs: (limit) =>
      useLog
        .getState()
        .lines.slice(-limit)
        .map((l) => `[${l.level}] ${l.source}: ${l.message}`),
    propose: (file, content, summary) => useProposals.getState().propose(file, content, summary),
  };
}

interface AiState {
  providers: AiProvider[];
  providerId: string | null;
  messages: ChatMessage[];
  running: boolean;
  error: string | null;
  abort: AbortController | null;
  registerProvider: (p: AiProvider) => () => void;
  setProvider: (id: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/** No provider is built in. Integrations register themselves here (see docs/architecture.md, ADR-10). */
export const useAi = create<AiState>((set, get) => ({
  providers: [],
  providerId: null,
  messages: [],
  running: false,
  error: null,
  abort: null,
  registerProvider(p) {
    set((s) => ({ providers: [...s.providers.filter((x) => x.id !== p.id), p], providerId: s.providerId ?? p.id }));
    return () => set((s) => ({ providers: s.providers.filter((x) => x.id !== p.id), providerId: s.providerId === p.id ? null : s.providerId }));
  },
  setProvider: (providerId) => set({ providerId }),
  async send(text) {
    const { providers, providerId, messages, running } = get();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || running || !text.trim()) return;
    const abort = new AbortController();
    set({ running: true, error: null, abort });
    try {
      const final = await runAgent({
        provider,
        history: messages,
        userText: text,
        deps: liveDeps(),
        signal: abort.signal,
        onMessage: (m) => set((s) => ({ messages: [...s.messages.filter((x) => x !== m), m] })),
      });
      set({ messages: final });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false, abort: null });
    }
  },
  stop: () => get().abort?.abort(),
  clear: () => set({ messages: [], error: null }),
}));
