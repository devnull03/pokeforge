import { Hono } from "hono";
import { cors } from "hono/cors";
import { Stagehand } from "@browserbasehq/stagehand";

type Bindings = {
	BROWSERBASE_PROJECT_ID: string;
	BROWSERBASE_API_KEY: string;
	ANTHROPIC_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use(cors());

interface RunPayload {
	websiteUrl: string;
	task: string;
}

interface ActionLog {
	instruction: string;
	type: "observe" | "act";
	result: unknown;
}

interface RunResult {
	actions: ActionLog[];
	logs: string;
	cacheKey: string;
	sessionId?: string;
	error?: string;
}

app.post("/run", async (c) => {
	const body = (await c.req.json()) as RunPayload;
	const { websiteUrl, task } = body;

	if (!websiteUrl || !task) {
		return c.json({ error: "websiteUrl and task are required" }, 400);
	}

	const actionLogs: ActionLog[] = [];
	const logLines: string[] = [];

	try {
		if (!c.env.BROWSERBASE_PROJECT_ID || !c.env.BROWSERBASE_API_KEY || !c.env.ANTHROPIC_API_KEY) {
			return c.json(
				{
					actions: actionLogs,
					logs: "Missing required Browserbase or Anthropic bindings",
					cacheKey: "",
					error: "BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY and ANTHROPIC_API_KEY are required",
				} satisfies RunResult,
				500,
			);
		}

		const stagehand = new Stagehand({
			env: "BROWSERBASE",
			model: {
				modelName: "anthropic/claude-haiku-4-5-20251001",
				apiKey: c.env.ANTHROPIC_API_KEY,
			},
		});

		await stagehand.init();
		logLines.push(`Session started: ${stagehand.browserbaseSessionId ?? "local"}`);

		const page = stagehand.context.pages()[0];
		await page.goto(websiteUrl);
		logLines.push(`Navigated to ${websiteUrl}`);

		// Run observe to discover what can be done for the task
		const observeResult = await stagehand.observe(task);
		actionLogs.push({ instruction: task, type: "observe", result: observeResult });
		logLines.push(`Observe: ${JSON.stringify(observeResult)}`);

		// Act on the task once - Stagehand act() accepts Action or string
		try {
			const actions = Array.isArray(observeResult) ? observeResult : [observeResult];
			if (actions.length > 0) {
				const firstAction = actions[0];
				const actResult = await stagehand.act(
					typeof firstAction === "string" ? firstAction : firstAction,
				);
				actionLogs.push({ instruction: task, type: "act", result: actResult });
				logLines.push(`Act result: ${JSON.stringify(actResult)}`);
			} else {
				// No actions from observe, try acting with task instruction directly
				const actResult = await stagehand.act(task);
				actionLogs.push({ instruction: task, type: "act", result: actResult });
				logLines.push(`Act result: ${JSON.stringify(actResult)}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			actionLogs.push({ instruction: task, type: "act", result: { error: msg } });
			logLines.push(`Act error: ${msg}`);
		}

		await stagehand.close();

		const cacheKey = `${websiteUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 64)}_${task.replace(/[^a-z0-9]/gi, "_").slice(0, 32)}`;

		const result: RunResult = {
			actions: actionLogs,
			logs: logLines.join("\n"),
			cacheKey,
			sessionId: stagehand.browserbaseSessionId,
		};

		return c.json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error ? err.stack : undefined;
		logLines.push(`Error: ${msg}`);
		if (stack) logLines.push(stack);

		return c.json(
			{
				actions: actionLogs,
				logs: logLines.join("\n"),
				cacheKey: "",
				error: msg,
			} satisfies RunResult,
			500,
		);
	}
});

app.get("/health", (c) => c.json({ ok: true }));

export default app;
