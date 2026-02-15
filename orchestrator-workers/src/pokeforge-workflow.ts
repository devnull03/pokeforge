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
		const stagehandService = this.env.STAGEHAND_SERVICE;
		const stagehandUrl = this.env.STAGEHAND_SERVICE_URL;
		const githubToken = this.env.GITHUB_TOKEN;
		const githubOwner = this.env.GITHUB_OWNER;
		const aiProvider = (this.env.AI_PROVIDER ?? "openai") as "openai" | "anthropic" | "google";
		const aiApiKey = this.env.AI_API_KEY;
		const repoName = `mcp-automation-${websiteUrl.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
		if (!aiApiKey) {
			throw new Error("AI_API_KEY is required for MCP code generation");
		}

		// Step 1: call stagehand service
		const discovery = await step.do("run stagehand", async () =>
			runStagehandDiscovery({
				stagehandService,
				stagehandUrl,
				websiteUrl,
				task,
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
			discovery: { actions: discovery.actions, cacheKey: discovery.cacheKey },
			githubUrl,
		};
	}
}
