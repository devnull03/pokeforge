import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies JSON-RPC requests to an MCP server to avoid CORS issues.
 * The client sends { serverUrl, body } and we forward the body to the MCP server.
 */
export async function POST(req: NextRequest) {
  try {
    const { serverUrl, body, sessionId } = await req.json();

    if (!serverUrl) {
      return NextResponse.json(
        { error: "serverUrl is required" },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const res = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const newSessionId = res.headers.get("Mcp-Session-Id") || sessionId || null;
    const contentType = res.headers.get("Content-Type") || "";

    // Handle empty responses (202/204 for notifications)
    if (res.status === 202 || res.status === 204) {
      return NextResponse.json({
        sessionId: newSessionId,
        status: res.status,
        result: null,
      });
    }

    const responseText = await res.text();

    if (!responseText || responseText.trim() === "") {
      return NextResponse.json({
        sessionId: newSessionId,
        status: res.status,
        result: null,
      });
    }

    // Handle SSE responses — extract JSON-RPC messages from data: lines
    if (contentType.includes("text/event-stream")) {
      const events: any[] = [];
      const lines = responseText.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            events.push(JSON.parse(data));
          } catch {
            // not JSON
          }
        }
      }
      return NextResponse.json({
        sessionId: newSessionId,
        status: res.status,
        sse: true,
        events,
        raw: responseText,
      });
    }

    // Try to parse as JSON
    try {
      const json = JSON.parse(responseText);
      return NextResponse.json({
        sessionId: newSessionId,
        status: res.status,
        json,
      });
    } catch {
      return NextResponse.json({
        sessionId: newSessionId,
        status: res.status,
        raw: responseText,
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Proxy request failed" },
      { status: 502 }
    );
  }
}
