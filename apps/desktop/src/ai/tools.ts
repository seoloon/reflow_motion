import type { ProjectContext, ToolCall, ToolDef } from "./types";

export const MAX_READ_CHARS = 200_000;
const MAX_LIST = 200;

export const TOOLS: ToolDef[] = [
  {
    name: "get_project_context",
    description: "Project structure: compositions (size, fps, duration, props, layers, keyframes), timeline state, selection, open files, git status and recent errors.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Read a text file of the project (path relative to the project root).",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "list_files",
    description: "List project files, optionally filtered by a substring. Dependency and build folders are excluded.",
    parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "get_logs",
    description: "Recent application, Remotion and renderer log lines.",
    parameters: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "propose_change",
    description:
      "Propose the full new content of one file. Nothing is written: the user reviews a diff and decides. Always include a one-line summary of what changes and why.",
    parameters: {
      type: "object",
      properties: { file: { type: "string" }, content: { type: "string" }, summary: { type: "string" } },
      required: ["file", "content", "summary"],
      additionalProperties: false,
    },
  },
];

export interface ToolDeps {
  context: () => ProjectContext;
  readFile: (path: string) => Promise<string>;
  listFiles: () => Promise<string[]>;
  logs: (limit: number) => string[];
  /** Creates a reviewable proposal; must never write to disk. */
  propose: (file: string, content: string, summary: string) => Promise<{ id: number }>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Execute one tool call. Failures are returned as `{ error }` so the model can recover. */
export async function executeTool(call: ToolCall, deps: ToolDeps): Promise<unknown> {
  try {
    switch (call.name) {
      case "get_project_context":
        return deps.context();
      case "read_file": {
        const path = str(call.args.path);
        if (!path) return { error: "path is required" };
        const text = await deps.readFile(path);
        return text.length > MAX_READ_CHARS
          ? { path, truncated: true, content: text.slice(0, MAX_READ_CHARS) }
          : { path, content: text };
      }
      case "list_files": {
        const q = str(call.args.query)?.toLowerCase();
        const files = (await deps.listFiles()).filter((f) => !q || f.toLowerCase().includes(q));
        return { files: files.slice(0, MAX_LIST), total: files.length };
      }
      case "get_logs": {
        const limit = typeof call.args.limit === "number" ? Math.min(200, Math.max(1, Math.floor(call.args.limit))) : 50;
        return { lines: deps.logs(limit) };
      }
      case "propose_change": {
        const file = str(call.args.file);
        const summary = str(call.args.summary);
        if (!file || typeof call.args.content !== "string" || !summary) return { error: "file, content and summary are required" };
        const p = await deps.propose(file, call.args.content, summary);
        return { proposalId: p.id, status: "pending_user_review", note: "The user must review and apply this change. It has not been written." };
      }
      default:
        return { error: `unknown tool: ${call.name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : typeof e === "object" && e && "title" in e ? String((e as { title: unknown }).title) : String(e) };
  }
}
