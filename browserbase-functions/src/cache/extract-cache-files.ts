import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

export type CacheFile = {
	name: string;
	sourceDir: string;
	size: number;
	encoding: "utf8" | "base64";
	mimeType: string;
	content: string;
};

export type CacheExtractionResult = {
	cacheFiles: CacheFile[];
	logs: string[];
};

type CacheExtractionOptions = {
	cacheDir: string;
	maxFiles: number;
};

function mimeFromFileName(name: string): string {
	const ext = extname(name).toLowerCase();
	if (ext === ".json") return "application/json";
	if (ext === ".html") return "text/html";
	if (ext === ".txt" || ext === ".log") return "text/plain";
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	return "application/octet-stream";
}

function textLike(name: string): boolean {
	const ext = extname(name).toLowerCase();
	return [".json", ".html", ".txt", ".log", ".xml", ".csv", ".md"].includes(ext);
}

async function walkFiles(root: string, maxFiles: number): Promise<string[]> {
	const files: string[] = [];
	const queue: string[] = [root];

	while (queue.length > 0 && files.length < maxFiles) {
		const current = queue.shift();
		if (!current) break;

		let entries: string[] = [];
		try {
			entries = await readdir(current);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (files.length >= maxFiles) break;
			const full = join(current, entry);
			try {
				const fileStat = await stat(full);
				if (fileStat.isDirectory()) queue.push(full);
				if (fileStat.isFile()) files.push(full);
			} catch {
				// Skip unreadable entries.
			}
		}
	}

	return files;
}

export async function extractCacheFiles(
	options: CacheExtractionOptions,
): Promise<CacheExtractionResult> {
	const { cacheDir, maxFiles } = options;
	const cacheScanDirs = [cacheDir, ".cache", "/tmp/.cache", "/tmp/tmp/.cache", "/workspace/.cache"];
	const seenPaths = new Set<string>();
	const cacheFiles: CacheFile[] = [];
	const logs: string[] = [];

	for (const dir of cacheScanDirs) {
		const files = await walkFiles(dir, maxFiles);
		logs.push(`scanDir=${dir} files=${files.length}`);

		for (const filePath of files) {
			if (seenPaths.has(filePath)) continue;
			seenPaths.add(filePath);

			const relative = filePath.startsWith(dir)
				? filePath.slice(dir.length).replace(/^[/\\]/, "")
				: filePath;
			const artifactName = `cache/${relative}`;

			try {
				const fileStat = await stat(filePath);
				const raw = await readFile(filePath);
				const asText = textLike(filePath);

				cacheFiles.push({
					name: artifactName,
					sourceDir: dir,
					size: fileStat.size,
					encoding: asText ? "utf8" : "base64",
					mimeType: mimeFromFileName(filePath),
					content: asText ? raw.toString("utf8") : raw.toString("base64"),
				});
			} catch (error) {
				logs.push(`failed reading ${artifactName}: ${String(error)}`);
			}
		}
	}

	return { cacheFiles, logs };
}
