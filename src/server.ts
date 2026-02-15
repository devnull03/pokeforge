/**
 * MCP Factory — Meta-MCP Server
 *
 * A FastMCP server that discovers websites, generates MCP servers,
 * deploys them to Modal, and replays browser actions.
 *
 * Usage:
 *   npx tsx src/server.ts          # stdio (for MCP Inspector / Claude Desktop)
 *   npx tsx src/server.ts --http   # HTTP on port 8080
 */

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { discoverWebsite } from "./discovery.js";
import { generateServer } from "./generate.js";
import { deployToModal } from "./deploy.js";
import { replayActions } from "./replay.js";

function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/\./g, "_"); } catch { return "unknown"; }
}

const server = new FastMCP({
  name: "MCP Factory",
  version: "1.0.0",
});

// ─── Tool 1: Discover ────────────────────────────────────────────

server.addTool({
  name: "discover",
  description:
    "Explore a website using an AI agent to discover what MCP tools/endpoints can be built for it. " +
    "Launches a Browserbase session and takes 1-5 minutes depending on site complexity.",
  parameters: z.object({
    url: z.string().describe("Full URL of the website to explore (e.g. https://www.amazon.com)"),
    turns: z.number().optional().describe("Max exploration turns (default: 15). Use fewer for simple sites."),
  }),
  execute: async (args, { log, reportProgress }) => {
    await log.info("Starting discovery for " + args.url);
    // Keepalive: send progress every 15s so the connection doesn't drop
    let step = 0;
    const keepalive = setInterval(async () => {
      step++;
      try { await reportProgress({ progress: step, total: 100 }); } catch {}
    }, 15_000);
    try {
      const result = await discoverWebsite(args.url, args.turns ?? 15);
      const endpointList = result.discovery.endpoints
        .map((e, i) => `  ${i + 1}. ${e.name}: ${e.description}`)
        .join("\n");
      return (
        `Discovery complete for ${args.url}\n\n` +
        `Endpoints found: ${result.endpointCount}\n` +
        `Turns used: ${result.turnCount}\n` +
        `Saved to: ${result.savedPath}\n\n` +
        `Endpoints:\n${endpointList}`
      );
    } finally {
      clearInterval(keepalive);
    }
  },
});

// ─── Tool 2: Generate ────────────────────────────────────────────

server.addTool({
  name: "generate",
  description:
    "Generate a deployable Python MCP server from a previously discovered website. " +
    "Creates server.py, deploy_modal.py, and all project files. Run 'discover' first.",
  parameters: z.object({
    url: z.string().describe("URL of the previously discovered website"),
  }),
  execute: async (args, { log, reportProgress }) => {
    await log.info("Generating MCP server for " + args.url);
    let step = 0;
    const keepalive = setInterval(async () => {
      step++;
      try { await reportProgress({ progress: step, total: 100 }); } catch {}
    }, 15_000);
    try {
      const result = await generateServer(args.url);
      return (
        `Generated MCP server at ${result.outputDir}\n\n` +
        `Tools created (${result.toolNames.length}):\n` +
        result.toolNames.map((t, i) => `  ${i + 1}. ${t}`).join("\n") +
        `\n\nTo deploy, call the 'deploy' tool with the same URL.`
      );
    } finally {
      clearInterval(keepalive);
    }
  },
});

// ─── Tool 3: Deploy ──────────────────────────────────────────────

server.addTool({
  name: "deploy",
  description:
    "Deploy a previously generated MCP server to Modal. Returns the live URL for connecting MCP clients. " +
    "Run 'generate' first.",
  parameters: z.object({
    url: z.string().describe("URL of the website whose generated server to deploy"),
  }),
  execute: async (args) => {
    const domain = domainFromUrl(args.url);
    const serverDir = path.resolve(__dirname, "..", "generated-servers", domain);
    const result = await deployToModal(serverDir);
    return (
      `Deployed to Modal!\n\n` +
      `MCP Endpoint: ${result.mcpEndpoint}\n` +
      `Transport: Streamable HTTP\n\n` +
      `Connect using MCP Inspector or Claude Desktop with the URL above.`
    );
  },
});

// ─── Tool 4: Replay ─────────────────────────────────────────────

server.addTool({
  name: "replay",
  description:
    "Replay a discovered endpoint's browser actions to test it. " +
    "Launches a new Browserbase session and executes the endpoint steps.",
  parameters: z.object({
    url: z.string().describe("URL of the discovered website"),
    endpoint_name: z.string().describe("Name of the endpoint to replay (from discovery)"),
    params_json: z.string().optional().describe("Optional JSON object of parameters to substitute into endpoint steps, e.g. '{\"query\": \"laptop\"}'"),
  }),
  execute: async (args) => {
    const params = args.params_json ? JSON.parse(args.params_json) as Record<string, string> : undefined;
    const result = await replayActions(args.url, args.endpoint_name, params);
    if (result.success) {
      let msg = `Replay successful: ${result.endpointName}\nSteps: ${result.stepsExecuted}/${result.totalSteps}`;
      if (result.extractedData) msg += `\n\nExtracted data:\n${result.extractedData}`;
      return msg;
    } else {
      return (
        `Replay failed: ${result.endpointName}\n` +
        `Steps completed: ${result.stepsExecuted}/${result.totalSteps}\n` +
        `Error: ${result.error}`
      );
    }
  },
});

// ─── Tool 5: Full Pipeline ──────────────────────────────────────

server.addTool({
  name: "full_pipeline",
  description:
    "End-to-end pipeline: discover a website, generate an MCP server, and deploy it to Modal. " +
    "Returns the live URL. Takes 2-10 minutes total.",
  parameters: z.object({
    url: z.string().describe("Full URL of the website (e.g. https://www.amazon.com)"),
    turns: z.number().optional().describe("Max exploration turns for discovery (default: 15)"),
  }),
  execute: async (args, { log, reportProgress }) => {
    let step = 0;
    const keepalive = setInterval(async () => {
      step++;
      try { await reportProgress({ progress: step, total: 100 }); } catch {}
    }, 15_000);
    try {
      // Step 1: Discover
      await log.info("Step 1/3: Discovering " + args.url);
      const discoverResult = await discoverWebsite(args.url, args.turns ?? 15);

      // Step 2: Generate
      await log.info("Step 2/3: Generating MCP server");
      const generateResult = await generateServer(args.url);

      // Step 3: Deploy
      await log.info("Step 3/3: Deploying to Modal");
      const domain = domainFromUrl(args.url);
      const serverDir = path.resolve(__dirname, "..", "generated-servers", domain);
      const deployResult = await deployToModal(serverDir);

      const toolList = generateResult.toolNames
        .map((t, i) => `  ${i + 1}. ${t}`)
        .join("\n");

      return (
        `Pipeline complete for ${args.url}\n\n` +
        `Discovery: ${discoverResult.endpointCount} endpoints found (${discoverResult.turnCount} turns)\n` +
        `Generated: ${generateResult.toolNames.length} tools\n` +
        `Deployed: ${deployResult.mcpEndpoint}\n\n` +
        `Tools:\n${toolList}\n\n` +
        `Connect using Streamable HTTP transport at the URL above.`
      );
    } finally {
      clearInterval(keepalive);
    }
  },
});

// ─── Start ───────────────────────────────────────────────────────

const transportType = process.argv.includes("--http") ? "httpStream" : "stdio";

if (transportType === "httpStream") {
  const port = parseInt(process.env.PORT || "8080", 10);
  server.start({
    transportType: "httpStream",
    httpStream: { port, host: "0.0.0.0", stateless: true },
  });
  console.error(`MCP Factory running on http://0.0.0.0:${port}`);
} else {
  server.start({ transportType: "stdio" });
}
