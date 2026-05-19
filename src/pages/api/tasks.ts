import { getDb, json, readJson } from "../../lib/db";

export const prerender = false;

type TaskUpdate = {
  id: number;
  task_id: number;
  update_text: string;
  action: string;
  created_at: string;
};

type Task = {
  id: number;
  producer: string;
  title: string;
  owner: string;
  status: string;
  priority: string;
  due_date: string;
  detail: string;
  notes: string;
  created_at: string;
  updated_at: string;
  updates?: TaskUpdate[];
};

export async function GET({ locals }: { locals: App.Locals }) {
  const db = getDb(locals);

  const [{ results: tasks }, { results: updates }] = await Promise.all([
    db.prepare("SELECT * FROM tasks ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, id DESC").all<Task>(),
    db.prepare("SELECT * FROM task_updates ORDER BY created_at DESC, id DESC").all<TaskUpdate>(),
  ]);

  const updatesByTask = new Map<number, TaskUpdate[]>();
  for (const update of updates) {
    const items = updatesByTask.get(update.task_id) || [];
    items.push(update);
    updatesByTask.set(update.task_id, items);
  }

  return json(tasks.map((task) => ({ ...task, updates: updatesByTask.get(task.id) || [] })));
}

export async function POST({ request, locals }: { request: Request; locals: App.Locals }) {
  const db = getDb(locals);
  const body = await readJson(request);

  if (!body.producer || !body.title || !body.owner) {
    return json({ error: "Üretici, iş ve sorumlu alanları zorunlu." }, { status: 400 });
  }

  const result = await db
    .prepare(`
      INSERT INTO tasks
      (producer, title, owner, status, priority, due_date, detail, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      body.producer,
      body.title,
      body.owner,
      body.status || "Beklemede",
      body.priority || "Orta",
      body.due_date || "",
      body.detail || "",
      body.notes || "",
    )
    .run();

  const taskId = result.meta.last_row_id;
  const updateText = body.update_text || "İş kaydı oluşturuldu.";

  await db
    .prepare("INSERT INTO task_updates (task_id, update_text, action) VALUES (?, ?, ?)")
    .bind(taskId, updateText, "Oluşturma")
    .run();

  return json({ success: true, id: taskId }, { status: 201 });
}
