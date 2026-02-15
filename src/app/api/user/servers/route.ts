import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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

  const { rows: servers } = await query(
    "SELECT * FROM servers WHERE created_by = $1 ORDER BY created_at DESC",
    [user.id]
  );

  return NextResponse.json({ servers });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Server ID is required" }, { status: 400 });
    }

    // Only allow deleting your own servers
    const result = await query(
      "DELETE FROM servers WHERE id = $1 AND created_by = $2",
      [id, user.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete server error:", error);
    return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    );
  }
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

    const apiKey = "sk_" + name.toLowerCase().replace(/\s/g, "_") + "_" + generateKey();

    const { rows } = await query(
      "INSERT INTO servers (name, description, url, website_url, color, icon, api_key, is_active, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8) RETURNING *",
      [name, description, url, website_url || null, color || "#ff6b9d", icon || "🌐", apiKey, user.id]
    );

    return NextResponse.json({ server: rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error("Create server error:", error);
    return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    );
  }
}
