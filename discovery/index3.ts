import "dotenv/config";
import { Stagehand, type Action } from "@browserbasehq/stagehand";

const OBSERVE_INSTRUCTION =
  "find all important interactable elements: buttons, links, input fields, dropdowns, and any clickable or focusable elements";

async function main() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
  });

  await stagehand.init();

  console.log("Stagehand Session Started");
  console.log(`Watch live: https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`);

  const amazonPage = stagehand.context.pages()[0];
  await amazonPage.goto("https://www.amazon.com");
  await amazonPage.waitForLoadState("domcontentloaded");

  const bestBuyPage = await stagehand.context.newPage();
  await bestBuyPage.goto("https://www.bestbuy.com");
  await bestBuyPage.waitForLoadState("domcontentloaded");

  const [amazonActions, bestBuyActions] = await Promise.all([
    stagehand.observe(OBSERVE_INSTRUCTION, { page: amazonPage }),
    stagehand.observe(OBSERVE_INSTRUCTION, { page: bestBuyPage }),
  ]);

  console.log(`\n--- Amazon (${amazonActions.length} interactable elements) ---\n`);
  amazonActions.forEach((action: Action, i: number) => {
    console.log(`${i + 1}. [${action.method}] ${action.description}`);
    if (action.selector) console.log(`   selector: ${action.selector}`);
  });

  console.log(`\n--- Best Buy (${bestBuyActions.length} interactable elements) ---\n`);
  bestBuyActions.forEach((action: Action, i: number) => {
    console.log(`${i + 1}. [${action.method}] ${action.description}`);
    if (action.selector) console.log(`   selector: ${action.selector}`);
  });

  console.log("\n--- Full actions (for debugging) ---");
  console.log("Amazon:", JSON.stringify(amazonActions, null, 2));
  console.log("Best Buy:", JSON.stringify(bestBuyActions, null, 2));

  await stagehand.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
