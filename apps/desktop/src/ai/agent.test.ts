import { describe, expect, it, vi } from "vitest";
import { runAgent } from "./agent";
import { buildContext } from "./context";
import { executeTool, MAX_READ_CHARS, TOOLS, type ToolDeps } from "./tools";
import type { AiProvider, ChatMessage, ProviderEvent, ToolCall } from "./types";
import type { ProjectInfo } from "../types";

/** Provider that replays scripted turns and records what it was sent. */
function scripted(turns: ProviderEvent[][]): AiProvider & { seen: ChatMessage[][] } {
  let i = 0;
  const seen: ChatMessage[][] = [];
  return {
    id: "scripted",
    name: "Scripted",
    seen,
    async *send(messages) {
      seen.push([...messages]);
      for (const ev of turns[Math.min(i++, turns.length - 1)]) yield ev;
    },
  };
}

const call = (id: string, name: string, args: Record<string, unknown>): ProviderEvent => ({ type: "tool_call", call: { id, name, args } as ToolCall });

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    context: () => buildContext({ info: null, timeline: { compositionId: null, frame: 0, playing: false, markers: {} }, selection: null, tabs: [], git: null, logs: [] }),
    readFile: async () => "export const A = 1;",
    listFiles: async () => ["src/Root.tsx", "src/Title.tsx", "package.json"],
    logs: () => [],
    propose: async () => ({ id: 1 }),
    ...over,
  };
}

describe("agent loop", () => {
  it("reads, then proposes a change, without ever writing", async () => {
    const propose = vi.fn(async () => ({ id: 7 }));
    const readFile = vi.fn(async () => "const a = 1;");
    const provider = scripted([
      [call("c1", "read_file", { path: "src/Title.tsx" }), { type: "done" }],
      [call("c2", "propose_change", { file: "src/Title.tsx", content: "const a = 2;", summary: "bump a" }), { type: "done" }],
      [{ type: "text", text: "I proposed a change." }, { type: "done" }],
    ]);
    const out = await runAgent({ provider, history: [], userText: "make a 2", deps: deps({ propose, readFile }) });

    expect(readFile).toHaveBeenCalledWith("src/Title.tsx");
    expect(propose).toHaveBeenCalledWith("src/Title.tsx", "const a = 2;", "bump a");
    const toolResults = out.filter((m) => m.role === "tool");
    expect(toolResults).toHaveLength(2);
    expect(JSON.stringify(toolResults[1])).toContain("pending_user_review");
    expect(out[out.length - 1]).toMatchObject({ role: "assistant", text: "I proposed a change." });
    // each turn sees the previous tool results
    expect(provider.seen[1].some((m) => m.role === "tool" && m.name === "read_file")).toBe(true);
  });

  it("stops at the step limit instead of looping forever", async () => {
    const provider = scripted([[call("c", "get_logs", {}), { type: "done" }]]);
    const out = await runAgent({ provider, history: [], userText: "loop", deps: deps(), maxSteps: 3 });
    expect(provider.seen).toHaveLength(3);
    expect(out[out.length - 1]).toMatchObject({ role: "assistant" });
    expect((out[out.length - 1] as { text: string }).text).toMatch(/step limit/);
  });

  it("honours an abort signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const provider = scripted([[{ type: "text", text: "hi" }]]);
    const out = await runAgent({ provider, history: [], userText: "x", deps: deps(), signal: ctrl.signal });
    expect(provider.seen).toHaveLength(0);
    expect(out[0]).toMatchObject({ role: "user" });
  });

  it("streams messages to the UI and keeps prior history", async () => {
    const seen: string[] = [];
    const provider = scripted([[{ type: "text", text: "done" }, { type: "done" }]]);
    const out = await runAgent({
      provider,
      history: [{ role: "user", text: "earlier" }],
      userText: "now",
      deps: deps(),
      onMessage: (m) => seen.push(m.role),
    });
    expect(seen).toEqual(["user", "assistant"]);
    expect(out.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
  });
});

describe("tools", () => {
  it("exposes exactly the read tools plus propose_change (no write tool)", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["get_logs", "get_project_context", "list_files", "propose_change", "read_file"]);
  });

  it("returns errors to the model instead of throwing", async () => {
    const r = await executeTool({ id: "1", name: "read_file", args: { path: "../../etc/passwd" } }, deps({ readFile: async () => { throw new Error("path escapes the project"); } }));
    expect(r).toEqual({ error: "path escapes the project" });
    expect(await executeTool({ id: "2", name: "nope", args: {} }, deps())).toEqual({ error: "unknown tool: nope" });
    expect(await executeTool({ id: "3", name: "read_file", args: {} }, deps())).toEqual({ error: "path is required" });
    expect(await executeTool({ id: "4", name: "propose_change", args: { file: "a" } }, deps())).toMatchObject({ error: expect.any(String) });
  });

  it("truncates huge files and filters/limits file lists", async () => {
    const big = "x".repeat(MAX_READ_CHARS + 10);
    const r = (await executeTool({ id: "1", name: "read_file", args: { path: "a" } }, deps({ readFile: async () => big }))) as { truncated: boolean; content: string };
    expect(r.truncated).toBe(true);
    expect(r.content).toHaveLength(MAX_READ_CHARS);
    const l = (await executeTool({ id: "2", name: "list_files", args: { query: "TITLE" } }, deps())) as { files: string[] };
    expect(l.files).toEqual(["src/Title.tsx"]);
  });
});

describe("project context", () => {
  it("summarises what the assistant may know and nothing else", () => {
    const info = {
      name: "demo",
      remotion_version: "4.0.532",
      package_manager: "pnpm",
      entry_point: "src/index.ts",
      scripts: { dev: "remotion studio" },
      dependencies: { secret: "x" },
      root: "D:/private/path",
      compositions: [
        {
          id: "Main", width: 1920, height: 1080, fps: 30, duration_in_frames: 120, duration_seconds: 4, is_still: false, file: "src/Root.tsx", line: 5,
          component: "Main", component_ref: { file: "src/Main.tsx", export: "Main" },
          layers: [{ name: "Sub", from: 10, duration_in_frames: 30, file: "src/Main.tsx", line: 9 }],
          animations: [{ name: "fade", file: "src/Main.tsx", line: 4, frames: [0, 30], values: [0, 1], driver: "frame" }],
          default_props: { title: "Hi" }, metadata: { editable: { title: { type: "string" } } },
        },
      ],
      assets: [], has_node_modules: true,
    } as unknown as ProjectInfo;
    const ctx = buildContext({
      info,
      timeline: { compositionId: "Main", frame: 12, playing: false, markers: { Main: [5] } },
      selection: { kind: "composition" },
      tabs: [{ path: "src/Main.tsx", content: "b", saved: "a" }],
      git: { branch: "main", ahead: 0, behind: 0, files: [{ path: "src/Main.tsx", orig_path: null, staged: null, unstaged: "modified" }] },
      logs: [{ level: "ERROR", source: "preview", message: "boom" }, { level: "INFO", source: "app", message: "ok" }],
    });
    expect(ctx.compositions[0]).toMatchObject({ id: "Main", previewable: true, editableProps: ["title"], props: { title: "Hi" } });
    expect(ctx.compositions[0].animations[0].frames).toEqual([0, 30]);
    expect(ctx.timeline).toEqual({ compositionId: "Main", frame: 12, playing: false, markers: [5] });
    expect(ctx.openFiles).toEqual([{ path: "src/Main.tsx", unsaved: true }]);
    expect(ctx.git).toEqual({ branch: "main", changedFiles: ["src/Main.tsx"] });
    expect(ctx.recentErrors).toEqual(["preview: boom"]);
    // no absolute paths or dependency lists leak into the context
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("D:/private");
    expect(json).not.toContain("secret");
  });
});
