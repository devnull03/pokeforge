import z from "zod";
import type { DiscoveryResult, GeneratedMcpServer } from "./types";

const codegenSchema = z.object({
	indexTs: z.string().describe("Full TypeScript source for src/index.ts - MCP server with tools derived from discovered actions"),
	wranglerJsonc: z.string().describe("Full wrangler.jsonc config"),
	packageJson: z.string().describe("Full package.json"),
});

export async function generateMcpServer(args: {
	websiteUrl: string;
	task: string;
	repoName: string;
	discovery: DiscoveryResult;
	aiProvider: "openai" | "anthropic" | "google";
	aiApiKey: string;
}): Promise<GeneratedMcpServer> {
	const { websiteUrl, task, repoName, discovery, aiProvider, aiApiKey } = args;

	const codegenPrompt = `You are generating a Cloudflare Workers MCP server. Given the following browser automation discovery:

Website: ${websiteUrl}
Task: ${task}

Discovery logs:
${discovery.logs}

Actions discovered:
${JSON.stringify(discovery.actions, null, 2)}

Generate a complete MCP server that exposes tools to perform this automation. Use the @modelcontextprotocol/sdk and agents/mcp (McpAgent, McpServer). Create tools based on the discovered actions - e.g. if the task was "search for X", create a tool that performs that search.

Return a JSON object with exactly three string fields:
- indexTs: Full source for src/index.ts (MCP server entry)
- wranglerJsonc: Full wrangler.jsonc (compatibility_date 2025-03-10, nodejs_compat, observability enabled)
- packageJson: Full package.json (name: "${repoName}", dependencies: @modelcontextprotocol/sdk, agents, zod)`;

	let content = "";
	if (aiProvider === "openai") {
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${aiApiKey}`,
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
					{ role: "user", content: codegenPrompt },
				],
			}),
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`AI codegen failed: ${response.status} ${errorText}`);
		}
		const payload = (await response.json()) as {
			choices?: Array<{ message?: { content?: string | null } }>;
		};
		content = payload.choices?.[0]?.message?.content?.trim() ?? "";
	} else if (aiProvider === "google") {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(aiApiKey)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					generationConfig: {
						temperature: 0.2,
					},
					systemInstruction: {
						parts: [
							{
								text: "Return only valid JSON with keys indexTs, wranglerJsonc, packageJson. Do not wrap in markdown.",
							},
						],
					},
					contents: [
						{
							role: "user",
							parts: [{ text: codegenPrompt }],
						},
					],
				}),
			},
		);
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`AI codegen failed: ${response.status} ${errorText}`);
		}
		const payload = (await response.json()) as {
			candidates?: Array<{
				content?: {
					parts?: Array<{ text?: string }>;
				};
			}>;
		};
		content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
		content = unwrapJsonCodeFence(content);
	} else {
		throw new Error(`AI_PROVIDER '${aiProvider}' is not supported for codegen yet.`);
	}
	if (!content) {
		throw new Error("AI codegen failed: empty response content");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("AI codegen failed: response was not valid JSON");
	}

	return codegenSchema.parse(parsed);
}

function unwrapJsonCodeFence(content: string): string {
	const trimmed = content.trim();
	if (trimmed.startsWith("```")) {
		return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	}
	return trimmed;
}
