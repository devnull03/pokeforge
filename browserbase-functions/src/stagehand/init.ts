import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Stagehand } from "@browserbasehq/stagehand";
import type { ProbeParams } from "../params.js";

function resolveModelName(aiProvider: string, modelName?: string): string {
	if (modelName) return modelName;
	if (aiProvider === "anthropic") return "anthropic/claude-3-5-haiku-latest";
	if (aiProvider === "google") return "google/gemini-2.5-flash";
	return "openai/gpt-4o-mini";
}

function applyAiProviderEnv(aiProvider: string, aiApiKey: string): void {
	if (aiProvider === "anthropic") process.env.ANTHROPIC_API_KEY = aiApiKey;
	if (aiProvider === "google") process.env.GOOGLE_API_KEY = aiApiKey;
	if (aiProvider === "openai") process.env.OPENAI_API_KEY = aiApiKey;
}

export function ensureStagehandCredentials(params: ProbeParams): void {
	if (!params.browserbaseProjectId || !params.browserbaseApiKey || !params.aiApiKey) {
		throw new Error(
			"Missing browserbaseProjectId/browserbaseApiKey/aiApiKey in function params.",
		);
	}
}

export async function prepareRuntime(cacheDir: string): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	await mkdir("/tmp/.cache", { recursive: true });

	process.env.HOME = "/tmp";
	process.env.TMPDIR = "/tmp";
	process.env.XDG_CACHE_HOME = "/tmp/.cache";
	process.env.STAGEHAND_CACHE_DIR = cacheDir;

	try {
		process.chdir("/tmp");
	} catch {
		// Some runtimes may not allow chdir; safe to ignore.
	}
}

export function buildStagehand(params: ProbeParams, cacheDir: string): Stagehand {
	ensureStagehandCredentials(params);

	const aiProvider = (params.aiProvider ?? "openai").toLowerCase();
	const aiApiKey = params.aiApiKey as string;
	const modelName = resolveModelName(aiProvider, params.modelName);
	applyAiProviderEnv(aiProvider, aiApiKey);

	return new Stagehand({
		env: "BROWSERBASE",
		projectId: params.browserbaseProjectId,
		apiKey: params.browserbaseApiKey,
		modelName,
		modelClientOptions: { apiKey: aiApiKey },
		cacheDir,
		enableCaching: true,
	});
}

export function runtimeDiagnostics(cacheDir: string): string[] {
	return [
		`cacheDir=${cacheDir}`,
		`cwd=${process.cwd()}`,
		`envHOME=${process.env.HOME}`,
		`envTMPDIR=${process.env.TMPDIR}`,
		`envXDG_CACHE_HOME=${process.env.XDG_CACHE_HOME}`,
		`stagehandCacheDir=${process.env.STAGEHAND_CACHE_DIR}`,
		`probeMarker=${join(cacheDir, "probe.txt")}`,
	];
}
