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

type ProgressReporter = (update: { progress: number; total: number }) => Promise<void>;
type PipelineStage = "queued" | "discovering" | "generating" | "deploying" | "completed" | "failed";

interface PipelineJob {
  id: string;
  url: string;
  turns: number;
  stage: PipelineStage;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  result?: {
    endpointCount: number;
    turnCount: number;
    generatedToolCount: number;
    generatedTools: string[];
    deployUrl: string;
  };
}

const pipelineJobs = new Map<string, PipelineJob>();

function createJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stageMessage(stage: PipelineStage): string {
  switch (stage) {
    case "queued":
      return "Job is queued and will start shortly.";
    case "discovering":
      return "Running discovery on the target website.";
    case "generating":
      return "Generating MCP server code from discovery output.";
    case "deploying":
      return "Deploying generated server to Modal.";
    case "completed":
      return "Pipeline finished successfully.";
    case "failed":
      return "Pipeline failed. Check the error for details.";
  }
}

function formatPipelineResult(url: string, job: PipelineJob): string {
  if (!job.result) {
    return `No result is available for ${url}.`;
  }
  const toolList = job.result.generatedTools
    .map((t, i) => `  ${i + 1}. ${t}`)
    .join("\n");

  return (
    `Pipeline complete for ${url}\n\n` +
    `Discovery: ${job.result.endpointCount} endpoints found (${job.result.turnCount} turns)\n` +
    `Generated: ${job.result.generatedToolCount} tools\n` +
    `Deployed: ${job.result.deployUrl}\n\n` +
    `Tools:\n${toolList}\n\n` +
    `Connect using Streamable HTTP transport at the URL above.`
  );
}

async function runPipelineJob(jobId: string): Promise<void> {
  const job = pipelineJobs.get(jobId);
  if (!job) {
    return;
  }

  try {
    job.stage = "discovering";
    job.progress = 10;
    job.updatedAt = new Date().toISOString();

    const discoverResult = await discoverWebsite(job.url, job.turns);

    job.stage = "generating";
    job.progress = 45;
    job.updatedAt = new Date().toISOString();

    const generateResult = await generateServer(job.url);

    job.stage = "deploying";
    job.progress = 80;
    job.updatedAt = new Date().toISOString();

    const domain = domainFromUrl(job.url);
    const serverDir = path.resolve(__dirname, "..", "generated-servers", domain);
    const deployResult = await deployToModal(serverDir);

    job.stage = "completed";
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.result = {
      endpointCount: discoverResult.endpointCount,
      turnCount: discoverResult.turnCount,
      generatedToolCount: generateResult.toolNames.length,
      generatedTools: generateResult.toolNames,
      deployUrl: deployResult.mcpEndpoint,
    };
  } catch (error) {
    job.stage = "failed";
    job.updatedAt = new Date().toISOString();
    job.error = error instanceof Error ? error.message : String(error);
  }
}

function startProgressKeepalive(
  reportProgress: ProgressReporter,
  options?: { start?: number; cap?: number; intervalMs?: number }
): { set: (next: number) => Promise<void>; stop: () => void } {
  let progress = options?.start ?? 0;
  const cap = options?.cap ?? 99;
  const intervalMs = options?.intervalMs ?? 10_000;

  const send = async () => {
    progress = Math.min(progress + 1, cap);
    try {
      await reportProgress({ progress, total: 100 });
    } catch {
      // Ignore dropped progress channel errors.
    }
  };

  void send();
  const timer = setInterval(() => {
    void send();
  }, intervalMs);

  return {
    set: async (next: number) => {
      progress = Math.min(next, cap);
      try {
        await reportProgress({ progress, total: 100 });
      } catch {
        // Ignore dropped progress channel errors.
      }
    },
    stop: () => clearInterval(timer),
  };
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
    const keepalive = startProgressKeepalive(reportProgress, { start: 2, cap: 95, intervalMs: 10_000 });
    try {
      const result = await discoverWebsite(args.url, args.turns ?? 15);
      if (result.sessionId) {
        await log.info(`Discovery Browserbase session: ${result.sessionId}`);
      } else {
        await log.warn("Discovery Browserbase session ID unavailable");
      }
      await keepalive.set(100);
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
      keepalive.stop();
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
    const keepalive = startProgressKeepalive(reportProgress, { start: 2, cap: 95, intervalMs: 10_000 });
    try {
      const result = await generateServer(args.url);
      await keepalive.set(100);
      return (
        `Generated MCP server at ${result.outputDir}\n\n` +
        `Tools created (${result.toolNames.length}):\n` +
        result.toolNames.map((t, i) => `  ${i + 1}. ${t}`).join("\n") +
        `\n\nTo deploy, call the 'deploy' tool with the same URL.`
      );
    } finally {
      keepalive.stop();
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
  execute: async (args, { log, reportProgress }) => {
    await log.info("Deploying MCP server for " + args.url);
    const keepalive = startProgressKeepalive(reportProgress, { start: 5, cap: 95, intervalMs: 10_000 });
    const domain = domainFromUrl(args.url);
    const serverDir = path.resolve(__dirname, "..", "generated-servers", domain);
    try {
      const result = await deployToModal(serverDir);
      await keepalive.set(100);
      return (
        `Deployed to Modal!\n\n` +
        `MCP Endpoint: ${result.mcpEndpoint}\n` +
        `Transport: Streamable HTTP\n\n` +
        `Connect using MCP Inspector or Claude Desktop with the URL above.`
      );
    } finally {
      keepalive.stop();
    }
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
  execute: async (args, { log, reportProgress }) => {
    await log.info(`Starting replay for ${args.url} / endpoint ${args.endpoint_name}`);
    const keepalive = startProgressKeepalive(reportProgress, { start: 2, cap: 95, intervalMs: 10_000 });
    const params = args.params_json ? JSON.parse(args.params_json) as Record<string, string> : undefined;
    try {
      const result = await replayActions(args.url, args.endpoint_name, params);
      if (result.sessionId) {
        await log.info(`Replay Browserbase session: ${result.sessionId}`);
      } else {
        await log.warn("Replay Browserbase session ID unavailable");
      }
      await keepalive.set(100);
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
    } finally {
      keepalive.stop();
    }
  },
});

// ─── Tool 5: Full Pipeline (Legacy Blocking) ────────────────────

server.addTool({
  name: "full_pipeline",
  description:
    "End-to-end pipeline: discover a website, generate an MCP server, and deploy it to Modal. " +
    "Returns the live URL. Takes 2-10 minutes total. (Legacy blocking behavior)",
  parameters: z.object({
    url: z.string().describe("Full URL of the website (e.g. https://www.amazon.com)"),
    turns: z.number().optional().describe("Max exploration turns for discovery (default: 15)"),
  }),
  execute: async (args, { log, reportProgress }) => {
    const keepalive = startProgressKeepalive(reportProgress, { start: 2, cap: 98, intervalMs: 10_000 });
    try {
      // Step 1: Discover
      await log.info("Step 1/3: Discovering " + args.url);
      await keepalive.set(10);
      const discoverResult = await discoverWebsite(args.url, args.turns ?? 15);
      await keepalive.set(40);

      // Step 2: Generate
      await log.info("Step 2/3: Generating MCP server");
      await keepalive.set(45);
      const generateResult = await generateServer(args.url);
      await keepalive.set(75);

      // Step 3: Deploy
      await log.info("Step 3/3: Deploying to Modal");
      await keepalive.set(80);
      const domain = domainFromUrl(args.url);
      const serverDir = path.resolve(__dirname, "..", "generated-servers", domain);
      const deployResult = await deployToModal(serverDir);
      await keepalive.set(100);

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
      keepalive.stop();
    }
  },
});

// ─── Tool 6: Start Full Pipeline (Async) ───────────────────────

server.addTool({
  name: "full_pipeline_start",
  description:
    "Starts the end-to-end pipeline asynchronously: discover, generate, and deploy. " +
    "Returns a job ID immediately. Use full_pipeline_status and full_pipeline_result next.",
  parameters: z.object({
    url: z.string().describe("Full URL of the website (e.g. https://www.amazon.com)"),
    turns: z.number().optional().describe("Max exploration turns for discovery (default: 15)"),
  }),
  execute: async (args, { log }) => {
    const jobId = createJobId();
    const now = new Date().toISOString();
    pipelineJobs.set(jobId, {
      id: jobId,
      url: args.url,
      turns: args.turns ?? 15,
      stage: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    await log.info(`Created pipeline job ${jobId} for ${args.url}`);
    void runPipelineJob(jobId);

    return (
      `Pipeline job started.\n\n` +
      `Job ID: ${jobId}\n` +
      `URL: ${args.url}\n` +
      `Status: queued\n\n` +
      `Next steps:\n` +
      `1) Call full_pipeline_status with this job ID\n` +
      `2) Once completed, call full_pipeline_result with this job ID`
    );
  },
});

// ─── Tool 7: Full Pipeline Status ───────────────────────────────

server.addTool({
  name: "full_pipeline_status",
  description:
    "Check status of an async full pipeline job started via full_pipeline_start.",
  parameters: z.object({
    job_id: z.string().describe("Job ID returned by full_pipeline_start"),
  }),
  execute: async (args) => {
    const job = pipelineJobs.get(args.job_id);
    if (!job) {
      return `No pipeline job found for job_id=${args.job_id}`;
    }

    const statusLines = [
      `Job ID: ${job.id}`,
      `URL: ${job.url}`,
      `Stage: ${job.stage}`,
      `Message: ${stageMessage(job.stage)}`,
      `Progress: ${job.progress}%`,
      `Created: ${job.createdAt}`,
      `Updated: ${job.updatedAt}`,
    ];

    if (job.completedAt) {
      statusLines.push(`Completed: ${job.completedAt}`);
    }

    if (job.error) {
      statusLines.push(`Error: ${job.error}`);
    }

    return statusLines.join("\n");
  },
});

// ─── Tool 8: Full Pipeline Result ───────────────────────────────

server.addTool({
  name: "full_pipeline_result",
  description:
    "Get final output of an async full pipeline job. Returns result only when completed.",
  parameters: z.object({
    job_id: z.string().describe("Job ID returned by full_pipeline_start"),
  }),
  execute: async (args) => {
    const job = pipelineJobs.get(args.job_id);
    if (!job) {
      return `No pipeline job found for job_id=${args.job_id}`;
    }

    if (job.stage === "failed") {
      return (
        `Pipeline job failed.\n\n` +
        `Job ID: ${job.id}\n` +
        `URL: ${job.url}\n` +
        `Error: ${job.error ?? "Unknown error"}`
      );
    }

    if (job.stage !== "completed") {
      return (
        `Pipeline result is not ready yet.\n\n` +
        `Job ID: ${job.id}\n` +
        `Current stage: ${job.stage}\n` +
        `Progress: ${job.progress}%\n\n` +
        `Call full_pipeline_status to keep polling.`
      );
    }

    return formatPipelineResult(job.url, job);
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
