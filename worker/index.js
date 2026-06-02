import astroWorker from "../dist/_worker.js/index.js";

const DEFAULT_REPORT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DEFAULT_REPORT_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

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
  const [taskCounts, caseCounts, openTasks, todayUpdates, todayCaseUpdates, todayCases] = await Promise.all([
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
      SELECT case_updates.update_text,
             case_updates.action,
             case_updates.created_at,
             cases.title AS case_title,
             cases.owner,
             cases.customer,
             cases.status,
             cases.priority
      FROM case_updates
      JOIN cases ON cases.id = case_updates.case_id
      WHERE case_updates.created_at >= datetime('now', '-24 hours')
      ORDER BY case_updates.created_at DESC, case_updates.id DESC
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
    todayCaseUpdates: todayCaseUpdates.results,
    activeCases: todayCases.results,
  };
}

function fallbackReport(data) {
  const formatTime = (value) =>
    value
      ? new Intl.DateTimeFormat("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Istanbul",
        }).format(new Date(value))
      : "-";

  const taskUpdates = data.todayUpdates || [];
  const caseUpdates = data.todayCaseUpdates || [];
  const lines = ["Gün Sonu Operasyon Raporu", "", "1. Son Güncellemeler"];

  if (taskUpdates.length || caseUpdates.length) {
    taskUpdates.forEach((update) => {
      lines.push(
        `- [${formatTime(update.created_at)}] ${update.task_title} / ${update.owner} / ${update.producer}: ${update.update_text}`,
      );
    });
    caseUpdates.forEach((update) => {
      lines.push(
        `- [${formatTime(update.created_at)}] ${update.case_title} / ${update.owner} / ${update.customer}: ${update.update_text}`,
      );
    });
  } else {
    lines.push("Kayıt yok.");
  }

  lines.push("", "2. Caseler");
  if (data.activeCases.length) {
    data.activeCases.slice(0, 12).forEach((item) => {
      lines.push(`- [${item.priority}] ${item.title} / ${item.customer} / ${item.owner} / ${item.status}: ${item.summary || "-"}`);
    });
  } else {
    lines.push("Kayıt yok.");
  }

  lines.push("", "3. Tamamlanmamış İşler");
  if (data.openTasks.length) {
    data.openTasks.slice(0, 12).forEach((task) => {
      lines.push(`- [${task.priority}] ${task.title} / ${task.producer} / ${task.owner} / ${task.status}`);
    });
  } else {
    lines.push("Kayıt yok.");
  }

  lines.push("", "4. Kısa Operasyon Notu");
  lines.push("Ek not yok.");
  return lines.join("\n");
}

function extractAiText(response) {
  if (typeof response?.response === "string") return response.response;
  if (typeof response?.output_text === "string") return response.output_text;
  if (typeof response?.result?.response === "string") return response.result.response;
  if (typeof response?.result?.output_text === "string") return response.result.output_text;
  if (Array.isArray(response?.output)) {
    return response.output
      .flatMap((item) => item.content || [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function runReportModel(env, model, messages) {
  const response = await env.AI.run(model, {
    messages,
    max_tokens: 900,
    temperature: 0.2,
  });
  return extractAiText(response);
}

async function generateReport(env, data) {
  if (!env.AI) {
    return fallbackReport(data);
  }

  const messages = [
    {
      role: "system",
      content:
        "Allianz Siber Güvenlik Operasyon Merkezi için gün sonu operasyon raporu hazırlayan kısa, net ve veriye bağlı bir analistsin. Türkçe yaz. Reklam dili, genel tavsiye, tahmin, gereksiz giriş ve kapanış cümlesi kullanma. Veride olmayan bilgi uydurma. Kişi, üretici, case ve iş adlarını aynen koru. Veri yoksa ilgili bölümde 'Kayıt yok.' yaz.",
    },
    {
      role: "user",
      content: `Aşağıdaki JSON verisinden gün sonu operasyon raporu üret.

Rapor sırası ve kuralları:
1. Son Güncellemeler
- Önce son 24 saatte girilen task güncellemelerini ve case güncellemelerini yaz.
- Her madde formatı: "- [saat] başlık / sorumlu / üretici veya kaynak: güncelleme"
- Güncelleme yoksa sadece "Kayıt yok." yaz.

2. Caseler
- Aktif caseleri listele.
- Her madde formatı: "- [öncelik] case başlığı / kaynak / sorumlu / durum: kısa özet"
- Aktif case yoksa "Kayıt yok." yaz.

3. Tamamlanmamış İşler
- Tamamlanmamış açık işleri öncelik sırasıyla listele.
- Yüksek öncelik ve blokaj durumlarını en üste al.
- Her madde formatı: "- [öncelik] iş başlığı / üretici / sorumlu / durum"
- En fazla 12 madde yaz. Benzer işleri birleştirme, başlıkları değiştirme.

4. Kısa Operasyon Notu
- En fazla 3 madde yaz.
- Sadece veriden anlaşılan risk, blokaj veya takip ihtiyacını belirt.
- Veri yetersizse "Ek not yok." yaz.

Veri:
${JSON.stringify(data, null, 2)}`,
    },
  ];

  const primaryModel = env.REPORT_MODEL || DEFAULT_REPORT_MODEL;
  const fallbackModel = env.REPORT_FALLBACK_MODEL || DEFAULT_REPORT_FALLBACK_MODEL;

  try {
    const report = await runReportModel(env, primaryModel, messages);
    if (report) return report;
    throw new Error(`${primaryModel} returned an empty report.`);
  } catch (error) {
    console.error("Primary Workers AI report generation failed, trying fallback model.", error);
  }

  try {
    const report = await runReportModel(env, fallbackModel, messages);
    if (report) return report;
  } catch (error) {
    console.error("Fallback Workers AI report generation failed, using static fallback report.", error);
  }

  return fallbackReport(data);
}

function reportToHtml(reportText) {
  const lines = String(reportText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sections = [];
  let currentSection = null;

  lines.forEach((line) => {
    const heading = line.replace(/^#+\s*/, "");
    if (/^(Son Güncellemeler|Caseler|Tamamlanmamış İşler|Kısa Operasyon Notu)/i.test(heading)) {
      currentSection = { title: heading, items: [] };
      sections.push(currentSection);
      return;
    }

    if (!currentSection) {
      currentSection = { title: "Operasyon Raporu", items: [] };
      sections.push(currentSection);
    }

    currentSection.items.push(line.replace(/^[-•]\s*/, ""));
  });

  const renderedSections = sections
    .map((section) => {
      const items = section.items.length ? section.items : ["Kayıt yok."];
      return `
        <tr>
          <td style="padding:0 0 16px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfe6f0;border-radius:8px;background:#ffffff">
              <tr>
                <td style="padding:14px 16px;border-bottom:1px solid #dfe6f0;background:#f8fafc;border-radius:8px 8px 0 0">
                  <h3 style="margin:0;color:#003781;font-size:16px;line-height:22px">${escapeHtml(section.title)}</h3>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 16px">
                  <ul style="margin:0;padding-left:20px;color:#142033;font-size:14px;line-height:21px">
                    ${items.map((item) => `<li style="margin:0 0 8px">${escapeHtml(item)}</li>`).join("")}
                  </ul>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join("");

  const reportDate = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date());

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#142033">
      <tr>
        <td style="padding:24px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;margin:0 auto">
            <tr>
              <td style="padding:18px 20px 16px;background:#0050aa;border-radius:8px;color:#ffffff">
                <h2 style="margin:0 0 6px;font-size:22px;line-height:28px">Gün Sonu Operasyon Raporu</h2>
                <p style="margin:0;font-size:14px;line-height:20px">Siber Güvenlik Operasyon Merkezi · ${escapeHtml(reportDate)}</p>
              </td>
            </tr>
            <tr><td style="height:16px"></td></tr>
            ${renderedSections}
          </table>
        </td>
      </tr>
    </table>
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
