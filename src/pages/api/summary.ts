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
    ownerSummary,
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
    db
      .prepare(`
        SELECT owner AS name, COUNT(*) AS count
        FROM tasks
        WHERE status NOT IN ('Tamamlandı', 'İptal Edildi')
        GROUP BY owner
        ORDER BY count DESC, owner ASC
        LIMIT 7
      `)
      .all<{ name: string; count: number }>(),
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

  return json({
    openTasks: openTasks?.count || 0,
    blockedTasks: blockedTasks?.count || 0,
    activeCases: activeCases?.count || 0,
    highPriority: (highPriorityTasks?.count || 0) + (highPriorityCases?.count || 0),
    producerSummary: producerSummary.results,
    ownerSummary: ownerSummary.results,
    recentUpdates: recentUpdates.results,
  });
}
