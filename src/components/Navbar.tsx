"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export default function Navbar() {
  const { user, loading, setUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMenuOpen(false);
    router.push("/");
    router.refresh();
  };

  return (
    <nav className="border-b-[3px] border-neo-black bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 bg-neo-yellow border-[3px] border-neo-black flex items-center justify-center font-bold text-lg shadow-neo group-hover:shadow-neo-hover group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 transition-all">
              M
            </div>
            <span className="font-bold text-xl tracking-tight hidden sm:block">
              MCP Market
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/" className="neo-btn bg-white text-sm py-2 px-4">
              Browse
            </Link>
            <Link href="/inspector" className="neo-btn bg-neo-purple text-white text-sm py-2 px-4">
              🔍 Inspector
            </Link>

            {loading ? (
              <div className="neo-badge bg-gray-200 animate-pulse w-20 h-8" />
            ) : user ? (
              <>
                <Link href="/dashboard" className="neo-btn bg-neo-blue text-sm py-2 px-4">
                  Dashboard
                </Link>
                {user.role === "admin" && (
                  <Link href="/admin" className="neo-btn bg-neo-purple text-white text-sm py-2 px-4">
                    Admin
                  </Link>
                )}

                {/* Logged-in user pill + sign out */}
                <div className="flex items-center gap-0">
                  <div
                    className="flex items-center gap-2 px-4 py-2 border-[3px] border-neo-black bg-white border-r-0 text-sm font-bold"
                    style={{ boxShadow: "0 4px 0px 0px #1a1a2e" }}
                  >
                    <div
                      className={`w-7 h-7 border-[2px] border-neo-black flex items-center justify-center text-xs font-bold ${
                        user.role === "admin" ? "bg-neo-purple text-white" : "bg-neo-green"
                      }`}
                    >
                      {user.username[0].toUpperCase()}
                    </div>
                    <div className="leading-tight">
                      <span>{user.username}</span>
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 ml-1">
                        ({user.role})
                      </span>
                    </div>
                  </div>
                  <button onClick={logout} className="neo-btn bg-neo-pink text-sm py-2 px-4 hover:bg-red-400">
                    Sign Out
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link href="/login" className="neo-btn bg-neo-yellow text-sm py-2 px-4">
                  Login
                </Link>
                <Link href="/register" className="neo-btn bg-neo-green text-sm py-2 px-4">
                  Sign Up
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden neo-btn bg-white py-2 px-3">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile Nav */}
        {menuOpen && (
          <div className="md:hidden pb-4 flex flex-col gap-2">
            <Link href="/" className="neo-btn bg-white text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
              Browse
            </Link>
            <Link href="/inspector" className="neo-btn bg-neo-purple text-white text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
              🔍 Inspector
            </Link>
            {loading ? null : user ? (
              <>
                {/* Mobile: show who's logged in */}
                <div className="neo-card p-3 bg-white flex items-center gap-3">
                  <div
                    className={`w-9 h-9 border-[2px] border-neo-black flex items-center justify-center text-sm font-bold shrink-0 ${
                      user.role === "admin" ? "bg-neo-purple text-white" : "bg-neo-green"
                    }`}
                  >
                    {user.username[0].toUpperCase()}
                  </div>
                  <div className="text-sm">
                    <span className="font-bold">{user.username}</span>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 ml-1">({user.role})</span>
                  </div>
                </div>
                <Link href="/dashboard" className="neo-btn bg-neo-blue text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
                  Dashboard
                </Link>
                {user.role === "admin" && (
                  <Link href="/admin" className="neo-btn bg-neo-purple text-white text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
                    Admin
                  </Link>
                )}
                <button onClick={logout} className="neo-btn bg-neo-pink text-sm py-2 hover:bg-red-400">
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="neo-btn bg-neo-yellow text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
                  Login
                </Link>
                <Link href="/register" className="neo-btn bg-neo-green text-sm py-2 text-center" onClick={() => setMenuOpen(false)}>
                  Sign Up
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
