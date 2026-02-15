import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const db = getDb();

    const existing = db.prepare("SELECT * FROM servers WHERE id = ?").get(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const fields: string[] = [];
    const values: any[] = [];

    for (const key of ["name", "description", "url", "website_url", "color", "icon", "is_active"]) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(params.id);
    db.prepare(`UPDATE servers SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(params.id);
    return NextResponse.json({ server });
  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM servers WHERE id = ?").run(params.id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
