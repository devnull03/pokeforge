import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { generateMcpServer } from "./utils/pokeforge/codegen";
import { createGithubRepoWithGeneratedCode } from "./utils/pokeforge/github";
import { validateGeneratedCodeInSandbox } from "./utils/pokeforge/sandbox-test";
import { runStagehandDiscovery } from "./utils/pokeforge/stagehand";

export { Sandbox } from "@cloudflare/sandbox";

export type PokeforgeWorkflowParams = {
	websiteUrl: string;
	task: string;
};

export class PokeforgeWorkflow extends WorkflowEntrypoint<
	Env,
	PokeforgeWorkflowParams
> {
	async run(event: WorkflowEvent<PokeforgeWorkflowParams>, step: WorkflowStep) {
		const { websiteUrl, task } = event.payload;
		const githubToken = this.env.GITHUB_TOKEN;
		const githubOwner = this.env.GITHUB_OWNER;
		const aiProvider = (this.env.AI_PROVIDER ?? "openai") as "openai" | "anthropic" | "google";
		const aiApiKey = this.env.AI_API_KEY;
		const repoName = `mcp-automation-${websiteUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

		if (!aiApiKey) {
			throw new Error("AI_API_KEY is required for MCP code generation");
		}
		if (!this.env.BROWSERBASE_PROJECT_ID || !this.env.BROWSERBASE_API_KEY) {
			throw new Error("BROWSERBASE_PROJECT_ID and BROWSERBASE_API_KEY are required");
		}

		// Step 1: run Stagehand inside a Sandbox (real Node, real fs, cache works)
		const discovery = await step.do("run stagehand", async () =>
			runStagehandDiscovery({
				sandboxNamespace: this.env.Sandbox,
				websiteUrl,
				task,
				env: {
					BROWSERBASE_PROJECT_ID: this.env.BROWSERBASE_PROJECT_ID!,
					BROWSERBASE_API_KEY: this.env.BROWSERBASE_API_KEY!,
					AI_PROVIDER: aiProvider,
					AI_API_KEY: aiApiKey,
				},
				context: {
					workflow: "pokeforge",
					repoName,
				},
			}),
		);

		// Step 2: receive and validate discovery result
		if (discovery.error) {
			return { error: discovery.error, logs: discovery.logs, githubUrl: null };
		}

		// Step 3: codegen
		const generated = await step.do("codegen mcp server", async () => {
			return generateMcpServer({
				websiteUrl,
				task,
				repoName,
				discovery,
				aiProvider,
				aiApiKey,
			});
		});

		// Step 4: test generated output
		await step.do("test generated code", async () => {
			return validateGeneratedCodeInSandbox({
				sandboxNamespace: this.env.Sandbox,
				sandboxId: `mcp-test-${repoName}`,
				generated,
			});
		});

		// Step 5: create GitHub repo only after tests pass
		const githubUrl = await step.do("push to github", async () => {
			return createGithubRepoWithGeneratedCode({
				githubToken,
				githubOwner,
				repoName,
				task,
				websiteUrl,
				generated,
			});
		});

		return {
			discovery: {
				actions: discovery.actions,
				cacheKey: discovery.cacheKey,
				cacheArtifactCount: discovery.artifacts.filter((a) => a.name.startsWith("cache/")).length,
			},
			githubUrl,
		};
	}
}
