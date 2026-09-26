// Load test against a RUNNING production build (`pnpm start -p 3002`) with the pilot dataset (`pnpm seed:pilot`).
//   BASE_URL=http://localhost:3002 pnpm load:test
//
// Virtual users (VUs) log in once through the REAL login form (the no-JS POST of `/login`, like scripts/smoke-prod.ts),
// then loop for the stage duration with a realistic mix: the 45 s badge poller `GET /api/inbox/summary` (most frequent),
// `/home`, `/inbox`, `/inbox/<id>` (ids scraped from the VU's own inbox HTML), `/notifications`, an occasional comment
// or «انجام شد» through the Server Action wire protocol, and teachers occasionally create a class task (the real
// fan-out: one inbox entry + one notification per student). Think time 3–8 s per VU.
//
// Stages (env `LOAD_STAGES="50x120,200x180,500x180"` = VUs × seconds): VUs pick accounts round-robin across the three
// pilot schools, ≈ 70 % students / 25 % teachers / 5 % admins. Sessions survive across stages (an account logs in once).
//
// Every 10 s the sampler records: RSS of the `next start` process (`LOAD_PID`, else the owner of the port on Windows),
// `pg_stat_activity` for the app database (total / active / waiting — `LOAD_DB_URL`, a superuser or pg_read_all_stats
// role; skipped when unreachable), `docker stats` of the DB container (`LOAD_DB_CONTAINER`) and, when the extension is
// loaded, the top statements from `pg_stat_statements` per stage.
//
// Output: backups/load-test-<date>.md (Markdown report) + .json (raw numbers). Exit code 1 when a stage saw 5xx or
// network errors, 0 otherwise. No dependencies beyond Node 22 (`fetch`, `AbortSignal.timeout`) and `pg` for monitoring.
//
// Accounts: with `LOAD_DB_URL` the script lists the pilot accounts from the database (the only complete source — the
// credentials sheet shows three students per class). `LOAD_PASSWORD` defaults to the pilot password.
// Writes (comments, status changes, tasks) are titled «بار آزمایشی» and can be turned off with `LOAD_WRITES=0`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";

const execFileP = promisify(execFile);

// ---- configuration ----------------------------------------------------------------------------------------------
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const PASSWORD = process.env.LOAD_PASSWORD ?? "Pilot-1405-pass";
const STAGES = parseStages(process.env.LOAD_STAGES ?? "50x120,200x180,500x180");
const THINK_MIN_MS = Number(process.env.LOAD_THINK_MIN_MS ?? 3000);
const THINK_MAX_MS = Number(process.env.LOAD_THINK_MAX_MS ?? 8000);
const REQUEST_TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 30_000);
const LOGIN_CONCURRENCY = Number(process.env.LOAD_LOGIN_CONCURRENCY ?? 8);
const SAMPLE_EVERY_MS = 10_000;
const WRITES = process.env.LOAD_WRITES !== "0";
const DB_URL = process.env.LOAD_DB_URL ?? "postgres://postgres:postgres@localhost:15433/app";
const DB_NAME = process.env.LOAD_DB_NAME ?? "app";
const DB_CONTAINER = process.env.LOAD_DB_CONTAINER ?? "edu-platform-dev-db-1";
const PILOT_ORG_SLUGS = (process.env.LOAD_ORG_SLUGS ?? "allameh,farzanegan,helli").split(",");
const OUT_DIR = process.env.LOAD_OUT_DIR ?? path.resolve(process.cwd(), "backups");

interface Stage {
  vus: number;
  seconds: number;
}

function parseStages(raw: string): Stage[] {
  const stages = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+)x(\d+)$/i.exec(s);
      if (!m) throw new Error(`LOAD_STAGES: bad stage "${s}" (expected <vus>x<seconds>, e.g. 50x120)`);
      return { vus: Number(m[1]), seconds: Number(m[2]) };
    });
  if (stages.length === 0) throw new Error("LOAD_STAGES is empty");
  return stages;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ---- accounts ---------------------------------------------------------------------------------------------------
type Kind = "student" | "teacher" | "admin";

interface Account {
  identifier: string;
  kind: Kind;
  org: string;
}

/** Pilot accounts from the database: active, no forced password change, grouped by org and role kind. */
async function loadAccounts(pool: Pool): Promise<Account[]> {
  const res = await pool.query<{ identifier: string; kind: Kind; org: string }>(
    `select ua.login_identifier as identifier,
            case when sp.id is not null then 'student'
                 when exists (select 1 from iam.role_assignment ra join iam.role r on r.id = ra.role_id
                              where ra.person_id = p.id and ra.revoked_at is null
                                and r.code in ('org_admin', 'school_principal', 'vice_principal')) then 'admin'
                 else 'teacher' end as kind,
            o.slug as org
       from iam.user_account ua
       join iam.organization_membership m on m.user_account_id = ua.id and m.status = 'active'
       join iam.person p on p.id = m.person_id
       join tenancy.organization o on o.id = p.organization_id
       left join iam.student_profile sp on sp.person_id = p.id
      where ua.status = 'active' and not ua.must_change_password and o.slug = any($1)
      order by o.slug, kind, ua.login_identifier`,
    [PILOT_ORG_SLUGS],
  );
  return res.rows;
}

/** ≈ 70 % students / 25 % teachers / 5 % admins, round-robin across the schools inside each kind. */
function planAccounts(accounts: Account[], n: number): Account[] {
  const byKind: Record<Kind, Account[][]> = { student: [], teacher: [], admin: [] };
  for (const org of PILOT_ORG_SLUGS) {
    for (const kind of ["student", "teacher", "admin"] as const) {
      const list = accounts.filter((a) => a.org === org && a.kind === kind);
      if (list.length > 0) byKind[kind].push(list);
    }
  }
  const share: Record<Kind, number> = { student: 0.7, teacher: 0.25, admin: 0.05 };
  const out: Account[] = [];
  for (const kind of ["student", "teacher", "admin"] as const) {
    const want = Math.max(1, Math.round(n * share[kind]));
    const lists = byKind[kind];
    if (lists.length === 0) continue;
    const cursors = lists.map(() => 0);
    for (let i = 0; i < want; i++) {
      const li = i % lists.length;
      const list = lists[li];
      out.push(list[cursors[li] % list.length]);
      cursors[li]++;
    }
  }
  return out.slice(0, n);
}

// ---- cookie jar + request -----------------------------------------------------------------------------------------
class Jar {
  private readonly cookies = new Map<string, string>();

  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || /^\s*expires=.*1970/i.test(a));
      if (value === "" || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  hasSession(): boolean {
    return [...this.cookies.keys()].some((k) => /session$/i.test(k));
  }
}

// ---- metrics -----------------------------------------------------------------------------------------------------
type Label = "login" | "home" | "inbox" | "summary" | "notifications" | "detail" | "comment" | "mark_done" | "create_task" | "inbox_new";

interface Series {
  durations: number[];
  ok: number;
  status4xx: number;
  status5xx: number;
  netErrors: number;
  authLost: number;
  /** Server Action answered `{ ok: false }` (business rule — expected for e.g. an already-done item). */
  rejected: number;
}

const newSeries = (): Series => ({ durations: [], ok: 0, status4xx: 0, status5xx: 0, netErrors: 0, authLost: 0, rejected: 0 });

class Metrics {
  readonly series = new Map<Label, Series>();
  startedAt = Date.now();
  requests = 0;

  of(label: Label): Series {
    let s = this.series.get(label);
    if (!s) this.series.set(label, (s = newSeries()));
    return s;
  }

  record(label: Label, ms: number, outcome: "ok" | "4xx" | "5xx" | "net" | "auth_lost" | "rejected"): void {
    const s = this.of(label);
    s.durations.push(ms);
    this.requests++;
    if (outcome === "ok") s.ok++;
    else if (outcome === "4xx") s.status4xx++;
    else if (outcome === "5xx") s.status5xx++;
    else if (outcome === "net") s.netErrors++;
    else if (outcome === "auth_lost") s.authLost++;
    else s.rejected++;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// ---- virtual user ------------------------------------------------------------------------------------------------
const decodeEntities = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function actionFields(html: string, marker: RegExp): Record<string, string> | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((f) => marker.test(f) && /\$ACTION/.test(f));
  if (!form) return null;
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (!name || !name.startsWith("$ACTION")) continue;
    fields[name] = decodeEntities(/value="([^"]*)"/.exec(m[0])?.[1] ?? "");
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Action ids discovered once from the client chunks (`createServerReference("<id>", …, "<exportName>")`). */
const actionIds = new Map<string, string>();
const chunkCache = new Map<string, string>();

class VirtualUser {
  readonly jar = new Jar();
  inboxIds: string[] = [];
  offeringIds: string[] = [];
  loggedIn = false;

  constructor(
    readonly account: Account,
    /** The current stage's metrics — swapped by the stage runner because a VU's session lives across stages. */
    public metrics: () => Metrics,
  ) {}

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.jar.header();
    if (cookie) headers.set("cookie", cookie);
    headers.set("user-agent", "edu-load/1.0");
    const res = await fetch(`${BASE_URL}${pathname}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    this.jar.store(res);
    return res;
  }

  /** Timed GET of a page or API; drains the body so the connection is reused. Returns the body text on 200. */
  async timedGet(label: Label, pathname: string): Promise<string | null> {
    const t0 = performance.now();
    try {
      const res = await this.request(pathname);
      const text = await res.text();
      const ms = performance.now() - t0;
      if (res.status >= 500) this.metrics().record(label, ms, "5xx");
      else if (res.status >= 300 && res.status < 400 && /\/login/.test(res.headers.get("location") ?? "")) this.metrics().record(label, ms, "auth_lost");
      else if (res.status >= 400) this.metrics().record(label, ms, "4xx");
      else this.metrics().record(label, ms, "ok");
      return res.status === 200 ? text : null;
    } catch {
      this.metrics().record(label, performance.now() - t0, "net");
      return null;
    }
  }

  async login(): Promise<boolean> {
    const t0 = performance.now();
    try {
      const page = await this.request("/login");
      const html = await page.text();
      const fields = page.ok ? actionFields(html, /name="identifier"/) : null;
      if (!fields) {
        this.metrics().record("login", performance.now() - t0, page.status >= 500 ? "5xx" : "4xx");
        return false;
      }
      const form = new FormData();
      form.set("identifier", this.account.identifier.replace(/^\+98/, "0"));
      form.set("password", PASSWORD);
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      const res = await this.request("/login", { method: "POST", body: form });
      await res.text();
      const ms = performance.now() - t0;
      const location = res.headers.get("location") ?? "";
      if (res.status >= 500) {
        this.metrics().record("login", ms, "5xx");
        return false;
      }
      if ((res.status === 303 || res.status === 302) && location.startsWith("/home") && this.jar.hasSession()) {
        this.metrics().record("login", ms, "ok");
        this.loggedIn = true;
        return true;
      }
      this.metrics().record("login", ms, "rejected");
      return false;
    } catch {
      this.metrics().record("login", performance.now() - t0, "net");
      return false;
    }
  }

  private async pageChunks(html: string): Promise<string[]> {
    const paths = new Set<string>();
    for (const m of html.matchAll(/(?:\/_next\/)?static\/chunks\/[^"'\\\s<>]+\.js/g)) paths.add(m[0].startsWith("/_next/") ? m[0] : `/_next/${m[0]}`);
    const bodies: string[] = [];
    for (const p of paths) {
      let body = chunkCache.get(p);
      if (body === undefined) {
        const res = await this.request(p);
        body = res.ok ? await res.text() : "";
        chunkCache.set(p, body);
      }
      if (body) bodies.push(body);
    }
    return bodies;
  }

  /** Same discovery as scripts/smoke-prod.ts; cached process-wide. */
  async discoverActionId(pagePath: string, exportName: string): Promise<string | null> {
    const cached = actionIds.get(exportName);
    if (cached) return cached;
    const page = await this.request(pagePath);
    if (!page.ok) return null;
    const html = await page.text();
    const needle = new RegExp(`["']${exportName}["']\\s*\\)`);
    for (const body of await this.pageChunks(html)) {
      let from = 0;
      for (;;) {
        const m = needle.exec(body.slice(from));
        if (!m) break;
        const at = from + m.index;
        const ids = [...body.slice(Math.max(0, at - 6000), at).matchAll(/\(\s*["']([0-9a-f]{40,64})["']\s*,/g)];
        if (ids.length > 0) {
          actionIds.set(exportName, ids[ids.length - 1][1]);
          return ids[ids.length - 1][1];
        }
        from = at + m[0].length;
      }
    }
    return null;
  }

  async callAction(label: Label, pagePath: string, exportName: string, args: unknown[]): Promise<void> {
    const actionId = actionIds.get(exportName) ?? (await this.discoverActionId(pagePath, exportName));
    if (!actionId) return;
    const t0 = performance.now();
    try {
      const res = await this.request(pagePath, {
        method: "POST",
        headers: { "next-action": actionId, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8", origin: BASE_URL },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      const ms = performance.now() - t0;
      if (res.status >= 500) return this.metrics().record(label, ms, "5xx");
      if (res.status >= 400) return this.metrics().record(label, ms, "4xx");
      if (res.status >= 300) return this.metrics().record(label, ms, "auth_lost");
      // Flight rows `<id>:<json>`; row 0 has {"a":"$@N"} pointing at the result row.
      const rows = new Map<string, string>();
      for (const line of text.split("\n")) {
        const m = /^([0-9a-f]+):(.*)$/.exec(line);
        if (!m || m[2].startsWith("D") || m[2].startsWith("I")) continue;
        if (!rows.has(m[1])) rows.set(m[1], m[2]);
      }
      const ref = /"a":"\$@([0-9a-f]+)"/.exec(rows.get("0") ?? "")?.[1];
      const raw = ref ? rows.get(ref) : undefined;
      const result = raw ? (JSON.parse(raw) as Result<unknown>) : null;
      this.metrics().record(label, ms, result?.ok ? "ok" : "rejected");
    } catch {
      this.metrics().record(label, performance.now() - t0, "net");
    }
  }

  private scrapeInboxIds(html: string): void {
    const ids = new Set<string>();
    for (const m of html.matchAll(/href="\/inbox\/([0-9a-f-]{36})"/g)) ids.add(m[1]);
    if (ids.size > 0) this.inboxIds = [...ids];
  }

  private scrapeOfferingIds(html: string): void {
    const ids = new Set<string>();
    for (const m of html.matchAll(/<option[^>]*value="([0-9a-f-]{36})"/g)) ids.add(m[1]);
    if (ids.size > 0) this.offeringIds = [...ids];
  }

  /** One iteration of the realistic mix. */
  async step(): Promise<void> {
    const r = Math.random();
    if (r < 0.4) {
      await this.timedGet("summary", "/api/inbox/summary");
    } else if (r < 0.55) {
      await this.timedGet("home", "/home");
    } else if (r < 0.7) {
      const html = await this.timedGet("inbox", pick(["/inbox", "/inbox", "/inbox?tab=done"]));
      if (html) this.scrapeInboxIds(html);
    } else if (r < 0.85) {
      if (this.inboxIds.length === 0) {
        const html = await this.timedGet("inbox", "/inbox");
        if (html) this.scrapeInboxIds(html);
      }
      if (this.inboxIds.length > 0) await this.timedGet("detail", `/inbox/${pick(this.inboxIds)}`);
    } else if (r < 0.93) {
      await this.timedGet("notifications", "/notifications");
    } else if (r < 0.97) {
      if (WRITES && this.inboxIds.length > 0) {
        const id = pick(this.inboxIds);
        await this.callAction("comment", `/inbox/${id}`, "addCommentAction", [{ workItemId: id, body: `نظر بار آزمایشی ${new Date().toISOString().slice(11, 19)}`, visibility: "all" }]);
      }
    } else if (r < 0.99) {
      if (WRITES && this.inboxIds.length > 0) {
        const id = pick(this.inboxIds);
        await this.callAction("mark_done", `/inbox/${id}`, "changeStatusAction", [{ workItemId: id, toStatusCode: "done" }]);
      }
    } else if (WRITES && this.account.kind === "teacher") {
      if (this.offeringIds.length === 0) {
        const html = await this.timedGet("inbox_new", "/inbox/new");
        if (html) this.scrapeOfferingIds(html);
      }
      if (this.offeringIds.length > 0) {
        await this.callAction("create_task", "/inbox/new", "createWorkItemAction", [
          { typeCode: "task", title: `بار آزمایشی ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, priority: "normal", recipients: { kind: "class_offering", id: pick(this.offeringIds), excludePersonIds: [] } },
        ]);
      }
    }
  }
}

// ---- sampler (RSS, Postgres, docker) ------------------------------------------------------------------------------
interface Sample {
  t: number;
  rssMb: number | null;
  /** CPU of the app process since the previous sample, in % of ONE core (100 = one core saturated). */
  appCpuPct: number | null;
  pgTotal: number | null;
  pgActive: number | null;
  pgWaiting: number | null;
  dbCpu: string | null;
  dbMem: string | null;
}

async function findServerPid(): Promise<number | null> {
  if (process.env.LOAD_PID) return Number(process.env.LOAD_PID);
  const port = Number(new URL(BASE_URL).port || 80);
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess`]);
      const pid = Number(stdout.trim());
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    }
    const { stdout } = await execFileP("sh", ["-c", `ss -ltnp 'sport = :${port}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2`]);
    const pid = Number(stdout.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function rssMb(pid: number): Promise<number | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      const cells = stdout.trim().split('","');
      const mem = cells[cells.length - 1]?.replace(/[^0-9]/g, "");
      return mem ? Math.round(Number(mem) / 1024) : null;
    }
    const { stdout } = await execFileP("ps", ["-o", "rss=", "-p", String(pid)]);
    const kb = Number(stdout.trim());
    return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

/** Total CPU seconds (user + system) consumed by `pid` so far. */
async function cpuSeconds(pid: number): Promise<number | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds`]);
      const v = Number(stdout.trim());
      return Number.isFinite(v) ? v : null;
    }
    const stat = await fs.promises.readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[11]) + Number(fields[12]); // utime + stime
    return Number.isFinite(ticks) ? ticks / 100 : null;
  } catch {
    return null;
  }
}

async function dockerStats(): Promise<{ cpu: string; mem: string } | null> {
  if (!DB_CONTAINER) return null;
  try {
    const { stdout } = await execFileP("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", DB_CONTAINER], { timeout: 8000 });
    const [cpu, mem] = stdout.trim().split("|");
    return cpu ? { cpu, mem: mem ?? "" } : null;
  } catch {
    return null;
  }
}

class Monitor {
  private pool: Pool | null = null;
  pid: number | null = null;
  pgStatStatements = false;
  private timer: NodeJS.Timeout | null = null;
  samples: Sample[] = [];

  async init(): Promise<void> {
    this.pid = await findServerPid();
    if (DB_URL) {
      const pool = new Pool({ connectionString: DB_URL, max: 1 });
      try {
        await pool.query("select 1");
        this.pool = pool;
        const ext = await pool.query("select 1 from pg_extension where extname = 'pg_stat_statements'");
        this.pgStatStatements = (ext.rowCount ?? 0) > 0;
      } catch (err) {
        console.warn(`monitor: database unreachable (${err instanceof Error ? err.message : String(err)}) — DB sampling skipped`);
        await pool.end().catch(() => undefined);
      }
    }
  }

  get db(): Pool | null {
    return this.pool;
  }

  private lastCpu: { t: number; seconds: number } | null = null;

  async sample(): Promise<Sample> {
    const [rss, cpu, pg, docker] = await Promise.all([
      this.pid ? rssMb(this.pid) : Promise.resolve(null),
      this.pid ? cpuSeconds(this.pid) : Promise.resolve(null),
      this.pgActivity(),
      dockerStats(),
    ]);
    const t = Date.now();
    let appCpuPct: number | null = null;
    if (cpu !== null) {
      if (this.lastCpu && t > this.lastCpu.t) appCpuPct = Math.round(((cpu - this.lastCpu.seconds) / ((t - this.lastCpu.t) / 1000)) * 100);
      this.lastCpu = { t, seconds: cpu };
    }
    const s: Sample = { t, rssMb: rss, appCpuPct, pgTotal: pg?.total ?? null, pgActive: pg?.active ?? null, pgWaiting: pg?.waiting ?? null, dbCpu: docker?.cpu ?? null, dbMem: docker?.mem ?? null };
    this.samples.push(s);
    return s;
  }

  private async pgActivity(): Promise<{ total: number; active: number; waiting: number } | null> {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query<{ total: number; active: number; waiting: number }>(
        `select count(*)::int as total,
                count(*) filter (where state = 'active')::int as active,
                count(*) filter (where wait_event_type in ('Lock', 'LWLock', 'IO') and state = 'active')::int as waiting
           from pg_stat_activity where datname = $1 and backend_type = 'client backend' and pid <> pg_backend_pid()`,
        [DB_NAME],
      );
      return res.rows[0] ?? null;
    } catch {
      return null;
    }
  }

  async resetStatements(): Promise<void> {
    if (!this.pool || !this.pgStatStatements) return;
    await this.pool.query("select pg_stat_statements_reset()").catch(() => undefined);
  }

  async topStatements(limit = 8): Promise<{ calls: number; totalMs: number; meanMs: number; query: string }[]> {
    if (!this.pool || !this.pgStatStatements) return [];
    try {
      const res = await this.pool.query<{ calls: string; total_ms: string; mean_ms: string; query: string }>(
        `select calls, round(total_exec_time::numeric)::text as total_ms, round(mean_exec_time::numeric, 1)::text as mean_ms,
                left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as query
           from pg_stat_statements s join pg_database d on d.oid = s.dbid
          where d.datname = $1 and query not ilike '%pg_stat_%' and query not ilike 'select set_config%'
          order by total_exec_time desc limit $2`,
        [DB_NAME, limit],
      );
      return res.rows.map((r) => ({ calls: Number(r.calls), totalMs: Number(r.total_ms), meanMs: Number(r.mean_ms), query: r.query }));
    } catch {
      return [];
    }
  }

  start(onSample: (s: Sample) => void): void {
    this.stop();
    this.timer = setInterval(() => void this.sample().then(onSample), SAMPLE_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async close(): Promise<void> {
    this.stop();
    await this.pool?.end().catch(() => undefined);
  }
}

// ---- stage runner ----------------------------------------------------------------------------------------------
interface StageResult {
  stage: Stage;
  loginsOk: number;
  loginsFailed: number;
  rampMs: number;
  elapsedMs: number;
  requests: number;
  rps: number;
  endpoints: Record<string, { count: number; p50: number; p95: number; p99: number; max: number; ok: number; s4xx: number; s5xx: number; net: number; authLost: number; rejected: number }>;
  errors5xx: number;
  netErrors: number;
  authLost: number;
  rssStartMb: number | null;
  rssEndMb: number | null;
  rssPeakMb: number | null;
  appCpuPeakPct: number | null;
  pgPeakTotal: number | null;
  pgPeakActive: number | null;
  pgPeakWaiting: number | null;
  dbCpuPeak: string | null;
  topStatements: { calls: number; totalMs: number; meanMs: number; query: string }[];
  samples: Sample[];
}

const vusByIdentifier = new Map<string, VirtualUser>();

async function runStage(stage: Stage, accounts: Account[], monitor: Monitor): Promise<StageResult> {
  const metrics = new Metrics();
  const metricsRef = (): Metrics => metrics;
  const plan = planAccounts(accounts, stage.vus);
  const vus = plan.map((a) => {
    let vu = vusByIdentifier.get(a.identifier);
    if (!vu) vusByIdentifier.set(a.identifier, (vu = new VirtualUser(a, metricsRef)));
    vu.metrics = metricsRef;
    return vu;
  });

  console.log(`\n=== stage ${stage.vus} VUs × ${stage.seconds}s — ${plan.filter((a) => a.kind === "student").length} students / ${plan.filter((a) => a.kind === "teacher").length} teachers / ${plan.filter((a) => a.kind === "admin").length} admins`);
  await monitor.resetStatements();
  const first = await monitor.sample();
  const stageStart = Date.now();
  const deadline = stageStart + stage.seconds * 1000;
  monitor.start((s) => {
    const done = metrics.requests;
    const el = (Date.now() - stageStart) / 1000;
    console.log(
      `  t+${el.toFixed(0).padStart(4)}s  req=${String(done).padStart(6)}  rps=${(done / Math.max(1, el)).toFixed(1).padStart(5)}  5xx=${sum5xx(metrics)}  net=${sumNet(metrics)}  rss=${s.rssMb ?? "?"}MB  cpu=${s.appCpuPct ?? "?"}%  pg=${s.pgTotal ?? "?"}/${s.pgActive ?? "?"}/${s.pgWaiting ?? "?"}  dbcpu=${s.dbCpu ?? "?"}`,
    );
  });

  // Ramp: log the not-yet-logged-in VUs in with bounded concurrency, each VU starting its loop as soon as it is in.
  let loginsOk = 0;
  let loginsFailed = 0;
  let cursor = 0;
  const loops: Promise<void>[] = [];
  const stopped = { value: false };
  const startLoop = (vu: VirtualUser): void => {
    loops.push(
      (async () => {
        await sleep(rand(0, THINK_MAX_MS)); // spread the first hits so 500 users do not fire in the same second
        while (!stopped.value && Date.now() < deadline) {
          await vu.step();
          if (Date.now() >= deadline) break;
          await sleep(rand(THINK_MIN_MS, THINK_MAX_MS));
        }
      })(),
    );
  };
  const rampT0 = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(LOGIN_CONCURRENCY, vus.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= vus.length) return;
        const vu = vus[i];
        if (vu.loggedIn) {
          loginsOk++;
          startLoop(vu);
          continue;
        }
        if (await vu.login()) {
          loginsOk++;
          startLoop(vu);
        } else loginsFailed++;
      }
    }),
  );
  const rampMs = Date.now() - rampT0;
  console.log(`  ramp done in ${(rampMs / 1000).toFixed(1)}s — ${loginsOk} sessions, ${loginsFailed} login failures`);
  // Discover the action ids once, before the writes start in earnest.
  const teacher = vus.find((v) => v.loggedIn && v.account.kind === "teacher");
  if (teacher && WRITES) await teacher.discoverActionId("/inbox/new", "createWorkItemAction").catch(() => null);

  await Promise.all(loops);
  stopped.value = true;
  monitor.stop();
  const last = await monitor.sample();
  const elapsedMs = Date.now() - stageStart;
  const topStatements = await monitor.topStatements();

  const endpoints: StageResult["endpoints"] = {};
  for (const [label, s] of metrics.series) {
    const sorted = [...s.durations].sort((a, b) => a - b);
    endpoints[label] = {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
      ok: s.ok,
      s4xx: s.status4xx,
      s5xx: s.status5xx,
      net: s.netErrors,
      authLost: s.authLost,
      rejected: s.rejected,
    };
  }
  const stageSamples = monitor.samples.filter((s) => s.t >= first.t);
  const rssValues = stageSamples.map((s) => s.rssMb).filter((x): x is number => x !== null);
  const peak = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.max(...v) : null;
  };
  const cpuValues = stageSamples.map((s) => s.dbCpu).filter((x): x is string => x !== null);
  const dbCpuPeak = cpuValues.length ? cpuValues.reduce((a, b) => (parseFloat(a) >= parseFloat(b) ? a : b)) : null;
  return {
    stage,
    loginsOk,
    loginsFailed,
    rampMs,
    elapsedMs,
    requests: metrics.requests,
    rps: metrics.requests / (elapsedMs / 1000),
    endpoints,
    errors5xx: sum5xx(metrics),
    netErrors: sumNet(metrics),
    authLost: [...metrics.series.values()].reduce((n, s) => n + s.authLost, 0),
    rssStartMb: first.rssMb,
    rssEndMb: last.rssMb,
    rssPeakMb: rssValues.length ? Math.max(...rssValues) : null,
    appCpuPeakPct: peak(stageSamples.map((s) => s.appCpuPct)),
    pgPeakTotal: peak(stageSamples.map((s) => s.pgTotal)),
    pgPeakActive: peak(stageSamples.map((s) => s.pgActive)),
    pgPeakWaiting: peak(stageSamples.map((s) => s.pgWaiting)),
    dbCpuPeak,
    topStatements,
    samples: stageSamples,
  };
}

const sum5xx = (m: Metrics): number => [...m.series.values()].reduce((n, s) => n + s.status5xx, 0);
const sumNet = (m: Metrics): number => [...m.series.values()].reduce((n, s) => n + s.netErrors, 0);

// ---- report ------------------------------------------------------------------------------------------------------
const LABEL_ORDER: Label[] = ["summary", "home", "inbox", "detail", "notifications", "comment", "mark_done", "create_task", "login", "inbox_new"];

function renderMarkdown(results: StageResult[], meta: { startedAt: Date; pid: number | null; accounts: number; pgStatStatements: boolean }): string {
  const lines: string[] = [];
  lines.push(`# Load test — ${meta.startedAt.toISOString()}`, "");
  lines.push(`- target: \`${BASE_URL}\` (pid ${meta.pid ?? "?"}) · accounts available: ${meta.accounts} · think ${THINK_MIN_MS}–${THINK_MAX_MS} ms · writes ${WRITES ? "on" : "off"} · pg_stat_statements ${meta.pgStatStatements ? "yes" : "no"}`);
  lines.push(`- stages: ${results.map((r) => `${r.stage.vus}×${r.stage.seconds}s`).join(" → ")}`, "");
  lines.push("## Summary", "");
  lines.push("| stage | sessions | login fail | ramp | req | RPS | 5xx | net err | auth lost | RSS start→end (peak) MB | app CPU peak (1 core = 100 %) | pg conn peak total/active/waiting | DB CPU peak |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.stage.vus} VU × ${r.stage.seconds}s | ${r.loginsOk} | ${r.loginsFailed} | ${(r.rampMs / 1000).toFixed(1)}s | ${r.requests} | ${r.rps.toFixed(1)} | ${r.errors5xx} | ${r.netErrors} | ${r.authLost} | ${r.rssStartMb ?? "?"}→${r.rssEndMb ?? "?"} (${r.rssPeakMb ?? "?"}) | ${r.appCpuPeakPct ?? "?"} % | ${r.pgPeakTotal ?? "?"}/${r.pgPeakActive ?? "?"}/${r.pgPeakWaiting ?? "?"} | ${r.dbCpuPeak ?? "?"} |`,
    );
  }
  for (const r of results) {
    lines.push("", `## Stage ${r.stage.vus} VUs × ${r.stage.seconds}s`, "");
    lines.push("| endpoint | count | p50 ms | p95 ms | p99 ms | max ms | ok | 4xx | 5xx | net | auth lost | rejected |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const label of LABEL_ORDER) {
      const e = r.endpoints[label];
      if (!e) continue;
      lines.push(`| ${label} | ${e.count} | ${e.p50} | ${e.p95} | ${e.p99} | ${e.max} | ${e.ok} | ${e.s4xx} | ${e.s5xx} | ${e.net} | ${e.authLost} | ${e.rejected} |`);
    }
    if (r.samples.length > 0) {
      lines.push("", "| t | RSS MB | app CPU % | pg total | pg active | pg waiting | DB CPU | DB mem |", "|---|---|---|---|---|---|---|---|");
      for (const s of r.samples) {
        lines.push(`| +${Math.round((s.t - r.samples[0].t) / 1000)}s | ${s.rssMb ?? "?"} | ${s.appCpuPct ?? "?"} | ${s.pgTotal ?? "?"} | ${s.pgActive ?? "?"} | ${s.pgWaiting ?? "?"} | ${s.dbCpu ?? "?"} | ${s.dbMem ?? "?"} |`);
      }
    }
    if (r.topStatements.length > 0) {
      lines.push("", "Top statements (pg_stat_statements, this stage):", "", "| calls | total ms | mean ms | query |", "|---|---|---|---|");
      for (const q of r.topStatements) lines.push(`| ${q.calls} | ${q.totalMs} | ${q.meanMs} | \`${q.query.replace(/\|/g, "\\|")}\` |`);
    }
  }
  return lines.join("\n") + "\n";
}

// ---- main --------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const startedAt = new Date();
  const health = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json() as Promise<{ ok?: boolean }>).catch(() => null);
  if (!health?.ok) {
    console.error(`GET ${BASE_URL}/api/health did not answer ok:true — is \`pnpm start -p 3002\` running?`);
    process.exit(2);
  }
  const monitor = new Monitor();
  await monitor.init();
  if (!monitor.db) {
    console.error("LOAD_DB_URL is required to list the pilot accounts (the credentials sheet lists only three students per class).");
    process.exit(2);
  }
  const accounts = await loadAccounts(monitor.db);
  if (accounts.length === 0) {
    console.error(`no active pilot accounts for orgs ${PILOT_ORG_SLUGS.join(", ")} — run pnpm seed:pilot`);
    process.exit(2);
  }
  console.log(`target ${BASE_URL} (pid ${monitor.pid ?? "unknown"}) · ${accounts.length} accounts · pg_stat_statements ${monitor.pgStatStatements ? "on" : "off"}`);
  console.log(`stages: ${STAGES.map((s) => `${s.vus}×${s.seconds}s`).join(" → ")} · think ${THINK_MIN_MS}–${THINK_MAX_MS} ms · writes ${WRITES ? "on" : "off"}`);

  const results: StageResult[] = [];
  for (const stage of STAGES) {
    results.push(await runStage(stage, accounts, monitor));
    const r = results[results.length - 1];
    console.log(`  → ${r.requests} req · ${r.rps.toFixed(1)} rps · 5xx ${r.errors5xx} · net ${r.netErrors} · rss ${r.rssStartMb}→${r.rssEndMb} MB · pg peak ${r.pgPeakTotal}`);
    for (const label of LABEL_ORDER) {
      const e = r.endpoints[label];
      if (e) console.log(`     ${label.padEnd(14)} n=${String(e.count).padStart(5)} p50=${String(e.p50).padStart(5)} p95=${String(e.p95).padStart(5)} p99=${String(e.p99).padStart(5)} 5xx=${e.s5xx} net=${e.net} rej=${e.rejected}`);
    }
  }
  await monitor.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const mdPath = path.join(OUT_DIR, `load-test-${stamp}.md`);
  const jsonPath = path.join(OUT_DIR, `load-test-${stamp}.json`);
  fs.writeFileSync(mdPath, renderMarkdown(results, { startedAt, pid: monitor.pid, accounts: accounts.length, pgStatStatements: monitor.pgStatStatements }), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({ startedAt, baseUrl: BASE_URL, stages: results.map((r) => ({ ...r, samples: undefined })) }, null, 2), "utf8");
  console.log(`\nreport: ${mdPath}\njson:   ${jsonPath}`);
  const failed = results.some((r) => r.errors5xx > 0 || r.netErrors > 0);
  process.exit(failed ? 1 : 0);
}

void main();
