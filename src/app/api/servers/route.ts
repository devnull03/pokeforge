import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const apiKey = req.headers.get("x-api-key") || searchParams.get("api_key");

    if (apiKey) {
      const { rows } = await query("SELECT * FROM users WHERE api_key = $1", [apiKey]);
      const user = rows[0];

      if (!user) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }

      if (user.api_calls_used >= user.api_calls_limit) {
        return NextResponse.json(
          { error: "API call limit exceeded", limit: user.api_calls_limit, used: user.api_calls_used },
          { status: 429 }
        );
      }

      await query(
        "UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = $1",
        [user.id]
      );
    }

    const { rows: servers } = await query(
      "SELECT id, name, description, url, website_url, color, icon, is_active, created_at FROM servers WHERE is_active = 1 ORDER BY created_at DESC"
    );

    return NextResponse.json({ servers });
  } catch (error) {
    console.error("List servers error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
