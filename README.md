# Pokeforge

Automatic MCP server generation for browser automation. [GitHub](https://github.com/devnull03/pokeforge)

## Folder split

Merged setup now uses **2 active projects**:

1. `orchestrator-workers/` - Cloudflare Worker with:
   - MCP endpoint (`/mcp`)
   - automation endpoints (`/automate`, `/automate/:id`)
   - workflows + codegen + GitHub publish
2. `stagehand-service/` - Browserbase Stagehand runtime (sync run + cache capture)

## Architecture

1. **Unified Worker** (`orchestrator-workers`) that:
   - Exposes MCP tool `automate_website` at `/mcp`
   - Calls Stagehand service (sync, waits for completion)
   - Codegens MCP server from discovered actions/cache
   - Pushes to GitHub and returns the new repo URL
2. **Stagehand Service** (`stagehand-service`) - Bun service using Browserbase cloud + Stagehand

## Setup (Bun)

### 1. Stagehand Service (Browserbase)

```bash
cd stagehand-service
cp .env.example .env
# Set BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY, ANTHROPIC_API_KEY
bun install
bun run dev
```

Runs on `http://localhost:8788`

### 2. Orchestrator Workers

```bash
cd orchestrator-workers
bun install
# Set GITHUB_TOKEN for GitHub push
bunx wrangler secret put GITHUB_TOKEN
# For production: set STAGEHAND_SERVICE_URL in wrangler.jsonc vars
bun run dev
```

Runs on `http://localhost:8787`

Connect MCP Inspector to `http://localhost:8787/mcp`. Use `automate_website` with:
- `website_url`
- `task`
- optional `orchestrator_url` (defaults to `http://localhost:8787`)

## Repo

https://github.com/devnull03/pokeforge
