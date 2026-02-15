import { extractCacheFiles } from "./cache/extract-cache-files.js";
import type { ProbeParams } from "./params.js";
import { buildStagehand, prepareRuntime, runtimeDiagnostics } from "./stagehand/init.js";

/**
 * Team-editable entrypoint for Browserbase Function logic.
 *
 * Keep this function shape stable so `stagehand-cache-probe.ts` can keep calling it.
 * The intended customization area is the block after `stagehand.init()`.
 *
 * Suggested teammate flow:
 * 1) Navigate the first page in `stagehand.context.pages()[0]`
 * 2) Run observe/act/agent steps
 * 3) Push useful debug info into `logs`
 * 4) Optionally extend `ExecuteResult` with extra outputs
 */
type ExecuteResult = {
	ok: boolean;
	websiteUrl: string;
	task: string;
	cacheDir: string;
	stagehandSessionId: string | null;
	stagehandError: string | null;
	cacheFileCount: number;
	cacheFiles: Awaited<ReturnType<typeof extractCacheFiles>>["cacheFiles"];
	logs: string[];
	note: string;
};

export async function execute(_ctx: unknown, params: ProbeParams): Promise<ExecuteResult> {
	const websiteUrl = params.websiteUrl ?? "https://example.com";
	const task = params.task ?? "Your teammate should replace this with real Stagehand steps.";
	const cacheDir = params.cacheDir ?? "/tmp/stagehand-cache";
	const maxFiles = Math.max(1, Math.min(params.maxFiles ?? 40, 200));
	const logs: string[] = [];

	let stagehandSessionId: string | null = null;
	let stagehandError: string | null = null;

	try {
		await prepareRuntime(cacheDir);
		logs.push(...runtimeDiagnostics(cacheDir));

		const stagehand = buildStagehand(params, cacheDir);
		try {
			await stagehand.init();
			stagehandSessionId = stagehand.browserbaseSessionId ?? null;

			/**
			 * TEAMMATE EDIT ZONE
			 *
			 * This is intentionally left blank as the main integration point.
			 * Example starter snippet:
			 *
			 * const page = stagehand.context.pages()[0];
			 * if (page) {
			 *   await page.goto(websiteUrl, { timeout: 45_000 });
			 *   logs.push(`navigated=${websiteUrl}`);
			 * }
			 *
			 * Keep `stagehand.close()` in `finally` unchanged.
			 */
		} finally {
			await stagehand.close().catch(() => undefined);
		}
	} catch (error) {
		stagehandError = error instanceof Error ? error.message : String(error);
		logs.push(`stagehandError=${stagehandError}`);
	}

	const cacheResult = await extractCacheFiles({ cacheDir, maxFiles });
	logs.push(...cacheResult.logs);

	return {
		ok: !stagehandError,
		websiteUrl,
		task,
		cacheDir,
		stagehandSessionId,
		stagehandError,
		cacheFileCount: cacheResult.cacheFiles.length,
		cacheFiles: cacheResult.cacheFiles,
		logs,
		note: "execute() initializes Stagehand only. Add custom Stagehand steps here.",
	};
}
