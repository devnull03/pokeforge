"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
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
        <div className="neo-card p-8 bg-neo-green text-center">
          <p className="font-bold">{user ? "Redirecting to dashboard..." : "Loading..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="neo-card p-8">
        <div className="text-center mb-8">
          <div className="inline-block w-16 h-16 bg-neo-green border-[3px] border-neo-black shadow-neo flex items-center justify-center text-3xl mb-4">
            🚀
          </div>
          <h1 className="text-3xl font-bold">Create Account</h1>
          <p className="text-gray-600 mt-2">Join MCP Market and start building</p>
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
              placeholder="Choose a username"
              minLength={3}
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
              placeholder="Min 6 characters"
              minLength={6}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold uppercase tracking-wider mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="neo-input"
              placeholder="Re-enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="neo-btn bg-neo-green w-full text-lg disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Account →"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <Link href="/login" className="font-bold underline hover:text-neo-pink">
              Log In
            </Link>
          </p>
        </div>
      </div>

      {/* Benefits */}
      <div className="neo-card p-4 mt-4 bg-neo-yellow">
        <p className="text-xs font-bold uppercase tracking-wider mb-3">What you get</p>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="font-bold">→</span> Personal API key with 100 free calls</li>
          <li className="flex items-center gap-2"><span className="font-bold">→</span> Create your own MCP servers</li>
          <li className="flex items-center gap-2"><span className="font-bold">→</span> Access all marketplace servers</li>
        </ul>
      </div>
    </div>
  );
}
