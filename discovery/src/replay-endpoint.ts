/**
 * Replay one MCP endpoint with parameters.
 * Usage: npm run replay -- <website_url> <endpoint_name> [key=value ...]
 *
 * Example: npm run replay -- https://quotes.toscrape.com get_quotes_by_tag tag_name=humor
 *
 * Parameters are substituted into step instructions: {tag_name} becomes "humor".
 */

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import { API_KEYS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

if (!process.env.BROWSERBASE_API_KEY) process.env.BROWSERBASE_API_KEY = API_KEYS.BROWSERBASE_API_KEY;
if (!process.env.BROWSERBASE_PROJECT_ID) process.env.BROWSERBASE_PROJECT_ID = API_KEYS.BROWSERBASE_PROJECT_ID;

import { loadDiscovery } from "./store.js";
import { BrowserRunner } from "./browser-runner.js";
import type { EndpointStep } from "./types.js";

/** Parse key=value args into a params object */
function parseParams(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq > 0) {
      params[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
  }
  return params;
}

/** Replace {param_name} placeholders in a string with actual values */
function substituteParams(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in params) return params[key];
    return match; // leave unreplaced if param not provided
  });
}

async function main() {
  const args = process.argv.slice(2);
  const websiteUrl = args.find((a) => a.startsWith("http"));
  const endpointName = args.find((a) => !a.startsWith("http") && !a.includes("="));
  const params = parseParams(args.filter((a) => a.includes("=")));

  if (!websiteUrl || !endpointName) {
    console.error("Usage: npm run replay -- <website_url> <endpoint_name> [key=value ...]");
    console.error("Example: npm run replay -- https://quotes.toscrape.com get_quotes_by_tag tag_name=humor");
    process.exit(1);
  }

  const discovery = await loadDiscovery(websiteUrl);
  if (!discovery) {
    console.error("No discovery found for", websiteUrl, "- run discover first.");
    process.exit(1);
  }

  const endpoint = discovery.endpoints.find(
    (e) => e.name.toLowerCase() === endpointName.toLowerCase()
  );
  if (!endpoint) {
    console.error("Endpoint not found:", endpointName);
    console.error("Available:", discovery.endpoints.map((e) => e.name).join(", "));
    process.exit(1);
  }

  // Show what we're doing
  console.log(`\nEndpoint: ${endpoint.name} — ${endpoint.description}`);
  if (Object.keys(params).length > 0) {
    console.log("Params:", params);
  }

  // Check for unresolved placeholders
  const allText = endpoint.steps
    .map((s: Record<string, unknown>) => String(s.instruction ?? s.url ?? ""))
    .join(" ");
  const placeholders = [...allText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const missing = placeholders.filter((p) => !(p in params));
  if (missing.length > 0) {
    console.warn(`\nWARNING: Missing params: ${missing.join(", ")}`);
    console.warn(`Pass them as: ${missing.map((p) => `${p}=value`).join(" ")}\n`);
  }

  const browser = new BrowserRunner({ websiteUrl });
  try {
    await browser.init();
    browser.seedActionById(discovery.exploration.actionById);
    console.log("Browserbase session started\n");

    for (let i = 0; i < endpoint.steps.length; i++) {
      const step = endpoint.steps[i] as EndpointStep;

      if (step.type === "navigate") {
        const url = substituteParams(step.url, params);
        console.log(`  Step ${i + 1}/${endpoint.steps.length}: navigate → ${url}`);
        const fb = await browser.goto(url);
        if (!fb.success) throw new Error(fb.error || "Navigate failed");
        console.log(`    OK: ${fb.currentUrl}`);
      } else if (step.type === "act") {
        const resolved = discovery.exploration.actionById[step.actionId];
        if (!resolved) throw new Error("Unknown action id: " + step.actionId);
        console.log(`  Step ${i + 1}/${endpoint.steps.length}: act → ${resolved.action.description}`);
        const fb = await browser.act(step.actionId);
        if (!fb.success) throw new Error(fb.error || "Act failed");
        console.log(`    OK: ${fb.currentUrl}`);
      } else if (step.type === "act_instruction") {
        const instruction = substituteParams(step.instruction, params);
        console.log(`  Step ${i + 1}/${endpoint.steps.length}: act → "${instruction}"`);
        const fb = await browser.act(instruction);
        if (!fb.success) throw new Error(fb.error || "Act failed");
        console.log(`    OK: ${fb.currentUrl}`);
      } else if (step.type === "extract") {
        const instruction = substituteParams(step.instruction, params);
        console.log(`  Step ${i + 1}/${endpoint.steps.length}: extract → "${instruction}"`);
        const fb = await browser.extract(instruction);
        if (!fb.success) throw new Error(fb.error || "Extract failed");
        console.log(`\n--- Result ---`);
        console.log(fb.resultSummary);
        console.log(`--- End ---\n`);
      }
    }

    console.log("Replay completed successfully.");
  } finally {
    try {
      await browser.close();
      console.log("Browser session closed.");
    } catch (e) {
      console.warn("Browser close warning:", (e as Error).message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
