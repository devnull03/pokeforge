import { Stagehand } from "@browserbasehq/stagehand";
import type { Bindings, ExecutePayload, ExecuteResult, StepResult, Artifact } from "../types.js";
import { bytesToBase64, toUint8Array } from "../utils/encoding.js";

export async function executeStagehand(payload: ExecutePayload, env: Bindings): Promise<ExecuteResult> {
	const aiProvider = env.AI_PROVIDER.toLowerCase() as Bindings["AI_PROVIDER"];
	const modelName =
		aiProvider === "anthropic"
			? "anthropic/claude-3-5-haiku-latest"
			: aiProvider === "google"
				? "google/gemini-2.5-flash"
				: "openai/gpt-4o-mini";
	const { targetUrl, steps, capture, context, inputArtifacts } = payload;
	const stepResults: StepResult[] = [];
	const logLines: string[] = [];
	const artifacts: Artifact[] = [];
	let stagehand: Stagehand | null = null;

	logLines.push(`Received ${inputArtifacts?.length ?? 0} input artifact(s) from caller.`);
	if (context) logLines.push(`Received context: ${JSON.stringify(context)}`);

	try {
		stagehand = new Stagehand({
			env: "BROWSERBASE",
			projectId: env.BROWSERBASE_PROJECT_ID,
			apiKey: env.BROWSERBASE_API_KEY,
			model: {
				modelName,
				apiKey: env.AI_API_KEY,
			},
			disablePino: true,
		});
		await stagehand.init();
		logLines.push(`Session started: ${stagehand.browserbaseSessionId ?? "local"}`);

		const page = stagehand.context.pages()[0];
		await page.goto(targetUrl);
		logLines.push(`Navigated to ${targetUrl}`);

		for (const step of steps) {
			if (!step?.instruction || (step.type !== "observe" && step.type !== "act")) continue;
			try {
				if (step.type === "observe") {
					const observeResult = await stagehand.observe(step.instruction);
					stepResults.push({
						instruction: step.instruction,
						type: "observe",
						result: observeResult,
					});
					logLines.push(`Observe (${step.instruction}): ${JSON.stringify(observeResult)}`);
				} else {
					const actResult = await stagehand.act(step.instruction);
					stepResults.push({
						instruction: step.instruction,
						type: "act",
						result: actResult,
					});
					logLines.push(`Act (${step.instruction}): ${JSON.stringify(actResult)}`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stepResults.push({
					instruction: step.instruction,
					type: step.type,
					result: { error: message },
				});
				logLines.push(`${step.type} error (${step.instruction}): ${message}`);
			}
		}

		if (capture?.screenshot) {
			const screenshotBytes = await page.screenshot({ fullPage: true });
			artifacts.push({
				name: "screenshot.png",
				mimeType: "image/png",
				encoding: "base64",
				content: bytesToBase64(toUint8Array(screenshotBytes)),
			});
		}
		if (capture?.htmlSnapshot) {
			const html = await page.evaluate(() => document.documentElement.outerHTML);
			artifacts.push({
				name: "page.html",
				mimeType: "text/html",
				encoding: "utf8",
				content: html,
			});
		}

		return {
			steps: stepResults,
			logs: logLines.join("\n"),
			metadata: {
				cacheKey: `${targetUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 64)}_${Date.now().toString(36)}`,
				sessionId: stagehand.browserbaseSessionId,
				targetUrl,
				finalUrl: page.url(),
				context,
				receivedArtifactCount: inputArtifacts?.length ?? 0,
			},
			artifacts,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack : undefined;
		logLines.push(`Error: ${message}`);
		if (stack) logLines.push(stack);

		return {
			steps: stepResults,
			logs: logLines.join("\n"),
			metadata: {
				cacheKey: "",
				targetUrl,
				context,
				receivedArtifactCount: inputArtifacts?.length ?? 0,
			},
			artifacts,
			error: message,
		};
	} finally {
		if (stagehand) {
			try {
				await stagehand.close();
			} catch {
				// ignore close errors
			}
		}
	}
}

