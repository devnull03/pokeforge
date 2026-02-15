import "dotenv/config";
import { Stagehand, type Action } from "@browserbasehq/stagehand";

const BROWSERBASE_KEYS = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"];
const LLM_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
];

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
    console.log(
      "  LLM: ✗ none set (need one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.)"
    );
  }
}

/** Link extracted from a page (for recursive exploration) */
interface PageLink {
  href: string;
  text: string;
}

/** One explored page: URL + discovered actions (for future MCP endpoints) */
export interface ExploredPage {
  url: string;
  title?: string;
  depth: number;
  actions: Action[];
  linksFound: PageLink[];
}

const OBSERVE_INSTRUCTION =
  "find all interactable elements: buttons, links, input fields, dropdowns, and any clickable or focusable elements. Include link destinations where relevant.";

/** Same origin as base URL (library.ufv.ca) */
function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** True if link is in scope: same origin and (for demo) booking-related or allowed nav */
function isLinkInScope(
  link: PageLink,
  baseOrigin: string,
  focusOnBooking: boolean
): boolean {
  try {
    const u = new URL(link.href, baseOrigin);
    if (u.origin !== baseOrigin) return false;
    // Skip anchors, javascript, mailto, etc.
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const path = u.pathname.toLowerCase();
    const text = (link.text || "").toLowerCase();
    const combined = `${path} ${text}`;

    if (focusOnBooking) {
      const bookingKeywords = ["book", "appointment", "schedule", "schedule an appointment", "services", "visit us", "contact"];
      return bookingKeywords.some((k) => combined.includes(k));
    }
    return true;
  } catch {
    return false;
  }
}

/** Get all same-origin links from the page via evaluate */
async function getPageLinks(page: { evaluate: (fn: () => PageLink[]) => Promise<PageLink[]> }, baseOrigin: string): Promise<PageLink[]> {
  const raw = await page.evaluate(() => {
    const links: PageLink[] = [];
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const href = a.href;
      const text = (a.textContent || "").trim().slice(0, 120);
      if (href && href.startsWith("http")) links.push({ href, text });
    });
    return links;
  });
  const seen = new Set<string>();
  return raw.filter((l) => {
    if (getOrigin(l.href) !== baseOrigin) return false;
    const norm = new URL(l.href).pathname;
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

async function main() {
  process.stdout.write("Starting site explorer (Browserbase + Stagehand)...\n");
  logKeysLoaded();

  const startUrl = "https://library.ufv.ca/articles-databases/";
  const baseOrigin = getOrigin(startUrl);
  const focusOnBooking = true;
  const maxDepth = 2;
  const maxPages = 10;
  const MAX_TABS_PER_INSTANCE = 10;

  const stagehand = new Stagehand({ env: "BROWSERBASE", cacheDir: "cache1" });
  const explored: ExploredPage[] = [];
  const visited = new Set<string>();

  try {
    process.stdout.write("Connecting to Browserbase...\n");
    await stagehand.init();
    console.log("Stagehand session started");
    console.log(`Watch live: https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`);

    const queue: { url: string; depth: number; page: ReturnType<typeof stagehand.context.pages>[0] }[] = [];
    const firstPage = stagehand.context.pages()[0];
    await firstPage.goto(startUrl);
    await firstPage.waitForLoadState("domcontentloaded");
    queue.push({ url: startUrl, depth: 0, page: firstPage });

    while (queue.length > 0 && explored.length < maxPages) {
      const { url, depth, page } = queue.shift()!;
      const normUrl = new URL(url).href;
      if (visited.has(normUrl)) continue;
      visited.add(normUrl);

      console.log(`\n[Explore depth=${depth}] ${normUrl}`);

      let title: string | undefined;
      try {
        title = await page.evaluate(() => document.title);
      } catch {
        // ignore
      }

      const [actions, linksFound] = await Promise.all([
        stagehand.observe(OBSERVE_INSTRUCTION, { page }),
        getPageLinks(page, baseOrigin),
      ]);

      const inScope = focusOnBooking
        ? linksFound.filter((l) => isLinkInScope(l, baseOrigin, true))
        : linksFound;
      const toFollowList = inScope.length > 0 ? inScope : linksFound.slice(0, 5);

      explored.push({
        url: normUrl,
        title,
        depth,
        actions,
        linksFound: toFollowList.slice(0, 20),
      });

      console.log(`  Actions: ${actions.length}, Links in scope: ${toFollowList.length}`);

      // Close this tab now that we're done so we stay under the tab limit
      try {
        await page.close();
      } catch (e) {
        console.warn("  Failed to close tab:", (e as Error).message);
      }

      if (depth < maxDepth) {
        const toFollow = toFollowList;
        const openCount = stagehand.context.pages().length;
        const maxNewTabs = Math.max(0, MAX_TABS_PER_INSTANCE - openCount);
        const linksToOpen = toFollow.slice(0, Math.min(5, maxNewTabs));
        for (const link of linksToOpen) {
          const nextUrl = new URL(link.href, baseOrigin).href;
          if (visited.has(nextUrl) || explored.length >= maxPages) continue;
          try {
            const newPage = await stagehand.context.newPage();
            await newPage.goto(nextUrl);
            await newPage.waitForLoadState("domcontentloaded");
            queue.push({ url: nextUrl, depth: depth + 1, page: newPage });
          } catch (e) {
            console.warn(`  Skip ${nextUrl}:`, (e as Error).message);
          }
        }
      }
    }

    console.log("\n--- Exploration summary (for future MCP endpoints) ---\n");
    for (const p of explored) {
      console.log(`Page: ${p.url}`);
      if (p.title) console.log(`  Title: ${p.title}`);
      console.log(`  Depth: ${p.depth}, Actions: ${p.actions.length}`);
      p.actions.slice(0, 8).forEach((a, i) => {
        console.log(`    ${i + 1}. [${a.method ?? "?"}] ${a.description}`);
        if (a.selector) console.log(`       selector: ${a.selector}`);
      });
      if (p.actions.length > 8) console.log(`    ... and ${p.actions.length - 8} more`);
      if (p.linksFound.length) {
        console.log(`  Links in scope: ${p.linksFound.map((l) => l.text || l.href).slice(0, 5).join(", ")}${p.linksFound.length > 5 ? "..." : ""}`);
      }
      console.log("");
    }

    console.log(`Total pages explored: ${explored.length}. Use this structure to design MCP action sequences.`);
  } finally {
    await stagehand.close();
    console.log("Stagehand session closed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
