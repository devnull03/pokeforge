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
			logs: "Missing required Browserbase or Anthropic bindings",
			metadata: {
				cacheKey: "",
				targetUrl: payload.targetUrl,
			},
			artifacts: [],
			error: "BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY and ANTHROPIC_API_KEY are required",
		};
		return c.json(result, 500);
	}

	const result = await executeStagehand(payload, c.env);
	const status = result.error ? 500 : 200;
	return c.json(result, status);
}

function hasRequiredBindings(env: Partial<Bindings>): env is Bindings {
	return Boolean(env.BROWSERBASE_PROJECT_ID && env.BROWSERBASE_API_KEY && env.ANTHROPIC_API_KEY);
}
