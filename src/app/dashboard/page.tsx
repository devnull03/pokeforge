"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

interface UserData {
  id: number;
  username: string;
  role: string;
  api_key: string;
  api_calls_used: number;
  api_calls_limit: number;
}

interface Server {
  id: number;
  name: string;
  description: string;
  url: string;
  is_active: number;
  color: string;
  icon: string;
}

const COLORS = ["#ff6b9d", "#ffd93d", "#6bcbff", "#6bff9d", "#b06bff", "#ff9d6b"];
const ICONS = ["🌐", "📊", "💬", "📝", "🔧", "📦", "🎯", "⚡"];

type CreateMode = null | "manual" | "generate";

// Fun messages to cycle through during the long generation wait
const GENERATING_MESSAGES = [
  "Discovering website structure...",
  "Mapping out API endpoints...",
  "Analyzing page content...",
  "Building MCP tool definitions...",
  "Generating server code...",
  "Deploying to Modal...",
  "Almost there, hang tight...",
  "Wiring up the final connections...",
  "Running deployment checks...",
  "Polishing the MCP server...",
];

export default function DashboardPage() {
  const { user: authUser, loading: authLoading } = useAuth();
  const [user, setUser] = useState<UserData | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  // Manual create form
  const [newServer, setNewServer] = useState({
    name: "",
    description: "",
    url: "",
    website_url: "",
    color: COLORS[0],
    icon: ICONS[0],
  });

  // Generate form
  const [genUrl, setGenUrl] = useState("");
  const [genTurns, setGenTurns] = useState(15);
  const [genName, setGenName] = useState("");
  const [genDescription, setGenDescription] = useState("");
  const [genColor, setGenColor] = useState(COLORS[2]); // blue
  const [genIcon, setGenIcon] = useState("⚡");
  const [genMessageIdx, setGenMessageIdx] = useState(0);

  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !authUser) {
      router.push("/login");
    }
  }, [authUser, authLoading, router]);

  // Load user data
  useEffect(() => {
    if (!authUser) return;
    Promise.all([
      fetch("/api/user/apikey").then((r) => r.json()),
      fetch("/api/user/servers").then((r) => r.json()),
    ]).then(([keyData, serverData]) => {
      setUser({
        ...authUser,
        api_key: keyData.api_key,
        api_calls_used: keyData.api_calls_used,
        api_calls_limit: keyData.api_calls_limit,
      });
      setServers(serverData.servers || []);
      setLoading(false);
    });
  }, [authUser]);

  // Cycle fun messages during generation
  useEffect(() => {
    if (!creating || createMode !== "generate") return;
    const interval = setInterval(() => {
      setGenMessageIdx((i) => (i + 1) % GENERATING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [creating, createMode]);

  const deleteServer = async (serverId: number) => {
    if (!confirm("Delete this MCP server? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/user/servers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: serverId }),
      });
      if (res.ok) {
        setServers(servers.filter((s) => s.id !== serverId));
      }
    } catch {
      // ignore
    }
  };

  const regenerateKey = async () => {
    if (!confirm("Generate a new API key? The old one will stop working.")) return;
    const res = await fetch("/api/user/apikey", { method: "POST" });
    const data = await res.json();
    if (user) {
      setUser({ ...user, api_key: data.api_key, api_calls_used: 0 });
    }
  };

  const copyKey = () => {
    if (user?.api_key) {
      navigator.clipboard.writeText(user.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const createServerManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    setCreating(true);

    try {
      const res = await fetch("/api/user/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newServer),
      });
      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error);
        return;
      }

      setServers([data.server, ...servers]);
      setCreateMode(null);
      setNewServer({ name: "", description: "", url: "", website_url: "", color: COLORS[0], icon: ICONS[0] });
      setFormSuccess("Server created and live!");
    } catch {
      setFormError("Failed to create server");
    } finally {
      setCreating(false);
    }
  };

  const createServerGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    setCreating(true);
    setGenMessageIdx(0);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: genUrl,
          turns: genTurns,
          name: genName || undefined,
          description: genDescription || undefined,
          color: genColor,
          icon: genIcon,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || "Generation failed");
        if (data.raw_response) {
          setFormError((prev) => prev + "\n\nRaw response: " + data.raw_response);
        }
        return;
      }

      setServers([data.server, ...servers]);
      setCreateMode(null);
      setGenUrl("");
      setGenTurns(15);
      setGenName("");
      setGenDescription("");
      setFormSuccess(`MCP server generated and live! URL: ${data.mcp_url}`);
    } catch {
      setFormError("Failed to generate MCP server. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || loading || !user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="neo-card p-8 bg-neo-yellow text-center">
          <div className="text-3xl mb-2">⏳</div>
          <p className="font-bold">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const usagePercent = Math.round((user.api_calls_used / user.api_calls_limit) * 100);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600">Welcome back, {user.username}</p>
        </div>
        <div className="neo-badge bg-neo-green text-lg px-4 py-2">
          {user.role === "admin" ? "Admin" : "User"}
        </div>
      </div>

      {/* Success banner */}
      {formSuccess && (
        <div className="neo-card bg-neo-green p-4 mb-6 text-sm font-bold flex items-center justify-between">
          <span>{formSuccess}</span>
          <button onClick={() => setFormSuccess("")} className="text-lg font-bold ml-4">✕</button>
        </div>
      )}

      {/* API Key Section */}
      <div className="neo-card p-6 mb-8 bg-white">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span className="w-8 h-8 bg-neo-yellow border-[3px] border-neo-black flex items-center justify-center text-sm">🔑</span>
          Your API Key
        </h2>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            readOnly
            value={user.api_key || "No key generated"}
            className="neo-input flex-1 font-mono text-sm"
          />
          <button onClick={copyKey} className="neo-btn bg-neo-blue whitespace-nowrap">
            {copied ? "Copied!" : "Copy Key"}
          </button>
          <button onClick={regenerateKey} className="neo-btn bg-neo-pink whitespace-nowrap">
            Regenerate
          </button>
        </div>

        {/* Usage meter */}
        <div>
          <div className="flex justify-between text-sm font-bold mb-2">
            <span>API Usage</span>
            <span>{user.api_calls_used} / {user.api_calls_limit} calls</span>
          </div>
          <div className="w-full h-8 border-[3px] border-neo-black bg-white overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${Math.min(usagePercent, 100)}%`,
                backgroundColor:
                  usagePercent > 90 ? "#ff6b9d" : usagePercent > 60 ? "#ffd93d" : "#6bff9d",
              }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 font-mono">
            {usagePercent}% used — {user.api_calls_limit - user.api_calls_used} calls remaining
          </p>
        </div>
      </div>

      {/* API Usage example */}
      <div className="neo-card p-6 mb-8 bg-neo-black text-white">
        <h3 className="font-bold mb-3 text-neo-yellow">Quick Start: Use the API</h3>
        <div className="font-mono text-sm leading-relaxed overflow-x-auto">
          <div className="text-gray-400"># List all servers</div>
          <div>
            <span className="text-neo-green">curl</span>{" "}
            <span className="text-neo-blue">-H</span>{" "}
            <span className="text-neo-yellow">{`"x-api-key: ${user.api_key}"`}</span>{" "}
            <span className="text-white">{"\\"}
            </span>
          </div>
          <div className="pl-4 text-neo-pink">
            {typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/api/servers
          </div>
        </div>
      </div>

      {/* My Servers */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">My MCP Servers</h2>
          {createMode === null && (
            <div className="flex gap-2">
              <button
                onClick={() => { setCreateMode("generate"); setFormError(""); setFormSuccess(""); }}
                className="neo-btn bg-neo-purple text-white text-sm"
              >
                ⚡ Generate from Website
              </button>
              <button
                onClick={() => { setCreateMode("manual"); setFormError(""); setFormSuccess(""); }}
                className="neo-btn bg-neo-green text-sm"
              >
                + Add Manually
              </button>
            </div>
          )}
          {createMode !== null && (
            <button
              onClick={() => { setCreateMode(null); setFormError(""); }}
              className="neo-btn bg-white text-sm"
            >
              Cancel
            </button>
          )}
        </div>

        {/* ==================== GENERATE FROM WEBSITE ==================== */}
        {createMode === "generate" && (
          <div className="neo-card p-0 mb-6 overflow-hidden">
            {/* Header bar */}
            <div className="bg-neo-purple text-white p-4 border-b-[3px] border-neo-black">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <h3 className="font-bold text-lg">Generate MCP from Website</h3>
                  <p className="text-sm opacity-90">
                    Enter any website URL and we&apos;ll auto-discover it, generate an MCP server, and deploy it live. Takes 2-10 minutes.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white">
              {formError && (
                <div className="neo-card bg-neo-pink p-3 mb-4 text-sm font-bold whitespace-pre-wrap">
                  {formError}
                </div>
              )}

              {/* Generating overlay */}
              {creating && (
                <div className="neo-card p-8 mb-4 bg-neo-yellow text-center">
                  <div className="text-4xl mb-3 animate-bounce">⚡</div>
                  <h4 className="text-xl font-bold mb-2">Generating your MCP Server...</h4>
                  <p className="text-sm font-mono mb-4 h-6 transition-all">
                    {GENERATING_MESSAGES[genMessageIdx]}
                  </p>
                  <div className="w-full h-4 border-[3px] border-neo-black bg-white overflow-hidden">
                    <div className="h-full bg-neo-purple animate-pulse" style={{ width: "100%" }} />
                  </div>
                  <p className="text-xs text-gray-600 mt-3">
                    This takes 2-10 minutes. Please don&apos;t close this page.
                  </p>
                </div>
              )}

              {!creating && (
                <form onSubmit={createServerGenerate} className="space-y-4">
                  {/* Main inputs */}
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">
                      Website URL <span className="text-neo-pink">*</span>
                    </label>
                    <input
                      value={genUrl}
                      onChange={(e) => setGenUrl(e.target.value)}
                      className="neo-input"
                      placeholder="https://www.amazon.com"
                      type="url"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The full URL of the website you want to turn into an MCP server.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">
                      Exploration Turns
                    </label>
                    <input
                      value={genTurns}
                      onChange={(e) => setGenTurns(Number(e.target.value))}
                      className="neo-input w-32"
                      type="number"
                      min={1}
                      max={50}
                    />
                    <p className="text-xs text-gray-500 mt-1">More turns = deeper discovery but longer wait time. Default: 15</p>
                  </div>

                  {/* Optional overrides */}
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider text-gray-500 hover:text-neo-black transition-colors">
                      Optional: Customize name, description & style ▾
                    </summary>
                    <div className="mt-3 space-y-4 pl-0">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-bold uppercase tracking-wider mb-1">Server Name</label>
                          <input
                            value={genName}
                            onChange={(e) => setGenName(e.target.value)}
                            className="neo-input"
                            placeholder="Auto-generated from URL"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold uppercase tracking-wider mb-1">Description</label>
                          <input
                            value={genDescription}
                            onChange={(e) => setGenDescription(e.target.value)}
                            className="neo-input"
                            placeholder="Auto-generated"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-bold uppercase tracking-wider mb-1">Color</label>
                          <div className="flex gap-2 flex-wrap">
                            {COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setGenColor(c)}
                                className={`w-10 h-10 border-[3px] border-neo-black transition-transform ${
                                  genColor === c ? "scale-110 shadow-neo" : ""
                                }`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-bold uppercase tracking-wider mb-1">Icon</label>
                          <div className="flex gap-2 flex-wrap">
                            {ICONS.map((i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setGenIcon(i)}
                                className={`w-10 h-10 border-[3px] border-neo-black bg-white flex items-center justify-center transition-transform ${
                                  genIcon === i ? "scale-110 shadow-neo" : ""
                                }`}
                              >
                                {i}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>

                  <button
                    type="submit"
                    className="neo-btn bg-neo-purple text-white text-lg"
                  >
                    ⚡ Generate MCP Server
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ==================== MANUAL CREATE ==================== */}
        {createMode === "manual" && (
          <div className="neo-card p-0 mb-6 overflow-hidden">
            <div className="bg-neo-green p-4 border-b-[3px] border-neo-black">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔧</span>
                <div>
                  <h3 className="font-bold text-lg">Add Server Manually</h3>
                  <p className="text-sm opacity-80">
                    Already have an MCP server? Add it to the marketplace directly.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-white">
              {formError && (
                <div className="neo-card bg-neo-pink p-3 mb-4 text-sm font-bold">
                  {formError}
                </div>
              )}
              <form onSubmit={createServerManual} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">Name <span className="text-neo-pink">*</span></label>
                    <input
                      value={newServer.name}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                      className="neo-input"
                      placeholder="My MCP Server"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">Website URL</label>
                    <input
                      value={newServer.website_url}
                      onChange={(e) => setNewServer({ ...newServer, website_url: e.target.value })}
                      className="neo-input"
                      placeholder="https://example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase tracking-wider mb-1">MCP Server URL <span className="text-neo-pink">*</span></label>
                  <input
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                    className="neo-input"
                    placeholder="https://mcp.example.com/api"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase tracking-wider mb-1">Description <span className="text-neo-pink">*</span></label>
                  <textarea
                    value={newServer.description}
                    onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                    className="neo-input min-h-[80px]"
                    placeholder="Describe what your MCP server does..."
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">Color</label>
                    <div className="flex gap-2 flex-wrap">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewServer({ ...newServer, color: c })}
                          className={`w-10 h-10 border-[3px] border-neo-black transition-transform ${
                            newServer.color === c ? "scale-110 shadow-neo" : ""
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-wider mb-1">Icon</label>
                    <div className="flex gap-2 flex-wrap">
                      {ICONS.map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setNewServer({ ...newServer, icon: i })}
                          className={`w-10 h-10 border-[3px] border-neo-black bg-white flex items-center justify-center transition-transform ${
                            newServer.icon === i ? "scale-110 shadow-neo" : ""
                          }`}
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="neo-btn bg-neo-black text-white disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Add Server →"}
                </button>
              </form>
              <p className="text-xs mt-3 text-gray-500">
                Your server will appear in the marketplace immediately.
              </p>
            </div>
          </div>
        )}

        {/* Server list */}
        {servers.length === 0 && createMode === null ? (
          <div className="neo-card p-8 text-center bg-white">
            <div className="text-5xl mb-4">🔌</div>
            <h3 className="font-bold text-lg mb-2">No servers yet</h3>
            <p className="text-sm text-gray-600 mb-6">Create your first MCP server to get started.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => setCreateMode("generate")}
                className="neo-btn bg-neo-purple text-white"
              >
                ⚡ Generate from Website
              </button>
              <button
                onClick={() => setCreateMode("manual")}
                className="neo-btn bg-neo-green"
              >
                + Add Manually
              </button>
            </div>
          </div>
        ) : servers.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {servers.map((s) => (
              <div key={s.id} className="neo-card p-4 bg-white">
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 border-[3px] border-neo-black flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: s.color + "40" }}
                  >
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold truncate">{s.name}</h4>
                      <span
                        className={`neo-badge text-[10px] ${
                          s.is_active ? "bg-neo-green" : "bg-neo-orange"
                        }`}
                      >
                        {s.is_active ? "Active" : "Pending"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2">{s.description}</p>
                  </div>
                  <button
                    onClick={() => deleteServer(s.id)}
                    className="neo-btn bg-neo-pink text-xs py-1 px-2 shrink-0"
                    title="Delete server"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
