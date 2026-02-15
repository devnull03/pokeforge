import { query } from "@/lib/db";
import ServerCard from "@/components/ServerCard";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { rows: servers } = await query(
    "SELECT * FROM servers WHERE is_active = 1 ORDER BY created_at DESC"
  );

  return (
    <div>
      {/* Hero */}
      <section className="mb-12">
        <div className="neo-card p-8 sm:p-12 bg-neo-yellow relative overflow-hidden">
          <div className="relative z-10">
            <div className="neo-badge bg-white mb-4">New Platform</div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4 leading-tight">
              Make Any Website
              <br />
              <span className="inline-block bg-neo-pink text-white px-3 py-1 border-[3px] border-neo-black shadow-neo -rotate-1">
                an MCP Server
              </span>
            </h1>
            <p className="text-lg sm:text-xl max-w-2xl mb-6 leading-relaxed">
              The marketplace for MCP servers. Browse, connect, and create your
              own MCP servers from any website. Plug into AI with one click.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className="neo-btn bg-neo-black text-white">
                Get Started
              </Link>
              <a href="#servers" className="neo-btn bg-white">
                Browse Servers ↓
              </a>
              <Link href="/inspector" className="neo-btn bg-neo-purple text-white">
                🔍 MCP Inspector
              </Link>
            </div>
          </div>

          {/* Decorative elements */}
          <div className="absolute top-4 right-4 w-20 h-20 bg-neo-blue border-[3px] border-neo-black rotate-12 hidden sm:block" />
          <div className="absolute bottom-4 right-24 w-12 h-12 bg-neo-green border-[3px] border-neo-black -rotate-6 hidden sm:block" />
          <div className="absolute top-1/2 right-12 w-8 h-8 bg-neo-purple border-[3px] border-neo-black rotate-45 hidden sm:block" />
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 mb-12">
        {[
          { label: "MCP Servers", value: servers.length, color: "bg-neo-blue" },
          { label: "Websites Connected", value: servers.length, color: "bg-neo-pink" },
        ].map((stat) => (
          <div key={stat.label} className={`neo-card p-4 ${stat.color}`}>
            <div className="text-3xl font-bold">{stat.value}</div>
            <div className="text-sm font-mono uppercase tracking-wider mt-1">
              {stat.label}
            </div>
          </div>
        ))}
      </section>

      {/* Server Grid */}
      <section id="servers">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold">
            Available Servers
          </h2>
          <div className="neo-badge bg-neo-yellow">
            {servers.length} servers
          </div>
        </div>

        {servers.length === 0 ? (
          <div className="neo-card p-12 text-center bg-white">
            <div className="text-5xl mb-4">🔌</div>
            <h3 className="text-xl font-bold mb-2">No servers yet</h3>
            <p className="text-gray-600">
              Be the first to create an MCP server!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {servers.map((server: any) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="mt-16 mb-8">
        <div className="neo-card p-8 sm:p-12 bg-neo-green text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Build Your Own MCP Server
          </h2>
          <p className="text-lg mb-6 max-w-xl mx-auto">
            Turn any website into an MCP-compatible server. Sign up and start
            building today.
          </p>
          <Link href="/register" className="neo-btn bg-neo-black text-white inline-block">
            Create Account →
          </Link>
        </div>
      </section>
    </div>
  );
}
