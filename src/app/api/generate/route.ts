import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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
 */
function parseModalUrl(responseText: string): string | null {
  const modalPattern = /https:\/\/[^\s"'<>]+\.modal\.run[^\s"'<>]*/gi;
  const modalMatch = responseText.match(modalPattern);
  if (modalMatch) return modalMatch[0].replace(/[.,;:!?)}\]]+$/, "");

  const urlPattern = /https:\/\/[^\s"'<>]+/gi;
  const urlMatch = responseText.match(urlPattern);
  if (urlMatch) {
    const filtered = urlMatch.filter((u) => !u.includes("mcp-factory"));
    if (filtered.length > 0) return filtered[0].replace(/[.,;:!?)}\]]+$/, "");
  }

  return null;
}

/**
 * Sends a JSON-RPC request to the MCP server and parses the response.
 */
async function mcpRequest(
  body: object,
  sessionId?: string
): Promise<{ result: any; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await fetch(MCP_FACTORY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSessionId = res.headers.get("Mcp-Session-Id") || sessionId;

  if (res.status === 202 || res.status === 204) {
    return { result: null, sessionId: newSessionId || undefined };
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MCP server error (${res.status}): ${errText || res.statusText}`);
  }

  const contentType = res.headers.get("Content-Type") || "";
  const responseText = await res.text();

  if (!responseText || responseText.trim() === "") {
    return { result: null, sessionId: newSessionId || undefined };
  }

  if (contentType.includes("text/event-stream")) {
    const lines = responseText.split("\n");
    let lastResult: any = null;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.result !== undefined) {
            lastResult = parsed.result;
          } else if (parsed.error) {
            throw new Error(
              `MCP error: ${parsed.error.message || JSON.stringify(parsed.error)}`
            );
          }
        } catch (e: any) {
          if (e.message?.startsWith("MCP error:")) throw e;
        }
      }
    }
    return { result: lastResult, sessionId: newSessionId || undefined };
  }

  try {
    const json = JSON.parse(responseText);
    if (json.error) {
      throw new Error(
        `MCP error: ${json.error.message || JSON.stringify(json.error)}`
      );
    }
    return { result: json.result, sessionId: newSessionId || undefined };
  } catch (e: any) {
    if (e.message?.startsWith("MCP error:")) throw e;
    return { result: responseText, sessionId: newSessionId || undefined };
  }
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

    // Step 1: Initialize MCP session
    const initRes = await mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pokeforge", version: "1.0.0" },
      },
    });

    const sessionId = initRes.sessionId;

    // Step 2: Send initialized notification
    await mcpRequest(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      sessionId
    );

    // Step 3: Call full_pipeline tool
    const toolRes = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "full_pipeline",
          arguments: { url, num_turns: turns || 15 },
        },
      },
      sessionId
    );

    // Step 4: Parse the result
    const toolResult = toolRes.result;
    let mcpUrl: string | null = null;

    if (toolResult) {
      if (toolResult.content && Array.isArray(toolResult.content)) {
        for (const block of toolResult.content) {
          if (block.type === "text" && block.text) {
            try {
              const parsed = JSON.parse(block.text);
              mcpUrl = parsed.url || parsed.mcp_url || parsed.server_url || null;
              if (!mcpUrl) mcpUrl = parseModalUrl(JSON.stringify(parsed));
            } catch {
              mcpUrl = parseModalUrl(block.text);
            }
            if (mcpUrl) break;
          }
        }
      }

      if (!mcpUrl) {
        const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);
        mcpUrl = toolResult.url || toolResult.mcp_url || toolResult.server_url || parseModalUrl(resultStr);
      }
    }

    if (!mcpUrl) {
      return NextResponse.json(
        {
          error: "Could not parse MCP server URL from factory response",
          raw_response: typeof toolResult === "string"
            ? toolResult.substring(0, 500)
            : JSON.stringify(toolResult).substring(0, 500),
        },
        { status: 422 }
      );
    }

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

    const serverDescription = description || `Auto-generated MCP server for ${url}. Created via MCP Factory pipeline.`;
    const apiKey = "sk_gen_" + generateKey();

    const { rows } = await query(
      "INSERT INTO servers (name, description, url, website_url, color, icon, api_key, is_active, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8) RETURNING *",
      [serverName, serverDescription, mcpUrl, url, color || "#6bcbff", icon || "⚡", apiKey, user.id]
    );

    return NextResponse.json({
      server: rows[0],
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
