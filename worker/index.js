import astroWorker from "../dist/_worker.js/index.js";

const REPORT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function collectReportData(env) {
  const [taskCounts, caseCounts, openTasks, todayUpdates, todayCases] = await Promise.all([
    env.DB.prepare(`
      SELECT status, priority, COUNT(*) AS count
      FROM tasks
      GROUP BY status, priority
      ORDER BY status, priority
    `).all(),
    env.DB.prepare(`
      SELECT status, priority, COUNT(*) AS count
      FROM cases
      GROUP BY status, priority
      ORDER BY status, priority
    `).all(),
    env.DB.prepare(`
      SELECT id, producer, title, owner, status, priority, due_date, detail, updated_at
      FROM tasks
      WHERE status != 'Tamamlandı'
      ORDER BY
        CASE priority WHEN 'Yüksek' THEN 0 WHEN 'Orta' THEN 1 ELSE 2 END,
        due_date ASC,
        id DESC
      LIMIT 30
    `).all(),
    env.DB.prepare(`
      SELECT task_updates.update_text,
             task_updates.action,
             task_updates.created_at,
             tasks.title AS task_title,
             tasks.owner,
             tasks.producer
      FROM task_updates
      JOIN tasks ON tasks.id = task_updates.task_id
      WHERE task_updates.created_at >= datetime('now', '-24 hours')
      ORDER BY task_updates.created_at DESC, task_updates.id DESC
      LIMIT 30
    `).all(),
    env.DB.prepare(`
      SELECT id, title, customer, owner, status, priority, opened_date, summary, updated_at
      FROM cases
      WHERE status != 'Kapalı'
      ORDER BY
        CASE priority WHEN 'Yüksek' THEN 0 WHEN 'Orta' THEN 1 ELSE 2 END,
        id DESC
      LIMIT 30
    `).all(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    taskCounts: taskCounts.results,
    caseCounts: caseCounts.results,
    openTasks: openTasks.results,
    todayUpdates: todayUpdates.results,
    activeCases: todayCases.results,
  };
}

function fallbackReport(data) {
  const openTaskCount = data.openTasks.length;
  const activeCaseCount = data.activeCases.length;
  const highPriorityTasks = data.openTasks.filter((task) => task.priority === "Yüksek").length;
  const blockedTasks = data.openTasks.filter((task) => task.status === "Blokaj").length;

  const lines = [
    `Gün sonu operasyon özeti`,
    ``,
    `Açık iş: ${openTaskCount}`,
    `Aktif case: ${activeCaseCount}`,
    `Yüksek öncelikli açık iş: ${highPriorityTasks}`,
    `Blokajdaki iş: ${blockedTasks}`,
    `Son 24 saat güncelleme: ${data.todayUpdates.length}`,
  ];

  if (data.openTasks.length) {
    lines.push("", "Öne çıkan açık işler:");
    data.openTasks.slice(0, 8).forEach((task) => {
      lines.push(`- [${task.priority}] ${task.title} / ${task.owner} / ${task.status}`);
    });
  }

  if (data.activeCases.length) {
    lines.push("", "Aktif caseler:");
    data.activeCases.slice(0, 8).forEach((item) => {
      lines.push(`- [${item.priority}] ${item.title} / ${item.owner} / ${item.status}`);
    });
  }

  return lines.join("\n");
}

async function generateReport(env, data) {
  if (!env.AI) {
    return fallbackReport(data);
  }

  const messages = [
    {
      role: "system",
      content:
        "Allianz Siber Güvenlik Operasyon Merkezi için gün sonu raporu hazırlayan, kısa ve net yazan bir operasyon analistisin. Türkçe yaz. Reklam dili kullanma. Riskleri, blokajları, aksiyon bekleyen işleri ve gün içi hareketleri maddeleyerek özetle.",
    },
    {
      role: "user",
      content: `Aşağıdaki JSON verisinden gün sonu operasyon raporu üret. Format:
1. Kısa özet
2. Kritik / yüksek öncelikli konular
3. Bugünkü güncellemeler
4. Yarın takip edilecekler

Veri:
${JSON.stringify(data, null, 2)}`,
    },
  ];

  try {
    const response = await env.AI.run(REPORT_MODEL, {
      messages,
      max_tokens: 900,
      temperature: 0.2,
    });

    return response.response || fallbackReport(data);
  } catch (error) {
    console.error("Workers AI report generation failed, using fallback report.", error);
    return fallbackReport(data);
  }
}

function reportToHtml(reportText) {
  return `
    <div style="font-family:Arial,sans-serif;color:#142033;line-height:1.5">
      <h2>Allianz Siber Güvenlik Operasyon Merkezi - Gün Sonu Raporu</h2>
      <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f5f7fb;border:1px solid #dfe6f0;padding:16px;border-radius:8px">${escapeHtml(reportText)}</pre>
    </div>
  `;
}

async function sendReportEmail(env, reportText) {
  if (!env.EMAIL) {
    return { sent: false, reason: "EMAIL binding tanımlı değil." };
  }
  if (!env.REPORT_FROM || !env.REPORT_TO) {
    return { sent: false, reason: "REPORT_FROM ve REPORT_TO tanımlı değil." };
  }

  const subjectDate = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date());

  const result = await env.EMAIL.send({
    from: env.REPORT_FROM,
    to: env.REPORT_TO,
    subject: `Gün Sonu Operasyon Raporu - ${subjectDate}`,
    text: reportText,
    html: reportToHtml(reportText),
  });

  return { sent: true, result };
}

async function buildAndMaybeSendReport(env, { sendEmail = false } = {}) {
  const data = await collectReportData(env);
  const report = await generateReport(env, data);
  const email = sendEmail ? await sendReportEmail(env, report) : { sent: false, reason: "preview" };
  return { report, data, email };
}

function isAuthorized(request, env) {
  if (!env.REPORT_TOKEN) return false;
  const url = new URL(request.url);
  return request.headers.get("x-report-token") === env.REPORT_TOKEN || url.searchParams.get("token") === env.REPORT_TOKEN;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/daily-report") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }

      const sendEmail = request.method === "POST" || url.searchParams.get("send") === "1";
      try {
        return json(await buildAndMaybeSendReport(env, { sendEmail }));
      } catch (error) {
        return json({ error: error.message || "Rapor oluşturulamadı." }, { status: 500 });
      }
    }

    return astroWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildAndMaybeSendReport(env, { sendEmail: true }));
  },
};
