import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const apiKey = req.headers.get("x-api-key");

    if (apiKey) {
      const { rows } = await query("SELECT * FROM users WHERE api_key = $1", [apiKey]);
      const user = rows[0];

      if (!user) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }

      if (user.api_calls_used >= user.api_calls_limit) {
        return NextResponse.json(
          { error: "API call limit exceeded" },
          { status: 429 }
        );
      }

      await query(
        "UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = $1",
        [user.id]
      );
    }

    const { rows } = await query(
      "SELECT * FROM servers WHERE id = $1 AND is_active = 1",
      [params.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    return NextResponse.json({ server: rows[0] });
  } catch (error) {
    console.error("Get server error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
