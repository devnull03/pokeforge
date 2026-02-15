import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";
import { createToken } from "@/lib/auth";

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    if (username.length < 3) {
      return NextResponse.json(
        { error: "Username must be at least 3 characters" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username);

    if (existing) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 }
      );
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const apiKey = "mcp_" + generateKey();

    const result = db
      .prepare(
        "INSERT INTO users (username, password, role, api_key, api_calls_limit) VALUES (?, ?, 'user', ?, 100)"
      )
      .run(username, hashedPassword, apiKey);

    const token = await createToken({
      id: result.lastInsertRowid as number,
      username,
      role: "user",
    });

    const response = NextResponse.json({
      user: {
        id: result.lastInsertRowid,
        username,
        role: "user",
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
