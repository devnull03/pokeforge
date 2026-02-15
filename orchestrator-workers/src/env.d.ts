declare namespace Cloudflare {
	interface Env {
		GITHUB_TOKEN?: string;
		GITHUB_OWNER?: string;
		AI_PROVIDER?: "openai" | "anthropic" | "google";
		AI_API_KEY?: string;
		STAGEHAND_SERVICE?: Fetcher;
		STAGEHAND_SERVICE_URL?: string;
		Sandbox: DurableObjectNamespace;
	}
}
