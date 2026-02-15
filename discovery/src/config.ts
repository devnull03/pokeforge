/**
 * Fallback API keys used when .env values are missing.
 * Set real keys in .env (see .env.example). Do NOT commit real keys here.
 */
export const API_KEYS = {
  BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID ?? "",
  BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
} as const;
