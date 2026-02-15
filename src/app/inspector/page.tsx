"use client";

import { useState, useRef } from "react";

interface HistoryEntry {
  id: number;
  direction: "sent" | "received";
  method?: string;
  body: any;
  timestamp: Date;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export default function InspectorPage() {
  const [serverUrl, setServerUrl] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [serverInfo, setServerInfo] = useState<any>(null);

  // Tool call state
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [toolArgs, setToolArgs] = useState<string>("{}");
  const [toolResult, setToolResult] = useState<any>(null);
  const [callingTool, setCallingTool] = useState(false);

  const idCounter = useRef(1);
  const historyIdCounter = useRef(1);

  function addHistory(direction: "sent" | "received", body: any, method?: string) {
    setHistory((prev) => [
      {
        id: historyIdCounter.current++,
        direction,
        method,
        body,
        timestamp: new Date(),
      },
      ...prev,
    ]);
  }

  async function mcpSend(body: any): Promise<any> {
    addHistory("sent", body, body.method);

    const res = await fetch("/api/mcp-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverUrl, body, sessionId }),
    });

    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (data.sessionId) {
      setSessionId(data.sessionId);
    }

    // Extract the JSON-RPC response
    const response = data.json || (data.events && data.events.length > 0 ? data.events[data.events.length - 1] : data.result);
    if (response) {
      addHistory("received", response, body.method);
    }

    return response;
  }

  async function connect() {
    if (!serverUrl) return;
    setStatus("connecting");
    setError("");
    setTools([]);
    setToolResult(null);
    setSelectedTool(null);
    setSessionId(null);
    setServerInfo(null);
    idCounter.current = 1;

    try {
      // Step 1: Initialize
      const initResult = await mcpSend({
        jsonrpc: "2.0",
        id: idCounter.current++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "MCP Inspector", version: "1.0.0" },
        },
      });

      if (initResult?.error) {
        throw new Error(initResult.error.message || JSON.stringify(initResult.error));
      }

      setServerInfo(initResult?.result);

      // Step 2: Send initialized notification
      await mcpSend({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // Step 3: List tools
      const toolsResult = await mcpSend({
        jsonrpc: "2.0",
        id: idCounter.current++,
        method: "tools/list",
        params: {},
      });

      if (toolsResult?.result?.tools) {
        setTools(toolsResult.result.tools);
      }

      setStatus("connected");
    } catch (e: any) {
      setError(e.message || "Connection failed");
      setStatus("error");
    }
  }

  function disconnect() {
    setStatus("disconnected");
    setSessionId(null);
    setTools([]);
    setToolResult(null);
    setSelectedTool(null);
    setServerInfo(null);
    setError("");
  }

  async function callTool() {
    if (!selectedTool) return;
    setCallingTool(true);
    setToolResult(null);

    try {
      let args: any = {};
      try {
        args = JSON.parse(toolArgs);
      } catch {
        throw new Error("Invalid JSON in arguments");
      }

      const result = await mcpSend({
        jsonrpc: "2.0",
        id: idCounter.current++,
        method: "tools/call",
        params: {
          name: selectedTool,
          arguments: args,
        },
      });

      if (result?.error) {
        throw new Error(result.error.message || JSON.stringify(result.error));
      }

      setToolResult(result?.result || result);
    } catch (e: any) {
      setToolResult({ error: e.message });
    } finally {
      setCallingTool(false);
    }
  }

  function getSchemaFields(tool: McpTool): { name: string; type: string; description: string; required: boolean }[] {
    const schema = tool.inputSchema;
    if (!schema || !schema.properties) return [];
    const required = schema.required || [];
    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type || "string",
      description: prop.description || "",
      required: required.includes(name),
    }));
  }

  const selectedToolObj = tools.find((t) => t.name === selectedTool);

  const statusColors: Record<ConnectionStatus, string> = {
    disconnected: "bg-gray-300",
    connecting: "bg-neo-yellow",
    connected: "bg-neo-green",
    error: "bg-neo-pink",
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <span className="w-10 h-10 bg-neo-purple border-[3px] border-neo-black flex items-center justify-center text-lg text-white">
              🔍
            </span>
            MCP Inspector
          </h1>
          <p className="text-gray-600 mt-1">
            Connect to any MCP server, explore its tools, and test them live.
          </p>
        </div>
        <div className={`neo-badge ${statusColors[status]} text-sm`}>
          {status === "disconnected" && "● Disconnected"}
          {status === "connecting" && "● Connecting..."}
          {status === "connected" && "● Connected"}
          {status === "error" && "● Error"}
        </div>
      </div>

      {/* Connection Panel */}
      <div className="neo-card p-0 mb-6 overflow-hidden">
        <div className="bg-neo-black text-white p-4 border-b-[3px] border-neo-black">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <span>⚡</span> Connection
          </h2>
        </div>
        <div className="p-5 bg-white">
          {error && (
            <div className="neo-card bg-neo-pink p-3 mb-4 text-sm font-bold">
              {error}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-sm font-bold uppercase tracking-wider mb-1">
                Server URL
              </label>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="neo-input font-mono text-sm"
                placeholder="https://your-mcp-server.com/mcp"
                disabled={status === "connected" || status === "connecting"}
              />
            </div>
            <div className="flex items-end gap-2">
              {status !== "connected" ? (
                <button
                  onClick={connect}
                  disabled={!serverUrl || status === "connecting"}
                  className="neo-btn bg-neo-green text-sm whitespace-nowrap disabled:opacity-50"
                >
                  {status === "connecting" ? "Connecting..." : "▶ Connect"}
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  className="neo-btn bg-neo-pink text-sm whitespace-nowrap"
                >
                  ■ Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Server info */}
          {serverInfo && (
            <div className="mt-4 p-3 bg-gray-50 border-[3px] border-neo-black text-sm font-mono">
              <span className="font-bold">Server:</span>{" "}
              {serverInfo.serverInfo?.name || "Unknown"}{" "}
              {serverInfo.serverInfo?.version && (
                <span className="text-gray-500">v{serverInfo.serverInfo.version}</span>
              )}
              {" · "}
              <span className="font-bold">Protocol:</span>{" "}
              {serverInfo.protocolVersion || "unknown"}
            </div>
          )}
        </div>
      </div>

      {/* Main content — tools + tool call */}
      {status === "connected" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Tools list */}
          <div className="lg:col-span-1">
            <div className="neo-card p-0 overflow-hidden">
              <div className="bg-neo-blue p-4 border-b-[3px] border-neo-black">
                <h2 className="font-bold flex items-center justify-between">
                  <span>🔧 Tools</span>
                  <span className="neo-badge bg-white text-xs">
                    {tools.length}
                  </span>
                </h2>
              </div>
              <div className="bg-white divide-y-[3px] divide-neo-black max-h-[500px] overflow-y-auto">
                {tools.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <div className="text-3xl mb-2">🤷</div>
                    No tools found
                  </div>
                ) : (
                  tools.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => {
                        setSelectedTool(tool.name);
                        setToolResult(null);
                        // Build default args from schema
                        const fields = getSchemaFields(tool);
                        if (fields.length > 0) {
                          const defaultArgs: Record<string, any> = {};
                          fields.forEach((f) => {
                            defaultArgs[f.name] = f.type === "number" || f.type === "integer" ? 0 : "";
                          });
                          setToolArgs(JSON.stringify(defaultArgs, null, 2));
                        } else {
                          setToolArgs("{}");
                        }
                      }}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                        selectedTool === tool.name ? "bg-neo-blue/20" : ""
                      }`}
                    >
                      <div className="font-bold font-mono text-sm">
                        {tool.name}
                      </div>
                      {tool.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {tool.description}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Tool call panel */}
          <div className="lg:col-span-2">
            {selectedToolObj ? (
              <div className="neo-card p-0 overflow-hidden">
                <div className="bg-neo-purple text-white p-4 border-b-[3px] border-neo-black">
                  <h2 className="font-bold text-lg font-mono">
                    {selectedToolObj.name}
                  </h2>
                  {selectedToolObj.description && (
                    <p className="text-sm opacity-90 mt-1">
                      {selectedToolObj.description}
                    </p>
                  )}
                </div>
                <div className="p-5 bg-white space-y-4">
                  {/* Schema info */}
                  {getSchemaFields(selectedToolObj).length > 0 && (
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-wider mb-2">
                        Parameters
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {getSchemaFields(selectedToolObj).map((field) => (
                          <div
                            key={field.name}
                            className={`neo-badge text-xs ${
                              field.required ? "bg-neo-yellow" : "bg-gray-200"
                            }`}
                          >
                            <span className="font-mono font-bold">{field.name}</span>
                            <span className="text-gray-500 ml-1">({field.type})</span>
                            {field.required && <span className="text-neo-pink ml-1">*</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Arguments editor */}
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">
                      Arguments (JSON)
                    </label>
                    <textarea
                      value={toolArgs}
                      onChange={(e) => setToolArgs(e.target.value)}
                      className="neo-input font-mono text-sm min-h-[120px]"
                      spellCheck={false}
                    />
                  </div>

                  <button
                    onClick={callTool}
                    disabled={callingTool}
                    className="neo-btn bg-neo-green text-sm disabled:opacity-50"
                  >
                    {callingTool ? "Calling..." : "▶ Run Tool"}
                  </button>

                  {/* Result */}
                  {toolResult && (
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-wider mb-1">
                        Result
                      </label>
                      <div className="bg-neo-black text-white p-4 border-[3px] border-neo-black font-mono text-sm overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                        {toolResult.error ? (
                          <span className="text-neo-pink">{toolResult.error}</span>
                        ) : toolResult.content ? (
                          toolResult.content.map((block: any, i: number) => (
                            <div key={i} className="mb-2">
                              {block.type === "text" ? (
                                <span className="text-neo-green">{block.text}</span>
                              ) : (
                                <span className="text-neo-yellow">
                                  {JSON.stringify(block, null, 2)}
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                          <span className="text-neo-blue">
                            {JSON.stringify(toolResult, null, 2)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="neo-card p-12 bg-white text-center">
                <div className="text-5xl mb-4">👈</div>
                <h3 className="font-bold text-lg mb-2">Select a tool</h3>
                <p className="text-sm text-gray-500">
                  Pick a tool from the list to inspect and test it.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <div className="neo-card p-0 overflow-hidden">
        <div className="bg-gray-100 p-4 border-b-[3px] border-neo-black flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <span>📜</span> Request History
          </h2>
          {history.length > 0 && (
            <button
              onClick={() => setHistory([])}
              className="neo-btn bg-white text-xs py-1 px-3"
            >
              Clear
            </button>
          )}
        </div>
        <div className="bg-white max-h-[400px] overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p className="font-mono text-sm">No history yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {history.map((entry) => (
                <div key={entry.id} className="p-3 hover:bg-gray-50">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`neo-badge text-[10px] ${
                        entry.direction === "sent" ? "bg-neo-blue" : "bg-neo-green"
                      }`}
                    >
                      {entry.direction === "sent" ? "→ SENT" : "← RECV"}
                    </span>
                    {entry.method && (
                      <span className="font-mono text-xs font-bold text-gray-600">
                        {entry.method}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 ml-auto font-mono">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <details>
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-neo-black">
                      Show payload
                    </summary>
                    <pre className="mt-1 p-2 bg-gray-50 border border-gray-200 text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
                      {JSON.stringify(entry.body, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
