/**
 * CLI: Run MCP discovery agent. Agent uses Browserbase to explore a site and design MCP endpoints.
 *
 * Usage: npm run discover -- <website_url> [description] [--rules "optional rules"]
 */

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { API_KEYS } from "./config.js";

import Anthropic from "@anthropic-ai/sdk";
import { BrowserRunner } from "./browser-runner.js";
import { runOrchestrator } from "./agent-orchestrator.js";
import { saveDiscovery } from "./store.js";
import type { DiscoveryResult } from "./types.js";

function isSet(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.length > 0 && !v.startsWith("YOUR_");
}

function logKeysLoaded(): void {
  console.log("API keys:");
  console.log(`  BROWSERBASE_API_KEY: ${isSet("BROWSERBASE_API_KEY") ? "OK" : "MISSING"}`);
  console.log(`  BROWSERBASE_PROJECT_ID: ${isSet("BROWSERBASE_PROJECT_ID") ? "OK" : "MISSING"}`);
  const anthropicOk = isSet("ANTHROPIC_API_KEY") && process.env.ANTHROPIC_API_KEY!.trim().startsWith("sk-ant-");
  console.log(`  ANTHROPIC_API_KEY: ${anthropicOk ? "OK (env)" : "OK (fallback)"}`);
}

function parseArgs(): { url: string; description?: string; rules?: string } {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith("http"));
  if (!url) {
    console.error("Usage: npm run discover -- <website_url> [description] [--rules \"...\"]");
    process.exit(1);
  }
  const rulesIdx = args.indexOf("--rules");
  const rules = rulesIdx >= 0 && args[rulesIdx + 1] ? args[rulesIdx + 1] : undefined;
  const rest = args.filter((a) => a !== url && a !== "--rules" && (rulesIdx < 0 || a !== args[rulesIdx + 1]));
  const description = rest.length ? rest.join(" ") : undefined;
  return { url, description, rules };
}

async function planTools(siteExtract: string, websiteUrl: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: API_KEYS.ANTHROPIC_API_KEY });
  console.log("\nPlanning: analyzing site and brainstorming MCP tools...");

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

  const plan = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log("\n--- Tool Plan ---");
  console.log(plan);
  console.log("--- End Plan ---\n");

  return plan;
}

async function main() {
  console.log("MCP Discovery Agent — starting...\n");

  // Node 20.0.0 + tsx leaks file descriptors. Recommend upgrading.
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major === 20 && minor < 17) {
    console.warn("WARNING: Node " + process.versions.node + " has known file descriptor issues with tsx.");
    console.warn("If you hit EMFILE errors, upgrade Node: nvm install 22 && nvm use 22\n");
  }

  logKeysLoaded();

  const { url, description, rules } = parseArgs();
  console.log(`\nWebsite: ${url}`);
  if (description) console.log(`Description: ${description}`);
  if (rules) console.log(`Rules: ${rules}`);

  const browser = new BrowserRunner({ websiteUrl: url });
  try {
    await browser.init();
    console.log("Browserbase session started");
    const sessionUrl = browser.getSessionUrl();
    if (sessionUrl) console.log(`Watch live: ${sessionUrl}`);

    // Step 1: Navigate and extract the homepage
    await browser.goto(url);
    console.log("Extracting homepage structure...");
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
      websiteDescription: description,
      rules,
      toolPlan,
      maxTurns: 15,
    });

    const exploration = browser.getExplorationState(description, rules);
    const result: DiscoveryResult = {
      exploration,
      endpoints,
      discoveredAt: new Date().toISOString(),
    };
    const outPath = await saveDiscovery(result);
    console.log(`\nSaved discovery to ${outPath}`);
    console.log(`Turns: ${turnCount}, Done: ${done}`);
    console.log(`Endpoints: ${endpoints.length}`);
    endpoints.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.name}: ${e.description} (${e.steps.length} steps)`);
    });
  } finally {
    try {
      await browser.close();
      console.log("Browser session closed.");
    } catch (e) {
      console.warn("Browser close warning:", (e as Error).message);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
