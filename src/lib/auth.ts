import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { query } from "./db";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "mcp-marketplace-secret-key-change-in-production"
);

export interface UserPayload {
  id: number;
  username: string;
  role: string;
}

export async function createToken(user: UserPayload): Promise<string> {
  return new SignJWT({ id: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as UserPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<UserPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getCurrentUserFull() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { rows } = await query(
    "SELECT id, username, role, api_key, api_calls_used, api_calls_limit, created_at FROM users WHERE id = $1",
    [user.id]
  );
  return rows[0] || null;
}

export function requireAuth(user: UserPayload | null) {
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export function requireAdmin(user: UserPayload | null) {
  if (!user || user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return user;
}
