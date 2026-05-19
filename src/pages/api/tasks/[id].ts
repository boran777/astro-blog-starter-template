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

  if (!body.producer || !body.title || !body.owner) {
    return json({ error: "Üretici, iş ve sorumlu alanları zorunlu." }, { status: 400 });
  }

  await db
    .prepare(`
      UPDATE tasks
      SET producer = ?,
          title = ?,
          owner = ?,
          status = ?,
          priority = ?,
          due_date = ?,
          detail = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      body.producer,
      body.title,
      body.owner,
      body.status,
      body.priority,
      body.due_date || "",
      body.detail || "",
      body.notes || "",
      params.id,
    )
    .run();

  if (body.update_text) {
    await db
      .prepare("INSERT INTO task_updates (task_id, update_text, action) VALUES (?, ?, ?)")
      .bind(params.id, body.update_text, "Güncelleme")
      .run();
  }

  return json({ success: true });
}

export async function DELETE({ params, locals }: { params: { id: string }; locals: App.Locals }) {
  const db = getDb(locals);

  await db.prepare("DELETE FROM task_updates WHERE task_id = ?").bind(params.id).run();
  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(params.id).run();

  return json({ success: true });
}
