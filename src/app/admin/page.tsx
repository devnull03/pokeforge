"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  created_by: number;
  created_at: string;
}

interface User {
  id: number;
  username: string;
  role: string;
  api_key: string;
  api_calls_used: number;
  api_calls_limit: number;
  created_at: string;
}

const COLORS = ["#ff6b9d", "#ffd93d", "#6bcbff", "#6bff9d", "#b06bff", "#ff9d6b"];
const ICONS = ["🌐", "📊", "💬", "📝", "🔧", "📦", "🎯", "⚡"];

export default function AdminPage() {
  const [tab, setTab] = useState<"servers" | "users">("servers");
  const [servers, setServers] = useState<Server[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<number | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const [newServer, setNewServer] = useState({
    name: "",
    description: "",
    url: "",
    website_url: "",
    color: COLORS[0],
    icon: ICONS[0],
  });
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user || data.user.role !== "admin") {
          router.push("/login");
          return;
        }
        loadData();
      });
  }, [router]);

  const loadData = async () => {
    const [serverRes, userRes] = await Promise.all([
      fetch("/api/admin/servers").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ]);
    setServers(serverRes.servers || []);
    setUsers(userRes.users || []);
    setLoading(false);
  };

  const toggleServer = async (id: number, is_active: number) => {
    await fetch(`/api/admin/servers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: is_active ? 0 : 1 }),
    });
    setServers(
      servers.map((s) =>
        s.id === id ? { ...s, is_active: is_active ? 0 : 1 } : s
      )
    );
  };

  const deleteServer = async (id: number) => {
    if (!confirm("Delete this server permanently?")) return;
    await fetch(`/api/admin/servers/${id}`, { method: "DELETE" });
    setServers(servers.filter((s) => s.id !== id));
  };

  const createServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newServer),
    });
    const data = await res.json();
    if (res.ok) {
      setServers([data.server, ...servers]);
      setShowCreate(false);
      setNewServer({ name: "", description: "", url: "", website_url: "", color: COLORS[0], icon: ICONS[0] });
    }
  };

  const updateUserLimit = async (userId: number) => {
    const limit = parseInt(editLimit);
    if (isNaN(limit) || limit < 0) return;
    await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, api_calls_limit: limit }),
    });
    setUsers(users.map((u) => (u.id === userId ? { ...u, api_calls_limit: limit } : u)));
    setEditingUser(null);
    setEditLimit("");
  };

  const toggleUserRole = async (userId: number, currentRole: string) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    if (!confirm(`Change this user's role to ${newRole}?`)) return;
    await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    setUsers(users.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="neo-card p-8 bg-neo-purple text-white text-center">
          <div className="text-3xl mb-2">⚙️</div>
          <p className="font-bold">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-gray-600">Manage servers, users, and settings</p>
        </div>
        <div className="neo-badge bg-neo-purple text-white text-lg px-4 py-2">Admin</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="neo-card p-4 bg-neo-blue">
          <div className="text-2xl font-bold">{servers.length}</div>
          <div className="text-xs font-mono uppercase">Total Servers</div>
        </div>
        <div className="neo-card p-4 bg-neo-green">
          <div className="text-2xl font-bold">{servers.filter((s) => s.is_active).length}</div>
          <div className="text-xs font-mono uppercase">Active</div>
        </div>
        <div className="neo-card p-4 bg-neo-yellow">
          <div className="text-2xl font-bold">{users.length}</div>
          <div className="text-xs font-mono uppercase">Total Users</div>
        </div>
        <div className="neo-card p-4 bg-neo-pink">
          <div className="text-2xl font-bold">{users.filter((u) => u.role === "admin").length}</div>
          <div className="text-xs font-mono uppercase">Admins</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("servers")}
          className={`neo-btn text-sm ${tab === "servers" ? "bg-neo-blue" : "bg-white"}`}
        >
          Servers ({servers.length})
        </button>
        <button
          onClick={() => setTab("users")}
          className={`neo-btn text-sm ${tab === "users" ? "bg-neo-yellow" : "bg-white"}`}
        >
          Users ({users.length})
        </button>
      </div>

      {/* SERVERS TAB */}
      {tab === "servers" && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="neo-btn bg-neo-green text-sm"
            >
              {showCreate ? "Cancel" : "+ Add Server"}
            </button>
          </div>

          {showCreate && (
            <div className="neo-card p-6 mb-6 bg-neo-green">
              <h3 className="font-bold mb-4">Add New MCP Server</h3>
              <form onSubmit={createServer} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold uppercase mb-1">Name</label>
                    <input
                      value={newServer.name}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                      className="neo-input"
                      placeholder="Server Name"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase mb-1">Website URL</label>
                    <input
                      value={newServer.website_url}
                      onChange={(e) => setNewServer({ ...newServer, website_url: e.target.value })}
                      className="neo-input"
                      placeholder="https://example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase mb-1">MCP Server URL</label>
                  <input
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                    className="neo-input"
                    placeholder="https://mcp.example.com/api"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase mb-1">Description</label>
                  <textarea
                    value={newServer.description}
                    onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                    className="neo-input min-h-[80px]"
                    placeholder="Description..."
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold uppercase mb-1">Color</label>
                    <div className="flex gap-2 flex-wrap">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewServer({ ...newServer, color: c })}
                          className={`w-8 h-8 border-[3px] border-neo-black ${newServer.color === c ? "scale-110 shadow-neo" : ""}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase mb-1">Icon</label>
                    <div className="flex gap-2 flex-wrap">
                      {ICONS.map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setNewServer({ ...newServer, icon: i })}
                          className={`w-8 h-8 border-[3px] border-neo-black bg-white flex items-center justify-center text-sm ${newServer.icon === i ? "scale-110 shadow-neo" : ""}`}
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button type="submit" className="neo-btn bg-neo-black text-white">
                  Create Server →
                </button>
              </form>
            </div>
          )}

          {/* Server list */}
          <div className="space-y-3">
            {servers.map((s) => (
              <div key={s.id} className="neo-card p-4 bg-white">
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 border-[3px] border-neo-black flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: s.color + "40" }}
                  >
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-bold">{s.name}</h4>
                      <span className={`neo-badge text-[10px] ${s.is_active ? "bg-neo-green" : "bg-gray-300"}`}>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">ID: {s.id}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-2">{s.description}</p>
                    <p className="text-xs font-mono text-gray-400">{s.url}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => toggleServer(s.id, s.is_active)}
                      className={`neo-btn text-xs py-1 px-3 ${s.is_active ? "bg-neo-orange" : "bg-neo-green"}`}
                    >
                      {s.is_active ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => deleteServer(s.id)}
                      className="neo-btn text-xs py-1 px-3 bg-neo-pink"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* USERS TAB */}
      {tab === "users" && (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="neo-card p-4 bg-white">
              <div className="flex items-center gap-4 flex-wrap">
                <div
                  className={`w-10 h-10 border-[3px] border-neo-black flex items-center justify-center font-bold text-sm ${
                    u.role === "admin" ? "bg-neo-purple text-white" : "bg-neo-yellow"
                  }`}
                >
                  {u.username[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold">{u.username}</h4>
                    <span className={`neo-badge text-[10px] ${u.role === "admin" ? "bg-neo-purple text-white" : "bg-neo-blue"}`}>
                      {u.role}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-400 mt-1">
                    API: {u.api_calls_used}/{u.api_calls_limit} calls used
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  {editingUser === u.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value)}
                        className="neo-input w-24 py-1 text-sm"
                        placeholder="Limit"
                      />
                      <button
                        onClick={() => updateUserLimit(u.id)}
                        className="neo-btn text-xs py-1 px-3 bg-neo-green"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingUser(null)}
                        className="neo-btn text-xs py-1 px-3 bg-white"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingUser(u.id);
                          setEditLimit(String(u.api_calls_limit));
                        }}
                        className="neo-btn text-xs py-1 px-3 bg-neo-yellow"
                      >
                        Edit Limit
                      </button>
                      <button
                        onClick={() => toggleUserRole(u.id, u.role)}
                        className="neo-btn text-xs py-1 px-3 bg-neo-blue"
                      >
                        Toggle Role
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
