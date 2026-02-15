import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

/**
 * Factory MCP — Cloudflare Worker.
 * Same API as the Python server: /health and create_mcp tool.
 */
export class FactoryMCP extends McpAgent {
	server = new McpServer({
		name: "factory-mcp",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"create_mcp",
			{
				url: z.string().describe("URL of the site or resource"),
				automation_goal: z.string().describe("What to automate"),
			},
			async ({ url, automation_goal }) => {
				const result = {
					status: "received",
					url,
					goal: automation_goal,
					mcp_endpoint: `https://generated.fake/${url.replace(/^https?:\/\//, "").replace(/\//g, "-")}`,
				};
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			},
		);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health" && request.method === "GET") {
			return Response.json({ status: "ok", server: "factory-mcp" });
		}

		if (url.pathname.startsWith("/mcp")) {
			return FactoryMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
