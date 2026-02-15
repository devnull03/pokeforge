import type { Context } from "hono";
import { executeStagehand } from "../core/execute-stagehand.js";
import type { Bindings, ExecutePayload, ExecuteResult } from "../types.js";

type AppContext = Context<{ Bindings: Bindings }>;

export async function handleExecute(c: AppContext) {
	const payload = (await c.req.json()) as ExecutePayload;
	if (!payload.targetUrl || !Array.isArray(payload.steps) || payload.steps.length === 0) {
		return c.json({ error: "targetUrl and non-empty steps are required" }, 400);
	}
	if (!hasRequiredBindings(c.env)) {
		const result: ExecuteResult = {
			steps: [],
			logs: "Missing required Browserbase or AI bindings",
			metadata: {
				cacheKey: "",
				targetUrl: payload.targetUrl,
			},
			artifacts: [],
			error: "BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY, AI_PROVIDER and AI_API_KEY are required",
		};
		return c.json(result, 500);
	}

	const result = await executeStagehand(payload, c.env);
	const status = result.error ? 500 : 200;
	return c.json(result, status);
}

function hasRequiredBindings(env: Partial<Bindings>): env is Bindings {
	const hasValidProvider =
		env.AI_PROVIDER === "openai" ||
		env.AI_PROVIDER === "anthropic" ||
		env.AI_PROVIDER === "google";
	return Boolean(env.BROWSERBASE_PROJECT_ID && env.BROWSERBASE_API_KEY && hasValidProvider && env.AI_API_KEY);
}
