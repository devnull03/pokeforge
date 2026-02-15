import type { DiscoveryAction, DiscoveryResult, StagehandArtifact, StagehandContext } from "./types";

export async function runStagehandDiscovery(args: {
	stagehandService?: Fetcher;
	stagehandUrl?: string;
	websiteUrl: string;
	task: string;
	context?: StagehandContext;
	inputArtifacts?: StagehandArtifact[];
}): Promise<DiscoveryResult> {
	const { stagehandService, stagehandUrl, websiteUrl, task, context, inputArtifacts } = args;

	const request = new Request(`${stagehandUrl ?? "https://stagehand-service.internal"}/execute`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			targetUrl: websiteUrl,
			steps: [
				{ type: "observe", instruction: task },
				{ type: "act", instruction: task },
			],
			capture: {
				screenshot: true,
				htmlSnapshot: true,
			},
			context,
			inputArtifacts,
		}),
	});
	const res = stagehandService
		? await stagehandService.fetch(request)
		: await fetch(request);

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Stagehand service error: ${res.status} ${err}`);
	}

	const raw = await res.json();
	const normalizedRaw = JSON.parse(JSON.stringify(raw)) as {
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

	const actions: DiscoveryAction[] = Array.isArray(normalizedRaw.steps)
		? normalizedRaw.steps.map((action) => ({
				instruction:
					typeof action.instruction === "string"
						? action.instruction
						: String(action.instruction ?? ""),
				type: typeof action.type === "string" ? action.type : String(action.type ?? ""),
				result: JSON.stringify(action.result ?? null),
			}))
		: [];

	return {
		actions,
		logs: typeof normalizedRaw.logs === "string" ? normalizedRaw.logs : "",
		cacheKey:
			typeof normalizedRaw.metadata?.cacheKey === "string"
				? normalizedRaw.metadata.cacheKey
				: "",
		sessionId:
			typeof normalizedRaw.metadata?.sessionId === "string"
				? normalizedRaw.metadata.sessionId
				: undefined,
		context:
			normalizedRaw.metadata?.context &&
			typeof normalizedRaw.metadata.context === "object" &&
			!Array.isArray(normalizedRaw.metadata.context)
				? (normalizedRaw.metadata.context as StagehandContext)
				: undefined,
		receivedArtifactCount:
			typeof normalizedRaw.metadata?.receivedArtifactCount === "number"
				? normalizedRaw.metadata.receivedArtifactCount
				: undefined,
		artifacts: Array.isArray(normalizedRaw.artifacts)
			? normalizedRaw.artifacts.map((artifact) => ({
					name: typeof artifact.name === "string" ? artifact.name : "artifact",
					mimeType:
						typeof artifact.mimeType === "string"
							? artifact.mimeType
							: "application/octet-stream",
					encoding:
						artifact.encoding === "base64" || artifact.encoding === "utf8"
							? artifact.encoding
							: "base64",
					content: typeof artifact.content === "string" ? artifact.content : "",
				}))
			: [],
		error: typeof normalizedRaw.error === "string" ? normalizedRaw.error : undefined,
	};
}
