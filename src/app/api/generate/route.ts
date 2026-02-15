import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const MCP_FACTORY_URL = "https://mcp-factory-724594740861.us-central1.run.app/mcp";

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Parses the Modal URL from the MCP Factory response.
 * The response may contain a URL in various formats — we look for
 * any https:// URL that looks like a Modal deployment link.
 */
function parseModalUrl(responseText: string): string | null {
  // Try to find a Modal URL pattern (e.g. https://something.modal.run/...)
  const modalPattern = /https:\/\/[^\s"'<>]+\.modal\.run[^\s"'<>]*/gi;
  const modalMatch = responseText.match(modalPattern);
  if (modalMatch) return modalMatch[0].replace(/[.,;:!?)}\]]+$/, "");

  // Fallback: find any https URL in the response
  const urlPattern = /https:\/\/[^\s"'<>]+/gi;
  const urlMatch = responseText.match(urlPattern);
  if (urlMatch) {
    // Filter out the factory URL itself
    const filtered = urlMatch.filter((u) => !u.includes("mcp-factory"));
    if (filtered.length > 0) return filtered[0].replace(/[.,;:!?)}\]]+$/, "");
  }

  return null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, turns, name, description, color, icon } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "Website URL is required" }, { status: 400 });
    }

    // Call MCP Factory full_pipeline
    const factoryRes = await fetch(MCP_FACTORY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: "full_pipeline",
        tool_input: {
          url: url,
          num_turns: turns || 15,
        },
      }),
    });

    if (!factoryRes.ok) {
      const errText = await factoryRes.text();
      return NextResponse.json(
        { error: "MCP Factory error: " + (errText || factoryRes.statusText) },
        { status: 502 }
      );
    }

    const responseText = await factoryRes.text();

    // Try to parse as JSON first
    let mcpUrl: string | null = null;
    try {
      const json = JSON.parse(responseText);
      // The response might have a url field, or the result might be nested
      mcpUrl =
        json.url ||
        json.mcp_url ||
        json.server_url ||
        json.result?.url ||
        json.result?.mcp_url ||
        json.result?.server_url ||
        null;

      // If not found in structured fields, search the stringified response
      if (!mcpUrl) {
        mcpUrl = parseModalUrl(JSON.stringify(json));
      }
    } catch {
      // Not JSON — parse as text
      mcpUrl = parseModalUrl(responseText);
    }

    if (!mcpUrl) {
      return NextResponse.json(
        {
          error: "Could not parse MCP server URL from factory response",
          raw_response: responseText.substring(0, 500),
        },
        { status: 422 }
      );
    }

    // Derive a name from the URL if not provided
    let serverName = name;
    if (!serverName) {
      try {
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname.replace("www.", "");
        serverName = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1) + " MCP";
      } catch {
        serverName = "Generated MCP";
      }
    }

    const serverDescription =
      description || `Auto-generated MCP server for ${url}. Created via MCP Factory pipeline.`;

    const apiKey = "sk_gen_" + generateKey();

    // Save to database — auto-generated servers go active immediately
    const db = getDb();
    const result = db
      .prepare(
        "INSERT INTO servers (name, description, url, website_url, color, icon, api_key, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)"
      )
      .run(
        serverName,
        serverDescription,
        mcpUrl,
        url,
        color || "#6bcbff",
        icon || "⚡",
        apiKey,
        user.id
      );

    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(result.lastInsertRowid);

    return NextResponse.json({
      server,
      mcp_url: mcpUrl,
      message: "MCP server generated and added to marketplace!",
    });
  } catch (error: any) {
    console.error("Generate error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate MCP server" },
      { status: 500 }
    );
  }
}
