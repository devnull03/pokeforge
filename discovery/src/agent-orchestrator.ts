/**
 * Orchestrator agent: Claude with browser tools. Explores site via BrowserRunner,
 * then submits MCP endpoint definitions (name, description, steps).
 *
 * IMPORTANT: Each browser tool call (observe, extract, act) uses LLM inference
 * which spawns workers. To avoid EMFILE on Node 20, we keep total browser calls
 * low (~3-4) by making the agent efficient.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BrowserRunner } from "./browser-runner.js";
import type { EndpointDefinition, EndpointStep } from "./types.js";
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
      "Find key interactable elements on the current page: primary navigation, search, forms, important buttons, and main content links. Returns action ids (e.g. p0-a0) you can reference in endpoint steps. Skips repetitive items (individual tags, individual list items) and footer/external links.",
    input_schema: {
      type: "object" as const,
      properties: {
        instruction: {
          type: "string",
          description: "What to look for. Default focuses on primary navigation, search, forms, and key buttons.",
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
        instruction: { type: "string", description: "What to extract, e.g. 'the page structure: what sections exist, what data is shown, what can a user do here'" },
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
          description: "Action id from observe (e.g. p0-a0) or natural language (e.g. 'click the Login button')",
        },
      },
      required: ["instruction_or_action_id"],
    },
  },
  {
    name: "submit_mcp_endpoints",
    description:
      "Submit your MCP endpoint definitions. Call this as soon as you understand the site's main features. Each endpoint = name + description + ordered steps (navigate/act/act_instruction/extract).",
    input_schema: {
      type: "object" as const,
      properties: {
        endpoints: {
          type: "array",
          description: "3-5 MCP endpoint definitions",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "snake_case name, e.g. get_quotes" },
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
      return {
        name: String(rec.name ?? "").replace(/\s+/g, "_"),
        description: String(rec.description ?? ""),
        steps,
      };
    });
}

export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const { browser, websiteUrl, websiteDescription, rules, maxTurns = 8 } = options;
  const apiKey = getAnthropicApiKey();
  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are an MCP endpoint designer. Given a website, you explore it and design reusable MCP endpoints.

## How it works
- You have browser tools to navigate and inspect the site.
- Every tool result tells you "Current page: <url> | <title>" so you know where you are.
- After inspecting, call submit_mcp_endpoints with 3-5 endpoints.

## Be efficient
- Browser calls are expensive. Use as few as possible.
- Typical flow: browser_goto → browser_observe (once, on the main page) → submit_mcp_endpoints.
- If the site has distinct sections (e.g. a login page), you may goto one more page and observe it. But 2 observes total should be enough for most sites.
- Do NOT observe every page. One good observe tells you what the site offers.

## What to observe
- Primary navigation (top menu, sidebar nav)
- Search forms, login forms, key action buttons
- Main content structure (what data is on the page)
- Do NOT list every individual item (e.g. not every tag link, not every product — just note "there are tag links" or "there is a product grid")

## What makes a good MCP endpoint
- Extracting data: "get quotes from homepage", "get products by search query"
- Performing actions: "login with credentials", "filter by category"
- Navigating flows: "search → view result → extract details"
- Each endpoint has steps: navigate → act/act_instruction → extract
- Use actionId from observe for buttons/links you saw; use act_instruction for parameterized actions (e.g. "type {query} in search box")

## What to skip
- Footer links, external links, decorative elements
- Duplicate actions (don't make separate endpoints for each tag if they all work the same way — make one "get_quotes_by_tag" endpoint)
${rules ? `\nUser rules: ${rules}` : ""}`;

  const userContent = `Website: ${websiteUrl}
${websiteDescription ? `Description: ${websiteDescription}` : ""}

Explore this site efficiently:
1. Navigate to the URL
2. Observe the main page to understand its structure and key features
3. Submit 3-5 MCP endpoints for the most useful features

Each endpoint should be reusable (with act_instruction for parameterized inputs like search queries, tag names, etc).`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  let endpoints: EndpointDefinition[] = [];
  let turnCount = 0;
  let done = false;
  let browserCallCount = 0;

  while (turnCount < maxTurns) {
    turnCount++;

    // If agent hasn't submitted after several browser calls, force it
    const forceSubmit = browserCallCount >= 4;
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
          // Use a focused default instruction that skips noise
          const instruction = input.instruction
            ? String(input.instruction)
            : "Find the primary navigation links, search/filter forms, login/signup forms, key action buttons, and main content structure. Skip individual list items, individual tags, footer links, and external links. Focus on what makes this site useful as an API.";
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
