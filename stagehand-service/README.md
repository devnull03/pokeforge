# Stagehand Service

Cloudflare Worker service using Browserbase cloud + Stagehand for browser automation.

POST `/execute` with `{ targetUrl, steps, capture?, context?, inputArtifacts? }` to run generic browser steps and return structured logs/artifacts.

## Setup

```bash
cp .env.example .env
# Set BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY, AI_PROVIDER, AI_API_KEY
bun install
bun run dev
```

## API

- `POST /execute` - Body: `{ targetUrl, steps, capture?, context?, inputArtifacts? }`. Returns `{ steps, logs, metadata, artifacts }`
- `GET /health` - Health check
