import { executeTool, TOOLS, type ToolDeps } from "./tools";
import type { AiProvider, ChatMessage, ToolCall } from "./types";

export const SYSTEM_PROMPT = [
  "You are the assistant of ReFlow Motion, a motion-design environment for Remotion projects.",
  "You work on the user's real project: read it with the tools, never guess file contents.",
  "You cannot write files. To change code, call propose_change with the complete new content of the file;",
  "the user reviews a diff and applies it. Prefer small, focused changes that keep the file's style.",
  "Keep Remotion code deterministic: derive animation from useCurrentFrame(), never from time or randomness.",
  "Explain what you changed in one or two sentences.",
].join(" ");

export interface AgentOptions {
  provider: AiProvider;
  history: ChatMessage[];
  userText: string;
  deps: ToolDeps;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Called after every message is appended, so the UI can stream the conversation. */
  onMessage?: (m: ChatMessage) => void;
}

/**
 * Tool-use loop: ask the model, run the tools it calls, feed results back, repeat until it answers
 * without calling tools (or `maxSteps` is reached). Returns the full conversation.
 */
export async function runAgent(opts: AgentOptions): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...opts.history];
  const push = (m: ChatMessage) => {
    messages.push(m);
    opts.onMessage?.(m);
  };
  push({ role: "user", text: opts.userText });

  const maxSteps = opts.maxSteps ?? 8;
  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) break;
    let text = "";
    const calls: ToolCall[] = [];
    for await (const ev of opts.provider.send(messages, TOOLS, SYSTEM_PROMPT, opts.signal)) {
      if (ev.type === "text") text += ev.text;
      else if (ev.type === "tool_call") calls.push(ev.call);
      else if (ev.type === "done") break;
    }
    push({ role: "assistant", text, toolCalls: calls.length ? calls : undefined });
    if (calls.length === 0) return messages;

    for (const call of calls) {
      const result = await executeTool(call, opts.deps);
      push({ role: "tool", callId: call.id, name: call.name, result });
    }
  }
  push({ role: "assistant", text: "Stopped: the assistant reached the step limit without finishing." });
  return messages;
}
