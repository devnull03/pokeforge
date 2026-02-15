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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const servers = db
    .prepare("SELECT * FROM servers WHERE created_by = ? ORDER BY created_at DESC")
    .all(user.id);

  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // User-created servers start inactive (need admin approval in the future)
    const result = db
      .prepare(
        "INSERT INTO servers (name, description, url, website_url, color, icon, api_key, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)"
      )
      .run(name, description, url, website_url || null, color || "#ff6b9d", icon || "🌐", apiKey, user.id);

    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json({ server }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
