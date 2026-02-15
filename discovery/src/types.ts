/**
 * Shared types for MCP discovery agent: exploration state, endpoints, replay, flows.
 */

// ─── Discovery types ───────────────────────────────────────────────

/** Action from Stagehand observe() with a stable id for referencing in endpoint steps */
export interface DiscoveredAction {
  id: string;
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

/** One explored page: URL + discovered actions (indexed by id) */
export interface ExploredPage {
  url: string;
  title?: string;
  actions: DiscoveredAction[];
}

// ─── Endpoint types ────────────────────────────────────────────────

/** One step in an MCP endpoint: either navigate, act (by id or instruction), or extract */
export type EndpointStep =
  | { type: "navigate"; url: string }
  | { type: "act"; actionId: string }
  | { type: "act_instruction"; instruction: string }
  | { type: "extract"; instruction: string; outputSchema?: Record<string, unknown> };

/** Dependency and execution metadata for an endpoint */
export interface EndpointMetadata {
  /** Endpoint names this depends on (must run first in the flow) */
  dependsOn?: string[];
  /** State tokens this endpoint provides after running (e.g. "cart_state", "logged_in") */
  provides?: string[];
  /** Whether this endpoint requires the user to be authenticated */
  requiresAuth?: boolean;
  /** Execution mode: static replays exact steps, dynamic uses Stagehand agent */
  mode?: "static" | "dynamic";
}

/** One MCP endpoint: name, description, ordered steps, optional metadata */
export interface EndpointDefinition {
  name: string;
  description: string;
  steps: EndpointStep[];
  metadata?: EndpointMetadata;
}

/** Full exploration state: pages + actions, used for agent feedback and replay */
export interface ExplorationState {
  websiteUrl: string;
  websiteDescription?: string;
  rules?: string;
  exploredPages: ExploredPage[];
  /** Map actionId -> { pageUrl, action } for replay */
  actionById: Record<string, { pageUrl: string; action: DiscoveredAction }>;
}

/** Persisted discovery result: exploration state + agent-designed endpoints */
export interface DiscoveryResult {
  exploration: ExplorationState;
  endpoints: EndpointDefinition[];
  discoveredAt: string;
}

/** Per-step feedback to the agent after a browser tool call */
export interface BrowserFeedback {
  success: boolean;
  currentUrl?: string;
  currentTitle?: string;
  lastMethod?: string;
  resultSummary: string;
  error?: string;
  /** Last N history entries for context */
  historyTail?: { method: string; timestamp: string; success: boolean }[];
}

// ─── Flow & Session types ──────────────────────────────────────────

/** Tracks the browser page state at any given point */
export interface PageState {
  url: string;
  title?: string;
}

/** An active flow: a chain of endpoint calls sharing one browser session */
export interface FlowState {
  flowId: string;
  userId: string;
  domain: string;
  /** Browserbase persistent context ID for this user+domain */
  contextId: string;
  /** Current page the browser is on */
  currentPage: PageState;
  /** Which endpoints have been completed in this flow */
  completedEndpoints: string[];
  /** State tokens provided by completed endpoints (e.g. "cart_state") */
  providedState: string[];
  /** Extracted data from each endpoint, keyed by endpoint name */
  extractedData: Record<string, unknown>;
  /** Timestamp of last activity (ms) */
  lastActivity: number;
  /** Timestamp of creation (ms) */
  createdAt: number;
}

/** Result from running an endpoint */
export interface EndpointRunResult {
  success: boolean;
  endpointName: string;
  flowId: string;
  currentPage: PageState;
  /** Data extracted by extract steps (if any) */
  extractedData?: unknown;
  stepsExecuted: number;
  totalSteps: number;
  error?: string;
}

/** Persisted context mapping: (userId+domain) → Browserbase context ID */
export interface ContextMap {
  [userDomainKey: string]: string;
}
