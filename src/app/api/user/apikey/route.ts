import { NextResponse } from "next/server";
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

  const { rows } = await query(
    "SELECT api_key, api_calls_used, api_calls_limit FROM users WHERE id = $1",
    [user.id]
  );

  return NextResponse.json(rows[0]);
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const newKey = "mcp_" + generateKey();
  await query(
    "UPDATE users SET api_key = $1, api_calls_used = 0 WHERE id = $2",
    [newKey, user.id]
  );

  return NextResponse.json({ api_key: newKey });
}
