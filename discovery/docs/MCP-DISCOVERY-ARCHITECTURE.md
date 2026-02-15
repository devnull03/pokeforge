# MCP Discovery Agent — Architecture

## Overview

Single **orchestrator agent** (Claude) controls Browserbase via tools. It explores a website, then submits a list of MCP endpoints (name, description, ordered steps). Steps are **replayable** via Stagehand with **shared cache** (`cacheDir`) so subsequent runs are fast.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Claude + tool-use loop)                  │
│  Tools: browser_goto, browser_observe, browser_act,     │
│         browser_extract, browser_get_links,             │
│         submit_mcp_endpoints                            │
├─────────────────────────────────────────────────────────┤
│  BROWSER RUNNER (Stagehand + Browserbase)               │
│  - cacheDir per domain (shared action inference cache)  │
│  - Explored pages + actionById for replay               │
├─────────────────────────────────────────────────────────┤
│  STORE (JSON by domain)                                 │
│  - data/discovery_<domain>.json: exploration + endpoints│
├─────────────────────────────────────────────────────────┤
│  REPLAY (run endpoint by name)                          │
│  - Load discovery → run steps (navigate, act, extract)  │
│  - Uses same cacheDir → fast after first run            │
└─────────────────────────────────────────────────────────┘
```

## Flow

1. **Discovery**  
   - User runs: `npm run discover -- https://quotes.toscrape.com/ "Quotes site" [--rules "only login"]`  
   - Browser opens URL; agent gets tools: goto, observe, act, extract, get_links, submit_mcp_endpoints.  
   - Agent explores (goto → observe → act / extract as needed).  
   - After exploration, agent calls `submit_mcp_endpoints` with 3–5 endpoints, each with ordered steps (navigate, act by id or instruction, extract).  
   - We persist exploration state + endpoints to `data/discovery_<domain>.json`.

2. **Replay**  
   - User runs: `npm run replay -- https://quotes.toscrape.com/ get_quotes`  
   - We load discovery, find endpoint `get_quotes`, run its steps with BrowserRunner (same cacheDir).  
   - First run: LLM inference for act/observe; later runs: cache hit → fast.

## Key Files

| File | Role |
|------|------|
| `src/types.ts` | ExploredPage, EndpointStep, EndpointDefinition, ExplorationState |
| `src/store.ts` | saveDiscovery, loadDiscovery (JSON by domain) |
| `src/browser-runner.ts` | Stagehand + cacheDir; goto, observe, act, extract, getLinks; exploration state + seedActionById for replay |
| `src/agent-orchestrator.ts` | Claude tool-use loop; runs browser tools, parses submit_mcp_endpoints |
| `src/run-discovery.ts` | CLI: init browser → run orchestrator → save discovery |
| `src/replay-endpoint.ts` | CLI: load discovery → run one endpoint by name |

## Caching

- **Stagehand `cacheDir`**: One dir per domain (e.g. `cache/quotes_toscrape_com`). First act/observe uses LLM and caches; replay reuses cache.  
- **Browserbase Contexts** (optional): Pass `browserbaseSessionCreateParams.browserSettings.context = { id, persist: true }` to reuse cookies/cache across sessions; not wired in this minimal flow.

## Trial

```bash
# .env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, ANTHROPIC_API_KEY (for agent)
npm run discover -- https://quotes.toscrape.com/ "Quotes to scrape - simple demo"
# Then replay an endpoint (use name from discovery output)
npm run replay -- https://quotes.toscrape.com/ get_quotes
```
