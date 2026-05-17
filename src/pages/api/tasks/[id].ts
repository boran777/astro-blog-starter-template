export const prerender = false;

export async function PUT({ request, params, locals }: any) {
  const runtime = locals.runtime;
  const db = runtime.env.DB;

  const body = await request.json();

  await db.prepare(`
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

  return new Response(
    JSON.stringify({
      success: true
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

export async function DELETE({ params, locals }: any) {
  const runtime = locals.runtime;
  const db = runtime.env.DB;

  await db.prepare("DELETE FROM tasks WHERE id = ?")
    .bind(params.id)
    .run();

  return new Response(
    JSON.stringify({
      success: true
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}