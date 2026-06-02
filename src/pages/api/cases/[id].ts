import { getDb, json, readJson } from "../../../lib/db";

export const prerender = false;

export async function PUT({
  request,
  params,
  locals,
}: {
  request: Request;
  params: { id: string };
  locals: App.Locals;
}) {
  const db = getDb(locals);
  const body = await readJson(request);

  if (!body.title || !body.customer || !body.owner) {
    return json({ error: "Case başlığı, üretici/kaynak ve sorumlu alanları zorunlu." }, { status: 400 });
  }

  await db
    .prepare(`
      UPDATE cases
      SET title = ?,
          customer = ?,
          owner = ?,
          status = ?,
          priority = ?,
          opened_date = ?,
          summary = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      body.title,
      body.customer,
      body.owner,
      body.status,
      body.priority,
      body.opened_date || "",
      body.summary || "",
      params.id,
    )
    .run();

  if (body.update_text) {
    await db
      .prepare("INSERT INTO case_updates (case_id, update_text, action) VALUES (?, ?, ?)")
      .bind(params.id, body.update_text, "Güncelleme")
      .run();
  }

  return json({ success: true });
}

export async function DELETE({ params, locals }: { params: { id: string }; locals: App.Locals }) {
  const db = getDb(locals);
  await db.prepare("DELETE FROM cases WHERE id = ?").bind(params.id).run();
  return json({ success: true });
}
