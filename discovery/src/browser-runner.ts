/**
 * Browserbase/Stagehand runner: single session, cacheDir by domain, exploration state.
 * Exposes goto, observe, act, extract, getLinks; returns structured feedback for the agent.
 */

import { Stagehand, type Action } from "@browserbasehq/stagehand";
import { API_KEYS } from "./config.js";
import type {
  ExploredPage,
  DiscoveredAction,
  ExplorationState,
  BrowserFeedback,
} from "./types.js";

const OBSERVE_INSTRUCTION =
  "Find the primary navigation links, search/filter forms, login/signup forms, key action buttons, and main content structure. Skip individual list items, individual tags, footer links, and external links. Focus on what makes this site useful as an API.";

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/\./g, "_");
  } catch {
    return "unknown";
  }
}

export interface BrowserRunnerOptions {
  websiteUrl: string;
  /** Max tabs per instance; when reached we would spin new instance (for now we use 1 tab for discovery) */
  maxTabs?: number;
}

export class BrowserRunner {
  private stagehand: Stagehand | null = null;
  private websiteUrl: string;
  private exploredPages: ExploredPage[] = [];
  private actionById: Record<string, { pageUrl: string; action: DiscoveredAction }> = {};
  private historyForFeedback: { method: string; timestamp: string; success: boolean }[] = [];
  private currentPageIndex = 0;
  private maxTabs: number;

  constructor(options: BrowserRunnerOptions) {
    this.websiteUrl = options.websiteUrl;
    this.maxTabs = options.maxTabs ?? 10;
  }

  async init(): Promise<void> {
    const domain = domainFromUrl(this.websiteUrl);
    const cacheDir = `cache/${domain}`;
    this.stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: API_KEYS.BROWSERBASE_API_KEY,
      projectId: API_KEYS.BROWSERBASE_PROJECT_ID,
      cacheDir,
    });
    await this.stagehand!.init();
  }

  private get page() {
    const sh = this.stagehand;
    if (!sh) throw new Error("BrowserRunner not initialized");
    const pages = sh.context.pages();
    const page = pages[this.currentPageIndex];
    if (!page) throw new Error("No page at index " + this.currentPageIndex);
    return page;
  }

  private recordHistory(method: string, success: boolean): void {
    this.historyForFeedback.push({
      method,
      timestamp: new Date().toISOString(),
      success,
    });
    if (this.historyForFeedback.length > 20) this.historyForFeedback.shift();
  }

  private async currentUrlAndTitle(): Promise<{ url: string; title?: string }> {
    let url = "";
    let title: string | undefined;
    try {
      url = await this.page.evaluate(() => window.location.href);
      title = await this.page.evaluate(() => document.title);
    } catch {
      // ignore
    }
    return { url, title };
  }

  /** Navigate to URL */
  async goto(url: string): Promise<BrowserFeedback> {
    try {
      await this.page.goto(url);
      await this.page.waitForLoadState("domcontentloaded");
      const { url: u, title } = await this.currentUrlAndTitle();
      this.recordHistory("navigate", true);
      return {
        success: true,
        currentUrl: u,
        currentTitle: title,
        lastMethod: "navigate",
        resultSummary: `Navigated to ${u}`,
        historyTail: this.historyForFeedback.slice(-8),
      };
    } catch (e) {
      this.recordHistory("navigate", false);
      return {
        success: false,
        resultSummary: "",
        error: (e as Error).message,
        historyTail: this.historyForFeedback.slice(-8),
      };
    }
  }

  /** Observe current page; adds actions to exploration state with ids */
  async observe(instruction?: string): Promise<BrowserFeedback> {
    const sh = this.stagehand;
    if (!sh) throw new Error("BrowserRunner not initialized");
    try {
      const actions = await sh.observe(instruction ?? OBSERVE_INSTRUCTION, {
        page: this.page,
      });
      const { url, title } = await this.currentUrlAndTitle();
      const pageIndex = this.exploredPages.length;
      const discovered: DiscoveredAction[] = actions.map((a: Action, i: number) => {
        const id = `p${pageIndex}-a${i}`;
        const d: DiscoveredAction = {
          id,
          selector: a.selector,
          description: a.description,
          method: a.method,
          arguments: a.arguments,
        };
        this.actionById[id] = { pageUrl: url, action: d };
        return d;
      });
      this.exploredPages.push({ url, title, actions: discovered });
      this.recordHistory("observe", true);
      const summary =
        discovered.length === 0
          ? "No actions found."
          : `Found ${discovered.length} actions: "${discovered.slice(0, 5).map((a) => a.description).join('", "')}"${discovered.length > 5 ? "..." : ""}`;
      return {
        success: true,
        currentUrl: url,
        currentTitle: title,
        lastMethod: "observe",
        resultSummary: summary,
        historyTail: this.historyForFeedback.slice(-8),
      };
    } catch (e) {
      this.recordHistory("observe", false);
      const info = await this.currentUrlAndTitle().catch(() => ({ url: "", title: undefined }));
      return {
        success: false,
        currentUrl: info.url,
        currentTitle: info.title,
        lastMethod: "observe",
        resultSummary: "",
        error: (e as Error).message,
        historyTail: this.historyForFeedback.slice(-8),
      };
    }
  }

  /** Act by instruction (natural language) or by action id */
  async act(instructionOrActionId: string): Promise<BrowserFeedback> {
    const sh = this.stagehand;
    if (!sh) throw new Error("BrowserRunner not initialized");
    const resolved = this.actionById[instructionOrActionId];
    try {
      if (resolved) {
        await sh.act(
          {
            selector: resolved.action.selector,
            description: resolved.action.description,
            method: resolved.action.method,
            arguments: resolved.action.arguments,
          },
          { page: this.page }
        );
      } else {
        await sh.act(instructionOrActionId, { page: this.page });
      }
      const { url, title } = await this.currentUrlAndTitle();
      this.recordHistory("act", true);
      return {
        success: true,
        currentUrl: url,
        currentTitle: title,
        lastMethod: "act",
        resultSummary: resolved ? `Executed action ${instructionOrActionId}` : `Executed: ${instructionOrActionId.slice(0, 60)}...`,
        historyTail: this.historyForFeedback.slice(-8),
      };
    } catch (e) {
      this.recordHistory("act", false);
      const info = await this.currentUrlAndTitle().catch(() => ({ url: "", title: undefined }));
      return {
        success: false,
        currentUrl: info.url,
        currentTitle: info.title,
        lastMethod: "act",
        resultSummary: "",
        error: (e as Error).message,
        historyTail: this.historyForFeedback.slice(-8),
      };
    }
  }

  /** Extract data from current page */
  async extract(instruction: string): Promise<BrowserFeedback> {
    const sh = this.stagehand;
    if (!sh) throw new Error("BrowserRunner not initialized");
    try {
      const result = await sh.extract(instruction, { page: this.page });
      const { url, title } = await this.currentUrlAndTitle();
      this.recordHistory("extract", true);
      const summary =
        typeof result === "object"
          ? `Extracted: ${JSON.stringify(result).slice(0, 200)}${JSON.stringify(result).length > 200 ? "..." : ""}`
          : String(result).slice(0, 200);
      return {
        success: true,
        currentUrl: url,
        currentTitle: title,
        lastMethod: "extract",
        resultSummary: summary,
        historyTail: this.historyForFeedback.slice(-8),
      };
    } catch (e) {
      this.recordHistory("extract", false);
      const info = await this.currentUrlAndTitle().catch(() => ({ url: "", title: undefined }));
      return {
        success: false,
        currentUrl: info.url,
        currentTitle: info.title,
        lastMethod: "extract",
        resultSummary: "",
        error: (e as Error).message,
        historyTail: this.historyForFeedback.slice(-8),
      };
    }
  }

  /** Get same-origin links from current page (for exploration) */
  async getLinks(): Promise<BrowserFeedback> {
    try {
      const baseOrigin = new URL(this.websiteUrl).origin;
      const raw = await this.page.evaluate(() => {
        const links: { href: string; text: string }[] = [];
        document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
          if (a.href && a.href.startsWith("http"))
            links.push({ href: a.href, text: (a.textContent || "").trim().slice(0, 80) });
        });
        return links;
      });
      const sameOrigin = raw.filter((l) => new URL(l.href).origin === baseOrigin);
      const { url, title } = await this.currentUrlAndTitle();
      this.recordHistory("get_links", true);
      const summary = `Found ${sameOrigin.length} same-origin links. Sample: ${sameOrigin.slice(0, 3).map((l) => l.text || l.href).join(", ")}`;
      return {
        success: true,
        currentUrl: url,
        currentTitle: title,
        lastMethod: "get_links",
        resultSummary: summary,
        historyTail: this.historyForFeedback.slice(-8),
      };
    } catch (e) {
      this.recordHistory("get_links", false);
      const info = await this.currentUrlAndTitle().catch(() => ({ url: "", title: undefined }));
      return {
        success: false,
        currentUrl: info.url,
        currentTitle: info.title,
        resultSummary: "",
        error: (e as Error).message,
        historyTail: this.historyForFeedback.slice(-8),
      };
    }
  }

  getExplorationState(websiteDescription?: string, rules?: string): ExplorationState {
    return {
      websiteUrl: this.websiteUrl,
      websiteDescription: websiteDescription,
      rules,
      exploredPages: [...this.exploredPages],
      actionById: { ...this.actionById },
    };
  }

  /** Seed actionById from a previous exploration (for replay). */
  seedActionById(actionById: Record<string, { pageUrl: string; action: DiscoveredAction }>): void {
    Object.assign(this.actionById, actionById);
  }

  getSessionUrl(): string | undefined {
    return this.stagehand?.browserbaseSessionURL;
  }

  async close(): Promise<void> {
    if (!this.stagehand) return;
    const sh = this.stagehand;
    this.stagehand = null;
    try {
      const closeWithTimeout = Promise.race([
        sh.close(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("close_timeout")), 10_000)
        ),
      ]);
      await closeWithTimeout;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (msg === "close_timeout" || msg.includes("fetch failed") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("Socket")) {
        console.warn("Browser close timed out or network error (discovery was already saved):", msg);
      } else {
        console.warn("Browser close error:", msg);
      }
    }
  }
}
