/**
 * Persist and load discovery data by domain.
 */

import { fileURLToPath } from "url";
import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import type { DiscoveryResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/\./g, "_");
  } catch {
    return "unknown";
  }
}

function discoveryPath(domain: string): string {
  return path.join(DATA_DIR, `discovery_${domain}.json`);
}

export async function saveDiscovery(result: DiscoveryResult): Promise<string> {
  const domain = domainFromUrl(result.exploration.websiteUrl);
  const filePath = discoveryPath(domain);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

export async function loadDiscovery(websiteUrl: string): Promise<DiscoveryResult | null> {
  const domain = domainFromUrl(websiteUrl);
  const filePath = discoveryPath(domain);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as DiscoveryResult;
  } catch {
    return null;
  }
}
