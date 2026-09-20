// End-to-end smoke against a RUNNING deployment (no browser, no DB access — only what a phone does over HTTPS):
//   BASE_URL=https://school.example.ir SMOKE_IDENTIFIER=0912… SMOKE_PASSWORD=… pnpm smoke:prod
//
// Steps (one Persian + English line per step; the first failure exits 1):
//   1. GET /api/health → ok:true
//   2. login through the REAL login form: the no-JS (progressive-enhancement) POST of the `<form action>` rendered
//      on /login — the hidden `$ACTION_*` fields are read from the page, so no action id is hard-coded → 303 /home
//   3. GET /api/inbox/summary with the session cookie → 200 + numeric counts
//   4. createWorkItemAction (todo for self) through the Server Action wire protocol (`Next-Action` header; the id
//      is discovered from the page's client chunks the same way the browser would)
//   5. changeStatusAction → done
//   6. logout through the «خروج» form on /more → 303 /login?out=1 and the cookie cleared
//   7. GET /home with the revoked cookie → redirect to /login (the (app) layout checks the DB, not the cookie)
//
// The account should be a dedicated QA user of a demo organization with `must_change_password = false`; the script
// leaves one completed todo in that user's inbox per run.
const BASE_URL = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 20_000);

if (!BASE_URL || !IDENTIFIER || !PASSWORD) {
  console.error("usage: BASE_URL=https://host SMOKE_IDENTIFIER=<login> SMOKE_PASSWORD=<password> pnpm smoke:prod");
  process.exit(2);
}

// ---- tiny cookie jar --------------------------------------------------------------------------------------------
const jar = new Map<string, string>();

function storeCookies(res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /^\s*expires=.*(1970|Thu, 01 Jan 1970)/i.test(a));
    if (value === "" || expired) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", "edu-smoke/1.0");
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  storeCookies(res);
  return res;
}

// ---- reporting --------------------------------------------------------------------------------------------------
class StepError extends Error {
  constructor(
    readonly fa: string,
    readonly en: string,
  ) {
    super(en);
  }
}

const fail = (fa: string, en: string): never => {
  throw new StepError(fa, en);
};

let stepNo = 0;
async function step<T>(fa: string, en: string, fn: () => Promise<T>): Promise<T> {
  stepNo += 1;
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`✓ ${stepNo}. ${fa} — ${en} (${Date.now() - t0}ms)`);
    return out;
  } catch (err) {
    if (err instanceof StepError) console.error(`✗ ${stepNo}. ${fa}: ${err.fa} — ${en}: ${err.en}`);
    else console.error(`✗ ${stepNo}. ${fa}: خطای غیرمنتظره — ${en}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ---- helpers for Next's action wire formats --------------------------------------------------------------------
const decodeEntities = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Hidden `$ACTION_*` inputs of the form whose HTML contains `marker` (progressive-enhancement bookkeeping). */
function actionFields(html: string, marker: RegExp): Record<string, string> {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((f) => marker.test(f) && /\$ACTION/.test(f));
  if (!form) fail("فرم موردنظر در صفحه پیدا نشد", `no <form> matching ${marker} with $ACTION fields`);
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (!name || !name.startsWith("$ACTION")) continue;
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    fields[name] = decodeEntities(value);
  }
  if (Object.keys(fields).length === 0) fail("فیلدهای اکشن فرم خالی است", "form has no $ACTION_* hidden fields");
  return fields;
}

const chunkCache = new Map<string, string>();

/** Every client JS chunk referenced by a page (script tags + flight payload), fetched once. */
async function pageChunks(html: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const m of html.matchAll(/(?:\/_next\/)?static\/chunks\/[^"'\\\s<>]+\.js/g)) {
    const p = m[0].startsWith("/_next/") ? m[0] : `/_next/${m[0]}`;
    paths.add(p);
  }
  const bodies: string[] = [];
  for (const p of paths) {
    let body = chunkCache.get(p);
    if (body === undefined) {
      const res = await request(p);
      body = res.ok ? await res.text() : "";
      chunkCache.set(p, body);
    }
    if (body) bodies.push(body);
  }
  return bodies;
}

/**
 * Server Action id of `exportName` as the browser learns it: `createServerReference("<id>", …, "<exportName>")` in
 * the page's client chunks (dev and minified production builds both keep the two string literals).
 */
async function discoverActionId(pagePath: string, exportName: string): Promise<string> {
  let page = await request(pagePath);
  if (page.status >= 500) {
    // One retry: a dev server compiling the route on first hit can answer 5xx once; production must pass twice.
    await new Promise((r) => setTimeout(r, 1500));
    page = await request(pagePath);
  }
  if (!page.ok) fail(`صفحهٴ ${pagePath} باز نشد (${page.status})`, `GET ${pagePath} → ${page.status}`);
  const html = await page.text();
  const needle = new RegExp(`["']${exportName}["']\\s*\\)`);
  for (const body of await pageChunks(html)) {
    let from = 0;
    for (;;) {
      const m = needle.exec(body.slice(from));
      if (!m) break;
      const at = from + m.index;
      const window = body.slice(Math.max(0, at - 6000), at);
      const ids = [...window.matchAll(/\(\s*["']([0-9a-f]{40,64})["']\s*,/g)];
      if (ids.length > 0) return ids[ids.length - 1][1];
      from = at + m[0].length;
    }
  }
  return fail(`شناسهٴ اکشن ${exportName} پیدا نشد`, `no createServerReference for ${exportName} in chunks of ${pagePath}`);
}

/** POST a Server Action the way `callServer` does; returns the action's return value (row 1 of the flight). */
async function callAction<T>(pagePath: string, actionId: string, args: unknown[]): Promise<T> {
  const res = await request(pagePath, {
    method: "POST",
    headers: { "next-action": actionId, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) fail(`اکشن با کد ${res.status} رد شد`, `action POST → ${res.status}: ${text.slice(0, 200)}`);
  // Flight rows are `<id>:<json>`; row 0 points at the result row via {"a":"$@N"}. Debug rows (`N:D"…"`) are skipped.
  const rows = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]+):(.*)$/.exec(line);
    if (!m || m[2].startsWith("D") || m[2].startsWith("I")) continue;
    if (!rows.has(m[1])) rows.set(m[1], m[2]);
  }
  const head = rows.get("0");
  const ref = head ? /"a":"\$@([0-9a-f]+)"/.exec(head)?.[1] : undefined;
  const raw = ref ? rows.get(ref) : undefined;
  if (!raw) fail("پاسخ اکشن قابل خواندن نبود", `cannot locate the action result in the flight response: ${text.slice(0, 200)}`);
  return JSON.parse(raw) as T;
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

// ---- steps ------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
const started = Date.now();

await step("سلامت سرویس", "health", async () => {
  const res = await request("/api/health");
  const body = (await res.json().catch(() => null)) as { ok?: boolean; db?: string; pendingMigrations?: number } | null;
  if (!res.ok || !body?.ok) fail(`پاسخ ${res.status} / db=${body?.db ?? "?"}`, `GET /api/health → ${res.status} ${JSON.stringify(body)}`);
  if ((body.pendingMigrations ?? 0) > 0) fail(`${body.pendingMigrations} مهاجرت اعمال نشده`, `pendingMigrations=${body.pendingMigrations}`);
});

await step("ورود با فرم واقعی", "login", async () => {
  const page = await request("/login");
  if (!page.ok) fail(`صفحهٴ ورود ${page.status}`, `GET /login → ${page.status}`);
  const fields = actionFields(await page.text(), /name="identifier"/);
  const form = new FormData();
  form.set("identifier", IDENTIFIER);
  form.set("password", PASSWORD);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await request("/login", { method: "POST", body: form });
  const location = res.headers.get("location") ?? "";
  if (res.status !== 303 && res.status !== 302) {
    const text = await res.text();
    const msg = /role="alert"[^>]*>([^<]*)</.exec(text)?.[1]?.trim();
    fail(msg ? `ورود رد شد: ${msg}` : `پاسخ ${res.status}`, `POST /login → ${res.status} (expected 303)`);
  }
  if (location.startsWith("/change-password")) fail("حساب باید اول رمز را تغییر دهد", "account has must_change_password — use a QA account");
  if (!location.startsWith("/home")) fail(`ریدایرکت به ${location}`, `expected Location /home, got ${location}`);
  if (![...jar.keys()].some((k) => /session$/i.test(k))) fail("کوکی نشست صادر نشد", "no session cookie in Set-Cookie");
});

await step("خلاصهٴ کارتابل", "inbox summary", async () => {
  const res = await request("/api/inbox/summary");
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status !== 200) fail(`پاسخ ${res.status}`, `GET /api/inbox/summary → ${res.status} ${JSON.stringify(body)}`);
  for (const k of ["overdue", "dueToday", "unread", "unreadNotifications"]) {
    if (typeof body?.[k] !== "number") fail(`فیلد ${k} عدد نیست`, `summary.${k} is not a number`);
  }
});

const workItemId = await step("ساخت یادداشت شخصی", "create todo", async () => {
  const id = await discoverActionId("/inbox/new", "createWorkItemAction");
  const title = `smoke ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const r = await callAction<Result<{ id: string }>>("/inbox/new", id, [
    { typeCode: "todo", title, priority: "normal", recipients: { kind: "self" } },
  ]);
  if (!r.ok) fail(`رد شد: ${r.message} (${r.code})`, `createWorkItemAction → ${r.code}`);
  if (!/^[0-9a-f-]{36}$/.test(r.data.id)) fail("شناسهٴ کار نامعتبر", `bad work item id ${r.data.id}`);
  return r.data.id;
});

await step("انجام‌شده کردن کار", "mark done", async () => {
  const id = await discoverActionId(`/inbox/${workItemId}`, "changeStatusAction");
  const r = await callAction<Result<unknown>>(`/inbox/${workItemId}`, id, [{ workItemId, toStatusCode: "done" }]);
  if (!r.ok) fail(`رد شد: ${r.message} (${r.code})`, `changeStatusAction → ${r.code}`);
});

await step("خروج", "logout", async () => {
  const page = await request("/more");
  if (!page.ok) fail(`صفحهٴ بیشتر ${page.status}`, `GET /more → ${page.status}`);
  const fields = actionFields(await page.text(), />\s*خروج\s*<\/button>/);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await request("/more", { method: "POST", body: form });
  const location = res.headers.get("location") ?? "";
  if (res.status !== 303 && res.status !== 302) fail(`پاسخ ${res.status}`, `POST logout → ${res.status} (expected 303)`);
  if (!location.startsWith("/login")) fail(`ریدایرکت به ${location}`, `expected Location /login?out=1, got ${location}`);
  // The browser drops the cookie because Set-Cookie clears it; keep a copy of the dead token for the next step.
});

await step("صفحهٴ خصوصی بدون نشست", "protected route redirects", async () => {
  // A stale-but-present cookie must ALSO bounce (the layout checks the DB, proxy only checks presence).
  jar.set("session", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const res = await request("/home");
  const location = res.headers.get("location") ?? "";
  if (![301, 302, 303, 307, 308].includes(res.status) || !/\/login(\?|$)/.test(location)) {
    fail(`پاسخ ${res.status} → ${location || "-"}`, `GET /home → ${res.status} ${location} (expected redirect to /login)`);
  }
  jar.clear();
  const bare = await request("/home");
  if (![301, 302, 303, 307, 308].includes(bare.status) || !/\/login(\?|$)/.test(bare.headers.get("location") ?? "")) {
    fail(`بدون کوکی: ${bare.status}`, `GET /home without cookie → ${bare.status}`);
  }
});

console.log(`\nهمه‌چیز سبز است — all ${stepNo} steps passed against ${BASE_URL} in ${Date.now() - started}ms`);
}

void main();
