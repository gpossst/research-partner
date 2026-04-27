# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A terminal UI research assistant that combines Fireworks AI (OpenAI-compatible LLM) with Alder's hosted MCP server for web search tools. Built with Bun, TypeScript, and OpenTUI (React-based terminal rendering).

All application code lives in `tui/`. Run all commands from that directory.

## Commands

```bash
cd tui
bun install          # install dependencies
bun dev              # run with hot reload (--watch)
bun start            # run without watch
bun run src/index.tsx /path/to/project   # run with a specific workspace directory
```

## Required Environment Variables

Create `tui/.env` or set in shell before running:

| Variable | Required | Default |
|----------|----------|---------|
| `FIREWORKS_API_KEY` | yes | — |
| `ALDER_API_KEY` | yes | — |
| `FIREWORKS_BASE_URL` | no | `https://api.fireworks.ai/inference/v1` |
| `FIREWORKS_MODEL` | no | `accounts/fireworks/models/minimax-m2p7` |
| `ALDER_MCP_URL` | no | `https://api.alder.so/mcp` |
| `RESEARCH_WORKSPACE` | no | first CLI arg or `process.cwd()` |

## Architecture

### Tool System (two sources)

**Alder MCP tools** (`alder-mcp.ts`) — remote tools fetched from the Alder MCP server at startup. Only `web_search`, `fetch_url`, and `deep_search` are allowed through (`mcpToolsToOpenAI` filter in `research-agent.ts`).

**Custom local tools** (`custom-tools.ts`) — registered in `customToolRegistry`, executed locally without an Alder round-trip: `read_file_lines`, `edit_file`, `bash`. All three are sandboxed to the workspace directory via `resolveSafeWorkspacePath` in `workspace-sandbox.ts`. `mergeChatTools` combines both lists (custom tools can override MCP tools by sharing the same function name).

### Agentic loop (`research-agent.ts`)

`runResearchTurn` drives a `while(true)` loop: stream a chat completion → if tool calls present, execute all of them (dispatching to `invokeTool` which routes to custom or Alder), push results back as `tool` messages → repeat until the model responds with no tool calls. Tool output is truncated to 120k chars. Fireworks requires `stream: true` when `max_tokens > 4096`, so all completions use the streaming API and aggregate chunks.

### Workspace sandboxing (`workspace-sandbox.ts`)

Workspace root is resolved once and memoized. Priority: `RESEARCH_WORKSPACE` env → first non-flag CLI arg → `process.cwd()`. `resolveSafeWorkspacePath` blocks `..` escapes and symlink targets outside the workspace. Bash runs via `spawnSync("bash", ["-lc", cmd])` with cwd pinned to workspace root and a 120s timeout.

### TUI (`index.tsx`)

`ChatLine` union type drives rendering: `user`, `assistant` (with optional `streaming` flag for the live cursor), `tools` (animated spinner row that finalizes to a `status` line when the tool round completes), and `status`. Keyboard: Enter submits, Esc exits. The scrollbox uses `stickyScroll` / `stickyStart="bottom"` to auto-scroll during streaming.
