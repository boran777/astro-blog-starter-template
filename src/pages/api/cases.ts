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
  updates?: CaseUpdate[];
};

type CaseUpdate = {
  id: number;
  case_id: number;
  update_text: string;
  action: string;
  created_at: string;
};

export async function GET({ locals }: { locals: App.Locals }) {
  const db = getDb(locals);
  const [{ results: cases }, { results: updates }] = await Promise.all([
    db.prepare("SELECT * FROM cases ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, id DESC").all<CaseRecord>(),
    db.prepare("SELECT * FROM case_updates ORDER BY created_at DESC, id DESC").all<CaseUpdate>(),
  ]);

  const updatesByCase = new Map<number, CaseUpdate[]>();
  for (const update of updates) {
    const items = updatesByCase.get(update.case_id) || [];
    items.push(update);
    updatesByCase.set(update.case_id, items);
  }

  return json(cases.map((item) => ({ ...item, updates: updatesByCase.get(item.id) || [] })));
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

  const caseId = result.meta.last_row_id;
  const updateText = body.update_text || body.summary || "Case kaydı oluşturuldu.";

  await db
    .prepare("INSERT INTO case_updates (case_id, update_text, action) VALUES (?, ?, ?)")
    .bind(caseId, updateText, "Oluşturma")
    .run();

  return json({ success: true, id: caseId }, { status: 201 });
}
