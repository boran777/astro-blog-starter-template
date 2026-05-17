export const prerender = false;

export async function GET({ locals }: any) {
  const runtime = locals.runtime;
  const db = runtime.env.DB;

  const { results } = await db
    .prepare("SELECT * FROM tasks ORDER BY id DESC")
    .all();

  return new Response(JSON.stringify(results), {
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export async function POST({ request, locals }: any) {
  const runtime = locals.runtime;
  const db = runtime.env.DB;

  const body = await request.json();

  await db.prepare(`
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