declare namespace Cloudflare {
	interface Env {
		GITHUB_TOKEN?: string;
		OPENAI_API_KEY?: string;
		STAGEHAND_SERVICE?: Fetcher;
		STAGEHAND_SERVICE_URL?: string;
		Sandbox: DurableObjectNamespace;
	}
}
