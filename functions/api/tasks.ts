export async function onRequestGet({ env }: any) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM tasks ORDER BY id DESC"
  ).all();

  return Response.json(results);
}

export async function onRequestPost({ request, env }: any) {
  const body = await request.json();

  const result = await env.DB.prepare(`
    INSERT INTO tasks 
    (producer, title, owner, status, priority, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      body.producer,
      body.title,
      body.owner,
      body.status || "Beklemede",
      body.priority || "Orta",
      body.due_date || "",
      body.notes || ""
    )
    .run();

  return Response.json({ success: true, result });
}