/**
 * Persist and load exploration state + endpoint definitions by domain.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { DiscoveryResult, ExplorationState, EndpointDefinition } from "./types.js";

const DATA_DIR = "data";

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/\./g, "_");
  } catch {
    return "unknown";
  }
}

function discoveryPath(domain: string): string {
  return `${DATA_DIR}/discovery_${domain}.json`;
}

export async function saveDiscovery(result: DiscoveryResult): Promise<string> {
  const domain = domainFromUrl(result.exploration.websiteUrl);
  const path = discoveryPath(domain);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2), "utf-8");
  return path;
}

export async function loadDiscovery(websiteUrl: string): Promise<DiscoveryResult | null> {
  const domain = domainFromUrl(websiteUrl);
  const path = discoveryPath(domain);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as DiscoveryResult;
  } catch {
    return null;
  }
}

export async function saveExploration(state: ExplorationState): Promise<void> {
  const domain = domainFromUrl(state.websiteUrl);
  const path = discoveryPath(domain);
  await mkdir(dirname(path), { recursive: true });
  const existing = await loadDiscovery(state.websiteUrl).catch(() => null);
  const result: DiscoveryResult = {
    exploration: state,
    endpoints: existing?.endpoints ?? [],
    discoveredAt: existing?.discoveredAt ?? new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(result, null, 2), "utf-8");
}

export async function saveEndpoints(
  websiteUrl: string,
  endpoints: EndpointDefinition[]
): Promise<void> {
  const existing = await loadDiscovery(websiteUrl).catch(() => null);
  const result: DiscoveryResult = {
    exploration: existing?.exploration ?? {
      websiteUrl,
      exploredPages: [],
      actionById: {},
    },
    endpoints,
    discoveredAt: existing?.discoveredAt ?? new Date().toISOString(),
  };
  await saveDiscovery(result);
}
