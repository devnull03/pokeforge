import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const servers = db.prepare("SELECT * FROM servers ORDER BY created_at DESC").all();
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { name, description, url, website_url, color, icon } = await req.json();

    if (!name || !description || !url) {
      return NextResponse.json(
        { error: "Name, description, and URL are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const apiKey = "sk_" + name.toLowerCase().replace(/\s/g, "_") + "_" + generateKey();

    const result = db
      .prepare(
        "INSERT INTO servers (name, description, url, website_url, color, icon, api_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        name,
        description,
        url,
        website_url || null,
        color || "#ff6b9d",
        icon || "🌐",
        apiKey,
        user.id
      );

    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json({ server }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
