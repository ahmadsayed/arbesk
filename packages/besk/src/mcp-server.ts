/**
 * `besk mcp` — serve the besk tool layer (mcp.ts) over MCP stdio so AI agents
 * (Claude Code, Cursor, Kimi Code, …) can drive the full CLI feature surface.
 *
 * stdio is the JSON-RPC channel: anything printed to stdout corrupts the
 * protocol, so all human logging is redirected to stderr before the server
 * starts (burn.ts logs its unpin progress via console.log).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listTools, callTool } from "./mcp.ts";

export async function startMcpServer(): Promise<void> {
  console.log = (...args: unknown[]) => console.error(...args);

  const server = new Server(
    { name: "besk", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await callTool(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: "Error: " + (e as Error).message }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error("besk MCP server running on stdio (" + listTools().length + " tools)");
}
