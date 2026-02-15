/**
 * SessionManager: manages Browserbase contexts (per-user persistence),
 * Stagehand sessions, and flows (chained endpoint calls).
 *
 * - Contexts persist cookies/localStorage across sessions (per userId + domain)
 * - Flows keep a browser session alive across multiple endpoint calls
 * - Sessions auto-expire after idle timeout
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { readFile, writeFile, mkdir } from "fs/promises";
import { API_KEYS } from "./config.js";
import type { FlowState, PageState, ContextMap } from "./types.js";

const CONTEXTS_FILE = "data/contexts.json";
const FLOW_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/\./g, "_");
  } catch {
    return "unknown";
  }
}

function contextKey(userId: string, domain: string): string {
  return `${userId}__${domain}`;
}

function generateFlowId(): string {
  return `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Context persistence ─────────────────────────────────────────

async function loadContextMap(): Promise<ContextMap> {
  try {
    const raw = await readFile(CONTEXTS_FILE, "utf-8");
    return JSON.parse(raw) as ContextMap;
  } catch {
    return {};
  }
}

async function saveContextMap(map: ContextMap): Promise<void> {
  await mkdir("data", { recursive: true });
  await writeFile(CONTEXTS_FILE, JSON.stringify(map, null, 2), "utf-8");
}

// ─── Browserbase Context API ─────────────────────────────────────

async function createBrowserbaseContext(): Promise<string> {
  const res = await fetch("https://api.browserbase.com/v1/contexts", {
    method: "POST",
    headers: {
      "x-bb-api-key": API_KEYS.BROWSERBASE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: API_KEYS.BROWSERBASE_PROJECT_ID }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create Browserbase context: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

// ─── SessionManager ──────────────────────────────────────────────

export interface ActiveSession {
  stagehand: Stagehand;
  flowId: string;
}

export class SessionManager {
  /** Active flows with live browser sessions */
  private flows: Map<string, FlowState> = new Map();
  /** Live Stagehand instances, keyed by flowId */
  private sessions: Map<string, Stagehand> = new Map();
  /** Cached context map (userId+domain → contextId) */
  private contextMap: ContextMap | null = null;

  // ─── Context management ──────────────────────────────────────

  /** Get or create a Browserbase context for a user+domain pair */
  async getOrCreateContext(userId: string, domain: string): Promise<string> {
    if (!this.contextMap) {
      this.contextMap = await loadContextMap();
    }
    const key = contextKey(userId, domain);
    if (this.contextMap[key]) {
      return this.contextMap[key];
    }
    console.log(`Creating new Browserbase context for ${userId}@${domain}...`);
    const contextId = await createBrowserbaseContext();
    this.contextMap[key] = contextId;
    await saveContextMap(this.contextMap);
    console.log(`Context created: ${contextId}`);
    return contextId;
  }

  // ─── Flow management ─────────────────────────────────────────

  /** Start a new flow or return an existing one */
  async startFlow(
    userId: string,
    websiteUrl: string,
    existingFlowId?: string
  ): Promise<{ flow: FlowState; stagehand: Stagehand; isNew: boolean }> {
    const domain = domainFromUrl(websiteUrl);

    // Resume existing flow if alive
    if (existingFlowId) {
      const existing = this.flows.get(existingFlowId);
      const existingSession = this.sessions.get(existingFlowId);
      if (existing && existingSession) {
        const idleTime = Date.now() - existing.lastActivity;
        if (idleTime < FLOW_IDLE_TIMEOUT_MS) {
          existing.lastActivity = Date.now();
          console.log(`Resuming flow ${existingFlowId} (idle ${Math.round(idleTime / 1000)}s)`);
          return { flow: existing, stagehand: existingSession, isNew: false };
        }
        // Expired — close and create new
        console.log(`Flow ${existingFlowId} expired (idle ${Math.round(idleTime / 1000)}s), creating new session`);
        await this.closeFlow(existingFlowId);
      }
    }

    // Create new flow
    const flowId = existingFlowId || generateFlowId();
    const ctxId = await this.getOrCreateContext(userId, domain);
    const cacheDir = `cache/${domain}`;

    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: API_KEYS.BROWSERBASE_API_KEY,
      projectId: API_KEYS.BROWSERBASE_PROJECT_ID,
      browserbaseSessionCreateParams: {
        browserSettings: {
          context: {
            id: ctxId,
            persist: true,
          },
        },
      },
      cacheDir,
    });

    await stagehand.init();

    const flow: FlowState = {
      flowId,
      userId,
      domain,
      contextId: ctxId,
      currentPage: { url: "", title: undefined },
      completedEndpoints: [],
      providedState: [],
      extractedData: {},
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };

    this.flows.set(flowId, flow);
    this.sessions.set(flowId, stagehand);

    console.log(`New flow ${flowId} | context: ${ctxId} | session: ${stagehand.browserbaseSessionID ?? "local"}`);
    if (stagehand.browserbaseSessionURL) {
      console.log(`Watch live: ${stagehand.browserbaseSessionURL}`);
    }

    return { flow, stagehand, isNew: true };
  }

  /** Update flow state after an endpoint runs */
  updateFlow(
    flowId: string,
    endpointName: string,
    currentPage: PageState,
    providedState: string[],
    extractedData?: unknown
  ): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;
    flow.completedEndpoints.push(endpointName);
    flow.providedState.push(...providedState);
    flow.currentPage = currentPage;
    flow.lastActivity = Date.now();
    if (extractedData !== undefined) {
      flow.extractedData[endpointName] = extractedData;
    }
  }

  /** Get current flow state */
  getFlow(flowId: string): FlowState | undefined {
    return this.flows.get(flowId);
  }

  /** Get the Stagehand instance for a flow */
  getStagehand(flowId: string): Stagehand | undefined {
    return this.sessions.get(flowId);
  }

  /** Close a flow and its browser session */
  async closeFlow(flowId: string): Promise<void> {
    const stagehand = this.sessions.get(flowId);
    if (stagehand) {
      try {
        await Promise.race([
          stagehand.close(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("close_timeout")), 10_000)
          ),
        ]);
      } catch (e) {
        console.warn(`Flow ${flowId} close warning:`, (e as Error).message);
      }
    }
    this.sessions.delete(flowId);
    this.flows.delete(flowId);
  }

  /** Close all active flows */
  async closeAll(): Promise<void> {
    const flowIds = [...this.flows.keys()];
    for (const id of flowIds) {
      await this.closeFlow(id);
    }
  }

  /** Check dependencies: are all required states available in the flow? */
  checkDependencies(
    flowId: string,
    endpointName: string,
    metadata?: { dependsOn?: string[]; requiresAuth?: boolean }
  ): { ok: boolean; missing: string[] } {
    const flow = this.flows.get(flowId);
    if (!flow) return { ok: true, missing: [] };

    const missing: string[] = [];

    if (metadata?.dependsOn) {
      for (const dep of metadata.dependsOn) {
        // Check if the dependency endpoint was completed or its state token is provided
        const depMet =
          flow.completedEndpoints.includes(dep) || flow.providedState.includes(dep);
        if (!depMet) {
          missing.push(dep);
        }
      }
    }

    if (metadata?.requiresAuth && !flow.providedState.includes("logged_in")) {
      missing.push("logged_in (requires authentication)");
    }

    return { ok: missing.length === 0, missing };
  }

  /** List active flows (for debugging) */
  listFlows(): { flowId: string; userId: string; domain: string; endpoints: string[]; idle: number }[] {
    return [...this.flows.entries()].map(([id, f]) => ({
      flowId: id,
      userId: f.userId,
      domain: f.domain,
      endpoints: f.completedEndpoints,
      idle: Math.round((Date.now() - f.lastActivity) / 1000),
    }));
  }
}
