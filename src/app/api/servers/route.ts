import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const apiKey = req.headers.get("x-api-key") || searchParams.get("api_key");

    // If API key provided, validate and track usage
    if (apiKey) {
      const user = db
        .prepare("SELECT * FROM users WHERE api_key = ?")
        .get(apiKey) as any;

      if (!user) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }

      if (user.api_calls_used >= user.api_calls_limit) {
        return NextResponse.json(
          { error: "API call limit exceeded", limit: user.api_calls_limit, used: user.api_calls_used },
          { status: 429 }
        );
      }

      // Increment usage
      db.prepare("UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = ?").run(user.id);
    }

    const servers = db
      .prepare("SELECT id, name, description, url, website_url, color, icon, is_active, created_at FROM servers WHERE is_active = 1 ORDER BY created_at DESC")
      .all();

    return NextResponse.json({ servers });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
