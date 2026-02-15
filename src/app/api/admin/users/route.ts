import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: users } = await query(
    "SELECT id, username, role, api_key, api_calls_used, api_calls_limit, created_at FROM users ORDER BY created_at DESC"
  );

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

    const fields: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (api_calls_limit !== undefined) {
      fields.push(`api_calls_limit = $${paramIdx++}`);
      values.push(api_calls_limit);
    }
    if (role !== undefined) {
      fields.push(`role = $${paramIdx++}`);
      values.push(role);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(userId);
    await query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const { rows } = await query(
      "SELECT id, username, role, api_key, api_calls_used, api_calls_limit, created_at FROM users WHERE id = $1",
      [userId]
    );

    return NextResponse.json({ user: rows[0] });
  } catch (error) {
    console.error("Admin update user error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
