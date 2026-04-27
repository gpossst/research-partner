# Research Partner

A terminal UI research assistant built by [Alder](https://alder.so) to demonstrate how Alder's MCP-based web research tools can be combined with Fireworks-hosted LLMs to build AI applications.

Ask questions in your terminal and get cited, sourced answers — with the ability to read and edit files in a local directory so research can flow directly into your notes or markdown files.

This is an open-source example project. Fork it, extend it, or use it as a reference for your own Alder integration.

## What it does

- **Web research** via Alder MCP: `web_search`, `fetch_url`, and `deep_search` give the model access to live web content
- **Local file tools**: read files, edit files, and run shell commands — all sandboxed to a workspace directory you specify
- **Streaming responses** with a live terminal UI built on [OpenTUI](https://opentui.dev)
- **Fireworks AI** as the LLM backend (OpenAI-compatible API)

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- An [Alder API key](https://alder.so) (the same Bearer token used for the Alder MCP server in Cursor)
- A [Fireworks AI API key](https://fireworks.ai)

## Setup

```bash
cd tui
bun install
cp .env.example .env
```

Fill in your keys in `.env`:

```env
FIREWORKS_API_KEY=your_fireworks_key
ALDER_API_KEY=your_alder_key
```

## Running

### Basic — research without a local workspace

```bash
cd tui
bun dev
```

The model can search the web and fetch URLs. Local file tools (`read_file_lines`, `edit_file`, `bash`) will be scoped to the `tui/` directory.

### With a workspace directory

Pass the directory you want the model to read and write as a CLI argument:

```bash
cd tui
bun dev /path/to/your/notes
```

Or set it persistently in `.env`:

```env
RESEARCH_WORKSPACE=/path/to/your/notes
```

The workspace path is shown in the header on startup. All file and shell operations are sandboxed to that directory — the model cannot read or write outside it.

### Typical use: researching into markdown files

```bash
bun dev ~/notes/research
```

Then ask something like:

> "Research the latest on [topic] and write a summary to research-notes.md"

The model will search the web, synthesize sources, and write directly to a file in your notes directory.

## Configuration

All options are set via environment variables (`.env` or shell):

| Variable | Required | Default |
|---|---|---|
| `FIREWORKS_API_KEY` | yes | — |
| `ALDER_API_KEY` | yes | — |
| `RESEARCH_WORKSPACE` | no | first CLI arg, then `cwd` |
| `FIREWORKS_MODEL` | no | `accounts/fireworks/models/minimax-m2p7` |
| `FIREWORKS_BASE_URL` | no | `https://api.fireworks.ai/inference/v1` |
| `ALDER_MCP_URL` | no | `https://api.alder.so/mcp` |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message |
| `Esc` | Quit |

## Project structure

```
src/
  index.tsx           # Terminal UI (OpenTUI / React)
  research-agent.ts   # Agentic tool-call loop
  alder-mcp.ts        # Alder MCP client connection
  custom-tools.ts     # Local file/bash tools
  workspace-sandbox.ts# Workspace path resolution and sandboxing
  config.ts           # Env-based configuration
```

## License

MIT
