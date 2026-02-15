declare namespace Cloudflare {
	interface Env {
		GITHUB_TOKEN?: string;
		OPENAI_API_KEY?: string;
		Sandbox: DurableObjectNamespace;
	}
}
