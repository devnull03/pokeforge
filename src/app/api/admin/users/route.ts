import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const users = db
    .prepare(
      "SELECT id, username, role, api_key, api_calls_used, api_calls_limit, created_at FROM users ORDER BY created_at DESC"
    )
    .all();

  return NextResponse.json({ users });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { userId, api_calls_limit, role } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    const db = getDb();
    const fields: string[] = [];
    const values: any[] = [];

    if (api_calls_limit !== undefined) {
      fields.push("api_calls_limit = ?");
      values.push(api_calls_limit);
    }
    if (role !== undefined) {
      fields.push("role = ?");
      values.push(role);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(userId);
    db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    const updated = db
      .prepare("SELECT id, username, role, api_key, api_calls_used, api_calls_limit, created_at FROM users WHERE id = ?")
      .get(userId);

    return NextResponse.json({ user: updated });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
