import { getDb, json, readJson } from "../../lib/db";

export const prerender = false;

type CaseRecord = {
  id: number;
  title: string;
  customer: string;
  owner: string;
  status: string;
  priority: string;
  opened_date: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export async function GET({ locals }: { locals: App.Locals }) {
  const db = getDb(locals);
  const { results } = await db.prepare("SELECT * FROM cases ORDER BY id DESC").all<CaseRecord>();
  return json(results);
}

export async function POST({ request, locals }: { request: Request; locals: App.Locals }) {
  const db = getDb(locals);
  const body = await readJson(request);

  if (!body.title || !body.customer || !body.owner) {
    return json({ error: "Case başlığı, üretici/kaynak ve sorumlu alanları zorunlu." }, { status: 400 });
  }

  const result = await db
    .prepare(`
      INSERT INTO cases
      (title, customer, owner, status, priority, opened_date, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      body.title,
      body.customer,
      body.owner,
      body.status || "Açık",
      body.priority || "Orta",
      body.opened_date || "",
      body.summary || "",
    )
    .run();

  return json({ success: true, id: result.meta.last_row_id }, { status: 201 });
}
