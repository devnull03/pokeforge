import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import z from "zod";

export { Sandbox } from "@cloudflare/sandbox";

export type PokeforgeWorkflowParams = {
	websiteUrl: string;
	task: string;
};

type DiscoveryAction = {
	instruction: string;
	type: string;
	result: string;
};

const codegenSchema = z.object({
	indexTs: z.string().describe("Full TypeScript source for src/index.ts - MCP server with tools derived from discovered actions"),
	wranglerJsonc: z.string().describe("Full wrangler.jsonc config"),
	packageJson: z.string().describe("Full package.json"),
});

export class PokeforgeWorkflow extends WorkflowEntrypoint<
	Env,
	PokeforgeWorkflowParams
> {
	async run(event: WorkflowEvent<PokeforgeWorkflowParams>, step: WorkflowStep) {
		const { websiteUrl, task } = event.payload;
		const stagehandUrl = this.env.STAGEHAND_SERVICE_URL ?? "http://localhost:8788";
		const githubToken = this.env.GITHUB_TOKEN;
		const githubOwner = this.env.GITHUB_OWNER ?? "devnull03";
		const openaiApiKey = this.env.OPENAI_API_KEY;
		const repoName = `mcp-automation-${websiteUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
		if (!openaiApiKey) {
			throw new Error("OPENAI_API_KEY is required for MCP code generation");
		}

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
			const normalizedRaw = JSON.parse(JSON.stringify(raw)) as {
				actions?: Array<{ instruction?: unknown; type?: unknown; result?: unknown }>;
				logs?: unknown;
				cacheKey?: unknown;
				error?: unknown;
			};
			const actions: DiscoveryAction[] = Array.isArray(normalizedRaw.actions)
				? normalizedRaw.actions.map((action) => ({
						instruction:
							typeof action.instruction === "string"
								? action.instruction
								: String(action.instruction ?? ""),
						type: typeof action.type === "string" ? action.type : String(action.type ?? ""),
						result: JSON.stringify(action.result ?? null),
					}))
				: [];

			return {
				actions,
				logs: typeof normalizedRaw.logs === "string" ? normalizedRaw.logs : "",
				cacheKey: typeof normalizedRaw.cacheKey === "string" ? normalizedRaw.cacheKey : "",
				error: typeof normalizedRaw.error === "string" ? normalizedRaw.error : undefined,
			};
		});

		const discoveryData = discovery as {
			actions: DiscoveryAction[];
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
			return generateMcpServerWithOpenAI(codegenPrompt, openaiApiKey);
		});

		// Step 3: Validate generated code in a sandbox before pushing to GitHub
		await step.do("test generated code", async () => {
			const sandboxId = `mcp-test-${repoName}`;
			const sandbox = getSandbox(this.env.Sandbox, sandboxId);

			try {
				await sandbox.exec("mkdir -p /workspace/src");
				await sandbox.writeFile("/workspace/package.json", generated.packageJson);
				await sandbox.writeFile("/workspace/src/index.ts", generated.indexTs);
				await sandbox.writeFile(
					"/workspace/tsconfig.json",
					JSON.stringify(
						{
							compilerOptions: {
								target: "ES2022",
								module: "NodeNext",
								moduleResolution: "NodeNext",
								strict: true,
								skipLibCheck: true,
								noEmit: true,
							},
							include: ["src/**/*.ts"],
						},
						null,
						2,
					),
				);

				const installResult = await sandbox.exec("cd /workspace && bun install");
				if (!installResult.success) {
					throw new Error(
						`Sandbox bun install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`,
					);
				}

				const typecheckResult = await sandbox.exec("cd /workspace && bunx tsc --noEmit");
				if (!typecheckResult.success) {
					throw new Error(
						`Generated code failed validation (exit ${typecheckResult.exitCode}): ${typecheckResult.stderr || typecheckResult.stdout}`,
					);
				}
			} finally {
				await sandbox.destroy();
			}
		});

		// Step 4: Push to GitHub
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

async function generateMcpServerWithOpenAI(prompt: string, apiKey: string) {
	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			temperature: 0.2,
			messages: [
				{
					role: "system",
					content:
						"Return only valid JSON with keys indexTs, wranglerJsonc, packageJson. Do not wrap in markdown.",
				},
				{ role: "user", content: prompt },
			],
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI codegen failed: ${response.status} ${errorText}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
	};
	const content = payload.choices?.[0]?.message?.content?.trim();
	if (!content) {
		throw new Error("OpenAI codegen failed: empty response content");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("OpenAI codegen failed: response was not valid JSON");
	}

	return codegenSchema.parse(parsed);
}
