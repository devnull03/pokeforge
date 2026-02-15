# Stagehand Service

Node.js HTTP service using Browserbase cloud + Stagehand for browser automation.

POST `/run` with `{ websiteUrl, task }` to perform a task on a website once, log discoveries, and return action logs + cache files.

## Setup

```bash
cp .env.example .env
# Set BROWSERBASE_PROJECT_ID, BROWSERBASE_API_KEY, ANTHROPIC_API_KEY
npm install
npm run dev
```

## API

- `POST /run` - Body: `{ websiteUrl: string, task: string }`. Returns `{ actions, logs, cacheKey, sessionId }`
- `GET /health` - Health check
