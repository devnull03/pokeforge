/**
 * Orchestrator agent: Claude with browser tools. Explores site via BrowserRunner,
 * then submits MCP endpoint definitions.
 * Ported from my-stagehand-app/src/agent-orchestrator.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BrowserRunner } from "./browser.js";
import type { EndpointDefinition, EndpointStep, EndpointMetadata } from "./types.js";
import { API_KEYS } from "./config.js";

function getAnthropicApiKey(): string {
  const raw = process.env.ANTHROPIC_API_KEY;
  const fromEnv = typeof raw === "string" ? raw.trim() : "";
  if (fromEnv && fromEnv.startsWith("sk-ant-")) return fromEnv;
  return API_KEYS.ANTHROPIC_API_KEY;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "browser_goto",
    description: "Navigate the browser to a URL.",
    input_schema: {
      type: "object" as const,
      properties: { url: { type: "string", description: "Full URL to navigate to" } },
      required: ["url"],
    },
  },
  {
    name: "browser_observe",
    description:
      "Find key interactable elements on the current page: primary navigation, search, forms, important buttons, and main content links. Returns action ids (e.g. p0-a0) you can reference in endpoint steps.",
    input_schema: {
      type: "object" as const,
      properties: {
        instruction: {
          type: "string",
          description: "What to look for.",
        },
      },
      required: [],
    },
  },
  {
    name: "browser_extract",
    description: "Extract structured data from the current page.",
    input_schema: {
      type: "object" as const,
      properties: {
        instruction: { type: "string", description: "What to extract" },
      },
      required: ["instruction"],
    },
  },
  {
    name: "browser_act",
    description: "Click a button, fill a form, or perform an action by id or natural language.",
    input_schema: {
      type: "object" as const,
      properties: {
        instruction_or_action_id: {
          type: "string",
          description: "Action id from observe (e.g. p0-a0) or natural language instruction",
        },
      },
      required: ["instruction_or_action_id"],
    },
  },
  {
    name: "submit_mcp_endpoints",
    description:
      "Submit your MCP endpoint definitions. Call this when you've explored enough to define the planned tools.",
    input_schema: {
      type: "object" as const,
      properties: {
        endpoints: {
          type: "array",
          description: "MCP endpoint definitions (aim for 5-15 based on the tool plan)",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "snake_case name" },
              description: { type: "string", description: "What this endpoint does" },
              steps: {
                type: "array",
                description: "Ordered steps",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["navigate", "act", "act_instruction", "extract"] },
                    url: { type: "string", description: "For navigate" },
                    actionId: { type: "string", description: "For act: id from observe" },
                    instruction: { type: "string", description: "For act_instruction or extract" },
                  },
                  required: ["type"],
                },
              },
              metadata: {
                type: "object",
                description: "Dependency and execution info",
                properties: {
                  dependsOn: { type: "array", items: { type: "string" } },
                  provides: { type: "array", items: { type: "string" } },
                  requiresAuth: { type: "boolean" },
                },
              },
            },
            required: ["name", "description", "steps"],
          },
        },
      },
      required: ["endpoints"],
    },
  },
];

export interface OrchestratorOptions {
  browser: BrowserRunner;
  websiteUrl: string;
  websiteDescription?: string;
  rules?: string;
  toolPlan?: string;
  maxTurns?: number;
}

export interface OrchestratorResult {
  endpoints: EndpointDefinition[];
  turnCount: number;
  done: boolean;
}

function formatBrowserResult(fb: { currentUrl?: string; currentTitle?: string }): string {
  const url = fb.currentUrl ?? "(unknown)";
  const title = fb.currentTitle ?? "";
  return `Current page: ${url}${title ? ` | ${title}` : ""}\n${JSON.stringify(fb)}`;
}

function parseEndpointsFromInput(input: unknown): EndpointDefinition[] {
  const obj = input as { endpoints?: unknown[] };
  if (!Array.isArray(obj?.endpoints)) return [];
  return obj.endpoints
    .filter((e: unknown) => e && typeof e === "object" && "name" in e && "description" in e && "steps" in e)
    .map((e: unknown) => {
      const rec = e as Record<string, unknown>;
      const steps: EndpointStep[] = (Array.isArray(rec.steps) ? rec.steps : []).map((s: unknown) => {
        const step = s as Record<string, unknown>;
        const type = String(step.type || "");
        if (type === "navigate" && typeof step.url === "string")
          return { type: "navigate" as const, url: step.url };
        if (type === "act" && typeof step.actionId === "string")
          return { type: "act" as const, actionId: step.actionId };
        if ((type === "act_instruction" || type === "act") && typeof step.instruction === "string")
          return { type: "act_instruction" as const, instruction: step.instruction };
        if (type === "extract" && typeof step.instruction === "string")
          return { type: "extract" as const, instruction: step.instruction };
        return { type: "navigate" as const, url: "" };
      });
      const rawMeta = rec.metadata as Record<string, unknown> | undefined;
      const metadata: EndpointMetadata | undefined = rawMeta
        ? {
            dependsOn: Array.isArray(rawMeta.dependsOn) ? (rawMeta.dependsOn as string[]) : undefined,
            provides: Array.isArray(rawMeta.provides) ? (rawMeta.provides as string[]) : undefined,
            requiresAuth: typeof rawMeta.requiresAuth === "boolean" ? rawMeta.requiresAuth : undefined,
            mode: rawMeta.mode === "dynamic" ? "dynamic" : "static",
          }
        : undefined;

      return {
        name: String(rec.name ?? "").replace(/\s+/g, "_"),
        description: String(rec.description ?? ""),
        steps,
        metadata,
      };
    });
}

export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { browser, websiteUrl, websiteDescription, rules, toolPlan, maxTurns = 15 } = options;
  const apiKey = getAnthropicApiKey();
  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are an MCP endpoint designer. You have already analyzed the website's homepage and have a plan of what tools to build. Now you explore the site to validate and refine those tools into concrete endpoint definitions.

## How it works
- You have browser tools to navigate and inspect the site.
- Every tool result tells you "Current page: <url> | <title>" so you know where you are.
- You already have a tool plan from analyzing the homepage. Your job is to explore the site to figure out the exact steps needed for each planned tool.
- When ready, call submit_mcp_endpoints with your endpoint definitions.

## Exploration strategy
- You're already on the homepage. Start by observing it to understand the UI elements.
- Then navigate to key sections (categories, search results, account pages, etc.) to understand how they work.
- For each planned tool, figure out the exact sequence: what URL to go to, what to click, what to type, what to extract.
- Use browser_observe to find interactable elements, browser_act to test interactions, browser_goto to visit different pages.

## What makes a good MCP endpoint
- Each endpoint = a reusable sequence of steps an AI can replay later
- Step types: navigate (go to URL), act_instruction (click/type with natural language — use {param} placeholders for dynamic inputs), extract (pull structured data)
- Use {param_name} placeholders for any dynamic input: {query}, {category}, {username}, {product_url}, etc.
- Example: search_products → navigate to site → act_instruction "type {query} in search box and press enter" → extract "product listings with title, price, rating, url"

## Endpoint metadata (important!)
For each endpoint, include metadata:
- dependsOn: list endpoint names this depends on (e.g. checkout depends on add_to_cart)
- provides: state tokens this provides (e.g. "cart_state", "logged_in", "search_results")
- requiresAuth: true if the user must be signed in

## What to skip
- Footer links, external links, decorative elements
- Duplicate endpoints (one parameterized endpoint > many specific ones)
- Endpoints that require complex multi-page state unless absolutely necessary
${rules ? `\nUser rules: ${rules}` : ""}`;

  const userContent = `Website: ${websiteUrl}
${websiteDescription ? `Description: ${websiteDescription}` : ""}
${toolPlan ? `\n## Tool Plan (from homepage analysis)\n${toolPlan}\n` : ""}
You are already on the homepage. Explore the site and build endpoint definitions for as many of the planned tools as possible.

For each endpoint, define the exact steps (navigate → act_instruction → extract) with {param} placeholders for dynamic inputs.

Submit your endpoints when you have covered the most important tools from the plan.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  let endpoints: EndpointDefinition[] = [];
  let turnCount = 0;
  let done = false;
  let browserCallCount = 0;

  while (turnCount < maxTurns) {
    turnCount++;

    const forceSubmit = browserCallCount >= 10;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: forceSubmit
        ? systemPrompt + "\n\nIMPORTANT: You have used enough browser calls. Call submit_mcp_endpoints NOW with the endpoints you can design from what you've seen."
        : systemPrompt,
      messages,
      tools: TOOLS,
      tool_choice: forceSubmit ? { type: "tool", name: "submit_mcp_endpoints" } : { type: "auto" },
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      messages.push({ role: "assistant", content: response.content });
      done = true;
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const name = block.name;
      const input = block.input as Record<string, unknown>;
      let result: string;

      try {
        if (name === "browser_goto") {
          browserCallCount++;
          const fb = await browser.goto(String(input.url ?? ""));
          result = formatBrowserResult(fb);
        } else if (name === "browser_observe") {
          browserCallCount++;
          const instruction = input.instruction
            ? String(input.instruction)
            : "Find the primary navigation links, search/filter forms, login/signup forms, key action buttons, and main content structure. Skip individual list items, individual tags, footer links, and external links.";
          const fb = await browser.observe(instruction);
          result = formatBrowserResult(fb);
        } else if (name === "browser_extract") {
          browserCallCount++;
          const fb = await browser.extract(String(input.instruction ?? ""));
          result = formatBrowserResult(fb);
        } else if (name === "browser_act") {
          browserCallCount++;
          const fb = await browser.act(String(input.instruction_or_action_id ?? ""));
          result = formatBrowserResult(fb);
        } else if (name === "submit_mcp_endpoints") {
          endpoints = parseEndpointsFromInput(input);
          result = JSON.stringify({ success: true, count: endpoints.length });
          done = true;
        } else {
          result = JSON.stringify({ error: "Unknown tool" });
        }
      } catch (e) {
        result = JSON.stringify({ success: false, error: (e as Error).message });
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });
    if (done) break;
  }

  return { endpoints, turnCount, done };
}
