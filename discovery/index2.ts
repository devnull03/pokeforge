import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";

// Keys Stagehand uses (BROWSERBASE + one LLM). Never log values.
const BROWSERBASE_KEYS = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"];
const LLM_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"];

function logKeysLoaded() {
  const isSet = (key: string) => {
    const v = process.env[key];
    return typeof v === "string" && v.length > 0 && !v.startsWith("YOUR_");
  };
  console.log("API keys from .env:");
  for (const key of BROWSERBASE_KEYS) {
    console.log(`  ${key}: ${isSet(key) ? "✓ set" : "✗ not set"}`);
  }
  const llmSet = LLM_KEYS.find((k) => isSet(k));
  if (llmSet) {
    console.log(`  LLM: ${llmSet} ✓`);
  } else {
    console.log("  LLM: ✗ none set (need one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.)");
  }
}

// Log immediately so you see the app is running
process.stdout.write("Starting Stagehand...\n");
logKeysLoaded();

async function main() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
  });

  try {
    process.stdout.write("Connecting to Browserbase...\n");
    await stagehand.init();
    console.log(`Stagehand Session Started`);
    console.log(
      `Watch live: https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`
    );

    const page = stagehand.context.pages()[0];

    await page.goto("https://stagehand.dev");

    const extractResult = await stagehand.extract(
      "Extract the value proposition from the page."
    );
    console.log(`Extract result:\n`, extractResult);

    const actResult = await stagehand.act("Click the 'Evals' button.");
    console.log(`Act result:\n`, actResult);

    const observeResult = await stagehand.observe("What can I click on this page?");
    console.log(`Observe result:\n`, observeResult);

    const agent = stagehand.agent({
      systemPrompt: "You're a helpful assistant that can control a web browser.",
    });

    const agentResult = await agent.execute(
      "What is the most accurate model to use in Stagehand?"
    );
    console.log(`Agent result:\n`, agentResult);
  } finally {
    await stagehand.close();
    console.log("Stagehand session closed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
