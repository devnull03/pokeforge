import { NextResponse } from "next/server";
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
  const userData = db
    .prepare("SELECT api_key, api_calls_used, api_calls_limit FROM users WHERE id = ?")
    .get(user.id) as any;

  return NextResponse.json(userData);
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const newKey = "mcp_" + generateKey();
  db.prepare("UPDATE users SET api_key = ?, api_calls_used = 0 WHERE id = ?").run(newKey, user.id);

  return NextResponse.json({ api_key: newKey });
}
