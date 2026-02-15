/**
 * CLI: Run MCP discovery agent. Agent uses Browserbase to explore a site and design MCP endpoints.
 *
 * Usage: npm run discover -- <website_url> [description] [--rules "optional rules"]
 */

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import { API_KEYS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// Ensure Browserbase keys are set
if (!process.env.BROWSERBASE_API_KEY) process.env.BROWSERBASE_API_KEY = API_KEYS.BROWSERBASE_API_KEY;
if (!process.env.BROWSERBASE_PROJECT_ID) process.env.BROWSERBASE_PROJECT_ID = API_KEYS.BROWSERBASE_PROJECT_ID;

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

    await browser.goto(url);

    const { endpoints, turnCount, done } = await runOrchestrator({
      browser,
      websiteUrl: url,
      websiteDescription: description,
      rules,
      maxTurns: 8,
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
