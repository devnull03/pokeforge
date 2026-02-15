"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user, loading: authLoading, setUser } = useAuth();

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      router.push("/dashboard");
    }
  }, [user, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      // Update shared auth context — Navbar updates instantly
      setUser(data.user);
      router.push("/dashboard");
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // Don't render the form if already logged in or still checking
  if (authLoading || user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="neo-card p-8 bg-neo-yellow text-center">
          <p className="font-bold">{user ? "Redirecting to dashboard..." : "Loading..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="neo-card p-8">
        <div className="text-center mb-8">
          <div className="inline-block w-16 h-16 bg-neo-yellow border-[3px] border-neo-black shadow-neo flex items-center justify-center text-3xl mb-4">
            🔐
          </div>
          <h1 className="text-3xl font-bold">Welcome Back</h1>
          <p className="text-gray-600 mt-2">Log in to your MCP Market account</p>
        </div>

        {error && (
          <div className="neo-card bg-neo-pink p-3 mb-6 text-sm font-bold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold uppercase tracking-wider mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="neo-input"
              placeholder="Enter username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold uppercase tracking-wider mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="neo-input"
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="neo-btn bg-neo-yellow w-full text-lg disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Log In →"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-bold underline hover:text-neo-pink">
              Sign Up
            </Link>
          </p>
        </div>
      </div>

      {/* Demo credentials */}
      <div className="neo-card p-4 mt-4 bg-neo-blue">
        <p className="text-xs font-bold uppercase tracking-wider mb-2">Demo Credentials</p>
        <div className="grid grid-cols-2 gap-3 text-sm font-mono">
          <div>
            <span className="text-xs text-gray-700">Admin:</span>
            <br />admin / admin123
          </div>
          <div>
            <span className="text-xs text-gray-700">User:</span>
            <br />demo / user123
          </div>
        </div>
      </div>
    </div>
  );
}
