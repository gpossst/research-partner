# Research Partner

A terminal UI research assistant built by [Alder](https://alder.so) to demonstrate how Alder's MCP-based web research tools can be combined with Fireworks-hosted LLMs to build AI applications.

Ask questions in your terminal and get cited, sourced answers — with the ability to read and edit files in a local directory so research can flow directly into your notes or markdown files.

This is an open-source example project. Fork it, extend it, or use it as a reference for your own Alder integration.

## What it does

- **Web research** via Alder MCP: `web_search`, `fetch_url`, and `deep_search` give the model access to live web content
- **Local file tools**: read files, edit files, and run shell commands — all sandboxed to a workspace directory you specify
- **Streaming responses** with a live terminal UI built on [OpenTUI](https://opentui.dev)
- **Fireworks AI** as the LLM backend (OpenAI-compatible API)
- **First-run API setup**: if no keys are found, the app prompts for Fireworks and Alder keys before you can chat; keys are saved for later sessions (see below)

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

If you skip `.env`, the app will ask for both keys when you start it and store them under `~/.config/research-partner/credentials.json` (mode `0600`). You can also create or edit that file yourself; it is a small JSON object: `{"fireworksApiKey":"…","alderApiKey":"…"}`.

**Precedence:** values in your environment (including `.env` / `export`) always override the saved file.

## Running

### Basic — research without a local workspace

```bash
cd tui
bun dev
```

The model can search the web and fetch URLs. Local file tools (`read_file_lines`, `edit_file`, `bash`) will be scoped to the `tui/` directory unless you pass a workspace (see below).

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

When you launch the program from a shell, the workspace defaults to **your shell’s current working directory** unless you override it with `RESEARCH_WORKSPACE` or a CLI argument.

### Typical use: researching into markdown files

```bash
bun dev ~/notes/research
```

Then ask something like:

> "Research the latest on [topic] and write a summary to research-notes.md"

The model will search the web, synthesize sources, and write directly to a file in your notes directory.

### Running from anywhere (global command)

Install dependencies once from the repo, then point a shell command at the entry file. The working directory of the terminal where you run the command becomes the default workspace (unless you set `RESEARCH_WORKSPACE` or pass a path argument).

**Bash — alias in `~/.bashrc`:**

```bash
alias research-agent='bun run /absolute/path/to/tui/src/index.tsx'
```

Reload: `source ~/.bashrc`.

**Executable on your `PATH` (e.g. `~/bin/research-agent`):**

```bash
#!/usr/bin/env bash
exec bun run /absolute/path/to/tui/src/index.tsx "$@"
```

Then `chmod +x ~/bin/research-agent` and ensure `~/bin` is on `PATH`:

```bash
export PATH="$HOME/bin:$PATH"
```

On macOS, if your terminal does not load `~/.bashrc`, add the same alias or `PATH` line to `~/.bash_profile`, or source bashrc from profile:

```bash
[[ -f ~/.bashrc ]] && source ~/.bashrc
```

If you use **zsh** (macOS default), put the alias or `PATH` export in `~/.zshrc` instead.

## Configuration

All options are set via environment variables (`.env`, shell exports) or the saved credentials file for the two API keys:

| Variable | Required | Default |
|---|---|---|
| `FIREWORKS_API_KEY` | yes\* | — |
| `ALDER_API_KEY` | yes\* | — |
| `RESEARCH_WORKSPACE` | no | first CLI arg, then `cwd` |
| `FIREWORKS_MODEL` | no | `accounts/fireworks/models/minimax-m2p7` |
| `FIREWORKS_BASE_URL` | no | `https://api.fireworks.ai/inference/v1` |
| `ALDER_MCP_URL` | no | `https://api.alder.so/mcp` |

\*Required before chatting: set in env / `.env`, or enter when the app prompts on first run (stored under `~/.config/research-partner/credentials.json`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message (or submit each API key during setup) |
| `Esc` | Quit |

## Project structure

```
src/
  index.tsx             # Terminal UI (OpenTUI / React)
  research-agent.ts     # Agentic tool-call loop
  alder-mcp.ts          # Alder MCP client connection
  custom-tools.ts       # Local file/bash tools
  workspace-sandbox.ts  # Workspace path resolution and sandboxing
  user-credentials.ts   # Optional ~/.config JSON for API keys
  config.ts             # Env-based configuration
```

## License

MIT
