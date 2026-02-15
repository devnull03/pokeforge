import type { GeneratedMcpServer } from "./types";

export async function createGithubRepoWithGeneratedCode(args: {
	githubToken?: string;
	githubOwner?: string;
	repoName: string;
	task: string;
	websiteUrl: string;
	generated: GeneratedMcpServer;
}): Promise<string> {
	const { githubToken, githubOwner, repoName, task, websiteUrl, generated } = args;
	const ownerDisplay = githubOwner ?? "unknown-owner";

	if (!githubToken) {
		return `https://github.com/${ownerDisplay}/${repoName} (repo not created - GITHUB_TOKEN not set)`;
	}

	const headers = {
		Authorization: `Bearer ${githubToken}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
	};
	const resolvedOwner = githubOwner ?? (await resolveGithubOwner(headers));

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
			`https://api.github.com/repos/${resolvedOwner}/${repoName}/contents/${filePath}`,
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

	return `https://github.com/${resolvedOwner}/${repoName}`;
}

async function resolveGithubOwner(headers: Record<string, string>): Promise<string> {
	const res = await fetch("https://api.github.com/user", { headers });
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`GitHub owner lookup failed: ${res.status} ${err}`);
	}
	const payload = (await res.json()) as { login?: unknown };
	if (typeof payload.login !== "string" || !payload.login) {
		throw new Error("GitHub owner lookup failed: missing login");
	}
	return payload.login;
}

function base64EncodeUtf8(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
