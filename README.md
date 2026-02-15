# Pokeforge

Automatic MCP server generation for browser automation.

## Projects

This repo currently uses:

1. `orchestrator-workers/` - Cloudflare Worker with:
   - MCP endpoint (`/mcp`)
   - automation endpoints (`/automate`, `/automate/:id`)
   - workflow + codegen + GitHub publish
   - debug endpoints for Stagehand and Browserbase Functions probing
2. `browserbase-functions/` - Browserbase Functions project used to test one-shot Stagehand cache capture.

## Architecture

`orchestrator-workers` runs the main Pokeforge workflow:

1. Discover actions/cache from a target site
2. Generate MCP server code
3. Validate generated code
4. Push generated code to GitHub

`browserbase-functions` is a separate test harness for validating cache extraction behavior when running Stagehand inside Browserbase Functions.

## Local Development

### 1) Browserbase functions (pnpm)

```bash
cd browserbase-functions
pnpm install
pnpm run dev
```

Publish:

```bash
pnpm run publish
```

### 2) Orchestrator workers (bun)

```bash
cd orchestrator-workers
bun install
bun run dev
```

Runs on `http://localhost:8787`.

## Deployment

### A) Required secrets / vars for `orchestrator-workers`

- `AI_PROVIDER` (var)
- `AI_API_KEY` (secret)
- `BROWSERBASE_PROJECT_ID` (secret)
- `BROWSERBASE_API_KEY` (secret)
- `GITHUB_TOKEN` (secret)
- `GITHUB_OWNER` (optional var)
- `BROWSERBASE_CACHE_PROBE_FUNCTION_ID` (optional var; used by debug probe endpoint)

### B) Setup commands

From repo root:

```bash
cd orchestrator-workers
bunx wrangler secret put AI_API_KEY
bunx wrangler secret put BROWSERBASE_PROJECT_ID
bunx wrangler secret put BROWSERBASE_API_KEY
bunx wrangler secret put GITHUB_TOKEN
```

## Browserbase Functions Cache Probe

Use this to test whether a Browserbase Function can return Stagehand cache files from a single run.

1. Publish `browserbase-functions/index.ts`.
2. Invoke the orchestrator debug endpoint:

```bash
curl -X POST "https://<orchestrator-domain>/debug/browserbase-functions-cache-probe" \
  -H "Content-Type: application/json" \
  -d '{
    "functionId": "<BROWSERBASE_FUNCTION_ID>",
    "websiteUrl": "https://example.com",
    "task": "Observe the page and summarize content",
    "rawParams": {
      "browserbaseProjectId": "<BROWSERBASE_PROJECT_ID>",
      "browserbaseApiKey": "<BROWSERBASE_API_KEY>",
      "aiApiKey": "<AI_API_KEY>",
      "aiProvider": "openai"
    }
  }'
```

Key response fields:

- `hasCacheFiles`
- `cacheArtifactCount`
- `cacheArtifactNames`
- `explicitCacheFileCount`
- `explicitCacheFiles`
