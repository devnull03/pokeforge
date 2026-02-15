import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { generateText, Output } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import z from "zod";

export type WebsiteAutomationWorkflowParams = {
	websiteUrl: string;
	task: string;
};

const codegenSchema = z.object({
	indexTs: z.string().describe("Full TypeScript source for src/index.ts - MCP server with tools derived from discovered actions"),
	wranglerJsonc: z.string().describe("Full wrangler.jsonc config"),
	packageJson: z.string().describe("Full package.json"),
});

export class WebsiteAutomationWorkflow extends WorkflowEntrypoint<
	Env,
	WebsiteAutomationWorkflowParams
> {
	async run(event: WorkflowEvent<WebsiteAutomationWorkflowParams>, step: WorkflowStep) {
		const { websiteUrl, task } = event.payload;
		const stagehandUrl = this.env.STAGEHAND_SERVICE_URL ?? "http://localhost:8788";
		const githubToken = this.env.GITHUB_TOKEN;
		const githubOwner = this.env.GITHUB_OWNER ?? "devnull03";
		const repoName = `mcp-automation-${websiteUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

		const workersai = createWorkersAI({ binding: this.env.AI });
		const bigModel = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

		// Step 1: Call Stagehand service (sync - wait for completion)
		const discovery = await step.do("run stagehand", async () => {
			const res = await fetch(`${stagehandUrl}/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ websiteUrl, task }),
			});
			if (!res.ok) {
				const err = await res.text();
				throw new Error(`Stagehand service error: ${res.status} ${err}`);
			}
			const raw = await res.json();
			return JSON.parse(JSON.stringify(raw)) as {
				actions: Array<{ instruction: string; type: string; result: unknown }>;
				logs: string;
				cacheKey: string;
				error?: string;
			};
		});

		const discoveryData = discovery as {
			actions: Array<{ instruction: string; type: string; result: unknown }>;
			logs: string;
			cacheKey: string;
			error?: string;
		} | null | undefined;

		if (discoveryData?.error) {
			return { error: discoveryData.error, logs: discoveryData.logs, githubUrl: null };
		}

		if (!discoveryData) {
			return { error: "Stagehand returned no data", logs: "", githubUrl: null };
		}

		// Step 2: Codegen MCP server from discovery
		const generated = await step.do("codegen mcp server", async () => {
			const codegenPrompt = `You are generating a Cloudflare Workers MCP server. Given the following browser automation discovery:

Website: ${websiteUrl}
Task: ${task}

Discovery logs:
${discoveryData.logs}

Actions discovered:
${JSON.stringify(discoveryData.actions, null, 2)}

Generate a complete MCP server that exposes tools to perform this automation. Use the @modelcontextprotocol/sdk and agents/mcp (McpAgent, McpServer). Create tools based on the discovered actions - e.g. if the task was "search for X", create a tool that performs that search.

Return a JSON object with exactly three string fields:
- indexTs: Full source for src/index.ts (MCP server entry)
- wranglerJsonc: Full wrangler.jsonc (compatibility_date 2025-03-10, nodejs_compat, observability enabled)
- packageJson: Full package.json (name: "${repoName}", dependencies: @modelcontextprotocol/sdk, agents, zod)`;

			const { output: object } = await generateText({
				model: bigModel,
				prompt: codegenPrompt,
				output: Output.object({ schema: codegenSchema }),
			});
			return object;
		});

		// Step 3: Push to GitHub
		const githubUrl = await step.do("push to github", async () => {
			if (!githubToken) {
				return `https://github.com/${githubOwner}/${repoName} (repo not created - GITHUB_TOKEN not set)`;
			}

			const headers = {
				Authorization: `Bearer ${githubToken}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			};

			// Create repo
			const createRes = await fetch("https://api.github.com/user/repos", {
				method: "POST",
				headers,
				body: JSON.stringify({
					name: repoName,
					description: `MCP server for ${task} on ${websiteUrl}`,
					private: false,
					auto_init: false,
				}),
			});
			if (!createRes.ok) {
				const err = await createRes.text();
				throw new Error(`GitHub create repo failed: ${createRes.status} ${err}`);
			}

			// Push files via Contents API
			const files: Array<{ path: string; content: string }> = [
				{ path: "src/index.ts", content: generated.indexTs },
				{ path: "wrangler.jsonc", content: generated.wranglerJsonc },
				{ path: "package.json", content: generated.packageJson },
				{
					path: "README.md",
					content: `# ${repoName}\n\nMCP server auto-generated for: ${task}\n\nWebsite: ${websiteUrl}\n`,
				},
			];

			for (const { path: filePath, content } of files) {
				const putRes = await fetch(
					`https://api.github.com/repos/${githubOwner}/${repoName}/contents/${filePath}`,
					{
						method: "PUT",
						headers,
						body: JSON.stringify({
							message: `Add ${filePath}`,
							content: base64EncodeUtf8(content),
						}),
					},
				);
				if (!putRes.ok) {
					const err = await putRes.text();
					throw new Error(`GitHub put ${filePath} failed: ${putRes.status} ${err}`);
				}
			}

			return `https://github.com/${githubOwner}/${repoName}`;
		});

		return {
			discovery: { actions: discoveryData.actions, cacheKey: discoveryData.cacheKey },
			githubUrl,
		};
	}
}

function base64EncodeUtf8(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
