# factory-mcp Worker (Cloudflare)

TypeScript port of the Python factory-mcp server for Cloudflare Workers. Same API:

- **GET /health** — `{"status":"ok","server":"factory-mcp"}`
- **POST /mcp** — MCP Streamable HTTP; tool: `create_mcp(url, automation_goal)`

## Deploy

```bash
npm install
npx wrangler login   # once
npm run deploy
```

Use the printed URL: `https://factory-mcp.<account>.workers.dev/mcp` for Poke or any MCP client.

## Local dev

```bash
npm run dev
```

Then open `http://localhost:8787/health` and connect MCP Inspector to `http://localhost:8787/mcp`.
