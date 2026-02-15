import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Variables } from "./types/hono";

export { PokeforgeWorkflow } from "./pokeforge-workflow";
export { Sandbox } from "@cloudflare/sandbox";

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
	const output =
		"output" in instance &&
		typeof (instance as { output?: () => Promise<unknown> }).output === "function"
			? await (instance as { output: () => Promise<unknown> }).output()
			: undefined;
	return c.json({ status, output });
});

/**
 * POST /debug/browserbase-functions-cache-probe
 * Invokes a Browserbase Function and checks whether cache artifacts are returned.
 * Body: { functionId?: string, websiteUrl?: string, task?: string, rawParams?: Record<string, unknown> }
 */
app.post("/debug/browserbase-functions-cache-probe", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		functionId?: string;
		websiteUrl?: string;
		task?: string;
		rawParams?: Record<string, unknown>;
	};

	if (!c.env.BROWSERBASE_API_KEY) {
		return c.json({ ok: false, error: "Missing BROWSERBASE_API_KEY" }, 500);
	}

	const functionId = body.functionId ?? c.env.BROWSERBASE_CACHE_PROBE_FUNCTION_ID;
	if (!functionId) {
		return c.json(
			{
				ok: false,
				error:
					"Missing functionId. Pass it in request body or set BROWSERBASE_CACHE_PROBE_FUNCTION_ID.",
			},
			400,
		);
	}

	const websiteUrl = body.websiteUrl ?? "https://example.com";
	const task = body.task ?? "Observe the page and summarize the main content.";

	try {
		const invokeResponse = await fetch(
			`https://api.browserbase.com/v1/functions/${encodeURIComponent(functionId)}/invoke`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-bb-api-key": c.env.BROWSERBASE_API_KEY,
				},
				body: JSON.stringify({
					websiteUrl,
					task,
					...(body.rawParams ?? {}),
				}),
			},
		);

		const rawText = await invokeResponse.text();
		let payload: unknown = rawText;
		try {
			payload = JSON.parse(rawText);
		} catch {
			// keep raw text payload
		}

		if (!invokeResponse.ok) {
			return c.json(
				{
					ok: false,
					httpStatus: invokeResponse.status,
					functionId,
					error: "Browserbase function invoke failed",
					payload,
				},
				502,
			);
		}

		const discoveredArtifacts = collectArtifactLikeObjects(payload);
		const cacheLikeArtifacts = discoveredArtifacts.filter(
			(a) => a.name.startsWith("cache/") || a.name.toLowerCase().includes("cache"),
		);
		const explicitCacheFiles = collectStringArrayFields(payload, [
			"cacheFiles",
			"cacheFileNames",
			"cache_paths",
		]);

		return c.json({
			ok: true,
			functionId,
			websiteUrl,
			task,
			hasCacheFiles: cacheLikeArtifacts.length > 0 || explicitCacheFiles.length > 0,
			cacheArtifactCount: cacheLikeArtifacts.length,
			cacheArtifactNames: cacheLikeArtifacts.map((a) => a.name),
			explicitCacheFileCount: explicitCacheFiles.length,
			explicitCacheFiles,
			artifactCount: discoveredArtifacts.length,
			artifactNamesPreview: discoveredArtifacts.slice(0, 20).map((a) => a.name),
			payloadType: typeof payload,
			payloadPreview: truncateJson(payload, 2_000),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ ok: false, functionId, error: message }, 500);
	}
});

type ArtifactLike = {
	name: string;
	mimeType: string;
	encoding: "base64" | "utf8";
	content: string;
};

function collectArtifactLikeObjects(value: unknown): ArtifactLike[] {
	const results: ArtifactLike[] = [];
	const seen = new Set<unknown>();

	const visit = (node: unknown) => {
		if (node === null || node === undefined) return;
		if (typeof node !== "object") return;
		if (seen.has(node)) return;
		seen.add(node);

		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}

		const rec = node as Record<string, unknown>;
		if (typeof rec.name === "string" && typeof rec.content === "string") {
			results.push({
				name: rec.name,
				mimeType:
					typeof rec.mimeType === "string" ? rec.mimeType : "application/octet-stream",
				encoding: rec.encoding === "utf8" ? "utf8" : "base64",
				content: rec.content,
			});
		}

		for (const child of Object.values(rec)) {
			visit(child);
		}
	};

	visit(value);
	return results;
}

function collectStringArrayFields(
	value: unknown,
	keys: string[],
): string[] {
	const collected = new Set<string>();
	const seen = new Set<unknown>();

	const visit = (node: unknown) => {
		if (node === null || node === undefined) return;
		if (typeof node !== "object") return;
		if (seen.has(node)) return;
		seen.add(node);

		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}

		const rec = node as Record<string, unknown>;
		for (const key of keys) {
			const maybe = rec[key];
			if (!Array.isArray(maybe)) continue;
			for (const v of maybe) {
				if (typeof v === "string") collected.add(v);
			}
		}
		for (const child of Object.values(rec)) {
			visit(child);
		}
	};

	visit(value);
	return [...collected];
}

function truncateJson(value: unknown, maxLen: number): string {
	const raw =
		typeof value === "string"
			? value
			: JSON.stringify(value, null, 2) ?? String(value);
	if (raw.length <= maxLen) return raw;
	return `${raw.slice(0, maxLen)}... [truncated ${raw.length - maxLen} chars]`;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const pathname = new URL(request.url).pathname;
		if (pathname.startsWith("/mcp")) {
			return mcpHandler(request, env, ctx);
		}
		return app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
