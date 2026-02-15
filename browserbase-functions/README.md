# Browserbase Functions

Browserbase Functions project for one-shot Stagehand initialization and cache extraction probes.

## Layout

- `index.ts` - publish entrypoint that registers functions
- `stagehand-cache-probe.ts` - thin wrapper that parses params and calls `execute()`
- `src/execute.ts` - main teammate-facing function; Stagehand init lives here
- `src/stagehand/init.ts` - runtime/env setup and Stagehand construction
- `src/cache/extract-cache-files.ts` - reusable cache artifact scanning/extraction
- `src/params.ts` - shared params schema and types

## Install

```bash
pnpm install
```

## Local Dev

```bash
pnpm run dev
```

## Type Check

```bash
pnpm run type-check
```

## Publish

```bash
pnpm run publish
```

After publish, use the function ID with `POST /debug/browserbase-functions-cache-probe` on `orchestrator-workers`.
