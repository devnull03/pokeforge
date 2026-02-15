import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Variables } from "./types/hono";
import { runStagehandDiscovery } from "./utils/pokeforge/stagehand";

export { PokeforgeWorkflow } from "./pokeforge-workflow";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use(cors());

const mcpServer = new McpServer({
	name: "Pokeforge MCP",
	version: "1.0.0",
});

 mcpServer.registerTool(
	"automate_website",
	{
		description: "Run the Pokeforge automation workflow for a target website task.",
		inputSchema: {
			website_url: z.url().describe("URL of the website to automate"),
			task: z.string().describe("Task to perform on the website"),
			orchestrator_url: z.url().optional().default("http://localhost:8787"),
		},
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
 * POST /automate - Trigger Pokeforge workflow (Stagehand + MCP codegen + GitHub)
 * Body: { websiteUrl: string, task: string }
 */
app.post("/automate", async (c) => {
	const body = (await c.req.json()) as { websiteUrl?: string; task?: string };
	const { websiteUrl, task } = body;
	if (!websiteUrl || !task) {
		return c.json({ error: "websiteUrl and task are required" }, 400);
	}
	const instance = await c.env.POKEFORGE_WORKFLOW.create({
		params: { websiteUrl, task },
	});
	const status = await instance.status();
	return c.json({ id: instance.id, details: status });
});

/**
 * GET /automate/:id - Fetch status and result of Pokeforge workflow
 */
app.get("/automate/:id", async (c) => {
	const instanceId = c.req.param("id");
	if (!instanceId) {
		return c.json({ error: "Instance ID not provided" }, 400);
	}
	const instance = await c.env.POKEFORGE_WORKFLOW.get(instanceId);
	const status = await instance.status();
	const output = "output" in instance && typeof (instance as { output?: () => Promise<unknown> }).output === "function" ? await (instance as { output: () => Promise<unknown> }).output() : undefined;
	return c.json({ status, output });
});

/**
 * POST /debug/stagehand-smoke - Verify orchestrator -> stagehand transport on Cloudflare.
 * Body (optional): { websiteUrl?: string, task?: string }
 */
app.post("/debug/stagehand-smoke", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		websiteUrl?: string;
		task?: string;
	};
	const websiteUrl = body.websiteUrl ?? "https://example.com";
	const task = body.task ?? "Observe the page and describe the main content.";

	try {
		const discovery = await runStagehandDiscovery({
			stagehandService: c.env.STAGEHAND_SERVICE,
			stagehandUrl: c.env.STAGEHAND_SERVICE_URL,
			websiteUrl,
			task,
			context: { smokeTest: true },
		});

		return c.json({
			ok: !discovery.error,
			transport: c.env.STAGEHAND_SERVICE ? "service-binding" : "url-fallback",
			cacheKey: discovery.cacheKey,
			sessionId: discovery.sessionId,
			receivedArtifactCount: discovery.receivedArtifactCount ?? 0,
			actionCount: discovery.actions.length,
			artifactCount: discovery.artifacts.length,
			error: discovery.error,
			logPreview: discovery.logs.slice(0, 400),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json(
			{
				ok: false,
				transport: c.env.STAGEHAND_SERVICE ? "service-binding" : "url-fallback",
				error: message,
			},
			500,
		);
	}
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
