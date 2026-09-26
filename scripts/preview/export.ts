// Static preview export: renders every screen of a RUNNING production build to standalone HTML, per role, for the
// GitHub Pages preview (.github/workflows/pages.yml). Nothing in the app is changed; only the logins write (one
// session row each).
//
//   BASE_URL=http://127.0.0.1:3002 OUT_DIR=preview PREVIEW_PASSWORD=<the PILOT_PASSWORD of the seed> \
//     pnpm exec tsx scripts/preview/export.ts && pnpm exec tsx scripts/preview/make-index.ts
//
// How a page is captured: log in through the REAL login form (no-JS POST of the rendered `<form>` with its hidden
// `$ACTION_*` fields) into a per-role cookie jar, GET the page, resolve React's streamed Suspense boundaries
// statically (`$RC` / `$RS` bindings → the hidden `S:n` segments replace the fallbacks, so no skeletons remain),
// strip every script, move the CSS and the Vazirmatn font into a shared `assets/`, rewrite internal links to the
// exported file names (unknown ones to `index.html`), neutralise forms and add the preview banner. Every URL in the
// output is RELATIVE, so the site works under any sub-path (…github.io/edu-platform-app/).
//
// Accounts are the pilot dataset of scripts/seed-pilot.ts (organization «علامه طباطبایی», school ALK, phone block
// 10: `pilotPhone(10, n)` = +9893510 + n in five digits). Ids (a work item, a class, a person, …) are discovered from
// the app's own pages, never hard-coded.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const OUT_DIR = resolve(process.env.OUT_DIR ?? "preview");
const ASSETS_DIR = join(OUT_DIR, "assets");
const PASSWORD = process.env.PREVIEW_PASSWORD ?? process.env.PILOT_PASSWORD ?? "";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 120_000);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null; // e.g. ONLY=student,public
const ROUTE_FILTER = process.env.ROUTES ? new RegExp(process.env.ROUTES) : null; // matched against `${role}:${path}`

const BANNER_TEXT = "پیش‌نمایش ثابت دانینو — ورود و ذخیره در این نسخه غیرفعال است";

if (!PASSWORD) {
  console.error("[preview] PREVIEW_PASSWORD (or PILOT_PASSWORD) must be the password the pilot seed gave every account");
  process.exit(2);
}

// ---- roles and routes ------------------------------------------------------------------------------------------
type Viewport = "phone" | "desktop" | "both" | "print";
interface RouteDef {
  path: string;
  fa: string;
  viewport: Viewport;
}
interface Role {
  key: string;
  labelFa: string;
  identifier: string | null;
  routes: RouteDef[];
}

const P: Viewport = "phone", D: Viewport = "desktop", B: Viewport = "both", PR: Viewport = "print";

/** `pilotPhone(10, n)` of scripts/seed-pilot.ts in the national form testers type (`0935…`). */
const alk = (n: number): string => `093510${String(n).padStart(5, "0")}`;

// Placeholders `<name>` are resolved by DISCOVERY (see PLACEHOLDERS below). Order matters only for readability:
// every placeholder fetches its own source pages when no earlier page revealed it.
const ROLES: Role[] = [
  {
    key: "public",
    labelFa: "بدون ورود",
    identifier: null,
    routes: [
      { path: "/login", fa: "ورود با موبایل یا نام کاربری و رمز", viewport: B },
      { path: "/help", fa: "راهنما", viewport: P },
      { path: "/privacy", fa: "حریم خصوصی", viewport: P },
      { path: "/~offline", fa: "صفحهٴ آفلاین نسخهٴ نصبی", viewport: P },
    ],
  },
  {
    key: "student",
    labelFa: "دانش‌آموز",
    identifier: alk(1000), // the first student of ۱۰/۱ (logs in by phone)
    routes: [
      { path: "/home", fa: "خانه: کاشی‌ها، زنگ‌های امروز، تکالیف نزدیک", viewport: B },
      { path: "/inbox", fa: "پنل من — تکالیف انجام‌نشده با دسته‌های سررسید", viewport: B },
      { path: "/inbox?tab=done", fa: "پنل من — انجام‌شده‌ها", viewport: B },
      { path: "/inbox/<inbox>", fa: "جزئیات یک تکلیف: واقعیت‌ها، اقدام‌ها، نظرها", viewport: B },
      { path: "/my-class", fa: "کلاس من: هم‌کلاسی‌ها و درس‌ها با دبیر", viewport: B },
      { path: "/subjects/<offering>", fa: "صفحهٴ یک درس: تکالیف این درس", viewport: B },
      { path: "/timetable", fa: "برنامهٴ هفتگی کلاس", viewport: B },
      { path: "/attendance", fa: "حضور و غیاب من: درصدها و آخرین موردها", viewport: B },
      { path: "/notifications", fa: "اعلان‌ها", viewport: B },
      { path: "/more", fa: "بیشتر: پروفایل، راهنما، تغییر رمز، خروج", viewport: P },
      { path: "/roadmap", fa: "نقشهٴ راه محصول", viewport: B },
      { path: "/change-password", fa: "تغییر رمز", viewport: P },
    ],
  },
  {
    key: "teacher",
    labelFa: "دبیر",
    identifier: alk(11), // teacher-1 of ALK (ریاضی)
    routes: [
      { path: "/home", fa: "خانهٴ دبیر: کلاس‌های امروز، تکالیف داده‌شده، «تکلیف جدید»", viewport: B },
      { path: "/inbox", fa: "پنل من (دبیر)", viewport: B },
      { path: "/inbox?mine=1", fa: "تکالیف داده‌شده", viewport: B },
      { path: "/inbox/new", fa: "فرم تکلیف جدید: درس، عنوان، اولویت، مهلت، گیرندگان", viewport: B },
      { path: "/inbox/<inbox>", fa: "جزئیات تکلیف از دید دبیر (پیشرفت گیرندگان)", viewport: B },
      { path: "/classes", fa: "کلاس‌های من: یک کارت برای هر درس", viewport: B },
      { path: "/subjects/<offering>", fa: "صفحهٴ یک درس از دید دبیر", viewport: B },
      { path: "/timetable", fa: "برنامهٴ هفتگی دبیر", viewport: B },
      { path: "/attendance", fa: "حضور و غیاب: زنگ‌های امروز", viewport: B },
      { path: "/attendance/<lesson>", fa: "ثبت حضور و غیاب یک زنگ امروز", viewport: B },
      { path: "/notifications", fa: "اعلان‌ها", viewport: B },
      { path: "/more", fa: "بیشتر", viewport: P },
    ],
  },
  {
    key: "principal",
    labelFa: "مدیر مدرسه",
    identifier: alk(2),
    routes: [
      { path: "/home", fa: "خانهٴ مدیر: کاشی‌های مدیریت و مدرسه در یک نگاه", viewport: B },
      { path: "/admin", fa: "نمای کلی مدیریت: شمارنده‌ها و بخش‌ها", viewport: B },
      { path: "/admin/students", fa: "فهرست دانش‌آموزان (جستجو، صفحه‌بندی)", viewport: D },
      { path: "/admin/students/new", fa: "ثبت دانش‌آموز جدید", viewport: B },
      { path: "/admin/staff", fa: "فهرست کارکنان", viewport: D },
      { path: "/admin/staff/new", fa: "ثبت همکار جدید", viewport: B },
      { path: "/admin/classes", fa: "فهرست کلاس‌ها", viewport: D },
      { path: "/admin/classes/<class>", fa: "یک کلاس: دانش‌آموزان، درس‌ها، برنامه، اعتبارنامه", viewport: B },
      { path: "/admin/classes/<class>/offerings", fa: "درس‌های یک کلاس (درس × نوبت × دبیر)", viewport: D },
      { path: "/admin/classes/<class>/timetable", fa: "برنامهٴ هفتگی یک کلاس", viewport: D },
      { path: "/admin/classes/<class>/credentials", fa: "برگهٴ چاپ اعتبارنامه‌های کلاس (A4)", viewport: PR },
      { path: "/admin/people/<person>", fa: "پروفایل یک فرد: حساب، نقش‌ها، ثبت‌نام", viewport: B },
      { path: "/admin/people/<person>/credentials", fa: "اعتبارنامهٴ ورود یک فرد (چاپ)", viewport: PR },
      { path: "/admin/roles", fa: "نقش‌ها و مجوزها", viewport: D },
      { path: "/admin/schools/<school>", fa: "پنل مدرسه: کلاس‌ها، کارکنان، زنگ‌ها", viewport: B },
      { path: "/admin/schools/<school>/periods", fa: "زنگ‌های مدرسه (ساعت شروع و پایان)", viewport: D },
      { path: "/admin/attendance", fa: "گزارش حضور و غیاب مدرسه", viewport: B },
      { path: "/attendance/<rollcall>", fa: "حضور و غیاب ثبت‌شدهٴ یک کلاس در آخرین روز مدرسه", viewport: B },
      { path: "/admin/years", fa: "سال‌های تحصیلی", viewport: D },
      { path: "/admin/terms?year=<year>", fa: "نوبت‌های یک سال تحصیلی", viewport: D },
      { path: "/admin/levels", fa: "مقطع‌ها", viewport: D },
      { path: "/admin/grades", fa: "پایه‌ها", viewport: D },
      { path: "/admin/subjects", fa: "درس‌ها", viewport: D },
      { path: "/inbox", fa: "پنل من (مدیر)", viewport: B },
      { path: "/notifications", fa: "اعلان‌ها", viewport: B },
    ],
  },
  {
    key: "orgadmin",
    labelFa: "مدیر سازمان",
    identifier: alk(1),
    routes: [
      { path: "/home", fa: "خانهٴ مدیر سازمان", viewport: B },
      { path: "/admin", fa: "نمای کلی مدیریت (سطح سازمان)", viewport: B },
      { path: "/admin/schools", fa: "مدرسه‌های سازمان", viewport: D },
      { path: "/admin/schools/<school>", fa: "پنل یک مدرسه از دید سازمان", viewport: B },
      { path: "/admin/infrastructure", fa: "تنظیمات زیرساختی", viewport: B },
      { path: "/admin/students", fa: "دانش‌آموزان همهٴ مدرسه‌ها", viewport: D },
      { path: "/admin/roles", fa: "نقش‌ها (سطح سازمان)", viewport: D },
    ],
  },
];

// ---- HTTP with a per-role cookie jar ---------------------------------------------------------------------------
class Jar {
  private map = new Map<string, string>();
  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /^\s*expires=.*1970/i.test(a));
      if (value === "" || expired) this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(re: RegExp): boolean {
    return [...this.map.keys()].some((k) => re.test(k));
  }
}

async function request(jar: Jar | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", "edu-preview-export/1.0");
  headers.set("accept-language", "fa-IR,fa;q=0.9");
  if (init.method === "POST") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  jar?.store(res);
  return res;
}

const decodeEntities = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function actionFields(html: string, marker: RegExp): Record<string, string> {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((f) => marker.test(f) && /\$ACTION/.test(f));
  if (!form) throw new Error(`no <form> matching ${marker} with $ACTION fields`);
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (!name || !name.startsWith("$ACTION")) continue;
    fields[name] = decodeEntities(/value="([^"]*)"/.exec(m[0])?.[1] ?? "");
  }
  return fields;
}

async function getPage(jar: Jar | null, path: string): Promise<{ status: number; html: string; finalPath: string }> {
  let current = path;
  for (let hop = 0; hop < 6; hop++) {
    let res = await request(jar, current);
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await request(jar, current);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location") ?? "";
      const u = new URL(loc, BASE_URL);
      current = u.pathname + u.search;
      continue;
    }
    return { status: res.status, html: await res.text(), finalPath: current };
  }
  throw new Error(`too many redirects from ${path}`);
}

async function login(identifier: string): Promise<Jar> {
  const jar = new Jar();
  const page = await getPage(jar, "/login");
  if (page.status !== 200) throw new Error(`GET /login → ${page.status}`);
  const fields = actionFields(page.html, /name="identifier"/);
  const form = new FormData();
  form.set("identifier", identifier);
  form.set("password", PASSWORD);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await request(jar, "/login", { method: "POST", body: form });
  const location = res.headers.get("location") ?? "";
  if (res.status !== 303 && res.status !== 302) {
    const text = await res.text();
    const msg = /role="alert"[^>]*>([^<]*)</.exec(text)?.[1]?.trim();
    throw new Error(`POST /login → ${res.status} ${msg ?? ""}`);
  }
  if (!jar.has(/session$/i)) throw new Error("no session cookie");
  console.log(`  login ${identifier} → ${location}`);
  return jar;
}

// ---- id discovery ----------------------------------------------------------------------------------------------
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface Placeholder {
  /** Pages of the same role that link to the target, tried in order when no exported page revealed it yet. */
  sources: string[];
  /** First capture group = the text that replaces `<name>` (entities decoded). */
  re: RegExp;
}

const PLACEHOLDERS: Record<string, Placeholder> = {
  inbox: { sources: ["/inbox", "/inbox?mine=1"], re: new RegExp(`href="/inbox/(${UUID})"`) },
  offering: { sources: ["/my-class", "/classes", "/timetable", "/home"], re: new RegExp(`href="/subjects/(${UUID})"`) },
  lesson: { sources: ["/attendance"], re: new RegExp(`href="/attendance/(${UUID}\\?date=\\d{4}-\\d{2}-\\d{2}&(?:amp;)?period=\\d+)"`) },
  class: { sources: ["/admin/classes"], re: new RegExp(`href="/admin/classes/(${UUID})"`) },
  person: { sources: ["/admin/students"], re: new RegExp(`href="/admin/people/(${UUID})"`) },
  year: { sources: ["/admin/years"], re: new RegExp(`href="/admin/terms\\?year=(${UUID})"`) },
  school: { sources: ["/admin", "/home", "/admin/schools"], re: new RegExp(`href="/admin/schools/(${UUID})"`) },
};

/** The most recent school day (شنبه…پنجشنبه) in Asia/Tehran, today included — the pilot seed took the roll call then. */
function lastSchoolDayTehran(now = new Date()): string {
  for (let back = 0; back < 7; back++) {
    const d = new Date(now.getTime() - back * 86_400_000);
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 5 = Friday (جمعه)
    if (weekday !== 5) return iso;
  }
  throw new Error("unreachable");
}

/**
 * `<rollcall>`: one class's page on the last school day, at a زنگ that already carries a roll call (the seed takes
 * them for past days). The class comes from the admin list; the زنگ from the page's own switcher.
 */
async function resolveRollcall(jar: Jar, ids: Record<string, string>): Promise<string | null> {
  const classId = ids.class ?? (await discoverFrom(jar, "class", ids));
  if (!classId) return null;
  const date = lastSchoolDayTehran();
  const base = `${classId}?date=${date}`;
  const page = await getPage(jar, `/attendance/${base}`);
  if (page.status !== 200) return null;
  const links = [...page.html.matchAll(new RegExp(`<a\\b[^>]*href="/attendance/(${classId}\\?date=${date}&(?:amp;)?period=\\d+)"[^>]*>([\\s\\S]*?)</a>`, "g"))];
  const taken = links.find((l) => /aria-label="ثبت‌شده"/.test(l[2])) ?? links[0];
  return taken ? decodeEntities(taken[1]) : base;
}

async function discoverFrom(jar: Jar, name: string, ids: Record<string, string>): Promise<string | null> {
  const ph = PLACEHOLDERS[name];
  if (!ph) return null;
  for (const source of ph.sources) {
    try {
      const p = await getPage(jar, source);
      if (p.status !== 200) continue;
      const m = ph.re.exec(p.html);
      if (m) {
        ids[name] = decodeEntities(m[1]);
        return ids[name];
      }
    } catch {
      /* try the next source */
    }
  }
  return null;
}

function discoverPassively(html: string, ids: Record<string, string>): void {
  for (const [name, ph] of Object.entries(PLACEHOLDERS)) {
    if (ids[name]) continue;
    const m = ph.re.exec(html);
    if (m) ids[name] = decodeEntities(m[1]);
  }
}

// ---- React streaming resolution --------------------------------------------------------------------------------
/** Extract `<div hidden id="S:n">…</div>` segments (depth-aware) and remove them from the HTML. */
function extractHiddenSegments(html: string): { html: string; segments: Map<string, string> } {
  const segments = new Map<string, string>();
  const open = /<div hidden(?:="")? id="(S:[^"]+)">/g;
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const start = m.index;
    if (start < cursor) continue;
    let depth = 1;
    const i = start + m[0].length;
    const tag = /<\/?div\b[^>]*>/g;
    tag.lastIndex = i;
    let t: RegExpExecArray | null;
    let end = -1;
    while ((t = tag.exec(html))) {
      if (t[0].startsWith("</")) depth -= 1;
      else if (!t[0].endsWith("/>")) depth += 1;
      if (depth === 0) {
        end = t.index;
        segments.set(m[1], html.slice(i, end));
        out += html.slice(cursor, start);
        cursor = end + t[0].length;
        open.lastIndex = cursor;
        break;
      }
    }
    if (end < 0) break;
  }
  out += html.slice(cursor);
  return { html: out, segments };
}

/** `$RC("B:0","S:0")` / `$RS("S:1","P:1")` pairs from every inline script. */
function collectBindings(html: string): { boundaries: Map<string, string>; placeholders: Map<string, string> } {
  const boundaries = new Map<string, string>();
  const placeholders = new Map<string, string>();
  for (const m of html.matchAll(/\$RC\(\s*"(B:[^"]+)"\s*,\s*"(S:[^"]+)"/g)) boundaries.set(m[1], m[2]);
  for (const m of html.matchAll(/\$RS\(\s*"(S:[^"]+)"\s*,\s*"(P:[^"]+)"/g)) placeholders.set(m[2], m[1]);
  return { boundaries, placeholders };
}

/** Find the `<!--/$-->` that closes the boundary opened at `openEnd` (nesting-aware). */
function findBoundaryClose(html: string, openEnd: number): number {
  const re = /<!--\$[?!]?-->|<!--\/\$-->/g;
  re.lastIndex = openEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0] === "<!--/$-->") depth -= 1;
    else depth += 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

function resolveStreaming(input: string): { html: string; unresolved: number } {
  const { boundaries, placeholders } = collectBindings(input);
  const extracted = extractHiddenSegments(input);
  let html = extracted.html;
  const segments = extracted.segments;
  // Segments may themselves contain nested hidden segments (rare); pull them out too.
  for (const [k, v] of [...segments]) {
    const inner = extractHiddenSegments(v);
    if (inner.segments.size) {
      segments.set(k, inner.html);
      for (const [ik, iv] of inner.segments) segments.set(ik, iv);
    }
  }
  const fill = (s: string): string =>
    s.replace(/<template id="(P:[^"]+)"><\/template>/g, (all, pid: string) => {
      const sid = placeholders.get(pid);
      const seg = sid ? segments.get(sid) : undefined;
      return seg !== undefined ? fill(seg) : all;
    });
  let unresolved = 0;
  for (let pass = 0; pass < 50; pass++) {
    const re = /<!--\$\?--><template id="(B:[^"]+)"><\/template>/g;
    let changed = false;
    let m: RegExpExecArray | null;
    let out = "";
    let cursor = 0;
    while ((m = re.exec(html))) {
      const start = m.index;
      const openEnd = start + m[0].length;
      const close = findBoundaryClose(html, openEnd);
      if (close < 0) break;
      const sid = boundaries.get(m[1]);
      const seg = sid ? segments.get(sid) : undefined;
      out += html.slice(cursor, start);
      if (seg !== undefined) {
        out += fill(seg);
        changed = true;
      } else {
        out += html.slice(openEnd, close); // keep the fallback, drop the markers
        unresolved += 1;
      }
      cursor = close + "<!--/$-->".length;
      re.lastIndex = cursor;
    }
    out += html.slice(cursor);
    html = out;
    if (!changed) break;
  }
  html = html.replace(/<!--\$!?-->|<!--\/\$-->/g, "").replace(/<template id="[BP]:[^"]+"><\/template>/g, "");
  return { html, unresolved };
}

// ---- standalone rewriting --------------------------------------------------------------------------------------
const assetCache = new Map<string, string>(); // absolute url → file name inside assets/
const cssCache = new Map<string, string>(); // absolute css url → file name inside assets/

function assetName(url: string): string {
  const u = new URL(url, BASE_URL);
  let name = basename(u.pathname) || "asset";
  name = name.replace(/[^\w.-]/g, "_"); // no brackets / spaces: plain names survive any static host
  if (!/\.[a-z0-9]+$/i.test(name)) name += ".bin";
  return name;
}

async function downloadAsset(url: string): Promise<string | null> {
  const abs = new URL(url, BASE_URL).toString();
  const hit = assetCache.get(abs);
  if (hit) return hit;
  try {
    const res = await fetch(abs, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    let name = assetName(abs);
    if (name.endsWith(".bin")) {
      const ct = res.headers.get("content-type") ?? "";
      const ext = /png/.test(ct) ? "png" : /svg/.test(ct) ? "svg" : /jpe?g/.test(ct) ? "jpg" : /webp/.test(ct) ? "webp" : /icon/.test(ct) ? "ico" : /woff2/.test(ct) ? "woff2" : "";
      if (ext) name = name.replace(/\.bin$/, `.${ext}`);
    }
    const target = join(ASSETS_DIR, name);
    if (!existsSync(target)) writeFileSync(target, buf);
    assetCache.set(abs, name);
    return name;
  } catch {
    return null;
  }
}

/** Downloads a stylesheet into assets/ with its fonts/images next to it; returns the file name inside assets/. */
async function localCss(cssUrl: string): Promise<string> {
  const abs = new URL(cssUrl, BASE_URL).toString();
  const hit = cssCache.get(abs);
  if (hit !== undefined) return hit;
  const res = await fetch(abs, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`CSS ${cssUrl} → ${res.status}`);
  let css = await res.text();
  css = css.replace(/\/\*# sourceMappingURL=[^*]*\*\//g, "");
  for (const m of [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]) {
    const ref = m[2];
    if (/^(data:|#|https?:\/\/(?!127\.0\.0\.1|localhost))/.test(ref)) continue;
    const name = await downloadAsset(new URL(ref, abs).toString());
    if (name) css = css.split(m[0]).join(`url(${name})`); // relative to assets/ itself
  }
  let file = assetName(abs);
  if (!file.endsWith(".css")) file += ".css";
  writeFileSync(join(ASSETS_DIR, file), css);
  cssCache.set(abs, file);
  return file;
}

function slugOf(path: string): string {
  let p = path.replace(/^\//, "").replace(/^~/, "");
  p = p.replace(new RegExp(UUID, "gi"), (id) => id.slice(0, 8));
  p = p.replace(/\?/, "--").replace(/[=&]/g, "-").replace(/\//g, "-");
  return p || "root";
}

const bannerHtml = `<div data-preview-banner style="position:sticky;top:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;min-height:32px;padding:4px 16px;background:#072AC8;color:#fff;font:500 13px/20px Vazirmatn,var(--font-vazir),system-ui,sans-serif;text-align:center"><span>${BANNER_TEXT}</span><a href="index.html" style="color:#fff;text-decoration:underline;text-underline-offset:3px;white-space:nowrap">فهرست صفحه‌ها</a></div>`;

interface Links {
  /** `${role}|${path with query}` → file */
  exact: Map<string, string>;
  /** `${role}|${path}` and `*|${path}` (query and no query) → file */
  loose: Map<string, string>;
}

function linkTarget(role: string, raw: string, links: Links): string | null {
  const path = decodeEntities(raw);
  const noQuery = path.split("?")[0];
  return links.exact.get(`${role}|${path}`) ?? links.loose.get(`${role}|${noQuery}`) ?? links.loose.get(`*|${path}`) ?? links.loose.get(`*|${noQuery}`) ?? null;
}

async function makeStandalone(input: string, role: string, links: Links): Promise<{ html: string; leftovers: string[] }> {
  let html = input;
  // 1. stylesheets → shared files in assets/
  for (const m of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1];
    if (!href) continue;
    const file = await localCss(decodeEntities(href));
    html = html.replace(m[0], `<link rel="stylesheet" href="assets/${file}">`);
  }
  // 2. drop scripts, preloads, refresh metas, the manifest and absolute-origin metas
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  html = html.replace(/<script\b[^>]*\/>/g, "");
  html = html.replace(/<link\b[^>]*rel="(?:preload|modulepreload|prefetch|preconnect|dns-prefetch|manifest|expect)"[^>]*>/g, "");
  html = html.replace(/<meta\b[^>]*http-equiv="refresh"[^>]*>/g, "");
  html = html.replace(/<meta\b[^>]*content="https?:\/\/(?:127\.0\.0\.1|localhost)[^"]*"[^>]*>/g, "");
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/g, "");
  // 3. icons / images from the server → assets/
  for (const m of [...html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon|shortcut icon)"[^>]*>/g)]) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1];
    if (!href || /^(data:|https?:\/\/(?!127|localhost))/.test(href)) continue;
    const name = await downloadAsset(decodeEntities(href));
    html = html.replace(m[0], name ? m[0].replace(href, `assets/${name}`) : "");
  }
  for (const m of [...html.matchAll(/\s(src|poster)="(\/[^"]+)"/g)]) {
    const name = await downloadAsset(decodeEntities(m[2]));
    if (name) html = html.replace(m[0], ` ${m[1]}="assets/${name}"`);
  }
  html = html.replace(/\ssrcset="\/[^"]*"/g, "");
  // 4. internal hrefs → exported files (same role first, then any role); anything else → the index
  html = html.replace(/href="(\/[^"#]*)(#[^"]*)?"/g, (_all, path: string, hash = "") => {
    const file = linkTarget(role, path, links);
    return file ? `href="${file}${hash}"` : `href="index.html" data-preview-missing="${escapeAttr(decodeEntities(path))}"`;
  });
  // 5. forms: nothing is submitted from a static copy
  html = html.replace(/<form\b([^>]*?)\saction="[^"]*"/g, "<form$1");
  html = html.replace(/<form\b/g, '<form onsubmit="return false"');
  html = html.replace(/\sformAction="[^"]*"/gi, "");
  // 6. banner, noindex, provenance
  html = html.replace(/<body\b[^>]*>/, (b) => `${b}${bannerHtml}`);
  html = html.replace(/<head\b[^>]*>/, (h) => `${h}<meta name="robots" content="noindex">`);
  html = html.replace(/<html\b/, "<!-- Static preview of edu-platform-app (scripts/preview/export.ts): scripts removed, streaming resolved. -->\n<html");
  // 7. anything still pointing at the server root or the local origin would break under a sub-path — report it
  const leftovers = [...html.matchAll(/\s(?:href|src|action|poster)="(\/[^"]*)"|url\(\s*['"]?(\/[^'")]*)|(https?:\/\/(?:127\.0\.0\.1|localhost)[^"'\s)]*)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return { html, leftovers };
}

// ---- main ------------------------------------------------------------------------------------------------------
interface Exported {
  role: Role;
  path: string;
  file: string;
  fa: string;
  viewport: Viewport;
  bytes: number;
  title: string;
  unresolved: number;
  skeletons: number;
  raw: string;
  leftovers: string[];
}
interface Failed {
  role: string;
  path: string;
  reason: string;
}

async function main(): Promise<void> {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const health = await request(null, "/api/health");
  console.log(`health → ${health.status} ${await health.text()}`);
  const exported: Exported[] = [];
  const failed: Failed[] = [];
  const links: Links = { exact: new Map(), loose: new Map() };
  const fileName = (role: string, path: string) => `${role}__${slugOf(path)}.html`;
  let loginFailures = 0;

  for (const role of ROLES) {
    if (ONLY && !ONLY.has(role.key)) continue;
    console.log(`\n== ${role.key} (${role.labelFa})`);
    let jar: Jar | null = null;
    if (role.identifier) {
      try {
        jar = await login(role.identifier);
      } catch (err) {
        loginFailures += 1;
        failed.push({ role: role.key, path: "/login", reason: `login failed: ${(err as Error).message}` });
        continue;
      }
    }
    const ids: Record<string, string> = {};
    for (const r of role.routes) {
      if (ROUTE_FILTER && !ROUTE_FILTER.test(`${role.key}:${r.path}`)) continue;
      let path = r.path;
      const missing = /<([a-z]+)>/.exec(path);
      if (missing) {
        const need = missing[1];
        if (!ids[need] && jar) {
          if (need === "rollcall") {
            const v = await resolveRollcall(jar, ids).catch(() => null);
            if (v) ids.rollcall = v;
          } else {
            await discoverFrom(jar, need, ids);
          }
        }
        if (!ids[need]) {
          const why = need === "lesson" ? "no زنگ in this teacher's timetable today (Tehran time) — the roll-call page is exported for the principal instead" : `no ${need} id could be discovered from the app's own pages`;
          failed.push({ role: role.key, path, reason: why });
          console.log(`  - ${path}: ${why}`);
          continue;
        }
        path = path.replace(`<${need}>`, ids[need]);
      }
      try {
        const page = await getPage(jar, path);
        if (page.finalPath !== path && page.finalPath.startsWith("/login")) {
          failed.push({ role: role.key, path, reason: "redirected to /login (not authorised for this role)" });
          console.log(`  ✗ ${path}: redirected to /login`);
          continue;
        }
        if (page.status !== 200) {
          failed.push({ role: role.key, path, reason: `HTTP ${page.status}` });
          console.log(`  ✗ ${path}: HTTP ${page.status}`);
          continue;
        }
        if (page.finalPath !== path) console.log(`  (${path} redirected to ${page.finalPath})`);
        discoverPassively(page.html, ids);

        const { html: resolved, unresolved } = resolveStreaming(page.html);
        const file = fileName(role.key, path);
        links.exact.set(`${role.key}|${path}`, file);
        const noQuery = path.split("?")[0];
        if (!links.loose.has(`${role.key}|${noQuery}`)) links.loose.set(`${role.key}|${noQuery}`, file);
        if (!links.loose.has(`*|${path}`)) links.loose.set(`*|${path}`, file);
        if (!links.loose.has(`*|${noQuery}`)) links.loose.set(`*|${noQuery}`, file);
        const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(resolved)?.[1] ?? "");
        exported.push({ role, path, file, fa: r.fa, viewport: r.viewport, bytes: 0, title, unresolved, skeletons: 0, raw: resolved, leftovers: [] });
        console.log(`  ✓ ${path} → ${file} («${title}», unresolved boundaries ${unresolved})`);
      } catch (err) {
        failed.push({ role: role.key, path, reason: (err as Error).message });
        console.log(`  ✗ ${path}: ${(err as Error).message}`);
      }
    }
  }

  // Second pass: rewrite now that every file name is known, so cross-links resolve.
  console.log("\n== standalone pass");
  for (const e of exported) {
    const { html, leftovers } = await makeStandalone(e.raw, e.role.key, links);
    writeFileSync(join(OUT_DIR, e.file), html);
    e.bytes = Buffer.byteLength(html);
    e.skeletons = (html.slice(html.indexOf("<body")).match(/animate-pulse/g) ?? []).length;
    e.leftovers = leftovers;
    e.raw = "";
    if (leftovers.length) console.log(`  ! ${e.file}: ${leftovers.length} absolute reference(s): ${leftovers.slice(0, 5).join(" ")}`);
  }

  const assets = [...new Set([...assetCache.values(), ...cssCache.values()])];
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        roles: ROLES.filter((r) => !ONLY || ONLY.has(r.key)).map((r) => ({ key: r.key, labelFa: r.labelFa })),
        pages: exported.map((e) => ({
          role: e.role.key,
          roleFa: e.role.labelFa,
          path: e.path,
          file: e.file,
          fa: e.fa,
          viewport: e.viewport,
          bytes: e.bytes,
          title: e.title,
          unresolvedBoundaries: e.unresolved,
          skeletonNodes: e.skeletons,
          absoluteRefs: e.leftovers.length,
        })),
        failed,
        assets,
        font: assets.find((a) => /vazir/i.test(a) && a.endsWith(".woff2")) ?? null,
      },
      null,
      2,
    ),
  );

  console.log("\n== summary");
  for (const role of ROLES) {
    if (ONLY && !ONLY.has(role.key)) continue;
    console.log(`  ${role.key}: ${exported.filter((e) => e.role.key === role.key).length} pages`);
  }
  console.log(`  total ${exported.length} pages, ${(exported.reduce((a, e) => a + e.bytes, 0) / 1024).toFixed(0)} KB html; assets: ${assets.join(", ")}`);
  if (failed.length) {
    console.log("  not exported:");
    for (const f of failed) console.log(`    ${f.role} ${f.path}: ${f.reason}`);
  }
  const leftovers = exported.reduce((n, e) => n + e.leftovers.length, 0);
  if (loginFailures > 0) throw new Error(`${loginFailures} login(s) failed`);
  if (leftovers > 0) throw new Error(`${leftovers} absolute reference(s) left in the output — they would break under the Pages sub-path`);
}

void main().catch((err) => {
  console.error("[preview] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
