import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type OpenAI from "openai";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { executeCustomTool, isCustomToolName } from "./custom-tools.ts";
import { callAlderTool } from "./alder-mcp.ts";

const MAX_TOOL_CHARS = 120_000;

export const RESEARCH_SYSTEM_PROMPT = `You are a careful research assistant running in a terminal UI.

You can search the web, open URLs, and run deeper multi-page research using Alder tools. Local tools (read_file_lines, edit_file, bash) only affect files and shell cwd inside the app workspace—never assume access outside it.

Guidelines:
- Start with a focused web search when the user asks for facts, sources, or current information.
- Use fetch_url when the user gives a URL or when a search result deserves a closer read.
- Use deep_search when the question needs breadth (several sources in one shot) or synthesis from multiple pages.
- Cite or name your sources (page title and URL) when you rely on them.
- If tools return errors or empty results, say so briefly and adjust your approach.
- Be concise but useful: default to short answers with clear headings; expand when the user asks for depth.
- Cite every piece of information with a source; never make up information. Put the link to the source directly in the section where the information is found so the user can learn more.`;

/** Map Alder MCP tools into OpenAI / Fireworks function tools. */
export function mcpToolsToOpenAI(
  tools: McpTool[],
): ChatCompletionFunctionTool[] {
  const allow = new Set(["web_search", "fetch_url", "deep_search"]);

  return tools
    .filter((t) => allow.has(t.name))
    .map((t) => {
      const parameters = (t.inputSchema as
        | Record<string, unknown>
        | undefined) ?? {
        type: "object",
        properties: {},
      };
      return {
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters,
        },
      };
    });
}

/** Combine tool lists; later lists overwrite earlier entries with the same function name. */
export function mergeChatTools(
  ...lists: ChatCompletionFunctionTool[][]
): ChatCompletionFunctionTool[] {
  const map = new Map<string, ChatCompletionFunctionTool>();
  for (const list of lists) {
    for (const tool of list) {
      map.set(tool.function.name, tool);
    }
  }
  return [...map.values()];
}

function toolResultToString(
  result: Awaited<ReturnType<typeof callAlderTool>>,
): string {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  let out = parts.join("\n\n").trim();
  if (result.isError === true) {
    out = `Tool error:\n${out || "(no message)"}`;
  }
  if (!out) {
    out = JSON.stringify(result);
  }
  if (out.length > MAX_TOOL_CHARS) {
    out = `${out.slice(0, MAX_TOOL_CHARS)}\n\n...[truncated ${out.length - MAX_TOOL_CHARS} chars]`;
  }
  return out;
}

async function invokeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (isCustomToolName(name)) {
    try {
      const out = await executeCustomTool(name, args);
      return truncateToolText(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Custom tool error: ${msg}`;
    }
  }

  const result = await callAlderTool(name, args);
  return toolResultToString(result);
}

function truncateToolText(s: string): string {
  if (s.length <= MAX_TOOL_CHARS) return s;
  return `${s.slice(0, MAX_TOOL_CHARS)}\n\n...[truncated ${s.length - MAX_TOOL_CHARS} chars]`;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type ToolProgress = { phase: "tool"; names: string[] };

/** Fired once per chat completion request in the tool loop (each needs its own assistant row when streaming). */
export type AssistantStreamHooks = {
  onBegin?: () => void;
  onDelta?: (contentSnapshot: string) => void;
  /** Called after each completion with final merged assistant text for that round. */
  onEnd?: (finalContent: string) => void;
};

/**
 * Runs one user turn: model may call Alder tools in a loop until it responds without tool calls.
 */
export async function runResearchTurn(options: {
  client: OpenAI;
  model: string;
  tools: ChatCompletionFunctionTool[];
  messages: ChatCompletionMessageParam[];
  onToolProgress?: (p: ToolProgress) => void;
  /** Token streaming for the Fireworks/OpenAI chat stream (one begin/delta/end cycle per completion in the loop). */
  assistantStream?: AssistantStreamHooks;
}): Promise<{ messages: ChatCompletionMessageParam[]; assistantText: string }> {
  const {
    client,
    model,
    tools,
    messages: initialThread,
    onToolProgress,
    assistantStream,
  } = options;

  let messages = [...initialThread];

  while (true) {
    assistantStream?.onBegin?.();

    // Fireworks: max_tokens > 4096 requires stream: true — aggregate streamed chunks (incl. tool_calls).
    const streamRunner = client.chat.completions.stream({
      model,
      max_tokens: 8192,
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        ...messages,
      ],
      tools,
      tool_choice: "auto",
    });
    streamRunner.on("content", (_delta, snapshot) => {
      assistantStream?.onDelta?.(snapshot);
    });

    const response = await streamRunner.finalChatCompletion();

    const msg = response.choices[0]?.message;
    if (!msg) {
      throw new Error("Empty completion from Fireworks");
    }

    // Fireworks rejects `refusal: null` on round-tripped messages ("Extra inputs are not permitted").
    // Only include refusal when the model returned a non-empty string.
    const assistantMsg: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: msg.content,
      ...(typeof msg.refusal === "string" && msg.refusal.length > 0
        ? { refusal: msg.refusal }
        : {}),
      ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    };
    messages.push(assistantMsg);

    const roundText = msg.content ?? "";
    assistantStream?.onEnd?.(roundText);

    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) {
      return {
        messages,
        assistantText: roundText,
      };
    }

    onToolProgress?.({
      phase: "tool",
      names: toolCalls
        .filter((tc) => tc.type === "function")
        .map((tc) => tc.function.name),
    });

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const args = parseToolArguments(tc.function.arguments ?? "");
      const content = await invokeTool(tc.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
    }
  }
}
