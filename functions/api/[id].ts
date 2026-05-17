export async function onRequestPut({ request, env, params }: any) {
  const body = await request.json();

  await env.DB.prepare(`
    UPDATE tasks
    SET producer = ?,
        title = ?,
        owner = ?,
        status = ?,
        priority = ?,
        due_date = ?,
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
      body.notes || "",
      params.id
    )
    .run();

  return Response.json({ success: true });
}

export async function onRequestDelete({ env, params }: any) {
  await env.DB.prepare("DELETE FROM tasks WHERE id = ?")
    .bind(params.id)
    .run();

  return Response.json({ success: true });
}