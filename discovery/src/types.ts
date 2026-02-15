/**
 * Shared types for MCP discovery agent: exploration state, endpoints, replay.
 */

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

/** One step in an MCP endpoint: either navigate, act (by id or instruction), or extract */
export type EndpointStep =
  | { type: "navigate"; url: string }
  | { type: "act"; actionId: string }
  | { type: "act_instruction"; instruction: string }
  | { type: "extract"; instruction: string; outputSchema?: Record<string, unknown> };

/** One MCP endpoint: name, description, ordered steps */
export interface EndpointDefinition {
  name: string;
  description: string;
  steps: EndpointStep[];
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
