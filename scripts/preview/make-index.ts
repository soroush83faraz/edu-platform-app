// Landing page of the static preview: builds OUT_DIR/index.html (Persian, RTL, the product palette) from the
// manifest.json that scripts/preview/export.ts wrote — one section per role, one row per exported page. Relative
// links only, so the site works under the GitHub Pages sub-path.
//   OUT_DIR=preview pnpm exec tsx scripts/preview/make-index.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT_DIR = resolve(process.env.OUT_DIR ?? "preview");

interface Page {
  role: string;
  roleFa: string;
  path: string;
  file: string;
  fa: string;
  viewport: string;
  bytes: number;
  title: string;
}
interface Manifest {
  generatedAt: string;
  roles: Array<{ key: string; labelFa: string }>;
  pages: Page[];
  failed: Array<{ role: string; path: string; reason: string }>;
  font: string | null;
}

const manifest = JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf8")) as Manifest;

const ROLE_NOTE: Record<string, string> = {
  public: "صفحه‌هایی که بدون ورود دیده می‌شوند",
  student: "دانش‌آموز کلاس ۱۰/۱ — تکالیف، کلاس، برنامه و حضور و غیاب خودش",
  teacher: "دبیر ریاضی — کلاس‌ها، تکالیف داده‌شده و حضور و غیاب زنگ‌ها",
  principal: "مدیر یک مدرسه — همهٴ بخش‌های مدیریت محدود به مدرسهٴ خودش",
  orgadmin: "مدیر سازمان — مدرسه‌ها و تنظیمات زیرساختی کل سازمان",
};
const VIEWPORT: Record<string, string> = { phone: "گوشی", desktop: "دسکتاپ", both: "گوشی و دسکتاپ", print: "چاپ A4" };
const fa = (n: number) => n.toLocaleString("fa-IR");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const roleLabel = (key: string) => manifest.roles.find((r) => r.key === key)?.labelFa ?? key;

const sections = manifest.roles
  .map((role) => ({ role, pages: manifest.pages.filter((p) => p.role === role.key) }))
  .filter((g) => g.pages.length > 0)
  .map((g) => {
    const rows = g.pages
      .map(
        (p) => `<li>
  <a class="row" href="${esc(p.file)}">
    <span class="mark" aria-hidden="true"></span>
    <span class="text"><span class="title">${esc(p.fa)}</span><bdi dir="ltr" class="path">${esc(p.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (id) => `${id.slice(0, 8)}…`))}</bdi></span>
    <span class="chip">${VIEWPORT[p.viewport] ?? p.viewport}</span>
    <span class="chev" aria-hidden="true">‹</span>
  </a>
</li>`,
      )
      .join("\n");
    return `<section class="card" id="${esc(g.role.key)}">
  <header class="card-head"><h2>${esc(g.role.labelFa)}</h2><span class="count">${fa(g.pages.length)} صفحه</span></header>
  <p class="note">${esc(ROLE_NOTE[g.role.key] ?? "")}</p>
  <ul class="rows">${rows}</ul>
</section>`;
  })
  .join("\n");

const jump = manifest.roles
  .filter((r) => manifest.pages.some((p) => p.role === r.key))
  .map((r) => `<a href="#${esc(r.key)}">${esc(r.labelFa)}</a>`)
  .join("");

const failed = manifest.failed.length
  ? `<section class="card quiet"><h2>صفحه‌هایی که در این نسخه نیستند</h2><ul class="plain">${manifest.failed
      .map((f) => `<li>${esc(roleLabel(f.role))} — <bdi dir="ltr">${esc(f.path)}</bdi></li>`)
      .join("")}</ul></section>`
  : "";

const fontFace = manifest.font ? `@font-face { font-family: Vazirmatn; src: url(assets/${manifest.font}) format("woff2"); font-weight: 100 900; font-display: swap; }` : "";

const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>پیش‌نمایش دانینو</title>
<meta name="theme-color" content="#072AC8">
<style>
${fontFace}
:root { --primary-600:#072AC8; --primary-700:#0622A3; --primary-50:#EEF2FF; --canvas:#E8EEF9; --surface:#fff; --sunken:#F4F7FD; --text:#0B1440; --muted:#5B6480; --line:#E3E8F4; --shadow-1: 0 1px 2px rgb(7 42 200 / .06), 0 8px 24px rgb(7 42 200 / .08); }
* { box-sizing: border-box; }
body { margin:0; background:var(--canvas); color:var(--text); font-family: Vazirmatn, system-ui, sans-serif; font-size:14px; line-height:24px; padding: 24px 16px 48px; }
main { max-width: 960px; margin-inline:auto; display:grid; gap:16px; }
.hero { background: linear-gradient(135deg,#072AC8 0%,#0B6FD1 100%); color:#fff; border-radius:20px; padding:24px; }
.hero h1 { margin:0 0 8px; font-size:28px; line-height:34px; }
.hero p { margin:0 0 8px; color:#E6EEFF; }
.hero .facts { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; }
.hero .facts span { background:rgb(255 255 255 / .14); border-radius:999px; padding:2px 12px; font-size:13px; }
nav.jump { display:flex; flex-wrap:wrap; gap:8px; }
nav.jump a { background:var(--surface); color:var(--primary-700); text-decoration:none; border-radius:999px; padding:8px 16px; min-height:44px; display:inline-flex; align-items:center; box-shadow:var(--shadow-1); }
.card { background:var(--surface); border-radius:16px; box-shadow:var(--shadow-1); padding:16px 20px; }
.card.quiet { background:transparent; box-shadow:none; border:1px solid var(--line); }
.card-head { display:flex; align-items:baseline; gap:12px; }
.card h2 { margin:0; font-size:18px; line-height:28px; }
.count { margin-inline-start:auto; color:var(--muted); font-size:13px; }
.note { margin:0 0 8px; color:var(--muted); font-size:13px; line-height:20px; }
.rows { list-style:none; margin:0; padding:0; }
.row { display:flex; align-items:center; gap:12px; min-height:56px; border-top:1px solid var(--line); padding:8px 4px; color:inherit; text-decoration:none; border-radius:12px; transition: background .15s, transform .15s; }
.row:hover { background:var(--sunken); }
.mark { inline-size:32px; block-size:32px; border-radius:50%; flex-shrink:0; background:var(--sunken); border:1px solid var(--line); position:relative; }
.mark::after { content:""; position:absolute; inset:10px; border-radius:3px; background:var(--primary-600); opacity:.55; }
.text { display:flex; flex-direction:column; min-width:0; flex:1; }
.title { font-size:15px; font-weight:600; }
.path { color:var(--muted); font-size:13px; line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chip { background:var(--sunken); color:var(--muted); border-radius:999px; padding:0 10px; font-size:12px; white-space:nowrap; }
.chev { color:var(--muted); font-size:20px; }
.plain { margin:8px 0 0; padding-inline-start:20px; color:var(--muted); font-size:13px; }
footer { color:var(--muted); font-size:13px; text-align:center; }
@media (max-width: 520px) { .chip { display:none; } }
</style>
</head>
<body>
<main>
  <header class="hero">
    <h1>پیش‌نمایش دانینو</h1>
    <p>سامانهٴ مدرسه (فاز ۱) — نسخهٴ ثابت همهٴ صفحه‌ها به تفکیک نقش، با داده‌های نمونهٴ پایلوت (نام‌ها و شماره‌ها ساختگی‌اند).</p>
    <p>هر صفحه از اجرای واقعی برنامه ساخته شده است؛ اما این نسخه فقط برای دیدن است: ورود، ذخیره، فرم‌ها و دکمه‌ها کاری انجام نمی‌دهند.</p>
    <div class="facts"><span>${fa(manifest.pages.length)} صفحه</span><span>${fa(manifest.roles.filter((r) => manifest.pages.some((p) => p.role === r.key)).length)} نقش</span><span>برای نمای گوشی، پنجره را باریک کنید</span></div>
  </header>
  <nav class="jump" aria-label="نقش‌ها">${jump}</nav>
  ${sections}
  ${failed}
  <footer>ساخته‌شده در ${new Date(manifest.generatedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran", dateStyle: "long", timeStyle: "short" })} به وقت تهران</footer>
</main>
</body>
</html>
`;

writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`[preview] index.html: ${manifest.pages.length} pages, ${manifest.failed.length} not exported`);
