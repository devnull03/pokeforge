/**
 * Replay module: replays a discovered endpoint's browser actions.
 * Useful for testing endpoints before generating a server.
 */

import { BrowserRunner } from "./browser.js";
import { loadDiscovery } from "./store.js";

export interface ReplayOutput {
  success: boolean;
  endpointName: string;
  stepsExecuted: number;
  totalSteps: number;
  sessionId?: string;
  extractedData?: string;
  error?: string;
}

/**
 * Replay a discovered endpoint's steps in a fresh Browserbase session.
 * Substitutes {param} placeholders with values from the params object.
 */
export async function replayActions(
  websiteUrl: string,
  endpointName: string,
  params?: Record<string, string>
): Promise<ReplayOutput> {
  const discovery = await loadDiscovery(websiteUrl);
  if (!discovery) {
    throw new Error(`No discovery found for ${websiteUrl}. Run discover first.`);
  }

  const endpoint = discovery.endpoints.find(ep => ep.name === endpointName);
  if (!endpoint) {
    const available = discovery.endpoints.map(e => e.name).join(", ");
    throw new Error(`Endpoint "${endpointName}" not found. Available: ${available}`);
  }

  const browser = new BrowserRunner({ websiteUrl });
  let stepsExecuted = 0;
  let extractedData: string | undefined;
  let sessionId: string | undefined;

  try {
    await browser.init();
    sessionId = browser.getBrowserbaseSessionID();

    // Seed action map from discovery so act-by-id steps work
    if (discovery.exploration?.actionById) {
      browser.seedActionById(discovery.exploration.actionById);
    }

    for (const step of endpoint.steps) {
      if (step.type === "navigate") {
        let url = step.url;
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            url = url.replace(`{${key}}`, encodeURIComponent(value));
          }
        }
        await browser.goto(url);
      } else if (step.type === "act") {
        await browser.act(step.actionId);
      } else if (step.type === "act_instruction") {
        let instruction = step.instruction;
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            instruction = instruction.replace(`{${key}}`, value);
          }
        }
        await browser.act(instruction);
      } else if (step.type === "extract") {
        const fb = await browser.extract(step.instruction);
        extractedData = fb.resultSummary;
      }
      stepsExecuted++;
    }

    return {
      success: true,
      endpointName,
      stepsExecuted,
      totalSteps: endpoint.steps.length,
      sessionId,
      extractedData,
    };
  } catch (e) {
    return {
      success: false,
      endpointName,
      stepsExecuted,
      totalSteps: endpoint.steps.length,
      sessionId,
      error: (e as Error).message,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
