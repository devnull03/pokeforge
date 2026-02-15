/**
 * Shared types for MCP Factory.
 */

// ─── Discovery types ───────────────────────────────────────────────

export interface DiscoveredAction {
  id: string;
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface ExploredPage {
  url: string;
  title?: string;
  actions: DiscoveredAction[];
}

// ─── Endpoint types ────────────────────────────────────────────────

export type EndpointStep =
  | { type: "navigate"; url: string }
  | { type: "act"; actionId: string }
  | { type: "act_instruction"; instruction: string }
  | { type: "extract"; instruction: string; outputSchema?: Record<string, unknown> };

export interface EndpointMetadata {
  dependsOn?: string[];
  provides?: string[];
  requiresAuth?: boolean;
  mode?: "static" | "dynamic";
}

export interface EndpointDefinition {
  name: string;
  description: string;
  steps: EndpointStep[];
  metadata?: EndpointMetadata;
}

export interface ExplorationState {
  websiteUrl: string;
  websiteDescription?: string;
  rules?: string;
  exploredPages: ExploredPage[];
  actionById: Record<string, { pageUrl: string; action: DiscoveredAction }>;
}

export interface DiscoveryResult {
  exploration: ExplorationState;
  endpoints: EndpointDefinition[];
  discoveredAt: string;
}

export interface BrowserFeedback {
  success: boolean;
  currentUrl?: string;
  currentTitle?: string;
  lastMethod?: string;
  resultSummary: string;
  error?: string;
  historyTail?: { method: string; timestamp: string; success: boolean }[];
}
