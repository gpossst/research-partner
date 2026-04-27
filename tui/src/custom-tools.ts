import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import {
  editFile,
  getWorkspaceRoot,
  readFileLines,
  resolveSafeWorkspacePath,
  runBashInWorkspace,
} from "./workspace-sandbox.ts";

/** Runs locally (no Alder round-trip). Keep names distinct from MCP tools unless you intend to override. */
export type CustomToolExecute = (
  args: Record<string, unknown>,
) => Promise<string> | string;

export type CustomToolEntry = {
  definition: ChatCompletionFunctionTool;
  execute: CustomToolExecute;
};

function asInt(v: unknown, label: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number.`);
  }
  return n;
}

/** Placeholder replaced with the resolved workspace path when tools are built. */
const WS = "__WORKSPACE__";

/**
 * Register custom tools here. Paths are confined to the configured workspace directory.
 */
export const customToolRegistry: CustomToolEntry[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "read_file_lines",
        description:
          `Read a range of lines (1-based, inclusive) from a text file under the workspace (${WS}). Use for inspecting code or notes.`,
        parameters: {
          type: "object",
          properties: {
            startline: {
              type: "integer",
              description: "First line to read (1-based).",
            },
            endline: {
              type: "integer",
              description: "Last line to read (1-based, inclusive).",
            },
            filename: {
              type: "string",
              description:
                "File path relative to the workspace root, or absolute only if still inside the workspace.",
            },
          },
          required: ["startline", "endline", "filename"],
        },
      },
    },
    execute: (args) => {
      const start = asInt(args.startline, "startline");
      const end = asInt(args.endline, "endline");
      const filename = typeof args.filename === "string" ? args.filename : "";
      const abs = resolveSafeWorkspacePath(filename);
      return readFileLines(abs, start, end);
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "edit_file",
        description:
          `Edit a file under the workspace (${WS}). If oldtext is empty, the file is created or fully overwritten with newtext. Otherwise the first occurrence of oldtext is replaced with newtext.`,
        parameters: {
          type: "object",
          properties: {
            oldtext: {
              type: "string",
              description:
                "Exact substring to replace once; use empty string to write or overwrite the whole file.",
            },
            newtext: {
              type: "string",
              description: "Replacement text, or full file contents when oldtext is empty.",
            },
            filename: {
              type: "string",
              description: "Path relative to the workspace root (or absolute within the workspace).",
            },
          },
          required: ["oldtext", "newtext", "filename"],
        },
      },
    },
    execute: (args) => {
      const oldtext = typeof args.oldtext === "string" ? args.oldtext : "";
      const newtext = typeof args.newtext === "string" ? args.newtext : "";
      const filename = typeof args.filename === "string" ? args.filename : "";
      const abs = resolveSafeWorkspacePath(filename);
      return editFile(oldtext, newtext, abs);
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "bash",
        description:
          `Run a shell command with bash -lc. Current working directory is fixed to the workspace (${WS}) only. stdout/stderr are combined in the result; exit code is included.`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Single command or pipeline passed to bash -lc.",
            },
          },
          required: ["command"],
        },
      },
    },
    execute: (args) => {
      const command = typeof args.command === "string" ? args.command : "";
      return runBashInWorkspace(command);
    },
  },
];

const customNames = new Set(
  customToolRegistry.map((e) => e.definition.function.name),
);

export function getCustomToolDefinitions(): ChatCompletionFunctionTool[] {
  const root = getWorkspaceRoot();
  return customToolRegistry.map((e) => {
    const desc = e.definition.function.description ?? "";
    return {
      type: "function" as const,
      function: {
        ...e.definition.function,
        description: desc.replaceAll(WS, root),
      },
    };
  });
}

export function isCustomToolName(name: string): boolean {
  return customNames.has(name);
}

export async function executeCustomTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const entry = customToolRegistry.find((e) => e.definition.function.name === name);
  if (!entry) {
    throw new Error(`Unknown custom tool: ${name}`);
  }
  return await Promise.resolve(entry.execute(args));
}
