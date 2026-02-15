# Pokeforge

Automatic MCP server generation for browser automation.

## Projects

This repo contains two Cloudflare Workers:

1. `orchestrator-workers/` - Cloudflare Worker with:
   - MCP endpoint (`/mcp`)
   - automation endpoints (`/automate`, `/automate/:id`)
   - workflows + codegen + GitHub publish
2. `stagehand-service/` - Browserbase + Stagehand execution service (`/execute`)

## Architecture

1. `orchestrator-workers`:
   - Exposes MCP tool `automate_website` at `/mcp`
   - Calls `stagehand-service` via Cloudflare Service Binding
   - Codegens MCP server from discovered actions/cache
   - Tests generated code in Cloudflare Sandbox
   - Pushes to GitHub and returns repo URL
2. `stagehand-service`:
   - Executes browser steps using Stagehand + Browserbase
   - Returns step logs + artifacts (screenshots/html/cache)

## Local Development (Bun)

### 1) Stagehand service

```bash
cd stagehand-service
cp .env.example .env
# Set BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY, AI_PROVIDER, AI_API_KEY
bun install
bun run dev
```

Runs on `http://localhost:8788`

### 2) Orchestrator workers

```bash
cd orchestrator-workers
bun install
# Optional for local fallback only (without Service Binding):
# set STAGEHAND_SERVICE_URL=http://localhost:8788
bun run dev
```

Runs on `http://localhost:8787`

## Cloudflare Deployment 

Deploy in this order:

1. Deploy `stagehand-service`
2. Deploy `orchestrator-workers` (depends on service binding to stagehand)

### A) Cloudflare Worker Build Settings

For both Workers in Cloudflare:
- Install command: `bun install --frozen-lockfile`
- Build command: `bun run build`
- Deploy command: `npx wrangler deploy`
- Root directory:
  - `stagehand-service` project: `stagehand-service`
  - `orchestrator-workers` project: `orchestrator-workers`

### B) Required Secrets / Vars

Set these in Cloudflare for `stagehand-service`:
- `BROWSERBASE_PROJECT_ID` (secret)
- `BROWSERBASE_API_KEY` (secret)
- `AI_PROVIDER` (var; example: `openai` or `google`)
- `AI_API_KEY` (secret)

Set these in Cloudflare for `orchestrator-workers`:
- `AI_PROVIDER` (var; currently codegen supports `openai` and `google`)
- `AI_API_KEY` (secret)
- `GITHUB_TOKEN` (secret; required for repo creation)
- `GITHUB_OWNER` (optional; auto-resolved from token if omitted)

### B.1) Copy/Paste Setup Commands

Run from repo root:

```bash
# Stagehand service secrets
cd stagehand-service
bunx wrangler secret put BROWSERBASE_PROJECT_ID
bunx wrangler secret put BROWSERBASE_API_KEY
bunx wrangler secret put AI_API_KEY

# Orchestrator workers secrets
cd ../orchestrator-workers
bunx wrangler secret put AI_API_KEY
bunx wrangler secret put GITHUB_TOKEN
```

Non-secret vars (`AI_PROVIDER`, optional `GITHUB_OWNER`) should be set in each project's `wrangler.jsonc` `vars` section (or in the Cloudflare dashboard for the Worker).

### C) Service Binding Requirement

`orchestrator-workers/wrangler.jsonc` includes:
- `services` binding `STAGEHAND_SERVICE -> stagehand-service`

The target script name must exactly match the deployed script name in Cloudflare.  
If Cloudflare renames scripts in CI, update binding `service` to that exact deployed name.

### D) Durable Object Migration Requirement

`orchestrator-workers` uses Sandbox DO and must keep migration configured:
- `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Sandbox"] }]`

### E) Post-deploy Smoke Test

After both deploy successfully:

```bash
curl -X POST "https://<orchestrator-domain>/debug/stagehand-smoke" \
  -H "Content-Type: application/json" \
  -d '{"websiteUrl":"https://example.com","task":"Observe the page and summarize content"}'
```

Expect:
- `ok: true`
- `transport: "service-binding"`

## Common Deployment Issues

- `Could not resolve service binding STAGEHAND_SERVICE`:
  - Stagehand worker not deployed yet, wrong account, or wrong target script name.
- `lockfile is frozen`:
  - run `bun install` locally in that project, commit updated `bun.lock`, redeploy.
- Worker name mismatch warning in CI:
  - align Cloudflare project worker name and `wrangler.jsonc` name to avoid confusion.

## Repo

Set your repository URL here after deployment.
