import "./ensure-bun-strip-ansi.ts";
import { createCliRenderer, TextAttributes, type TextareaRenderable } from "@opentui/core";
import { createRoot, useAppContext, useKeyboard, useTerminalDimensions } from "@opentui/react";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectAlder, disconnectAlder } from "./alder-mcp.ts";
import { getConfig } from "./config.ts";
import { getCustomToolDefinitions } from "./custom-tools.ts";
import { promptCredentialsIfNeeded } from "./prompt-credentials-cli.ts";
import { loadUserCredentialsIntoEnv } from "./user-credentials.ts";
import { mergeChatTools, mcpToolsToOpenAI, runResearchTurn, type ToolProgress } from "./research-agent.ts";
import { getWorkspaceRoot } from "./workspace-sandbox.ts";

type ChatLine =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "status"; text: string }
  | { kind: "tools"; calls: ToolProgress["calls"] };

const TOOL_SPINNER = ["|", "/", "-", "\\"];

/** Footer label while busy (dots animate separately). */
type BusyCaption =
  | "thinking"
  | "writing"
  | "searching"
  | "reading"
  | "researching"
  | "running";

function captionVerb(c: BusyCaption): string {
  switch (c) {
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing";
    case "searching":
      return "Searching";
    case "reading":
      return "Reading";
    case "researching":
      return "Researching";
    case "running":
      return "Running";
  }
}

/** Derive activity from tools invoked in the current batch (priority if multiple). */
function busyCaptionFromToolCalls(calls: ToolProgress["calls"]): BusyCaption {
  const s = new Set(calls.map((call) => call.name));
  if (s.has("deep_search")) return "researching";
  if (s.has("web_search")) return "searching";
  if (s.has("fetch_url") || s.has("read_file_lines")) return "reading";
  if (s.has("edit_file")) return "writing";
  if (s.has("bash")) return "running";
  return "thinking";
}

function ToolsRunningRow({ calls }: { calls: ToolProgress["calls"] }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % TOOL_SPINNER.length), 120);
    return () => clearInterval(id);
  }, []);
  const summaries = calls.length ? calls.map((call) => call.summary) : ["tools"];
  return (
    <box flexDirection="column">
      {summaries.map((summary, i) => (
        <text key={i}>
          <span fg="#e0af68">{TOOL_SPINNER[frame]!}</span>
          <span fg="#7aa2f7"> Calling </span>
          <span attributes={TextAttributes.DIM}>{summary}</span>
        </text>
      ))}
    </box>
  );
}

function toolStatusText(calls: ToolProgress["calls"]): string {
  const summaries = calls.length ? calls.map((call) => call.summary) : ["tools"];
  return `· ${summaries.join("; ")}`;
}

function App() {
  const { renderer } = useAppContext();
  const { height } = useTerminalDimensions();
  const cfg = getConfig();

  const [lines, setLines] = useState<ChatLine[]>(() => [
    { kind: "status", text: "Connecting to Alder MCP…" },
  ]);
  const [inputKey, setInputKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyCaption, setBusyCaption] = useState<BusyCaption>("thinking");
  const [workingDots, setWorkingDots] = useState(0);
  const [toolsLabel, setToolsLabel] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");

  const conversationRef = useRef<ChatCompletionMessageParam[]>([]);
  const fireworksRef = useRef<OpenAI | null>(null);
  const toolsRef = useRef<ReturnType<typeof mcpToolsToOpenAI>>([]);
  const composerRef = useRef<TextareaRenderable | null>(null);
  /** Avoid stale `busy` / `ready` in submit — OpenTUI may invoke an older textarea callback. */
  const readyRef = useRef(ready);
  const busyRef = useRef(busy);
  readyRef.current = ready;
  busyRef.current = busy;

  /** Lines reserved below scrollbox (header/footer + multi-line composer). */
  const composerRows = 5;
  const layoutReserve = 8 + (composerRows - 1);

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer?.destroy();
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const env = getConfig();
      if (!env.isConfigured) {
        setLines([
          {
            kind: "status",
            text: "Missing FIREWORKS_API_KEY or ALDER_API_KEY — run setup or set env vars (.env.example).",
          },
        ]);
        return;
      }

      try {
        setWorkspacePath(getWorkspaceRoot());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLines((prev) => [
          ...prev,
          { kind: "status", text: `Bad workspace: ${msg}` },
        ]);
        return;
      }

      try {
        const client = await connectAlder(env.alderMcpUrl, env.alderApiKey);
        if (cancelled) return;

        const listed = await client.listTools();
        const tools = mergeChatTools(
          mcpToolsToOpenAI(listed.tools),
          getCustomToolDefinitions(),
        );
        toolsRef.current = tools;
        fireworksRef.current = new OpenAI({
          apiKey: env.fireworksApiKey,
          baseURL: env.fireworksBaseUrl,
        });

        setToolsLabel(tools.map((t) => t.function.name).join(", "));
        setReady(true);
        setLines((prev) => [
          ...prev.filter((l) => l.kind !== "status" || !l.text.startsWith("Connecting")),
          {
            kind: "status",
            text: `Ready (Fireworks). Tools: ${tools.map((t) => t.function.name).join(", ")} — Enter sends; Shift+Enter newline; Esc exits.`,
          },
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLines((prev) => [
          ...prev,
          {
            kind: "status",
            text: `Failed to connect to Alder: ${msg}`,
          },
        ]);
      }
    }

    void init();

    return () => {
      cancelled = true;
      void disconnectAlder();
    };
  }, []);

  useEffect(() => {
    if (!busy) {
      setWorkingDots(0);
      return;
    }
    const id = setInterval(() => setWorkingDots((d) => (d + 1) % 4), 420);
    return () => clearInterval(id);
  }, [busy]);

  /** Keep typing focus on the composer — scrollbox also requests focus and would steal Enter. */
  useEffect(() => {
    if (!ready || busy) return;
    composerRef.current?.focus();
  }, [ready, busy]);

  function finalizePendingToolLines(lines: ChatLine[]): ChatLine[] {
    return lines.map((l) =>
      l.kind === "tools" ? { kind: "status", text: toolStatusText(l.calls) } : l,
    );
  }

  const onSubmit = useCallback(
    async (value: string) => {
      const q = value.trim();
      if (!q || busyRef.current || !readyRef.current) return;

      const fireworks = fireworksRef.current;
      const tools = toolsRef.current;
      if (!fireworks || tools.length === 0) {
        setLines((prev) => [
          ...prev,
          {
            kind: "status",
            text: `Cannot send: ${!fireworks ? "model client not ready" : "no tools loaded"}.`,
          },
        ]);
        return;
      }

      setInputKey((k) => k + 1);
      setBusy(true);
      setBusyCaption("thinking");
      setLines((prev) => [...prev, { kind: "user", text: q }]);

      const userMessage: ChatCompletionMessageParam = { role: "user", content: q };

      try {
        const { messages, assistantText } = await runResearchTurn({
          client: fireworks,
          model: cfg.fireworksModel,
          tools,
          messages: [...conversationRef.current, userMessage],
          onToolProgress: ({ calls }) => {
            setBusyCaption(busyCaptionFromToolCalls(calls));
            setLines((prev) => {
              const next = prev.filter(
                (line) =>
                  !(
                    line.kind === "assistant" &&
                    line.streaming === false &&
                    !line.text.trim()
                  ),
              );
              return [...next, { kind: "tools", calls }];
            });
          },
          assistantStream: {
            onBegin: () => {
              setBusyCaption("writing");
              setLines((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  const line = next[i];
                  if (line?.kind === "tools") {
                    next[i] = { kind: "status", text: toolStatusText(line.calls) };
                    break;
                  }
                }
                next.push({ kind: "assistant", text: "", streaming: true });
                return next;
              });
            },
            onDelta: (snapshot) => {
              setLines((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  const line = next[i];
                  if (line?.kind === "assistant" && line.streaming) {
                    next[i] = { kind: "assistant", text: snapshot, streaming: true };
                    return next;
                  }
                }
                return prev;
              });
            },
            onEnd: (finalContent) => {
              setLines((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  const line = next[i];
                  if (line?.kind === "assistant" && line.streaming) {
                    next[i] = { kind: "assistant", text: finalContent, streaming: false };
                    return next;
                  }
                }
                return prev;
              });
            },
          },
        });

        conversationRef.current = messages;
        if (!assistantText.trim()) {
          setLines((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const line = next[i];
              if (line?.kind === "assistant") {
                next[i] = { kind: "assistant", text: "(no text)", streaming: false };
                break;
              }
            }
            return next;
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLines((prev) => {
          let next = finalizePendingToolLines(prev);
          for (let i = next.length - 1; i >= 0; i--) {
            const line = next[i];
            if (line?.kind === "assistant" && line.streaming) {
              next = [...next];
              next[i] = {
                kind: "assistant",
                text: line.text.trim() ? line.text : "(interrupted)",
                streaming: false,
              };
              break;
            }
          }
          return [...next, { kind: "status", text: `Error: ${msg}` }];
        });
      } finally {
        setBusy(false);
      }
    },
    [cfg.fireworksModel],
  );

  const scrollHeight = Math.max(8, height - layoutReserve);

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="column" marginBottom={1}>
        <ascii-font font="tiny" text="Research Partner" />
        <text attributes={TextAttributes.DIM}>
          Web via Alder MCP · Fireworks AI · Esc quit
        </text>
        {workspacePath ? (
          <text attributes={TextAttributes.DIM}>Workspace: {workspacePath}</text>
        ) : null}
      </box>

      <scrollbox
        focused={false}
        stickyScroll
        stickyStart="bottom"
        style={{
          flexGrow: 1,
          height: scrollHeight,
          rootOptions: { backgroundColor: "#1e2030" },
          viewportOptions: { backgroundColor: "#1a1b26" },
        }}
      >
        {lines.map((line, i) => (
          <box key={i} style={{ paddingBottom: 1 }}>
            {line.kind === "user" ? (
              <box flexDirection="column" gap={0}>
                {line.text.split("\n").map((t, j) => (
                  <text key={j}>
                    <span fg="#7dcfff">{j === 0 ? "You " : "    "}</span>
                    {t}
                  </text>
                ))}
              </box>
            ) : line.kind === "assistant" ? (
              <box flexDirection="column" gap={0}>
                <text fg="#bb9af7">Assistant</text>
                {line.text || line.streaming ? (
                  <text>
                    {line.text}
                    {line.streaming ? (
                      <span attributes={TextAttributes.DIM}>▍</span>
                    ) : null}
                  </text>
                ) : null}
              </box>
            ) : line.kind === "tools" ? (
              <ToolsRunningRow calls={line.calls} />
            ) : (
              <text attributes={TextAttributes.DIM}>{line.text}</text>
            )}
          </box>
        ))}
      </scrollbox>

      <box flexDirection="column" marginTop={1} gap={1}>
        <text attributes={TextAttributes.DIM}>
          {busy
            ? `${captionVerb(busyCaption)}${".".repeat(workingDots)}`
            : "Ask — Enter to send · Shift+Enter newline"}
        </text>
        <box border flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <textarea
            ref={composerRef}
            key={inputKey}
            placeholder={ready ? "Type a question…" : cfg.isConfigured ? "Starting…" : "Waiting for configuration…"}
            focused={ready && !busy}
            style={{
              height: composerRows,
              wrapMode: "word",
            }}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "linefeed", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "linefeed", shift: true, action: "newline" },
            ]}
            onSubmit={() => {
              const text = composerRef.current?.plainText ?? "";
              if (!text.trim()) return;
              void onSubmit(text);
            }}
          />
        </box>
        <text attributes={TextAttributes.DIM}>
          {toolsLabel ? `Tools loaded: ${toolsLabel}` : ""}
        </text>
      </box>
    </box>
  );
}

loadUserCredentialsIntoEnv();
await promptCredentialsIfNeeded();

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  onDestroy() {
    void disconnectAlder().finally(() => process.exit(0));
  },
});
createRoot(renderer).render(<App />);
