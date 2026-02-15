import { Stagehand } from "@browserbasehq/stagehand";
import {
	readFileSync, writeFileSync, mkdirSync,
	readdirSync, statSync,
} from "node:fs";
import { join, extname } from "node:path";

const PAYLOAD_PATH = "/workspace/payload.json";
const OUTPUT_PATH = "/workspace/output.json";
const CACHE_DIR = "/workspace/cache";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function guessMime(name) {
	const ext = extname(name).toLowerCase();
	if (ext === ".json") return "application/json";
	if (ext === ".html") return "text/html";
	if (ext === ".txt" || ext === ".log") return "text/plain";
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	return "application/octet-stream";
}

const TEXT_EXTS = new Set([".json", ".html", ".txt", ".log", ".xml", ".csv"]);

function collectCacheArtifacts() {
	const artifacts = [];
	try {
		for (const entry of readdirSync(CACHE_DIR)) {
			const fp = join(CACHE_DIR, entry);
			try {
				if (!statSync(fp).isFile()) continue;
				const ext = extname(entry).toLowerCase();
				const raw = readFileSync(fp);
				const isText = TEXT_EXTS.has(ext);
				artifacts.push({
					name: `cache/${entry}`,
					mimeType: guessMime(entry),
					encoding: isText ? "utf8" : "base64",
					content: isText ? raw.toString("utf8") : raw.toString("base64"),
				});
			} catch { /* skip unreadable files */ }
		}
	} catch { /* cache dir doesn't exist yet */ }
	return artifacts;
}

function writeOutput(output) {
	writeFileSync(OUTPUT_PATH, JSON.stringify(output));
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
	const payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf8"));
	const { targetUrl, steps, capture, context, inputArtifacts, env } = payload;

	mkdirSync(CACHE_DIR, { recursive: true });

	const aiProvider = (env.AI_PROVIDER || "openai").toLowerCase();
	const modelName =
		aiProvider === "anthropic" ? "anthropic/claude-3-5-haiku-latest"
		: aiProvider === "google" ? "google/gemini-2.5-flash"
		: "openai/gpt-4o-mini";

	const stepResults = [];
	const logLines = [];
	const artifacts = [];
	let stagehand = null;
	let sessionId;
	let finalUrl = targetUrl;

	logLines.push(`Received ${(inputArtifacts || []).length} input artifact(s).`);
	if (context) logLines.push(`Context: ${JSON.stringify(context)}`);

	try {
		stagehand = new Stagehand({
			env: "BROWSERBASE",
			projectId: env.BROWSERBASE_PROJECT_ID,
			apiKey: env.BROWSERBASE_API_KEY,
			model: { modelName, apiKey: env.AI_API_KEY },
			cacheDir: CACHE_DIR,
		});
		await stagehand.init();
		sessionId = stagehand.browserbaseSessionId;
		logLines.push(`Session: ${sessionId || "local"}`);

		const page = stagehand.context.pages()[0];
		await page.goto(targetUrl);
		logLines.push(`Navigated to ${targetUrl}`);

		for (const step of steps) {
			if (!step?.instruction) continue;
			if (step.type !== "observe" && step.type !== "act") continue;
			try {
				if (step.type === "observe") {
					const r = await stagehand.observe(step.instruction);
					stepResults.push({ instruction: step.instruction, type: "observe", result: r });
					logLines.push(`Observe: ${JSON.stringify(r)}`);
				} else {
					const r = await stagehand.act(step.instruction);
					stepResults.push({ instruction: step.instruction, type: "act", result: r });
					logLines.push(`Act: ${JSON.stringify(r)}`);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				stepResults.push({ instruction: step.instruction, type: step.type, result: { error: msg } });
				logLines.push(`${step.type} error: ${msg}`);
			}
		}

		if (capture?.screenshot) {
			try {
				const buf = await page.screenshot({ fullPage: true });
				artifacts.push({
					name: "screenshot.png",
					mimeType: "image/png",
					encoding: "base64",
					content: Buffer.from(buf).toString("base64"),
				});
			} catch (err) {
				logLines.push(`Screenshot error: ${err.message || err}`);
			}
		}

		if (capture?.htmlSnapshot) {
			try {
				const html = await page.evaluate(() => document.documentElement.outerHTML);
				artifacts.push({
					name: "page.html",
					mimeType: "text/html",
					encoding: "utf8",
					content: html,
				});
			} catch (err) {
				logLines.push(`HTML error: ${err.message || err}`);
			}
		}

		finalUrl = page.url();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logLines.push(`Error: ${msg}`);
		if (err instanceof Error && err.stack) logLines.push(err.stack);

		writeOutput({
			steps: stepResults,
			logs: logLines.join("\n"),
			metadata: { cacheKey: "", targetUrl, context, receivedArtifactCount: (inputArtifacts || []).length },
			artifacts: [...artifacts, ...collectCacheArtifacts()],
			error: msg,
		});
		process.exit(0);
	} finally {
		if (stagehand) {
			try { await stagehand.close(); } catch { /* ignore */ }
		}
	}

	const cacheArtifacts = collectCacheArtifacts();
	logLines.push(`Collected ${cacheArtifacts.length} cache artifact(s).`);

	const cacheKey = `${targetUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 64)}_${Date.now().toString(36)}`;

	writeOutput({
		steps: stepResults,
		logs: logLines.join("\n"),
		metadata: {
			cacheKey,
			sessionId,
			targetUrl,
			finalUrl,
			context,
			receivedArtifactCount: (inputArtifacts || []).length,
		},
		artifacts: [...artifacts, ...cacheArtifacts],
	});
}

main().catch((err) => {
	writeOutput({
		steps: [],
		logs: `Fatal: ${err.message || err}`,
		metadata: { cacheKey: "", targetUrl: "unknown" },
		artifacts: [],
		error: err.message || String(err),
	});
});
