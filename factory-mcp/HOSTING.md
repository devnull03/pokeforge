# Hosting factory-mcp so Poke (AI) can use it

## Recommended: Cloudflare Workers (for hackathon track)

Hosts the same API (GET `/health`, MCP at `/mcp` with `create_mcp` tool) on Cloudflare. No Python on the edge — the Worker is a TypeScript port.

1. **From this repo:**
   ```bash
   cd factory-mcp/worker
   npm install
   npm run deploy
   ```
   (First time: `npx wrangler login` if needed.)

2. **Your MCP URL for Poke:**
   ```text
   https://factory-mcp.<YOUR_SUBDOMAIN>.workers.dev/mcp
   ```
   Replace `<YOUR_SUBDOMAIN>` with your Cloudflare account’s workers subdomain. The deploy output shows the exact URL.

3. **Verify**
   - Health: `curl https://factory-mcp.<YOUR_SUBDOMAIN>.workers.dev/health`
   - In MCP Inspector or Poke: add server URL `https://factory-mcp.<YOUR_SUBDOMAIN>.workers.dev/mcp` (Streamable HTTP).

