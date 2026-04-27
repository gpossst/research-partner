import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

let mcpClient: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;

export async function connectAlder(mcpUrl: string, bearerToken: string): Promise<Client> {
  await disconnectAlder();

  const client = new Client(
    { name: "research-partner-tui", version: "0.1.0" },
    {},
  );

  const tr = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  });

  await client.connect(tr);
  mcpClient = client;
  transport = tr;
  return client;
}

export function getAlderClient(): Client | null {
  return mcpClient;
}

export async function disconnectAlder(): Promise<void> {
  if (transport) {
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
  }
  transport = null;
  mcpClient = null;
}

export async function callAlderTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const c = mcpClient;
  if (!c) throw new Error("Alder MCP is not connected.");

  const result = await c.callTool({
    name,
    arguments: args,
  });

  return result as CallToolResult;
}
