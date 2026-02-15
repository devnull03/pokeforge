import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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

    const { rows: existing } = await query(
      "SELECT * FROM servers WHERE id = $1",
      [params.id]
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const key of ["name", "description", "url", "website_url", "color", "icon", "is_active"]) {
      if (body[key] !== undefined) {
        fields.push(`${key} = $${paramIdx++}`);
        values.push(body[key]);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(params.id);
    await query(
      `UPDATE servers SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const { rows } = await query("SELECT * FROM servers WHERE id = $1", [params.id]);
    return NextResponse.json({ server: rows[0] });
  } catch (error) {
    console.error("Admin update server error:", error);
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

  const result = await query("DELETE FROM servers WHERE id = $1", [params.id]);

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
