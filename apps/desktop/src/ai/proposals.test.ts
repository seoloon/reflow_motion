import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const writeFile = vi.fn(async (path: string, content: string) => void files.set(path, content));
const readFile = vi.fn(async (path: string) => {
  if (!files.has(path)) throw new Error("not found");
  return files.get(path)!;
});

vi.mock("../lib/ipc", () => ({
  ipc: { readFile, writeFile, refreshProject: vi.fn(async () => ({})) },
  toUserMessage: (e: unknown) => ({ title: "err", hint: "", details: String(e) }),
}));

const { useProposals } = await import("./proposals");
const { history, undo } = await import("../stores/edits");
const { useEditor } = await import("../stores/editor");

beforeEach(() => {
  files.clear();
  writeFile.mockClear();
  useProposals.setState({ proposals: [] });
  useEditor.getState().reset();
  history.clear();
});

describe("AI proposals", () => {
  it("creating a proposal never writes the file", async () => {
    files.set("src/A.tsx", "old");
    const p = await useProposals.getState().propose("src/A.tsx", "new", "change A");
    expect(p).toMatchObject({ before: "old", after: "new", status: "pending" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(files.get("src/A.tsx")).toBe("old");
  });

  it("applying writes the file once, records history and can be undone", async () => {
    files.set("src/A.tsx", "old");
    const p = await useProposals.getState().propose("src/A.tsx", "new", "change A");
    expect(await useProposals.getState().apply(p.id)).toBe(true);
    expect(files.get("src/A.tsx")).toBe("new");
    expect(useProposals.getState().proposals[0].status).toBe("applied");
    expect(history.nextUndoLabel).toBe("AI: change A");
    await undo();
    expect(files.get("src/A.tsx")).toBe("old");
    // an applied proposal cannot be applied twice
    expect(await useProposals.getState().apply(p.id)).toBe(false);
  });

  it("refuses to apply over edits made after the proposal", async () => {
    files.set("src/A.tsx", "old");
    const p = await useProposals.getState().propose("src/A.tsx", "new", "change A");
    files.set("src/A.tsx", "user edited meanwhile");
    expect(await useProposals.getState().apply(p.id)).toBe(false);
    expect(files.get("src/A.tsx")).toBe("user edited meanwhile");
    expect(useProposals.getState().proposals[0].status).toBe("pending");
  });

  it("uses unsaved editor text as the baseline", async () => {
    files.set("src/A.tsx", "on disk");
    useEditor.setState({ tabs: [{ path: "src/A.tsx", content: "unsaved edit", saved: "on disk" }], active: "src/A.tsx" });
    const p = await useProposals.getState().propose("src/A.tsx", "proposal", "x");
    expect(p.before).toBe("unsaved edit");
  });

  it("supports new files and rejection", async () => {
    const p = await useProposals.getState().propose("src/New.tsx", "export {}", "add file");
    expect(p.before).toBe("");
    useProposals.getState().reject(p.id);
    expect(useProposals.getState().proposals[0].status).toBe("rejected");
    expect(await useProposals.getState().apply(p.id)).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
