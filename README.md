# Allianz Siber Güvenlik Operasyon Merkezi

Allianz için açık işler, case kayıtları ve operasyon istatistiklerini takip eden Astro + Cloudflare Workers + D1 uygulaması.

## Ekranlar

- Ana Sayfa: açık iş, blokaj, aktif case ve yüksek öncelik istatistikleri.
- Açık İşler: iş oluşturma, detay alanı, durum/öncelik takibi ve güncelleme geçmişi.
- Caseler: case oluşturma, filtreleme, kapatma ve silme akışı.
- Gün Sonu Raporu: Cloudflare Workers AI ile rapor üretir, cron ile e-posta gönderir.

## Komutlar

```bash
npm install
npm run dev
npm run build
npm run deploy
```

Bu makinede taşınabilir Node kurulduysa PowerShell için:

```powershell
$env:PATH = 'C:\Users\boran\OneDrive\Documents\Allianz\tools\node-v24.15.0-win-x64;' + $env:PATH
..\tools\node-v24.15.0-win-x64\npm.cmd run dev
```

## D1 Şeması

İlk kurulumda migration çalıştırın:

```bash
npx wrangler d1 migrations apply allianz
```

Mevcut eski `tasks` tablosu daha önce detay alanı olmadan oluşturulduysa D1 üzerinde şu kolonların eklendiğinden emin olun:

```sql
ALTER TABLE tasks ADD COLUMN detail TEXT DEFAULT '';
```

`migrations/0001_allianz_operations.sql` dosyası temiz kurulum için `tasks`, `task_updates` ve `cases` tablolarını oluşturur.

## Gün Sonu AI Raporu

Worker her gün Türkiye saatiyle 18:00'de çalışır. D1 verisini özetler, `@cf/meta/llama-4-scout-17b-16e-instruct` modeliyle rapor metni üretir ve Cloudflare Email Service üzerinden gönderir.

Manuel preview/send endpoint'i:

```bash
curl "https://<worker-url>/api/daily-report?token=<REPORT_TOKEN>"
curl -X POST "https://<worker-url>/api/daily-report?token=<REPORT_TOKEN>"
```

`REPORT_TOKEN` secret olarak tutulur. `REPORT_FROM` ve `REPORT_TO` değerleri `wrangler.json` içindeki `vars` alanındadır.
