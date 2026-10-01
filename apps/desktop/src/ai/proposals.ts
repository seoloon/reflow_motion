import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { applyTextChange } from "../stores/edits";
import { useEditor } from "../stores/editor";
import { toast } from "../stores/toasts";
import type { ProposedChange } from "./types";

interface ProposalState {
  proposals: ProposedChange[];
  propose: (file: string, after: string, summary: string) => Promise<ProposedChange>;
  apply: (id: number) => Promise<boolean>;
  reject: (id: number) => void;
  clearResolved: () => void;
}

let nextId = 1;

/** Text the user currently sees for a file: the open (possibly unsaved) tab, else disk, else empty for a new file. */
export async function currentText(file: string): Promise<string> {
  const tab = useEditor.getState().tabs.find((t) => t.path === file);
  if (tab) return tab.content;
  try {
    return await ipc.readFile(file);
  } catch {
    return "";
  }
}

export const useProposals = create<ProposalState>((set, get) => ({
  proposals: [],
  /** Records a proposal. This never touches the file. */
  async propose(file, after, summary) {
    const p: ProposedChange = { id: nextId++, file, summary, before: await currentText(file), after, status: "pending", createdAt: Date.now() };
    set((s) => ({ proposals: [...s.proposals, p] }));
    return p;
  },
  async apply(id) {
    const p = get().proposals.find((x) => x.id === id);
    if (!p || p.status !== "pending") return false;
    // refuse to overwrite edits made after the proposal was created
    if ((await currentText(p.file)) !== p.before) {
      toast.error(`${p.file} changed since this was proposed. Reject it and ask again.`);
      return false;
    }
    try {
      await applyTextChange(p.file, p.before, p.after, `AI: ${p.summary}`);
    } catch {
      toast.error(`Could not write ${p.file}.`);
      return false;
    }
    set((s) => ({ proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "applied" } : x)) }));
    toast.success(`Applied to ${p.file}. Undo with Ctrl+Z.`);
    return true;
  },
  reject: (id) => set((s) => ({ proposals: s.proposals.map((x) => (x.id === id && x.status === "pending" ? { ...x, status: "rejected" } : x)) })),
  clearResolved: () => set((s) => ({ proposals: s.proposals.filter((p) => p.status === "pending") })),
}));
