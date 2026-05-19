import { getDb, json } from "../../lib/db";

export const prerender = false;

export async function GET({ locals }: { locals: App.Locals }) {
  const db = getDb(locals);

  const [
    openTasks,
    blockedTasks,
    activeCases,
    highPriorityTasks,
    highPriorityCases,
    producerSummary,
    openTaskOwners,
    recentUpdates,
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status NOT IN ('Tamamlandı', 'İptal Edildi')").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'Blokaj'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM cases WHERE status != 'Kapalı'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE priority = 'Yüksek' AND status NOT IN ('Tamamlandı', 'İptal Edildi')").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM cases WHERE priority = 'Yüksek'").first<{ count: number }>(),
    db
      .prepare(`
        SELECT producer AS name, COUNT(*) AS count
        FROM tasks
        WHERE status NOT IN ('Tamamlandı', 'İptal Edildi')
        GROUP BY producer
        ORDER BY count DESC, producer ASC
        LIMIT 8
      `)
      .all<{ name: string; count: number }>(),
    db.prepare("SELECT owner FROM tasks WHERE status NOT IN ('Tamamlandı', 'İptal Edildi')").all<{ owner: string }>(),
    db
      .prepare(`
        SELECT task_updates.id,
               task_updates.update_text,
               task_updates.created_at,
               tasks.title AS task_title
        FROM task_updates
        JOIN tasks ON tasks.id = task_updates.task_id
        ORDER BY task_updates.created_at DESC, task_updates.id DESC
        LIMIT 6
      `)
      .all<{ id: number; update_text: string; created_at: string; task_title: string }>(),
  ]);

  const ownerCounts = new Map<string, number>();
  for (const task of openTaskOwners.results) {
    const owners = task.owner
      .split(",")
      .map((owner) => owner.trim())
      .filter(Boolean)
      .map((owner) => (owner === "Allianz Ekib" ? "Allianz Ekibi" : owner));

    for (const owner of owners) {
      ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
    }
  }

  const ownerSummary = [...ownerCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"))
    .slice(0, 7);

  return json({
    openTasks: openTasks?.count || 0,
    blockedTasks: blockedTasks?.count || 0,
    activeCases: activeCases?.count || 0,
    highPriority: (highPriorityTasks?.count || 0) + (highPriorityCases?.count || 0),
    producerSummary: producerSummary.results,
    ownerSummary,
    recentUpdates: recentUpdates.results,
  });
}
