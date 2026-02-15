import { getSandbox } from "@cloudflare/sandbox";
import RUNNER_SCRIPT from "./stagehand-runner.mjs?raw";
import type { DiscoveryAction, DiscoveryResult, StagehandArtifact, StagehandContext } from "./types";

const SANDBOX_PACKAGE_JSON = JSON.stringify(
	{ type: "module", dependencies: { "@browserbasehq/stagehand": "latest" } },
	null,
	2,
);

export async function runStagehandDiscovery(args: {
	sandboxNamespace: DurableObjectNamespace;
	websiteUrl: string;
	task: string;
	env: {
		BROWSERBASE_PROJECT_ID: string;
		BROWSERBASE_API_KEY: string;
		AI_PROVIDER: string;
		AI_API_KEY: string;
	};
	context?: StagehandContext;
	inputArtifacts?: StagehandArtifact[];
}): Promise<DiscoveryResult> {
	const { sandboxNamespace, websiteUrl, task, env, context, inputArtifacts } = args;

	// Stable ID — deps persist across invocations (warm sandbox)
	const sandbox = getSandbox(sandboxNamespace, "stagehand-runner");

	try {
		// ── Ensure deps are installed (only on first run) ──────────
		const check = await sandbox.exec(
			"test -d /workspace/node_modules/@browserbasehq && echo ok || echo no",
		);
		if (check.stdout.trim() !== "ok") {
			await sandbox.exec("mkdir -p /workspace");
			await sandbox.writeFile("/workspace/package.json", SANDBOX_PACKAGE_JSON);
			const install = await sandbox.exec(
				"cd /workspace && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bun install",
			);
			if (!install.success) {
				throw new Error(
					`Sandbox bun install failed (exit ${install.exitCode}): ${install.stderr || install.stdout}`,
				);
			}
		}

		// ── Write runner script + payload ──────────────────────────
		await sandbox.writeFile("/workspace/runner.mjs", RUNNER_SCRIPT);
		await sandbox.writeFile(
			"/workspace/payload.json",
			JSON.stringify({
				targetUrl: websiteUrl,
				steps: [
					{ type: "observe", instruction: task },
					{ type: "act", instruction: task },
				],
				capture: { screenshot: true, htmlSnapshot: true },
				context,
				inputArtifacts,
				env,
			}),
		);

		// ── Execute ───────────────────────────────────────────────
		const run = await sandbox.exec("cd /workspace && bun runner.mjs");

		// ── Read output ───────────────────────────────────────────
		const outputResult = await sandbox.exec("cat /workspace/output.json");
		if (!outputResult.success) {
			throw new Error(
				`Failed to read sandbox output: ${outputResult.stderr}. ` +
					`Runner exit ${run.exitCode}: ${run.stderr || run.stdout}`,
			);
		}

		return parseRunnerOutput(outputResult.stdout);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			actions: [],
			logs: message,
			cacheKey: "",
			artifacts: [],
			error: message,
		};
	}
	// NOTE: we do NOT destroy the sandbox — keep it warm for next call
}

/* ------------------------------------------------------------------ */
/*  Parse the JSON written by the runner into a DiscoveryResult       */
/* ------------------------------------------------------------------ */

function parseRunnerOutput(stdout: string): DiscoveryResult {
	const raw = JSON.parse(stdout) as {
		steps?: Array<{ instruction?: unknown; type?: unknown; result?: unknown }>;
		logs?: unknown;
		metadata?: {
			cacheKey?: unknown;
			sessionId?: unknown;
			context?: unknown;
			receivedArtifactCount?: unknown;
		};
		artifacts?: Array<{
			name?: unknown;
			mimeType?: unknown;
			encoding?: unknown;
			content?: unknown;
		}>;
		error?: unknown;
	};

	const actions: DiscoveryAction[] = Array.isArray(raw.steps)
		? raw.steps.map((s) => ({
				instruction: typeof s.instruction === "string" ? s.instruction : String(s.instruction ?? ""),
				type: typeof s.type === "string" ? s.type : String(s.type ?? ""),
				result: JSON.stringify(s.result ?? null),
			}))
		: [];

	return {
		actions,
		logs: typeof raw.logs === "string" ? raw.logs : "",
		cacheKey: typeof raw.metadata?.cacheKey === "string" ? raw.metadata.cacheKey : "",
		sessionId: typeof raw.metadata?.sessionId === "string" ? raw.metadata.sessionId : undefined,
		context:
			raw.metadata?.context &&
			typeof raw.metadata.context === "object" &&
			!Array.isArray(raw.metadata.context)
				? (raw.metadata.context as StagehandContext)
				: undefined,
		receivedArtifactCount:
			typeof raw.metadata?.receivedArtifactCount === "number"
				? raw.metadata.receivedArtifactCount
				: undefined,
		artifacts: Array.isArray(raw.artifacts)
			? raw.artifacts.map((a) => ({
					name: typeof a.name === "string" ? a.name : "artifact",
					mimeType: typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream",
					encoding: a.encoding === "base64" || a.encoding === "utf8" ? a.encoding : "base64",
					content: typeof a.content === "string" ? a.content : "",
				}))
			: [],
		error: typeof raw.error === "string" ? raw.error : undefined,
	};
}
