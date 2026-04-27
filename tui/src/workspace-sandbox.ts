import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_BASH_OUTPUT_CHARS = 120_000;
const BASH_TIMEOUT_MS = 120_000;

let cachedRoot: string | null = null;

/**
 * Pick workspace directory (memoized):
 * 1. `RESEARCH_WORKSPACE` env
 * 2. First CLI argument (if not a flag), e.g. `bun run src/index.tsx /path/to/project`
 * 3. `process.cwd()`
 */
function computeWorkspaceRoot(): string {
  const envPath = process.env.RESEARCH_WORKSPACE?.trim();
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(`RESEARCH_WORKSPACE does not exist: ${envPath}`);
    }
    const r = fs.realpathSync(envPath);
    if (!fs.statSync(r).isDirectory()) {
      throw new Error(`RESEARCH_WORKSPACE is not a directory: ${r}`);
    }
    return r;
  }

  const arg = process.argv[2];
  if (arg && !arg.startsWith("-")) {
    if (!fs.existsSync(arg)) {
      throw new Error(`Workspace path does not exist: ${arg}`);
    }
    const r = fs.realpathSync(arg);
    if (!fs.statSync(r).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${r}`);
    }
    return r;
  }

  return fs.realpathSync(process.cwd());
}

/** Absolute path for file/bash sandboxing — see {@link computeWorkspaceRoot}. */
export function getWorkspaceRoot(): string {
  if (cachedRoot === null) {
    cachedRoot = computeWorkspaceRoot();
  }
  return cachedRoot;
}

/**
 * Resolve `filename` to an absolute path that must lie under {@link getWorkspaceRoot}.
 * Blocks `..` escapes and symlink targets outside the workspace.
 */
export function resolveSafeWorkspacePath(filename: string): string {
  const root = getWorkspaceRoot();

  const raw = typeof filename === "string" ? filename.trim() : "";
  if (!raw) {
    throw new Error("filename is required.");
  }

  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw);

  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes the workspace directory.");
  }

  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    const relReal = path.relative(root, real);
    if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
      throw new Error("Path resolves outside the workspace directory (symlink).");
    }
    return real;
  }

  let dir = abs;
  while (dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
    if (fs.existsSync(dir)) {
      const realDir = fs.realpathSync(dir);
      const relDir = path.relative(root, realDir);
      if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
        throw new Error("Parent path resolves outside the workspace directory.");
      }
      break;
    }
  }

  return abs;
}

export function readFileLines(
  absPath: string,
  startLine: number,
  endLine: number,
): string {
  const st = fs.statSync(absPath);
  if (!st.isFile()) {
    throw new Error("Not a regular file.");
  }
  if (st.size > MAX_READ_BYTES) {
    throw new Error(`File too large (max ${MAX_READ_BYTES} bytes).`);
  }

  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  if (start < 1 || end < 1) {
    throw new Error("startline and endline must be >= 1.");
  }
  const slice = lines.slice(start - 1, end);
  const header = `[lines ${start}-${Math.min(end, lines.length)} of ${lines.length}]\n`;
  return header + slice.join("\n");
}

/**
 * If `oldText` is empty: overwrite or create the file with `newText`.
 * Otherwise replace the first occurrence of `oldText` with `newText`.
 */
export function editFile(oldText: string, newText: string, absPath: string): string {
  const parent = path.dirname(absPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  if (oldText === "") {
    const existed = fs.existsSync(absPath);
    fs.writeFileSync(absPath, newText, "utf8");
    return JSON.stringify({
      action: existed ? "overwritten" : "created",
      path: absPath,
      bytes: Buffer.byteLength(newText, "utf8"),
    });
  }

  if (!fs.existsSync(absPath)) {
    return JSON.stringify({
      error: "File does not exist; use empty oldtext to create it.",
    });
  }

  const st = fs.statSync(absPath);
  if (!st.isFile()) {
    return JSON.stringify({ error: "Not a regular file." });
  }
  if (st.size > MAX_READ_BYTES) {
    return JSON.stringify({ error: `File too large (max ${MAX_READ_BYTES} bytes).` });
  }

  const original = fs.readFileSync(absPath, "utf8");
  if (!original.includes(oldText)) {
    return JSON.stringify({
      error: "oldtext not found in file",
      hint: "Verify exact whitespace; only the first occurrence is replaced.",
    });
  }

  const edited = original.replace(oldText, newText);
  fs.writeFileSync(absPath, edited, "utf8");
  return JSON.stringify({
    action: "edited",
    path: absPath,
    replacements: 1,
  });
}

/** Runs `bash -lc` with cwd pinned to the workspace only. */
export function runBashInWorkspace(command: string): string {
  const root = getWorkspaceRoot();
  const cmd = typeof command === "string" ? command.trim() : "";
  if (!cmd) {
    return JSON.stringify({ error: "command is empty." });
  }

  const result = spawnSync("bash", ["-lc", cmd], {
    cwd: root,
    encoding: "utf8",
    timeout: BASH_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PWD: root,
    },
  });

  let stdout = result.stdout ?? "";
  let stderr = result.stderr ?? "";
  const status = result.status ?? -1;
  const signal = result.signal;

  if (signal) {
    return JSON.stringify({
      exitCode: status,
      signal,
      stderr: truncate(stderr),
      stdout: truncate(stdout),
    });
  }

  const combined = truncate(
    stdout +
      (stderr ? (stdout ? "\n--- stderr ---\n" : "") + stderr : ""),
  );

  return JSON.stringify({
    exitCode: status,
    cwd: root,
    output: combined || "(no output)",
  });
}

function truncate(s: string): string {
  if (s.length <= MAX_BASH_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_BASH_OUTPUT_CHARS)}\n...[truncated]`;
}
