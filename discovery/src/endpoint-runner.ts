/**
 * EndpointRunner: executes a discovered endpoint's steps against a live Stagehand session.
 *
 * Features:
 * - Smart navigate: skips navigation if already on the right page
 * - Parameter substitution: {query}, {category}, etc.
 * - State tracking: records currentUrl after each step
 * - Stagehand cache reuse: uses cacheDir from discovery for fast replays
 * - Extracts data and returns it for flow chaining
 */

import type { Stagehand } from "@browserbasehq/stagehand";
import type {
  EndpointDefinition,
  EndpointStep,
  PageState,
  EndpointRunResult,
  FlowState,
  DiscoveredAction,
} from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────

/** Replace {param_name} placeholders in a string with actual values */
function substituteParams(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in params) return params[key];
    return match;
  });
}

/** Check if two URLs are "the same page" (ignoring fragments and trailing slashes) */
function isSamePage(url1: string, url2: string): boolean {
  try {
    const a = new URL(url1);
    const b = new URL(url2);
    const normalize = (u: URL) =>
      `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    return normalize(a) === normalize(b);
  } catch {
    return url1 === url2;
  }
}

/** Get current page URL and title from a Stagehand page */
async function getPageState(stagehand: Stagehand): Promise<PageState> {
  try {
    const page = stagehand.context.pages()[0];
    const url = await page.evaluate(() => window.location.href);
    const title = await page.evaluate(() => document.title);
    return { url, title };
  } catch {
    return { url: "", title: undefined };
  }
}

// ─── EndpointRunner ──────────────────────────────────────────────

export interface RunOptions {
  /** The endpoint to execute */
  endpoint: EndpointDefinition;
  /** Live Stagehand instance */
  stagehand: Stagehand;
  /** Runtime parameters (e.g. { query: "macbook", category: "electronics" }) */
  params?: Record<string, string>;
  /** Current flow state (for smart navigate and dependency tracking) */
  flow?: FlowState;
  /** Action map from discovery (for act-by-id steps) */
  actionById?: Record<string, { pageUrl: string; action: DiscoveredAction }>;
  /** If true, log step-by-step progress */
  verbose?: boolean;
}

export async function runEndpoint(options: RunOptions): Promise<EndpointRunResult> {
  const { endpoint, stagehand, params = {}, flow, actionById = {}, verbose = true } = options;
  const page = stagehand.context.pages()[0];
  const steps = endpoint.steps;
  let stepsExecuted = 0;
  let lastExtractedData: unknown = undefined;

  if (verbose) {
    console.log(`\nRunning: ${endpoint.name} — ${endpoint.description}`);
    if (Object.keys(params).length > 0) console.log(`Params: ${JSON.stringify(params)}`);
  }

  // Warn about unresolved placeholders
  const allText = steps
    .map((s) => {
      if (s.type === "navigate") return s.url;
      if (s.type === "act_instruction" || s.type === "extract") return s.instruction;
      return "";
    })
    .join(" ");
  const placeholders = [...allText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const missing = placeholders.filter((p) => !(p in params));
  if (missing.length > 0 && verbose) {
    console.warn(`  WARNING: Unresolved params: ${missing.join(", ")}`);
  }

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepLabel = `Step ${i + 1}/${steps.length}`;

      if (step.type === "navigate") {
        const targetUrl = substituteParams(step.url, params);

        // Smart navigate: skip if already on the right page
        const current = flow?.currentPage?.url || "";
        if (current && isSamePage(current, targetUrl)) {
          if (verbose) console.log(`  ${stepLabel}: navigate → ${targetUrl} (SKIPPED — already here)`);
          stepsExecuted++;
          continue;
        }

        if (verbose) console.log(`  ${stepLabel}: navigate → ${targetUrl}`);
        await page.goto(targetUrl);
        await page.waitForLoadState("domcontentloaded");

        const pageState = await getPageState(stagehand);
        if (flow) flow.currentPage = pageState;
        if (verbose) console.log(`    OK: ${pageState.url}`);

      } else if (step.type === "act") {
        const resolved = actionById[step.actionId];
        if (!resolved) {
          throw new Error(`Unknown action ID: ${step.actionId}`);
        }
        if (verbose) console.log(`  ${stepLabel}: act → ${resolved.action.description}`);
        await stagehand.act(
          {
            selector: resolved.action.selector,
            description: resolved.action.description,
            method: resolved.action.method,
            arguments: resolved.action.arguments,
          },
          { page }
        );

        const pageState = await getPageState(stagehand);
        if (flow) flow.currentPage = pageState;
        if (verbose) console.log(`    OK: ${pageState.url}`);

      } else if (step.type === "act_instruction") {
        const instruction = substituteParams(step.instruction, params);
        if (verbose) console.log(`  ${stepLabel}: act → "${instruction}"`);
        await stagehand.act(instruction, { page });

        const pageState = await getPageState(stagehand);
        if (flow) flow.currentPage = pageState;
        if (verbose) console.log(`    OK: ${pageState.url}`);

      } else if (step.type === "extract") {
        const instruction = substituteParams(step.instruction, params);
        if (verbose) console.log(`  ${stepLabel}: extract → "${instruction}"`);
        const result = await stagehand.extract(instruction, { page });
        lastExtractedData = result;

        const pageState = await getPageState(stagehand);
        if (flow) flow.currentPage = pageState;

        if (verbose) {
          const summary = JSON.stringify(result);
          const truncated = summary.length > 500 ? summary.slice(0, 500) + "..." : summary;
          console.log(`    Extracted: ${truncated}`);
        }
      }

      stepsExecuted++;
    }

    const finalPage = await getPageState(stagehand);
    if (verbose) console.log(`\n  Completed: ${endpoint.name} (${stepsExecuted}/${steps.length} steps)`);

    return {
      success: true,
      endpointName: endpoint.name,
      flowId: flow?.flowId ?? "standalone",
      currentPage: finalPage,
      extractedData: lastExtractedData,
      stepsExecuted,
      totalSteps: steps.length,
    };

  } catch (e) {
    const error = (e as Error).message;
    const currentPage = await getPageState(stagehand);

    if (verbose) {
      console.error(`\n  FAILED at step ${stepsExecuted + 1}: ${error}`);
    }

    return {
      success: false,
      endpointName: endpoint.name,
      flowId: flow?.flowId ?? "standalone",
      currentPage,
      extractedData: lastExtractedData,
      stepsExecuted,
      totalSteps: steps.length,
      error,
    };
  }
}
