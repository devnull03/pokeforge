import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";
import { createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = await createToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
