/**
 * Replay CLI: Run endpoints using BrowserRunner (same as discovery — proven to work).
 * Flow state persists to disk; sessions reconnect via browserbaseSessionID.
 *
 * Usage:
 *   npm run replay -- <url> --list                              # List endpoints
 *   npm run replay -- <url> <endpoint> query=macbook            # Run standalone
 *   npm run replay -- <url> <endpoint> --user alice query=mac   # Start a flow
 *   npm run replay -- <url> <endpoint> --flow <id> --user alice # Continue flow
 *   npm run replay -- <url> ep1,ep2 --user alice query=mac      # Chain in one call
 */

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { readFile, writeFile, mkdir } from "fs/promises";
import { loadDiscovery } from "./store.js";
import { BrowserRunner } from "./browser-runner.js";
import type { EndpointStep, FlowState, PageState } from "./types.js";

const FLOWS_DIR = "data/flows";
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

// ─── Flow persistence ────────────────────────────────────────────

async function loadFlow(flowId: string): Promise<FlowState | null> {
  try {
    return JSON.parse(await readFile(`${FLOWS_DIR}/${flowId}.json`, "utf-8")) as FlowState;
  } catch {
    return null;
  }
}

async function saveFlow(flow: FlowState): Promise<void> {
  await mkdir(FLOWS_DIR, { recursive: true });
  await writeFile(`${FLOWS_DIR}/${flow.flowId}.json`, JSON.stringify(flow, null, 2), "utf-8");
}

// ─── Helpers ─────────────────────────────────────────────────────

function substituteParams(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? params[key] : match));
}

function hasUnresolvedParams(text: string): boolean {
  return /\{(\w+)\}/.test(text);
}

function isSamePage(url1: string, url2: string): boolean {
  try {
    const norm = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    return norm(new URL(url1)) === norm(new URL(url2));
  } catch {
    return false;
  }
}

function isSameDomain(url1: string, url2: string): boolean {
  try { return new URL(url1).hostname === new URL(url2).hostname; } catch { return false; }
}

function generateFlowId(): string {
  return `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Arg parsing ─────────────────────────────────────────────────

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const websiteUrl = args.find((a) => a.startsWith("http")) ?? "";
  const userId = getFlag(args, "--user") ?? "default";
  const flowId = getFlag(args, "--flow");
  const listOnly = args.includes("--list");

  const flagValues = new Set([userId, flowId].filter(Boolean));
  const endpointArg = args.find(
    (a) => !a.startsWith("http") && !a.startsWith("--") && !a.includes("=") && !flagValues.has(a)
  );
  const endpointNames = endpointArg ? endpointArg.split(",") : [];

  const params: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq > 0 && !arg.startsWith("--")) params[arg.slice(0, eq)] = arg.slice(eq + 1);
  }

  return { websiteUrl, endpointNames, params, userId, flowId, listOnly };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const { websiteUrl, endpointNames, params, userId, flowId, listOnly } = parseArgs();

  if (!websiteUrl) {
    console.error("Usage: npm run replay -- <url> <endpoint> [--user id] [--flow id] [key=value ...]");
    process.exit(1);
  }

  const discovery = await loadDiscovery(websiteUrl);
  if (!discovery) {
    console.error(`No discovery for ${websiteUrl} — run discover first.`);
    process.exit(1);
  }

  // List mode
  if (listOnly || endpointNames.length === 0) {
    console.log(`\nEndpoints for ${websiteUrl}:\n`);
    for (const ep of discovery.endpoints) {
      const meta = ep.metadata;
      const tags = [
        meta?.dependsOn?.length ? `depends: ${meta.dependsOn.join(", ")}` : "",
        meta?.provides?.length ? `provides: ${meta.provides.join(", ")}` : "",
        meta?.requiresAuth ? "auth" : "",
      ].filter(Boolean);
      console.log(`  ${ep.name}: ${ep.description} (${ep.steps.length} steps)${tags.length ? ` [${tags.join(", ")}]` : ""}`);
      const allText = ep.steps.map((s) => {
        if (s.type === "navigate") return s.url;
        if (s.type === "act_instruction" || s.type === "extract") return s.instruction;
        return "";
      }).join(" ");
      const phs = [...new Set([...allText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
      if (phs.length > 0) console.log(`    params: ${phs.join(", ")}`);
    }
    return;
  }

  // Resolve endpoints
  const endpoints = endpointNames.map((name) => {
    const ep = discovery.endpoints.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!ep) {
      console.error(`Endpoint not found: ${name}\nAvailable: ${discovery.endpoints.map((e) => e.name).join(", ")}`);
      process.exit(1);
    }
    return ep;
  });

  // ── Load or create flow ──
  let flow: FlowState;
  let sessionIdToReuse: string | undefined;

  if (flowId) {
    const existing = await loadFlow(flowId);
    if (existing) {
      const idle = Date.now() - existing.lastActivity;
      if (idle < FLOW_TIMEOUT_MS && existing.browserbaseSessionId) {
        sessionIdToReuse = existing.browserbaseSessionId;
        console.log(`Resuming flow ${flowId} — reconnecting to session ${sessionIdToReuse}`);
      } else {
        console.log(`Flow ${flowId} session expired — creating new session (flow state preserved)`);
      }
      flow = existing;
    } else {
      console.log(`Flow ${flowId} not found on disk — creating new flow`);
      flow = makeNewFlow(generateFlowId(), userId, websiteUrl);
    }
  } else {
    flow = makeNewFlow(generateFlowId(), userId, websiteUrl);
  }

  // ── Create BrowserRunner (same as discovery — proven to work) ──
  const browser = new BrowserRunner({
    websiteUrl,
    browserbaseSessionID: sessionIdToReuse,
  });

  try {
    await browser.init();
    flow.browserbaseSessionId = browser.getBrowserbaseSessionID();
    flow.lastActivity = Date.now();
    await saveFlow(flow);

    browser.seedActionById(discovery.exploration.actionById);

    const status = sessionIdToReuse ? "RESUMED (same session)" : "NEW session";
    console.log(`\nFlow: ${flow.flowId} | User: ${userId} | ${status}`);
    if (flow.completedEndpoints.length > 0) console.log(`Previously completed: ${flow.completedEndpoints.join(" → ")}`);
    if (flow.currentPage.url) console.log(`Current page: ${flow.currentPage.url}`);
    const sessionUrl = browser.getSessionUrl();
    if (sessionUrl) console.log(`Watch live: ${sessionUrl}`);

    // ── Run each endpoint ──
    for (const endpoint of endpoints) {
      // Build merged params: flow extracted data + user params
      const flowParams = flattenExtractedData(flow.extractedData);
      const mergedParams = { ...flowParams, ...params };

      console.log(`\nRunning: ${endpoint.name} — ${endpoint.description}`);
      if (Object.keys(params).length > 0) console.log(`Params: ${JSON.stringify(params)}`);

      let stepsExecuted = 0;
      let lastExtract: unknown = undefined;
      let failed = false;

      for (let i = 0; i < endpoint.steps.length; i++) {
        const step = endpoint.steps[i] as EndpointStep;
        const label = `Step ${i + 1}/${endpoint.steps.length}`;

        try {
          if (step.type === "navigate") {
            const url = substituteParams(step.url, mergedParams);
            if (hasUnresolvedParams(url) && flow.currentPage.url && isSameDomain(flow.currentPage.url, websiteUrl)) {
              console.log(`  ${label}: navigate → ${url} (SKIPPED — unresolved, continuing from current page)`);
              stepsExecuted++;
              continue;
            }
            if (flow.currentPage.url && isSamePage(flow.currentPage.url, url)) {
              console.log(`  ${label}: navigate → ${url} (SKIPPED — already here)`);
              stepsExecuted++;
              continue;
            }
            console.log(`  ${label}: navigate → ${url}`);
            const fb = await browser.goto(url);
            if (!fb.success) throw new Error(fb.error || "Navigate failed");
            flow.currentPage = { url: fb.currentUrl || url, title: fb.currentTitle };
            console.log(`    OK: ${fb.currentUrl}`);

          } else if (step.type === "act") {
            const resolved = discovery.exploration.actionById[step.actionId];
            if (!resolved) throw new Error(`Unknown action ID: ${step.actionId}`);
            console.log(`  ${label}: act → ${resolved.action.description}`);
            const fb = await browser.act(step.actionId);
            if (!fb.success) throw new Error(fb.error || "Act failed");
            flow.currentPage = { url: fb.currentUrl || "", title: fb.currentTitle };
            console.log(`    OK: ${fb.currentUrl}`);

          } else if (step.type === "act_instruction") {
            const instruction = substituteParams(step.instruction, mergedParams);
            console.log(`  ${label}: act → "${instruction}"`);
            const fb = await browser.act(instruction);
            if (!fb.success) throw new Error(fb.error || "Act failed");
            flow.currentPage = { url: fb.currentUrl || "", title: fb.currentTitle };
            console.log(`    OK: ${fb.currentUrl}`);

          } else if (step.type === "extract") {
            const instruction = substituteParams(step.instruction, mergedParams);
            console.log(`  ${label}: extract → "${instruction}"`);
            const fb = await browser.extract(instruction);
            if (!fb.success) throw new Error(fb.error || "Extract failed");
            lastExtract = fb.resultSummary;
            flow.currentPage = { url: fb.currentUrl || "", title: fb.currentTitle };
            const trunc = fb.resultSummary.length > 500 ? fb.resultSummary.slice(0, 500) + "..." : fb.resultSummary;
            console.log(`    Extracted: ${trunc}`);
          }

          stepsExecuted++;
        } catch (e) {
          console.error(`\n  FAILED at step ${i + 1}: ${(e as Error).message}`);
          failed = true;
          break;
        }
      }

      console.log(`\n${"─".repeat(60)}`);
      console.log(`${endpoint.name}: ${failed ? "FAILED" : "SUCCESS"} (${stepsExecuted}/${endpoint.steps.length} steps)`);
      console.log(`Page: ${flow.currentPage.url}`);
      if (lastExtract) {
        console.log("\n--- Extracted Data ---");
        console.log(typeof lastExtract === "string" ? lastExtract : JSON.stringify(lastExtract, null, 2));
        console.log("--- End Data ---");
      }
      console.log(`${"─".repeat(60)}`);

      if (!failed) {
        flow.completedEndpoints.push(endpoint.name);
        flow.providedState.push(...(endpoint.metadata?.provides ?? []));
        if (lastExtract !== undefined) flow.extractedData[endpoint.name] = lastExtract;
        flow.lastActivity = Date.now();
        await saveFlow(flow);
      } else {
        flow.lastActivity = Date.now();
        await saveFlow(flow);
        console.error(`\nStopping — ${endpoint.name} failed.`);
        break;
      }
    }

    // Print continuation instructions
    console.log(`\nFlow: ${flow.flowId}`);
    console.log(`  Completed: ${flow.completedEndpoints.join(" → ") || "(none)"}`);
    console.log(`  Page: ${flow.currentPage.url}`);
    console.log(`\n  Continue: npm run replay -- ${websiteUrl} <next_endpoint> --flow ${flow.flowId} --user ${userId}`);

  } finally {
    try {
      await browser.close();
      console.log("Session closed.");
    } catch (e) {
      console.warn("Close warning:", (e as Error).message);
    }
  }
}

function makeNewFlow(flowId: string, userId: string, websiteUrl: string): FlowState {
  const domain = new URL(websiteUrl).hostname.replace(/\./g, "_");
  return {
    flowId, userId, domain, websiteUrl,
    contextId: "", browserbaseSessionId: undefined,
    currentPage: { url: "", title: undefined },
    completedEndpoints: [], providedState: [], extractedData: {},
    lastActivity: Date.now(), createdAt: Date.now(),
  };
}

function flattenExtractedData(data: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === "string") params[`${key}_result`] = val;
    else if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") params[k] = v;
      }
    }
  }
  return params;
}

main().catch((err) => { console.error(err); process.exit(1); });
