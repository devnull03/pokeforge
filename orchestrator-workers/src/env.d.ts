declare namespace Cloudflare {
	interface Env {
		GITHUB_TOKEN?: string;
		GITHUB_OWNER?: string;
		AI_PROVIDER?: "openai" | "anthropic" | "google";
		AI_API_KEY?: string;
		BROWSERBASE_PROJECT_ID?: string;
		BROWSERBASE_API_KEY?: string;
		BROWSERBASE_CACHE_PROBE_FUNCTION_ID?: string;
		Sandbox: DurableObjectNamespace;
	}
}
