/**
 * Generation module: takes discovery output and uses Claude to generate
 * a complete standalone Python FastMCP server project deployable to Modal.
 * Clean async function — no CLI code.
 */

import { fileURLToPath } from "url";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "fs/promises";
import { loadDiscovery } from "./store.js";
import { API_KEYS } from "./config.js";
import type { DiscoveryResult, EndpointDefinition, EndpointStep } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_BASE = path.join(PROJECT_ROOT, "generated-servers");

// ─── Helpers ─────────────────────────────────────────────────────

function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/\./g, "_"); } catch { return "unknown"; }
}

function extractPlaceholders(steps: EndpointStep[]): string[] {
  const all = steps.map((s) => {
    if (s.type === "navigate") return s.url;
    if (s.type === "act_instruction" || s.type === "extract") return s.instruction;
    return "";
  }).join(" ");
  return [...new Set([...all.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

function endpointSummary(ep: EndpointDefinition): string {
  const params = extractPlaceholders(ep.steps);
  const stepsDesc = ep.steps.map((s, i) => {
    if (s.type === "navigate") return `  ${i + 1}. navigate → ${s.url}`;
    if (s.type === "act") return `  ${i + 1}. act → actionId: ${s.actionId}`;
    if (s.type === "act_instruction") return `  ${i + 1}. act → "${s.instruction}"`;
    if (s.type === "extract") return `  ${i + 1}. extract → "${s.instruction}"`;
    return `  ${i + 1}. unknown`;
  }).join("\n");
  return `- ${ep.name}: ${ep.description}\n  params: [${params.join(", ")}]\n  steps:\n${stepsDesc}`;
}

// ─── Claude prompt ───────────────────────────────────────────────

function buildPrompt(discovery: DiscoveryResult, websiteUrl: string): string {
  const siteName = new URL(websiteUrl).hostname.replace("www.", "");
  const endpointsSummary = discovery.endpoints.map(endpointSummary).join("\n\n");

  return `You are a code generator. You will generate Python tool functions for a FastMCP server that automates the website "${siteName}" (${websiteUrl}).

## Discovered Endpoints

${endpointsSummary}

## Endpoint Step Types

- \`navigate\`: Go to a URL. \`{param}\` placeholders get substituted with tool args.
- \`act_instruction\`: Natural language browser action via Stagehand.
- \`extract\`: Natural language extraction. Stagehand extracts structured data.

## EXACT API you must use

Here is a COMPLETE, TESTED, WORKING tool. Follow this structure EXACTLY for every tool:

\`\`\`python
@mcp.tool()
async def get_quotes_by_tag(tag_name: str) -> str:
    """Get quotes filtered by a specific tag (e.g. 'love', 'inspirational')."""
    async with AsyncStagehand(**_creds()) as client:
        session = await client.sessions.start(model_name="openai/gpt-4o-mini")
        try:
            await session.navigate(url=f"https://quotes.toscrape.com/tag/{tag_name}/")
            resp = await session.extract(
                instruction="Extract all quotes on this page. For each quote return the text, author name, and tags as a list."
            )
            return json.dumps(resp.data, indent=2, default=str)
        except Exception as e:
            return f"Error: {e}"
        finally:
            await session.end()
\`\`\`

CRITICAL RULES (violating ANY of these will break the server):
1. Decorator MUST be \`@mcp.tool()\` — with parentheses
2. Function MUST be \`async def\`
3. Client MUST use \`async with AsyncStagehand(**_creds()) as client:\`
4. Session MUST be created with \`await client.sessions.start(model_name="openai/gpt-4o-mini")\`
5. ALWAYS wrap in try/except/finally, ALWAYS call \`await session.end()\` in finally
6. Navigation: \`await session.navigate(url="...")\`
7. Actions: \`await session.act(input="natural language instruction")\`
8. Extraction: \`resp = await session.extract(instruction="...")\` — use ONLY the instruction parameter. Do NOT pass a schema parameter (it causes 422 validation errors on complex pages).
9. Return \`json.dumps(resp.data, indent=2, default=str)\` for extracted data
10. If a URL can be constructed directly with parameters (e.g. /tag/{name}/ or /page/{num}/), navigate directly instead of clicking.

## What to generate

Generate ONLY the tool function definitions. Output them inside a single fenced code block. Do NOT include imports, do NOT include the FastMCP constructor, do NOT include any boilerplate — ONLY the @mcp.tool() decorated async functions.

\`\`\`python
@mcp.tool()
async def tool_one(...) -> str:
    ...

@mcp.tool()
async def tool_two(...) -> str:
    ...
\`\`\`

Generate ALL tools for ALL endpoints. Do NOT use placeholder comments. Every tool must be complete.`;
}

// ─── Parse Claude's response ─────────────────────────────────────

function extractToolCode(response: string): string {
  const codeBlockRegex = /```(?:python)?\n([\s\S]*?)```/g;
  let match;
  let longestBlock = "";
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const block = match[1].trim();
    if (block.includes("@mcp.tool") && block.length > longestBlock.length) {
      longestBlock = block;
    }
  }
  return longestBlock;
}

// ─── Templates (deterministic — Claude never touches these) ──────

function buildServerPy(siteName: string, toolCode: string): string {
  return `import os
import json
import sys
from fastmcp import FastMCP
from stagehand import AsyncStagehand


def create_mcp():
    """Factory function to create the MCP server instance."""
    mcp = FastMCP("${siteName} MCP Server")

    def _creds():
        return dict(
            browserbase_api_key=os.environ["BROWSERBASE_API_KEY"],
            browserbase_project_id=os.environ["BROWSERBASE_PROJECT_ID"],
            model_api_key=os.environ["MODEL_API_KEY"],
        )

${toolCode}

    return mcp


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    required_vars = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "MODEL_API_KEY"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        raise EnvironmentError(f"Missing: {', '.join(missing)}")

    mcp = create_mcp()

    if "--http" in sys.argv:
        port = int(os.environ.get("PORT", "8080"))
        mcp.run(transport="http", host="0.0.0.0", port=port)
    else:
        mcp.run()
`;
}

function buildDeployModalPy(domain: string, siteName: string, toolCode: string): string {
  const appName = domain.replace(/_/g, "-");
  const bb_key = process.env.BROWSERBASE_API_KEY || "";
  const bb_proj = process.env.BROWSERBASE_PROJECT_ID || "";
  const model_key = process.env.OPENAI_API_KEY || "";

  return `"""
Deploy ${siteName} MCP server to Modal.

Usage:  modal deploy deploy_modal.py
Dev:    modal serve deploy_modal.py
"""

import modal

app = modal.App("mcp-${appName}")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi==0.115.14",
    "fastmcp==2.10.6",
    "pydantic==2.11.10",
    "stagehand",
)

SECRETS = {
    "BROWSERBASE_API_KEY": "${bb_key}",
    "BROWSERBASE_PROJECT_ID": "${bb_proj}",
    "MODEL_API_KEY": "${model_key}",
}


def make_mcp_server():
    import os
    import json
    from fastmcp import FastMCP
    from stagehand import AsyncStagehand

    mcp = FastMCP("${siteName} MCP Server")

    def _creds():
        return dict(
            browserbase_api_key=os.environ["BROWSERBASE_API_KEY"],
            browserbase_project_id=os.environ["BROWSERBASE_PROJECT_ID"],
            model_api_key=os.environ["MODEL_API_KEY"],
        )

${toolCode}

    return mcp


@app.function(
    image=image,
    secrets=[modal.Secret.from_dict(SECRETS)],
    timeout=600,
    scaledown_window=300,
)
@modal.asgi_app()
def web():
    """ASGI web endpoint for the MCP server."""
    from fastapi import FastAPI

    mcp = make_mcp_server()
    mcp_app = mcp.http_app(transport="streamable-http", stateless_http=True)

    fastapi_app = FastAPI(lifespan=mcp_app.router.lifespan_context)
    fastapi_app.mount("/", mcp_app, "mcp")

    return fastapi_app
`;
}

function buildRequirementsTxt(): string {
  return `fastmcp>=2.10
stagehand
python-dotenv
pydantic
`;
}

function buildEnvExample(): string {
  return `BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id
MODEL_API_KEY=your_openai_or_llm_api_key
`;
}

function buildReadme(siteName: string, domain: string): string {
  return `# ${siteName} MCP Server

Auto-generated MCP server for ${siteName} using Browserbase + Stagehand.

## Local usage

\`\`\`bash
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
python server.py       # stdio (MCP Inspector / Claude Desktop)
python server.py --http  # HTTP on port 8080
\`\`\`

## Deploy to Modal

\`\`\`bash
modal deploy deploy_modal.py
\`\`\`

## Connect

- MCP Inspector: use "Streamable HTTP" transport, URL = \`<modal_url>/mcp/\`
- Claude Desktop: add the Modal URL to your config
`;
}

function buildDotEnv(): string {
  const bb_key = process.env.BROWSERBASE_API_KEY || "your_browserbase_api_key";
  const bb_proj = process.env.BROWSERBASE_PROJECT_ID || "your_browserbase_project_id";
  const model_key = process.env.OPENAI_API_KEY || "your_model_api_key";

  return `# Browserbase credentials
BROWSERBASE_API_KEY=${bb_key}
BROWSERBASE_PROJECT_ID=${bb_proj}

# LLM API key (used by Stagehand for act/extract)
MODEL_API_KEY=${model_key}

# Server port (only used with --http flag)
PORT=8080
`;
}

// ─── Main export ─────────────────────────────────────────────────

export interface GenerateOutput {
  outputDir: string;
  toolNames: string[];
  domain: string;
}

/**
 * Generate a complete Python MCP server project from a website discovery.
 */
export async function generateServer(websiteUrl: string): Promise<GenerateOutput> {
  const discovery = await loadDiscovery(websiteUrl);
  if (!discovery) {
    throw new Error(`No discovery found for ${websiteUrl}. Run discover first.`);
  }

  const domain = domainFromUrl(websiteUrl);
  const siteName = new URL(websiteUrl).hostname.replace("www.", "");
  const outputDir = path.join(OUTPUT_BASE, domain);

  // Build prompt and call Claude — only generates tool functions
  const prompt = buildPrompt(discovery, websiteUrl);

  const anthropic = new Anthropic({ apiKey: API_KEYS.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let toolCode = extractToolCode(responseText);
  if (!toolCode) {
    throw new Error("Failed to extract tool code from Claude's response.");
  }

  // Extract tool names before indenting
  const toolNames = [...toolCode.matchAll(/async def (\w+)\(/g)].map(m => m[1]);

  // Indent tool code to sit inside create_mcp()/make_mcp_server()
  toolCode = toolCode
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : "    " + line))
    .join("\n");

  // Write all files using deterministic templates
  await mkdir(outputDir, { recursive: true });

  const files: Array<{ name: string; content: string }> = [
    { name: "server.py", content: buildServerPy(siteName, toolCode) },
    { name: "deploy_modal.py", content: buildDeployModalPy(domain, siteName, toolCode) },
    { name: "requirements.txt", content: buildRequirementsTxt() },
    { name: ".env.example", content: buildEnvExample() },
    { name: "README.md", content: buildReadme(siteName, domain) },
  ];

  for (const file of files) {
    const filePath = path.join(outputDir, file.name);
    await writeFile(filePath, file.content, "utf-8");
  }

  // Write .env with actual keys
  const dotEnvPath = path.join(outputDir, ".env");
  await writeFile(dotEnvPath, buildDotEnv(), "utf-8");

  // Write discovery JSON for reference
  const discoveryPath = path.join(outputDir, "discovery.json");
  await writeFile(discoveryPath, JSON.stringify(discovery, null, 2), "utf-8");

  return { outputDir, toolNames, domain };
}
