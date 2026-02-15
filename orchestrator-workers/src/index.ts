import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Variables } from "./types/hono";

export { OrchestratorWorkersWorkflow } from "./orchestrator-workers-workflow";
export { WebsiteAutomationWorkflow } from "./website-automation-workflow";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use(cors());

const mcpServer = new McpServer({
	name: "Pokeforge MCP",
	version: "1.0.0",
});

mcpServer.tool(
	"automate_website",
	{
		website_url: z.string().url().describe("URL of the website to automate"),
		task: z.string().describe("Task to perform on the website"),
		orchestrator_url: z.string().url().optional().default("http://localhost:8787"),
	},
	async ({ website_url, task, orchestrator_url }) => {
		const base = orchestrator_url ?? "http://localhost:8787";
		const startRes = await fetch(`${base}/automate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ websiteUrl: website_url, task }),
		});

		if (!startRes.ok) {
			const err = await startRes.text();
			return { content: [{ type: "text", text: `Error: ${startRes.status} ${err}` }] };
		}

		const { id } = (await startRes.json()) as { id: string };
		const pollUrl = `${base}/automate/${id}`;

		for (let i = 0; i < 60; i++) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			const pollRes = await fetch(pollUrl);
			if (!pollRes.ok) {
				continue;
			}

			const { status, output } = (await pollRes.json()) as {
				status: string;
				output?: { githubUrl?: string };
			};

			if (status === "complete" && output?.githubUrl) {
				return { content: [{ type: "text", text: `Done. GitHub repo: ${output.githubUrl}` }] };
			}
			if (status === "errored") {
				return { content: [{ type: "text", text: `Workflow failed. Check ${pollUrl}` }] };
			}
		}

		return { content: [{ type: "text", text: `Workflow started. Poll status: ${pollUrl}` }] };
	},
);

const mcpHandler = createMcpHandler(mcpServer);

/**
 * POST / - Trigger orchestrator-workers workflow (prompt subtasks)
 */
app.post("/", async (c) => {
	const { prompt } = (await c.req.json()) as { prompt: string };
	const instance = await c.env.ORCHESTRATOR_WORKERS_WORKFLOW.create({
		params: { prompt },
	});
	const status = await instance.status();
	return c.json({ id: instance.id, details: status });
});

/**
 * POST /automate - Trigger website automation workflow (Stagehand + MCP codegen + GitHub)
 * Body: { websiteUrl: string, task: string }
 */
app.post("/automate", async (c) => {
	const body = (await c.req.json()) as { websiteUrl?: string; task?: string };
	const { websiteUrl, task } = body;
	if (!websiteUrl || !task) {
		return c.json({ error: "websiteUrl and task are required" }, 400);
	}
	const instance = await c.env.WEBSITE_AUTOMATION_WORKFLOW.create({
		params: { websiteUrl, task },
	});
	const status = await instance.status();
	return c.json({ id: instance.id, details: status });
});

/**
 * GET /automate/:id - Fetch status and result of website automation workflow
 */
app.get("/automate/:id", async (c) => {
	const instanceId = c.req.param("id");
	if (!instanceId) {
		return c.json({ error: "Instance ID not provided" }, 400);
	}
	const instance = await c.env.WEBSITE_AUTOMATION_WORKFLOW.get(instanceId);
	const status = await instance.status();
	const output = "output" in instance && typeof (instance as { output?: () => Promise<unknown> }).output === "function" ? await (instance as { output: () => Promise<unknown> }).output() : undefined;
	return c.json({ status, output });
});

/**
 * GET /:id - Fetch status of orchestrator-workers workflow instance
 */
app.get("/:id", async (c) => {
	const instanceId = c.req.param("id");
	if (instanceId) {
		const instance = await c.env.ORCHESTRATOR_WORKERS_WORKFLOW.get(instanceId);
		const status = await instance.status();
		return c.json({ status });
	}
	return c.json({ error: "Instance ID not provided" }, 400);
});

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const pathname = new URL(request.url).pathname;
		if (pathname.startsWith("/mcp")) {
			return mcpHandler(request, env, ctx);
		}
		return app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
