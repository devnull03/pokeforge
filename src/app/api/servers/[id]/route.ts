import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const apiKey = req.headers.get("x-api-key");

    if (apiKey) {
      const user = db
        .prepare("SELECT * FROM users WHERE api_key = ?")
        .get(apiKey) as any;

      if (!user) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }

      if (user.api_calls_used >= user.api_calls_limit) {
        return NextResponse.json(
          { error: "API call limit exceeded" },
          { status: 429 }
        );
      }

      db.prepare("UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = ?").run(user.id);
    }

    const server = db
      .prepare("SELECT * FROM servers WHERE id = ? AND is_active = 1")
      .get(params.id) as any;

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({ server });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
