"use client";

import { useState } from "react";

interface Server {
  id: number;
  name: string;
  description: string;
  url: string;
  website_url: string;
  color: string;
  icon: string;
  api_key: string;
  is_active: number;
}

export default function ServerCard({ server }: { server: Server }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col">
      <div
        onClick={() => setExpanded(!expanded)}
        className="neo-card neo-card-hover p-0 overflow-hidden"
      >
        {/* Color bar */}
        <div
          className="h-3 w-full border-b-[3px] border-neo-black"
          style={{ backgroundColor: server.color }}
        />

        <div className="p-5">
          {/* Icon and status */}
          <div className="flex items-start justify-between mb-3">
            <div
              className="w-14 h-14 border-[3px] border-neo-black flex items-center justify-center text-2xl"
              style={{ backgroundColor: server.color + "40" }}
            >
              {server.icon}
            </div>
            <div
              className={`neo-badge ${
                server.is_active ? "bg-neo-green" : "bg-gray-300"
              }`}
            >
              {server.is_active ? "Active" : "Inactive"}
            </div>
          </div>

          {/* Name */}
          <h3 className="text-xl font-bold mb-2 tracking-tight">
            {server.name}
          </h3>

          {/* Description */}
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            {server.description}
          </p>

          {/* Website link */}
          {server.website_url && (
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <span className="w-2 h-2 rounded-full bg-neo-green border border-neo-black inline-block" />
              {server.website_url}
            </div>
          )}
        </div>

        {/* Click hint */}
        <div
          className="border-t-[3px] border-neo-black px-5 py-2 text-xs font-mono text-center"
          style={{ backgroundColor: server.color + "20" }}
        >
          {expanded ? "▲ Click to collapse" : "▼ Click to view connection details"}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="neo-card border-t-0 p-5 bg-gray-50">
          <h4 className="font-bold text-sm uppercase tracking-wider mb-4">
            Connection Details
          </h4>

          {/* MCP URL */}
          <div className="mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 block">
              MCP Server URL
            </label>
            <div className="flex items-stretch">
              <input
                readOnly
                value={server.url}
                className="neo-input flex-1 text-xs !shadow-none !border-r-0 bg-white"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copy(server.url, "url");
                }}
                className="neo-btn bg-neo-blue text-xs py-0 px-4 whitespace-nowrap"
              >
                {copied === "url" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* API Key */}
          <div className="mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 block">
              API Key
            </label>
            <div className="flex items-stretch">
              <input
                readOnly
                value={server.api_key || "No API key required"}
                className="neo-input flex-1 text-xs !shadow-none !border-r-0 bg-white font-mono"
              />
              {server.api_key && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copy(server.api_key, "key");
                  }}
                  className="neo-btn bg-neo-yellow text-xs py-0 px-4 whitespace-nowrap"
                >
                  {copied === "key" ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
          </div>

          {/* Usage example */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 block">
              Quick Setup
            </label>
            <div className="bg-neo-black text-green-400 p-4 font-mono text-xs leading-relaxed border-[3px] border-neo-black overflow-x-auto">
              <div className="text-gray-500"># Add to your MCP config</div>
              <div>
                <span className="text-neo-yellow">{`"${server.name.toLowerCase().replace(/\s/g, "-")}"`}</span>: {"{"}
              </div>
              <div className="pl-4">
                <span className="text-neo-blue">{`"url"`}</span>: <span className="text-neo-green">{`"${server.url}"`}</span>,
              </div>
              <div className="pl-4">
                <span className="text-neo-blue">{`"apiKey"`}</span>: <span className="text-neo-green">{`"${server.api_key || "none"}"`}</span>
              </div>
              <div>{"}"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
