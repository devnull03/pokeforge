/**
 * Discovery module: explores a website and identifies MCP endpoints.
 * Clean async function — no CLI code.
 */

import Anthropic from "@anthropic-ai/sdk";
import { BrowserRunner } from "./browser.js";
import { runOrchestrator } from "./orchestrator.js";
import { saveDiscovery } from "./store.js";
import { API_KEYS } from "./config.js";
import type { DiscoveryResult } from "./types.js";

async function planTools(siteExtract: string, websiteUrl: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: API_KEYS.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are analyzing a website to plan what MCP (Model Context Protocol) tools should be built for it.

Website: ${websiteUrl}

Here is what was extracted from the homepage:
${siteExtract}

Based on this:
1. What TYPE of website is this? (e-commerce, social media, news, SaaS tool, wiki, forum, etc.)
2. List ALL useful MCP tools that could be built. Think broadly — what would an AI agent want to do on this site? Consider:
   - Search/query tools (searching products, articles, users, etc.)
   - Data extraction tools (getting details, listings, stats)
   - Action tools (login, add to cart, submit forms, follow users)
   - Navigation tools (browse categories, pagination, filters)
   - Monitoring tools (track prices, check status, get notifications)

Be specific to THIS site. For example, if it's Amazon, don't just say "search" — say "search_products", "get_product_details", "get_reviews", "add_to_cart", "get_deals", "track_price", "get_best_sellers_by_category", etc.

Return a numbered list of tool names with one-line descriptions. Aim for 8-15 tools. Be ambitious — think of everything an AI agent would find useful.`,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export interface DiscoveryOutput {
  discovery: DiscoveryResult;
  endpointCount: number;
  turnCount: number;
  savedPath: string;
}

/**
 * Run the full discovery pipeline on a website.
 * Returns the discovery result with all identified endpoints.
 */
export async function discoverWebsite(
  url: string,
  maxTurns: number = 15
): Promise<DiscoveryOutput> {
  const browser = new BrowserRunner({ websiteUrl: url });
  try {
    await browser.init();

    // Step 1: Navigate and extract homepage
    await browser.goto(url);
    const homepageFb = await browser.extract(
      "Describe this website fully: what type of site is it, what are the main sections, navigation items, features, forms, buttons, and what can a user do here? Be thorough."
    );
    const siteExtract = homepageFb.resultSummary || JSON.stringify(homepageFb);

    // Step 2: Plan tools based on what we see
    const toolPlan = await planTools(siteExtract, url);

    // Step 3: Explore with the plan
    const { endpoints, turnCount, done } = await runOrchestrator({
      browser,
      websiteUrl: url,
      maxTurns,
      toolPlan,
    });

    const exploration = browser.getExplorationState();
    const result: DiscoveryResult = {
      exploration,
      endpoints,
      discoveredAt: new Date().toISOString(),
    };

    const savedPath = await saveDiscovery(result);

    return {
      discovery: result,
      endpointCount: endpoints.length,
      turnCount,
      savedPath,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
