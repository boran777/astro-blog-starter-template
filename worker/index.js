import astroWorker from "../dist/_worker.js/index.js";
import { EmailMessage } from "cloudflare:email";

const DEFAULT_REPORT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DEFAULT_REPORT_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const OPEN_TASK_STATUSES_EXCLUDED = ["Tamamlandı", "İptal Edildi"];

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

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(date);
}

function columnName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function worksheetXml(rows, columnWidths = []) {
  const cols = columnWidths.length
    ? `<cols>${columnWidths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const sheetData = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, colIndex) => {
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            const style = rowIndex === 0 ? ' s="1"' : "";
            return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(cell)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${cols}
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${sheetData}</sheetData>
  <autoFilter ref="A1:${columnName(Math.max(rows[0]?.length || 1, 1) - 1)}${Math.max(rows.length, 1)}"/>
</worksheet>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")}</sheets>
</workbook>`;
}

function workbookRelsXml(sheets) {
  const sheetRels = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheets) {
  const sheetTypes = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetTypes}
</Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0050AA"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const output = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const checksum = crc32(dataBytes);
    const localOffset = offset;

    pushUint32(output, 0x04034b50);
    pushUint16(output, 20);
    pushUint16(output, 0);
    pushUint16(output, 0);
    pushUint16(output, 0);
    pushUint16(output, 0);
    pushUint32(output, checksum);
    pushUint32(output, dataBytes.length);
    pushUint32(output, dataBytes.length);
    pushUint16(output, nameBytes.length);
    pushUint16(output, 0);
    output.push(...nameBytes, ...dataBytes);
    offset = output.length;

    pushUint32(central, 0x02014b50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, checksum);
    pushUint32(central, dataBytes.length);
    pushUint32(central, dataBytes.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, localOffset);
    central.push(...nameBytes);
  }

  const centralOffset = output.length;
  output.push(...central);
  pushUint32(output, 0x06054b50);
  pushUint16(output, 0);
  pushUint16(output, 0);
  pushUint16(output, files.length);
  pushUint16(output, files.length);
  pushUint32(output, central.length);
  pushUint32(output, centralOffset);
  pushUint16(output, 0);

  return new Uint8Array(output);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trim();
}

function encodeHeader(value) {
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
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

async function collectOpenTasksExportData(env) {
  const excludedStatuses = OPEN_TASK_STATUSES_EXCLUDED.map(() => "?").join(", ");
  const [{ results: tasks }, { results: updates }] = await Promise.all([
    env.DB.prepare(`
      SELECT id, producer, title, owner, status, priority, due_date, detail, notes, created_at, updated_at
      FROM tasks
      WHERE status NOT IN (${excludedStatuses})
      ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC, id DESC
    `)
      .bind(...OPEN_TASK_STATUSES_EXCLUDED)
      .all(),
    env.DB.prepare(`
      SELECT task_updates.task_id,
             task_updates.update_text,
             task_updates.action,
             task_updates.created_at,
             tasks.title AS task_title
      FROM task_updates
      JOIN tasks ON tasks.id = task_updates.task_id
      WHERE tasks.status NOT IN (${excludedStatuses})
      ORDER BY datetime(task_updates.created_at) DESC, task_updates.id DESC
    `)
      .bind(...OPEN_TASK_STATUSES_EXCLUDED)
      .all(),
  ]);

  return { tasks, updates };
}

function createOpenTasksWorkbook({ tasks, updates }) {
  const taskRows = [
    ["ID", "Kayıt Tarihi", "Güncelleme Tarihi", "Üretici", "İş", "Sorumlu", "Durum", "Öncelik", "Detay", "Notlar"],
    ...tasks.map((task) => [
      task.id,
      formatDateTime(task.created_at),
      formatDateTime(task.updated_at),
      task.producer,
      task.title,
      task.owner,
      task.status,
      task.priority,
      task.detail,
      task.notes,
    ]),
  ];
  const updateRows = [
    ["İş ID", "İş", "Tarih", "Aksiyon", "Güncelleme"],
    ...updates.map((update) => [
      update.task_id,
      update.task_title,
      formatDateTime(update.created_at),
      update.action,
      update.update_text,
    ]),
  ];
  const sheets = [
    {
      name: "Açık İşler",
      xml: worksheetXml(taskRows, [8, 17, 17, 20, 42, 28, 16, 12, 60, 42]),
    },
    {
      name: "Güncelleme Geçmişi",
      xml: worksheetXml(updateRows, [9, 42, 17, 16, 80]),
    },
  ];

  return createZip([
    { name: "[Content_Types].xml", content: contentTypesXml(sheets) },
    { name: "_rels/.rels", content: relsXml() },
    { name: "xl/workbook.xml", content: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(sheets) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheet.xml })),
  ]);
}

function createOpenTasksExcelHtml({ tasks, updates }) {
  const cell = (value) => `<td>${escapeHtml(value)}</td>`;
  const header = (value) => `<th>${escapeHtml(value)}</th>`;
  const taskRows = tasks
    .map(
      (task) => `<tr>
        ${cell(task.id)}
        ${cell(formatDateTime(task.created_at))}
        ${cell(formatDateTime(task.updated_at))}
        ${cell(task.producer)}
        ${cell(task.title)}
        ${cell(task.owner)}
        ${cell(task.status)}
        ${cell(task.priority)}
        ${cell(task.detail)}
        ${cell(task.notes)}
      </tr>`,
    )
    .join("");
  const updateRows = updates
    .map(
      (update) => `<tr>
        ${cell(update.task_id)}
        ${cell(update.task_title)}
        ${cell(formatDateTime(update.created_at))}
        ${cell(update.action)}
        ${cell(update.update_text)}
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Calibri, Arial, sans-serif; }
    table { border-collapse: collapse; margin-bottom: 28px; }
    th { background: #0050aa; color: #fff; font-weight: 700; }
    th, td { border: 1px solid #c8d2e0; padding: 6px 8px; vertical-align: top; mso-number-format: "\\@"; }
    td { white-space: normal; }
    h2 { color: #003781; }
  </style>
</head>
<body>
  <h2>Açık İşler</h2>
  <table>
    <thead><tr>
      ${["ID", "Kayıt Tarihi", "Güncelleme Tarihi", "Üretici", "İş", "Sorumlu", "Durum", "Öncelik", "Detay", "Notlar"].map(header).join("")}
    </tr></thead>
    <tbody>${taskRows}</tbody>
  </table>
  <h2>Güncelleme Geçmişi</h2>
  <table>
    <thead><tr>
      ${["İş ID", "İş", "Tarih", "Aksiyon", "Güncelleme"].map(header).join("")}
    </tr></thead>
    <tbody>${updateRows}</tbody>
  </table>
</body>
</html>`;
}

async function sendOpenTasksExportEmail(env) {
  if (!env.EMAIL) {
    return { sent: false, reason: "EMAIL binding tanımlı değil." };
  }
  if (!env.REPORT_FROM || !env.REPORT_TO) {
    return { sent: false, reason: "REPORT_FROM ve REPORT_TO tanımlı değil." };
  }

  const data = await collectOpenTasksExportData(env);
  const workbook = new TextEncoder().encode(createOpenTasksExcelHtml(data));
  const reportDate = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date());
  const filenameDate = new Intl.DateTimeFormat("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Istanbul",
  })
    .format(new Date())
    .replaceAll(".", "-");
  const filename = `Allianz_Acik_Isler_${filenameDate}.xls`;
  const boundary = `allianz-open-tasks-${crypto.randomUUID()}`;
  const subject = `Açık İşler Excel - ${reportDate}`;
  const text = `Merhaba,\n\nGüncel açık işler Excel dosyası ektedir.\n\nAçık iş sayısı: ${data.tasks.length}\nGüncelleme kaydı: ${data.updates.length}\n`;
  const html = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#142033">
      <tr><td>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dfe6f0;border-radius:8px">
          <tr><td style="padding:18px 20px;background:#0050aa;color:#ffffff;border-radius:8px 8px 0 0">
            <h2 style="margin:0;font-size:20px;line-height:26px">Açık İşler Excel</h2>
            <p style="margin:6px 0 0;font-size:14px">${escapeHtml(reportDate)}</p>
          </td></tr>
          <tr><td style="padding:18px 20px;font-size:14px;line-height:21px">
            <p style="margin:0 0 12px">Güncel açık işler Excel dosyası ektedir.</p>
            <p style="margin:0"><strong>Açık iş sayısı:</strong> ${data.tasks.length}</p>
            <p style="margin:4px 0 0"><strong>Güncelleme kaydı:</strong> ${data.updates.length}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;
  const raw = [
    `From: ${env.REPORT_FROM}`,
    `To: ${env.REPORT_TO}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}-alt"`,
    "",
    `--${boundary}-alt`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}-alt`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}-alt--`,
    "",
    `--${boundary}`,
    `Content-Type: application/vnd.ms-excel; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "",
    bytesToBase64(workbook),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  await env.EMAIL.send(new EmailMessage(env.REPORT_FROM, env.REPORT_TO, raw));
  return {
    sent: true,
    taskCount: data.tasks.length,
    updateCount: data.updates.length,
    filename,
  };
}

async function collectWeeklyReportData(env) {
  const [openTasks, activeCases] = await Promise.all([
    env.DB.prepare(`
      SELECT tasks.producer,
             tasks.title,
             tasks.owner,
             tasks.status,
             tasks.priority,
             tasks.created_at,
             tasks.updated_at,
             MAX(task_updates.created_at) AS latest_update_at
      FROM tasks
      LEFT JOIN task_updates ON task_updates.task_id = tasks.id
      WHERE tasks.status NOT IN ('Tamamlandı', 'İptal Edildi')
      GROUP BY tasks.id
      ORDER BY
        CASE tasks.status WHEN 'Üzerinde Çalışılıyor' THEN 0 WHEN 'Blokaj' THEN 1 WHEN 'Beklemede' THEN 2 ELSE 3 END,
        datetime(COALESCE(MAX(task_updates.created_at), tasks.updated_at, tasks.created_at)) DESC,
        tasks.id DESC
    `).all(),
    env.DB.prepare(`
      SELECT cases.title,
             cases.customer,
             cases.owner,
             cases.status,
             cases.priority,
             cases.opened_date,
             cases.updated_at,
             MAX(case_updates.created_at) AS latest_update_at
      FROM cases
      LEFT JOIN case_updates ON case_updates.case_id = cases.id
      WHERE cases.status != 'Kapalı'
      GROUP BY cases.id
      ORDER BY datetime(COALESCE(MAX(case_updates.created_at), cases.updated_at, cases.created_at)) DESC, cases.id DESC
    `).all(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    openTasks: openTasks.results,
    activeCases: activeCases.results,
  };
}

function renderWeeklyRows(items, columns, emptyMessage) {
  if (!items.length) {
    return `<tr><td colspan="${columns.length}" style="padding:14px 12px;color:#64748b;border:1px solid #dbe3ef">${escapeHtml(emptyMessage)}</td></tr>`;
  }

  return items
    .map(
      (item) => `<tr>${columns
        .map(({ key, format }) => {
          const value = format ? format(item[key], item) : item[key];
          return `<td style="padding:10px 12px;border:1px solid #dbe3ef;vertical-align:top;color:#142033;font-size:13px;line-height:18px">${escapeHtml(value || "-")}</td>`;
        })
        .join("")}</tr>`,
    )
    .join("");
}

function renderWeeklyTable(title, count, columns, rowsHtml) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 18px;background:#ffffff;border:1px solid #dbe3ef;border-radius:8px;overflow:hidden">
      <tr>
        <td colspan="${columns.length}" style="padding:14px 16px;background:#f8fafc;border-bottom:1px solid #dbe3ef">
          <h3 style="margin:0;color:#003781;font-size:17px;line-height:22px">${escapeHtml(title)} <span style="color:#64748b;font-weight:400">(${count})</span></h3>
        </td>
      </tr>
      <tr>
        ${columns
          .map(
            (column) =>
              `<th align="left" style="padding:10px 12px;background:#0050aa;color:#ffffff;border:1px solid #0050aa;font-size:12px;line-height:16px">${escapeHtml(column.label)}</th>`,
          )
          .join("")}
      </tr>
      ${rowsHtml}
    </table>
  `;
}

function fallbackWeeklySummary(data) {
  const workingCount = data.openTasks.filter((task) => task.status === "Üzerinde Çalışılıyor").length;
  const blockedCount = data.openTasks.filter((task) => task.status === "Blokaj").length;
  const highPriorityCount = data.openTasks.filter((task) => task.priority === "Yüksek").length;
  const producerCounts = new Map();

  data.openTasks.forEach((task) => {
    producerCounts.set(task.producer || "Belirsiz", (producerCounts.get(task.producer || "Belirsiz") || 0) + 1);
  });
  data.activeCases.forEach((item) => {
    producerCounts.set(item.customer || "Belirsiz", (producerCounts.get(item.customer || "Belirsiz") || 0) + 1);
  });

  const producerSummary = [...producerCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
    .slice(0, 4)
    .map(([producer, count]) => `${producer}: ${count}`)
    .join(", ");

  return [
    `Bu hafta ${data.activeCases.length} açık case ve ${data.openTasks.length} açık iş takipte.`,
    producerSummary ? `Üretici bazlı yoğunluk: ${producerSummary}.` : "Üretici bazlı açık kayıt bulunmuyor.",
    `Açık işlerin ${workingCount} tanesi üzerinde çalışılıyor durumunda.`,
    blockedCount || highPriorityCount
      ? `${blockedCount} blokaj ve ${highPriorityCount} yüksek öncelikli açık iş özellikle takip edilmeli.`
      : "Kritik blokaj görünmüyor; takip açık işlerin güncel durumlarına göre sürüyor.",
  ].join("\n");
}

async function generateWeeklySummary(env, data) {
  if (!env.AI) {
    return fallbackWeeklySummary(data);
  }

  const messages = [
    {
      role: "system",
      content:
        "Allianz Siber Güvenlik Operasyon Merkezi için haftalık operasyon mailinin giriş yorumunu yazan kısa ve net bir analistsin. Türkçe yaz. Reklam dili kullanma. Veride olmayan bilgi uydurma.",
    },
    {
      role: "user",
      content: `Aşağıdaki haftalık operasyon verisine göre mailin başına koyulacak kısa AI yorumunu üret.

Kurallar:
- En fazla 4 madde yaz.
- İlk maddede açık case ve açık iş sayılarını mutlaka belirt.
- Bir maddede üretici/kaynak bazlı dağılımı belirt; açık işlerde producer, caselerde customer alanını kullan.
- Üzerinde çalışılıyor, blokaj ve yüksek öncelik varsa kısaca vurgula.
- Genel tavsiye verme, sadece veriden görünen operasyon durumunu yaz.

Veri:
${JSON.stringify(data, null, 2)}`,
    },
  ];

  try {
    const summary = await runReportModel(env, env.REPORT_MODEL || DEFAULT_REPORT_MODEL, messages);
    if (summary) return summary;
  } catch (error) {
    console.error("Weekly AI summary generation failed, using fallback.", error);
  }

  return fallbackWeeklySummary(data);
}

function renderWeeklySummary(summaryText) {
  const items = String(summaryText || "")
    .split("\n")
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean);

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 18px;background:#ffffff;border:1px solid #dbe3ef;border-radius:8px;overflow:hidden">
      <tr>
        <td style="padding:14px 16px;background:#f8fafc;border-bottom:1px solid #dbe3ef">
          <h3 style="margin:0;color:#003781;font-size:17px;line-height:22px">Kısa Özet</h3>
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
  `;
}

function weeklyReportToHtml(data, summaryText = "") {
  const reportDate = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date());
  const dateOnly = (value) => (value ? formatDateTime(value).replace(/ \d{2}:\d{2}$/, "") : "-");
  const latestDate = (value, item) => formatDateTime(value || item.updated_at || item.created_at || item.opened_date);
  const taskColumns = [
    { key: "producer", label: "Üretici" },
    { key: "title", label: "İş" },
    { key: "owner", label: "Sorumlu" },
    { key: "status", label: "Durum" },
    { key: "priority", label: "Öncelik" },
    { key: "created_at", label: "Kayıt Tarihi", format: dateOnly },
    { key: "latest_update_at", label: "Son Güncelleme", format: latestDate },
  ];
  const caseColumns = [
    { key: "title", label: "Case" },
    { key: "customer", label: "Üretici / Kaynak" },
    { key: "owner", label: "Sorumlu" },
    { key: "status", label: "Durum" },
    { key: "priority", label: "Öncelik" },
    { key: "opened_date", label: "Açılış", format: dateOnly },
    { key: "latest_update_at", label: "Son Güncelleme", format: latestDate },
  ];
  const casesTable = renderWeeklyTable(
    "Açık Caseler",
    data.activeCases.length,
    caseColumns,
    renderWeeklyRows(data.activeCases, caseColumns, "Açık case bulunmuyor."),
  );
  const tasksTable = renderWeeklyTable(
    "Açık İşler",
    data.openTasks.length,
    taskColumns,
    renderWeeklyRows(data.openTasks, taskColumns, "Açık iş bulunmuyor."),
  );

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#142033">
      <tr>
        <td style="padding:24px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:980px;margin:0 auto">
            <tr>
              <td style="padding:18px 20px 16px;background:#0050aa;border-radius:8px;color:#ffffff">
                <h2 style="margin:0 0 6px;font-size:22px;line-height:28px">Haftalık Operasyon Takibi</h2>
                <p style="margin:0;font-size:14px;line-height:20px">Siber Güvenlik Operasyon Merkezi · ${escapeHtml(reportDate)}</p>
              </td>
            </tr>
            <tr><td style="height:16px"></td></tr>
            <tr><td>${renderWeeklySummary(summaryText || fallbackWeeklySummary(data))}</td></tr>
            <tr><td>${casesTable}</td></tr>
            <tr><td>${tasksTable}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function weeklyReportToText(data, summaryText = "") {
  const lines = ["Haftalık Operasyon Takibi", "", "Kısa Özet"];
  lines.push(summaryText || fallbackWeeklySummary(data));

  lines.push("", `Açık Caseler (${data.activeCases.length})`);
  data.activeCases.forEach((item) => {
    lines.push(
      `- ${item.title} / ${item.customer} / ${item.owner} / ${item.status} / ${item.priority} / Açılış: ${item.opened_date || "-"} / Son güncelleme: ${formatDateTime(item.latest_update_at || item.updated_at || item.opened_date)}`,
    );
  });
  if (!data.activeCases.length) lines.push("Açık case bulunmuyor.");

  lines.push("", `Açık İşler (${data.openTasks.length})`);
  data.openTasks.forEach((task) => {
    lines.push(
      `- ${task.producer} / ${task.title} / ${task.owner} / ${task.status} / ${task.priority} / Kayıt: ${formatDateTime(task.created_at)} / Son güncelleme: ${formatDateTime(task.latest_update_at || task.updated_at || task.created_at)}`,
    );
  });
  if (!data.openTasks.length) lines.push("Açık iş bulunmuyor.");

  return lines.join("\n");
}

async function sendWeeklyReportEmail(env) {
  if (!env.EMAIL) {
    return { sent: false, reason: "EMAIL binding tanımlı değil." };
  }
  if (!env.REPORT_FROM || !env.REPORT_TO) {
    return { sent: false, reason: "REPORT_FROM ve REPORT_TO tanımlı değil." };
  }

  const data = await collectWeeklyReportData(env);
  const summary = await generateWeeklySummary(env, data);
  const subjectDate = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date());

  await env.EMAIL.send({
    from: env.REPORT_FROM,
    to: env.REPORT_TO,
    subject: `Haftalık Operasyon Takibi - ${subjectDate}`,
    text: weeklyReportToText(data, summary),
    html: weeklyReportToHtml(data, summary),
  });

  return {
    sent: true,
    openTaskCount: data.openTasks.length,
    activeCaseCount: data.activeCases.length,
    summary,
  };
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

    if (url.pathname === "/api/open-tasks-export") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }

      try {
        if (request.method === "POST" || url.searchParams.get("send") === "1") {
          return json({ email: await sendOpenTasksExportEmail(env) });
        }
        const data = await collectOpenTasksExportData(env);
        return json({ taskCount: data.tasks.length, updateCount: data.updates.length });
      } catch (error) {
        return json({ error: error.message || "Excel maili gönderilemedi." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/weekly-report") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }

      try {
        const data = await collectWeeklyReportData(env);
        const sendEmail = request.method === "POST" || url.searchParams.get("send") === "1";
        const email = sendEmail ? await sendWeeklyReportEmail(env) : { sent: false, reason: "preview" };
        return json({
          data,
          email,
          html: url.searchParams.get("html") === "1" ? weeklyReportToHtml(data, fallbackWeeklySummary(data)) : undefined,
        });
      } catch (error) {
        return json({ error: error.message || "Haftalık rapor oluşturulamadı." }, { status: 500 });
      }
    }

    return astroWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === "0 5 * * 1") {
      await sendWeeklyReportEmail(env);
      return;
    }

    await buildAndMaybeSendReport(env, { sendEmail: true });
  },
};
