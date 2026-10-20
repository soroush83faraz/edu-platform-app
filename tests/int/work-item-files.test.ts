// «پیوست تکلیف و تحویل پاسخ» (owner, 2026-10-19; migration 0024; docs/decisions.md). Both layers: the services
// (src/modules/workspace/{file-access,work-item-files,submissions}.ts — what the two route handlers and the actions run
// through defineAction) and the database (0024's CHECKs, grants and RESTRICTIVE policies decide per
// `app.current_person_id()`, so every call runs as its actor — `as` binds what withTenant binds for a request of theirs).
//   • 0024: tables, RLS (ENABLE + FORCE + the RESTRICTIVE policies), no DELETE for app_rw, the earlier REVOKEs intact;
//   • a teacher's files on a new تکلیف: every assignee, the giver and a manager download them; another class's
//     student, a guardian, a counselor, another class's teacher and another tenant get NOT_FOUND; a pending upload is
//     served to nobody;
//   • uploads are refused BEFORE a byte is written: no permission, an invisible تکلیف, not its manager, a demo session;
//   • a student's پاسخ (text + files): the giver sees every پاسخ and who has not answered, another student never sees
//     one — service AND database; one bell to the giver, title only; editing replaces files (old bytes deleted);
//   • limits: 5 files per تکلیف, a stranger's or another تکلیف's upload, an empty پاسخ, the daily quota;
//   • a closed تکلیف takes no پاسخ (and «بازیابی» opens it again); a removed student's پاسخ stays for the giver;
//   • the audit trail has ids, sizes and types only; stale pending uploads expire;
//   • 0025 (security review 2026-10-19, D3): the FILE rows fail closed too — a classmate, another class, a guardian, a
//     counselor read none of another's file rows and archive nothing; nobody but the item's manager touches a giver's
//     attachment; `app.work_item_manager` = `managesItem`; expiry and the sweeper's lookup through their SECURITY
//     DEFINER functions, the current organization only;
//   • D6: the orphan sweep deletes only bytes no live row names, older than a day — through app.live_file_ids.
// FILES_DIR is a fresh temp directory for this file. The catalog is seeded in beforeAll; every write runs inside a
// withTenant transaction that ends with Rollback; afterAll re-creates the fixture database (later files assert exact
// fixture counts).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type SQL, and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditLog, fileObject, notification, workItemAttachment, workItemSubmission } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { assignTeacher } from "@/modules/academic/service";
import { type Assignment } from "@/modules/iam/can";
import { DEMO_SESSION_LABEL } from "@/modules/iam/demo-login/repo";
import { addGuardian } from "@/modules/iam/guardian";
import { PERMISSIONS } from "@/modules/iam/permissions";
import { removePerson } from "@/modules/iam/removal";
import { listValidAssignments } from "@/modules/iam/repo";
import { assignRole, createStaff, createStudent } from "@/modules/iam/service";
import { createSession } from "@/modules/iam/session";
import { createClassOffering } from "@/modules/tenancy/service";
import { FILE_LIMITS, FILE_MESSAGES, MiB } from "@/modules/files/limits";
import { storageKeyFor, storagePathIn } from "@/modules/files/paths";
import { receiveToTemp } from "@/modules/files/receive";
import { sniffFile } from "@/modules/files/sniff";
import { filesRoot, removeStored, tempDir } from "@/modules/files/storage";
import { type UploadMeta, type UploadedFile, authorizeUpload, findDownload, recordUpload, sweepOrphanFiles, workItemFilesView } from "@/modules/workspace/file-access";
import { changeStatus, createWorkItem, getWorkItemDetail, updateWorkItem } from "@/modules/workspace/service";
import { saveSubmission, submittedTitle } from "@/modules/workspace/submissions";
import { runMigrations } from "../../scripts/migrate";
import { seedCatalog } from "../../scripts/seed";
import { OWNER_URL } from "./env";
import * as f from "./fixtures";
import { dropAppSchemas, seed } from "./global-setup";
import { Rollback, asAppRw } from "./helpers";

interface Actor {
  orgId: string;
  personId: string;
  userId: null;
  requestId: string;
  assignments: Assignment[];
  sessionId?: string;
}

const ALL = PERMISSIONS.map((p) => p.code);
const bootstrap: Actor = {
  orgId: f.ORG_A,
  personId: f.PERSON_A2,
  userId: null,
  requestId: "int-work-item-files",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin", scopeType: "organization", scopeId: f.ORG_A, permissions: ALL }],
};
/** An organization admin of B — every permission, but RLS shows it nothing of A. */
const adminB: Actor = {
  orgId: f.ORG_B,
  personId: f.PERSON_B1,
  userId: null,
  requestId: "int-work-item-files",
  assignments: [{ roleCode: "org_admin", roleId: "r-admin-b", scopeType: "organization", scopeId: f.ORG_B, permissions: ALL }],
};
const tenant = { orgId: f.ORG_A, personId: f.PERSON_A2 };
const phone = (n: number) => `0912753${String(n).padStart(4, "0")}`;

const isError = (code: string, message?: string) => (e: unknown) => AppError.is(e) && e.code === code && (message === undefined || e.message === message);
const rejects = async (p: Promise<unknown>, code: string, message?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected ${code}`).not.toBeNull();
  expect(isError(code, message)(err), `got ${AppError.is(err) ? `${err.code}: ${err.message}` : String(err)}`).toBe(true);
};

/** Binds the tenant and `app.current_person_id` to `who` (what withTenant does for a request of theirs), then runs `fn`. */
async function as<T>(tx: Tx, who: { orgId: string; personId: string }, fn: (t: Tx) => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.current_org_id', ${who.orgId}, true), set_config('app.current_person_id', ${who.personId}, true)`);
  return fn(tx);
}

async function actor(tx: Tx, personId: string): Promise<Actor> {
  return { orgId: f.ORG_A, personId, userId: null, requestId: "int-work-item-files", assignments: await listValidAssignments(tx, personId) };
}

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(
    withTenant(tenant, async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent) c.close();
      else {
        c.enqueue(new Uint8Array(bytes));
        sent = true;
      }
    },
  });
}

const pdf = (label: string) => Buffer.from(`%PDF-1.7\n% ${label}\n1 0 obj << >> endobj\n`, "utf8");
const text = (s: string) => Buffer.from(s, "utf8");

/** What POST /api/files does between its two gate passes, as `who`: authorize, receive to temp, sniff, record. */
async function upload(tx: Tx, who: Actor, meta: Omit<UploadMeta, "name"> & { name?: string }, bytes: Buffer): Promise<UploadedFile> {
  const full: UploadMeta = { name: "فایل.pdf", ...meta };
  return as(tx, who, async (t) => {
    const ticket = await authorizeUpload(t, who, full, bytes.length);
    const received = await receiveToTemp(streamOf(bytes), { tempDir: tempDir(), maxBytes: FILE_LIMITS.maxFileBytes, expectedBytes: bytes.length, idleTimeoutMs: 5000, totalTimeoutMs: 10_000 });
    const verdict = await sniffFile(received.tempPath);
    if (!verdict.ok) throw new Error(`sniff refused: ${verdict.reason}`);
    const { file } = await recordUpload(t, who, full, { fileId: ticket.fileId, storageKey: ticket.storageKey }, { tempPath: received.tempPath, sizeBytes: received.size, sha256: received.sha256, kind: verdict.kind });
    return file;
  });
}

interface Student {
  personId: string;
  studentProfileId: string;
  userAccountId: string | null;
  name: string;
  actor: Actor;
}

interface World {
  admin: Actor;
  principal: Actor;
  counselor: Actor;
  /** ریاضی of class A1 — the giver. */
  teacher: Actor;
  /** ریاضی of class A2 — another class's teacher. */
  teacherA2: Actor;
  /** Class A1 — assignees of the class تکلیف. */
  s1: Student;
  s3: Student;
  /** Class A2 — not an assignee. */
  s2: Student;
  /** s1's guardian. */
  guardian: Actor;
}

async function buildWorld(tx: Tx): Promise<World> {
  const adminP = await createStaff(tx, bootstrap, { firstName: "محمد", lastName: "امینی", phone: phone(1), createAccount: false });
  await assignRole(tx, { ...bootstrap, personId: adminP.personId }, { personId: adminP.personId, roleCode: "org_admin" });
  const admin = await actor(tx, adminP.personId);
  const staff = (firstName: string, lastName: string, n: number, roles: Array<{ roleCode: "school_principal" | "counselor"; schoolId: string }> = []) =>
    createStaff(tx, admin, { firstName, lastName, phone: phone(n), createAccount: false, roles, schoolId: f.SCHOOL_A });
  const pA = await staff("مریم", "رضایی", 2, [{ roleCode: "school_principal", schoolId: f.SCHOOL_A }]);
  const cA = await staff("نگار", "صادقی", 3, [{ roleCode: "counselor", schoolId: f.SCHOOL_A }]);
  const tMath = await staff("علی", "حسینی", 4);
  const tA2 = await staff("حسن", "مرادی", 5);
  const offA2 = await createClassOffering(tx, admin, { classGroupId: f.CLASS_GROUP_A2, subjectId: f.SUBJECT_A, termId: f.TERM_A });
  await assignTeacher(tx, admin, { staffProfileId: tMath.staffProfileId, classOfferingId: f.OFFERING_A1 });
  await assignTeacher(tx, admin, { staffProfileId: tA2.staffProfileId, classOfferingId: offA2.classOfferingId });
  const student = async (firstName: string, lastName: string, number: string, classGroupId: string, withAccount: boolean): Promise<Student> => {
    const r = await createStudent(tx, admin, {
      firstName,
      lastName,
      studentNumber: number,
      enrollment: { classGroupId },
      login: { createAccount: withAccount },
    });
    return { personId: r.personId, studentProfileId: r.studentProfileId, userAccountId: r.userAccountId, name: `${firstName} ${lastName}`, actor: await actor(tx, r.personId) };
  };
  const s1 = await student("لیلا", "نیک‌خواه", "F-1", f.CLASS_GROUP_A1, true);
  const s3 = await student("نگار", "رستمی", "F-3", f.CLASS_GROUP_A1, false);
  const s2 = await student("سارا", "کاظمی", "F-2", f.CLASS_GROUP_A2, false);
  const link = await addGuardian(tx, admin, { studentProfileId: s1.studentProfileId, firstName: "زهره", lastName: "نیک‌خواه", phone: phone(21), relation: "mother" });
  return {
    admin,
    principal: await actor(tx, pA.personId),
    counselor: await actor(tx, cA.personId),
    teacher: await actor(tx, tMath.personId),
    teacherA2: await actor(tx, tA2.personId),
    s1,
    s3,
    s2,
    guardian: await actor(tx, link.guardianPersonId),
  };
}

/** The teacher's class تکلیف for A1 with `files` attached on create. */
async function classItem(tx: Tx, w: World, fileIds: string[] = []): Promise<string> {
  const res = await as(tx, w.teacher, (t) =>
    createWorkItem(t, w.teacher, {
      typeCode: "task",
      title: "تمرین صفحهٴ ۴۲",
      description: "فایل را ببینید و پاسخ را بفرستید.",
      priority: "normal",
      recipients: { kind: "class_offering", id: f.OFFERING_A1, excludePersonIds: [] },
      attachmentFileIds: fileIds,
    }),
  );
  return res.id;
}

/** A sanctioned file row written straight into the table (quota / expiry cases): valid key, no bytes on disk. */
async function rawFileRow(tx: Tx, who: Actor, over: Partial<typeof fileObject.$inferInsert> = {}): Promise<string> {
  const id = uuidv7();
  await as(tx, who, (t) =>
    t.insert(fileObject).values({
      id,
      organizationId: f.ORG_A,
      storageKey: storageKeyFor(f.ORG_A, id, new Date()),
      mime: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
      originalName: "x.pdf",
      uploadedByPersonId: who.personId,
      status: "pending",
      purpose: "work_item",
      ...over,
    }),
  );
  return id;
}

let filesDir = "";

describe("«پیوست تکلیف و تحویل پاسخ» — files on a تکلیف and a student's پاسخ", () => {
  beforeAll(async () => {
    filesDir = mkdtempSync(path.join(os.tmpdir(), "edu-files-int-"));
    process.env.FILES_DIR = filesDir;
    const pool = new Pool({ connectionString: OWNER_URL, max: 1 });
    try {
      await seedCatalog(drizzle({ client: pool, schema }));
    } finally {
      await pool.end();
    }
  });
  afterAll(async () => {
    rmSync(filesDir, { recursive: true, force: true });
    delete process.env.FILES_DIR;
    await dropAppSchemas();
    await runMigrations({ test: true, connectionString: OWNER_URL });
    await seed();
  });

  it("migration 0024: the submission table is tenant-isolated with its RESTRICTIVE policies; attachments too; app_rw deletes none of the three; earlier REVOKEs intact", async () => {
    await asAppRw(async (c) => {
      const rls = await c.query<{ t: string; enabled: boolean; forced: boolean }>(
        `select c.relname as t, c.relrowsecurity as enabled, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where (n.nspname, c.relname) in (('workspace','work_item_submission'), ('workspace','work_item_attachment'), ('files','file_object')) order by 1`,
      );
      expect(rls.rows).toEqual([
        { t: "file_object", enabled: true, forced: true },
        { t: "work_item_attachment", enabled: true, forced: true },
        { t: "work_item_submission", enabled: true, forced: true },
      ]);
      const policies = await c.query<{ tablename: string; policyname: string; cmd: string; permissive: string; roles: string[] }>(
        `select tablename, policyname, cmd, permissive, roles::text[] as roles from pg_policies
          where schemaname = 'workspace' and tablename in ('work_item_submission', 'work_item_attachment') order by tablename, policyname`,
      );
      expect(policies.rows).toEqual([
        { tablename: "work_item_attachment", policyname: "attachment_insert", cmd: "INSERT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_attachment", policyname: "attachment_read", cmd: "SELECT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_attachment", policyname: "attachment_update", cmd: "UPDATE", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_attachment", policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["public"] },
        { tablename: "work_item_submission", policyname: "submission_insert", cmd: "INSERT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_submission", policyname: "submission_read", cmd: "SELECT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_submission", policyname: "submission_update", cmd: "UPDATE", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { tablename: "work_item_submission", policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["public"] },
      ]);
      const priv = await c.query<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select t, has_table_privilege('app_rw', t, 'SELECT') as s, has_table_privilege('app_rw', t, 'INSERT') as i,
                has_table_privilege('app_rw', t, 'UPDATE') as u, has_table_privilege('app_rw', t, 'DELETE') as d
           from unnest(array['files.file_object', 'workspace.work_item_attachment', 'workspace.work_item_submission']) as t order by t`,
      );
      for (const r of priv.rows) expect(r, r.t).toMatchObject({ s: true, i: true, u: true, d: false });
      const kept = await c.query<{ g: boolean; m: boolean; r: boolean; a: boolean }>(
        `select has_table_privilege('app_rw', 'iam.guardian_link', 'DELETE') as g, has_table_privilege('app_rw', 'workspace.guardian_message', 'UPDATE') as m,
                has_table_privilege('app_rw', 'counseling.referral', 'UPDATE') as r, has_table_privilege('app_rw', 'audit.audit_log', 'UPDATE') as a`,
      );
      expect(kept.rows[0]).toEqual({ g: false, m: false, r: false, a: false });
    });
  });

  it("migration 0025: files.file_object has its three RESTRICTIVE policies; the two new functions are SECURITY DEFINER, pinned, app_rw-only; 0023's is unchanged", async () => {
    await asAppRw(async (c) => {
      const policies = await c.query<{ policyname: string; cmd: string; permissive: string; roles: string[] }>(
        `select policyname, cmd, permissive, roles::text[] as roles from pg_policies where schemaname = 'files' and tablename = 'file_object' order by policyname`,
      );
      expect(policies.rows).toEqual([
        { policyname: "file_insert", cmd: "INSERT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { policyname: "file_read", cmd: "SELECT", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { policyname: "file_update", cmd: "UPDATE", permissive: "RESTRICTIVE", roles: ["app_rw"] },
        { policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["public"] },
      ]);
      const fns = await c.query<{ name: string; definer: boolean; owner: string; config: string[] | null; rw: boolean; backup: boolean; anyone: boolean }>(
        `select p.proname as name, p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner, p.proconfig as config,
                has_function_privilege('app_rw', p.oid, 'EXECUTE') as rw, has_function_privilege('app_backup', p.oid, 'EXECUTE') as backup,
                has_function_privilege('public', p.oid, 'EXECUTE') as anyone
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname in ('expire_stale_uploads', 'live_file_ids', 'guardian_message_routes', 'work_item_manager', 'work_item_viewer')
          order by 1`,
      );
      const byName = Object.fromEntries(fns.rows.map((r) => [r.name, r]));
      for (const name of ["expire_stale_uploads", "live_file_ids", "guardian_message_routes"]) {
        expect(byName[name], name).toMatchObject({ definer: true, owner: "app_owner", config: ["search_path=pg_catalog, app, pg_temp"], rw: true, backup: false, anyone: false });
      }
      for (const name of ["work_item_manager", "work_item_viewer"]) expect(byName[name], name).toMatchObject({ definer: false, config: ["search_path=pg_catalog, pg_temp"] });
    });
  });

  it("the storage key is pinned to its own row: another organization's prefix, another id, a traversal and a bad hash are refused by CHECKs", async () => {
    await rolledBack(async (tx) => {
      const sub = <T>(fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
      const id = uuidv7();
      const base = { id, organizationId: f.ORG_A, mime: "application/pdf", sizeBytes: 10, sha256: "b".repeat(64), uploadedByPersonId: f.PERSON_A2, purpose: "work_item" as const };
      for (const storageKey of [storageKeyFor(f.ORG_B, id, new Date()), storageKeyFor(f.ORG_A, uuidv7(), new Date()), `${f.ORG_A}/2026/../${id}`]) {
        await expect(sub((sp) => sp.insert(fileObject).values({ ...base, storageKey })), storageKey).rejects.toMatchObject({ cause: { code: "23514" } });
      }
      await expect(sub((sp) => sp.insert(fileObject).values({ ...base, storageKey: storageKeyFor(f.ORG_A, id, new Date()), sha256: "xyz" }))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(sub((sp) => sp.insert(fileObject).values({ ...base, storageKey: storageKeyFor(f.ORG_A, id, new Date()), purpose: "submission" }))).rejects.toMatchObject({ cause: { code: "23514" } });
    });
  });

  it("a teacher's files on a new تکلیف: every assignee, the giver and a manager download them; outsiders and other tenants get NOT_FOUND; a pending upload is served to nobody", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const a = await upload(tx, w.teacher, { purpose: "work_item", name: "C:\\fakepath\\کاربرگ\u202Efdp.exe" }, pdf("worksheet"));
      const b = await upload(tx, w.teacher, { purpose: "work_item", name: "راهنما.txt" }, text("راهنمای حل تمرین\n"));
      expect(a).toMatchObject({ kind: "pdf", name: "کاربرگfdp.pdf", sizeBytes: pdf("worksheet").length });
      expect(b).toMatchObject({ kind: "txt", name: "راهنما.txt" });
      // The bytes sit at <FILES_DIR>/<org>/<yyyy>/<id> — nothing of the client's name in the path.
      const [row] = await tx.select({ key: fileObject.storageKey, status: fileObject.status, sha: fileObject.sha256 }).from(fileObject).where(eq(fileObject.id, a.id));
      expect(row.key).toBe(`${f.ORG_A}/${new Date().getUTCFullYear()}/${a.id}`);
      expect(row.status).toBe("pending");
      expect(readFileSync(storagePathIn(filesRoot(), row.key))).toEqual(pdf("worksheet"));
      // Pending: not even its uploader gets it.
      await rejects(as(tx, w.teacher, (t) => findDownload(t, w.teacher, a.id)), "NOT_FOUND");

      const itemId = await classItem(tx, w, [a.id, b.id]);
      const links = await tx.select({ file: workItemAttachment.fileId, sub: workItemAttachment.submissionId }).from(workItemAttachment).where(eq(workItemAttachment.workItemId, itemId));
      expect(links.map((l) => l.file).sort()).toEqual([a.id, b.id].sort());
      expect(links.every((l) => l.sub === null)).toBe(true);

      for (const who of [w.s1.actor, w.s3.actor, w.teacher, w.principal, w.admin]) {
        const got = await as(tx, who, (t) => findDownload(t, who, a.id));
        expect(got).toMatchObject({ kind: "pdf", name: "کاربرگfdp.pdf", storageKey: row.key });
      }
      for (const [label, who] of [
        ["another class's student", w.s2.actor],
        ["the assignee's guardian", w.guardian],
        ["the school's counselor", w.counselor],
        ["another class's teacher", w.teacherA2],
        ["another tenant's admin", adminB],
      ] as const) {
        await expect(as(tx, who, (t) => findDownload(t, who, a.id)), label).rejects.toSatisfy(isError("NOT_FOUND"));
      }
      // The page: everyone who opens the تکلیف sees its files; the giver may change them while it is open.
      const view = async (who: Actor) => as(tx, who, async (t) => workItemFilesView(t, who, await getWorkItemDetail(t, who, itemId)));
      expect((await view(w.s1.actor)).files.map((x) => x.id)).toEqual([a.id, b.id]);
      expect((await view(w.teacher)).canAttach).toBe(true);
      expect((await view(w.s1.actor)).canAttach).toBe(false);
    });
  });

  it("uploads are refused BEFORE a byte is written: no permission, a تکلیف the caller cannot see or does not manage, a demo session, a name with nothing left", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const itemId = await classItem(tx, w);
      const auth = (who: Actor, meta: UploadMeta) => as(tx, who, (t) => authorizeUpload(t, who, meta, 100));
      // A student holds no attach; a guardian no submit (and sees no تکلیف); another class's student cannot see it.
      await rejects(auth(w.s1.actor, { purpose: "work_item", name: "a.pdf" }), "FORBIDDEN");
      await rejects(auth(w.s1.actor, { purpose: "work_item", workItemId: itemId, name: "a.pdf" }), "FORBIDDEN");
      await rejects(auth(w.guardian, { purpose: "submission", workItemId: itemId, name: "a.pdf" }), "NOT_FOUND");
      await rejects(auth(w.s2.actor, { purpose: "submission", workItemId: itemId, name: "a.pdf" }), "NOT_FOUND");
      await rejects(auth(w.teacherA2, { purpose: "work_item", workItemId: itemId, name: "a.pdf" }), "NOT_FOUND");
      await rejects(auth(w.counselor, { purpose: "work_item", workItemId: itemId, name: "a.pdf" }), "NOT_FOUND");
      await rejects(auth(adminB, { purpose: "work_item", workItemId: itemId, name: "a.pdf" }), "NOT_FOUND");
      // The giver, an assignee student and a manager (a broad admin who is not assigned) may.
      await expect(auth(w.teacher, { purpose: "work_item", workItemId: itemId, name: "a.pdf" })).resolves.toMatchObject({ purpose: "work_item", workItemId: itemId });
      await expect(auth(w.principal, { purpose: "work_item", workItemId: itemId, name: "a.pdf" })).resolves.toMatchObject({ workItemId: itemId });
      await expect(auth(w.s1.actor, { purpose: "submission", workItemId: itemId, name: "پاسخ.pdf" })).resolves.toMatchObject({ purpose: "submission" });
      // A name with nothing usable left, and an announced size over the cap.
      await rejects(auth(w.teacher, { purpose: "work_item", name: "\u202E\u200B ..." }), "VALIDATION", FILE_MESSAGES.badName);
      await rejects(as(tx, w.teacher, (t) => authorizeUpload(t, w.teacher, { purpose: "work_item", name: "a.pdf" }, FILE_LIMITS.maxFileBytes + 1)), "VALIDATION", FILE_MESSAGES.tooLarge);
      // A session minted by «ورود آزمایشی» uploads nothing, whoever it signed in as.
      const { session } = await createSession(tx, { userAccountId: w.s1.userAccountId!, currentOrgId: f.ORG_A, isPublicDevice: true, ip: "127.0.0.1", userAgent: "int", deviceLabel: DEMO_SESSION_LABEL });
      await rejects(auth({ ...w.s1.actor, sessionId: session.id }, { purpose: "submission", workItemId: itemId, name: "a.pdf" }), "FORBIDDEN");
      const { session: normal } = await createSession(tx, { userAccountId: w.s1.userAccountId!, currentOrgId: f.ORG_A, isPublicDevice: false, ip: "127.0.0.1", userAgent: "int" });
      await expect(auth({ ...w.s1.actor, sessionId: normal.id }, { purpose: "submission", workItemId: itemId, name: "a.pdf" })).resolves.toBeTruthy();
    });
  });

  it("a student's پاسخ: the giver sees every پاسخ and who has not answered, another student never sees one (service AND database); one bell, title only", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const itemId = await classItem(tx, w);
      const body = "پاسخ من: صفحهٴ ۴۲، تمرین ۳ تا ۵";
      const file = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "حل تمرین.pdf" }, pdf("answer"));
      const saved = await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body, addFileIds: [file.id], removeFileIds: [] }));
      expect(saved).toMatchObject({ first: true, changed: true, fileCount: 1, unlinkKeys: [] });

      // The giver's bell: once, the student's name and the title, never the text.
      const bells = await tx.select({ title: notification.title, body: notification.body, type: notification.typeCode, to: notification.recipientPersonId }).from(notification).where(eq(notification.typeCode, "work_item.submitted"));
      expect(bells).toEqual([{ title: submittedTitle(w.s1.name, "تمرین صفحهٴ ۴۲"), body: null, type: "work_item.submitted", to: w.teacher.personId }]);
      await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: `${body} (ویرایش)`, addFileIds: [], removeFileIds: [] }));
      expect(await tx.select({ id: notification.id }).from(notification).where(eq(notification.typeCode, "work_item.submitted"))).toHaveLength(1);

      const view = async (who: Actor) => as(tx, who, async (t) => workItemFilesView(t, who, await getWorkItemDetail(t, who, itemId)));
      const teacherView = await view(w.teacher);
      expect(teacherView.overview).toMatchObject({ assigneeCount: 2, submittedCount: 1, missing: [{ personId: w.s3.personId, name: w.s3.name }] });
      expect(teacherView.overview!.submissions).toHaveLength(1);
      expect(teacherView.overview!.submissions[0]).toMatchObject({ studentPersonId: w.s1.personId, body: `${body} (ویرایش)`, studentRemoved: false });
      expect(teacherView.overview!.submissions[0].files.map((x) => x.id)).toEqual([file.id]);
      expect(teacherView.mine).toBeNull();
      expect((await view(w.principal)).overview?.submittedCount).toBe(1);
      const s1View = await view(w.s1.actor);
      expect(s1View.mine?.submission?.files.map((x) => x.id)).toEqual([file.id]);
      expect(s1View.mine?.canSubmit).toBe(true);
      expect(s1View.overview).toBeNull();
      const s3View = await view(w.s3.actor);
      expect(s3View.mine).toEqual({ submission: null, canSubmit: true });
      expect(s3View.overview).toBeNull();

      // Downloads of the پاسخ's file: its student, the giver, a manager — never a classmate, a guardian, a counselor.
      for (const who of [w.s1.actor, w.teacher, w.principal]) await expect(as(tx, who, (t) => findDownload(t, who, file.id))).resolves.toMatchObject({ kind: "pdf" });
      for (const who of [w.s3.actor, w.s2.actor, w.guardian, w.counselor, w.teacherA2, adminB]) {
        await expect(as(tx, who, (t) => findDownload(t, who, file.id))).rejects.toSatisfy(isError("NOT_FOUND"));
      }

      // The database says the same (0024's RESTRICTIVE policies), whatever a query asks for.
      const seenBy = async (who: { orgId: string; personId: string }) =>
        as(tx, who, async (t) => ({
          submissions: (await t.select({ id: workItemSubmission.id }).from(workItemSubmission)).length,
          files: (await t.select({ id: workItemAttachment.id }).from(workItemAttachment).where(sql`${workItemAttachment.submissionId} is not null`)).length,
        }));
      expect(await seenBy(w.s1.actor)).toEqual({ submissions: 1, files: 1 });
      expect(await seenBy(w.teacher)).toEqual({ submissions: 1, files: 1 });
      expect(await seenBy(w.principal)).toEqual({ submissions: 1, files: 1 });
      for (const who of [w.s3.actor, w.s2.actor, w.guardian, w.counselor, w.teacherA2]) expect(await seenBy(who)).toEqual({ submissions: 0, files: 0 });
      // Nobody writes a پاسخ in another student's name, nor touches its row.
      const sub = <T>(fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
      await as(tx, w.s3.actor, async () => {
        await expect(sub((sp) => sp.insert(workItemSubmission).values({ organizationId: f.ORG_A, workItemId: itemId, studentPersonId: w.s1.personId, body: "جعلی" }))).rejects.toMatchObject({ cause: { code: "42501" } });
        const res = await sub((sp) => sp.update(workItemSubmission).set({ body: "دست‌کاری" }).where(eq(workItemSubmission.id, saved.submissionId)).returning({ id: workItemSubmission.id }));
        expect(res).toEqual([]);
      });
    });
  });

  it("editing a پاسخ replaces files: the old one is archived, its bytes deleted after the commit; an empty پاسخ is refused", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const itemId = await classItem(tx, w);
      const first = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "نسخهٴ ۱.pdf" }, pdf("v1"));
      await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: null, addFileIds: [first.id], removeFileIds: [] }));
      const [firstRow] = await tx.select({ key: fileObject.storageKey }).from(fileObject).where(eq(fileObject.id, first.id));
      const second = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "نسخهٴ ۲.pdf" }, pdf("v2"));
      const res = await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: null, addFileIds: [second.id], removeFileIds: [first.id] }));
      expect(res).toMatchObject({ first: false, changed: true, fileCount: 1, unlinkKeys: [firstRow.key] });
      const [archived] = await tx.select({ status: fileObject.status, at: fileObject.archivedAt }).from(fileObject).where(eq(fileObject.id, first.id));
      expect(archived.status).toBe("archived");
      expect(archived.at).not.toBeNull();
      await removeStored(res.unlinkKeys); // what the action does once the transaction has committed
      expect(existsSync(storagePathIn(filesRoot(), firstRow.key))).toBe(false);
      await rejects(as(tx, w.teacher, (t) => findDownload(t, w.teacher, first.id)), "NOT_FOUND");
      await expect(as(tx, w.teacher, (t) => findDownload(t, w.teacher, second.id))).resolves.toMatchObject({ kind: "pdf" });
      // Nothing left at all → refused; an unchanged save writes nothing.
      await rejects(as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: "  ", addFileIds: [], removeFileIds: [second.id] })), "VALIDATION", FILE_MESSAGES.emptySubmission);
      expect(await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: null, addFileIds: [], removeFileIds: [] }))).toMatchObject({ changed: false });
      // A first پاسخ that is empty is refused too.
      await rejects(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: "", addFileIds: [], removeFileIds: [] })), "VALIDATION", FILE_MESSAGES.emptySubmission);
    });
  });

  it("limits and bindings: five files per تکلیف, a stranger's upload, an upload made for another تکلیف or purpose, the daily quota", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const five: UploadedFile[] = [];
      for (let i = 0; i < 5; i++) five.push(await upload(tx, w.teacher, { purpose: "work_item", name: `برگه ${i}.pdf` }, pdf(`p${i}`)));
      const itemId = await classItem(tx, w, five.map((x) => x.id));
      const sixth = await upload(tx, w.teacher, { purpose: "work_item", workItemId: itemId, name: "ششم.pdf" }, pdf("p6"));
      await rejects(as(tx, w.teacher, (t) => updateWorkItem(t, w.teacher, { workItemId: itemId, files: { add: [sixth.id], remove: [] } })), "VALIDATION", FILE_MESSAGES.tooManyItemFiles);
      // Swap one out instead: allowed, and the edit bell names «فایل‌ها», no file name.
      const swapped = await as(tx, w.teacher, (t) => updateWorkItem(t, w.teacher, { workItemId: itemId, files: { add: [sixth.id], remove: [five[0].id] } }));
      expect(swapped.changed).toEqual(["files"]);
      expect(swapped.unlinkKeys).toHaveLength(1);
      const editBells = await tx.select({ title: notification.title, body: notification.body }).from(notification).where(eq(notification.typeCode, "work_item.updated"));
      expect(editBells.length).toBeGreaterThan(0);
      for (const b of editBells) {
        expect(b.body).toBe("فایل‌ها تغییر کرد.");
        expect(`${b.title} ${b.body}`).not.toContain("ششم");
      }

      // A stranger's pending upload, one made for a NEW تکلیف, and one made as a پاسخ: none attaches here.
      const stranger = await upload(tx, w.principal, { purpose: "work_item", workItemId: itemId, name: "x.pdf" }, pdf("stranger"));
      await rejects(as(tx, w.teacher, (t) => updateWorkItem(t, w.teacher, { workItemId: itemId, files: { add: [stranger.id], remove: [] } })), "INVALID_REFERENCE");
      const forNew = await upload(tx, w.teacher, { purpose: "work_item", name: "y.pdf" }, pdf("new"));
      await rejects(as(tx, w.teacher, (t) => updateWorkItem(t, w.teacher, { workItemId: itemId, files: { add: [forNew.id], remove: [five[1].id] } })), "INVALID_REFERENCE");
      const answer = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "z.pdf" }, pdf("answer"));
      const otherItem = await classItem(tx, w);
      await rejects(as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: otherItem, body: null, addFileIds: [answer.id], removeFileIds: [] })), "INVALID_REFERENCE");
      // A classmate cannot take s1's upload into their own پاسخ.
      await rejects(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: null, addFileIds: [answer.id], removeFileIds: [] })), "INVALID_REFERENCE");
      // Six files in one پاسخ.
      const many: UploadedFile[] = [];
      for (let i = 0; i < 6; i++) many.push(await upload(tx, w.s3.actor, { purpose: "submission", workItemId: itemId, name: `ص${i}.txt` }, text(`صفحهٴ ${i}`)));
      await rejects(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: null, addFileIds: many.map((m) => m.id), removeFileIds: [] })), "VALIDATION", FILE_MESSAGES.tooManySubmissionFiles);
      // Personal items take no files.
      const own = await upload(tx, w.teacher, { purpose: "work_item", name: "own.pdf" }, pdf("own"));
      await rejects(
        as(tx, w.teacher, (t) => createWorkItem(t, w.teacher, { typeCode: "todo", title: "یادداشت", priority: "normal", recipients: { kind: "self" }, attachmentFileIds: [own.id] })),
        "VALIDATION",
        FILE_MESSAGES.attachNotHere,
      );

      // The daily quota: 50 MiB of a student's uploads in 24 h — the next one is refused, before its bytes.
      for (let i = 0; i < 5; i++) await rawFileRow(tx, w.s3.actor, { sizeBytes: 10 * MiB, purpose: "submission", targetWorkItemId: itemId });
      await rejects(as(tx, w.s3.actor, (t) => authorizeUpload(t, w.s3.actor, { purpose: "submission", workItemId: itemId, name: "a.pdf" }, 1)), "RATE_LIMITED", FILE_MESSAGES.quota);
      // …and a teacher's 200 MiB is a different budget.
      await expect(as(tx, w.teacher, (t) => authorizeUpload(t, w.teacher, { purpose: "work_item", workItemId: itemId, name: "a.pdf" }, 1))).resolves.toBeTruthy();
    });
  });

  it("a closed تکلیف takes no پاسخ and no upload for one; «بازیابی» opens it again", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const itemId = await classItem(tx, w);
      const early = await upload(tx, w.s3.actor, { purpose: "submission", workItemId: itemId, name: "a.pdf" }, pdf("early"));
      await as(tx, w.teacher, (t) => changeStatus(t, w.teacher, { workItemId: itemId, toStatusCode: "done" }));
      await rejects(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: "دیر", addFileIds: [early.id], removeFileIds: [] })), "VALIDATION", FILE_MESSAGES.submissionClosed);
      await rejects(as(tx, w.s3.actor, (t) => authorizeUpload(t, w.s3.actor, { purpose: "submission", workItemId: itemId, name: "a.pdf" }, 10)), "VALIDATION", FILE_MESSAGES.submissionClosed);
      const closedView = await as(tx, w.s3.actor, async (t) => workItemFilesView(t, w.s3.actor, await getWorkItemDetail(t, w.s3.actor, itemId)));
      expect(closedView.mine?.canSubmit).toBe(false);
      expect((await as(tx, w.teacher, async (t) => workItemFilesView(t, w.teacher, await getWorkItemDetail(t, w.teacher, itemId)))).canAttach).toBe(false);
      await as(tx, w.teacher, (t) => changeStatus(t, w.teacher, { workItemId: itemId, toStatusCode: "open" }));
      await expect(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: "حالا", addFileIds: [early.id], removeFileIds: [] }))).resolves.toMatchObject({ first: true });
      // A student's own «انجام شد» does not close it for them: they may still edit.
      await as(tx, w.s3.actor, (t) => changeStatus(t, w.s3.actor, { workItemId: itemId, toStatusCode: "done" }));
      await expect(as(tx, w.s3.actor, (t) => saveSubmission(t, w.s3.actor, { workItemId: itemId, body: "حالا، کامل‌تر", addFileIds: [], removeFileIds: [] }))).resolves.toMatchObject({ changed: true });
    });
  });

  it("a removed student's پاسخ stays for the giver — listed (marked removed) and downloadable — while the counts follow the class", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const itemId = await classItem(tx, w);
      const file = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "a.pdf" }, pdf("kept"));
      await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: "پاسخ", addFileIds: [file.id], removeFileIds: [] }));
      await as(tx, w.admin, (t) => removePerson(t, w.admin, { personId: w.s1.personId, kind: "student" }));
      const view = await as(tx, w.teacher, async (t) => workItemFilesView(t, w.teacher, await getWorkItemDetail(t, w.teacher, itemId)));
      expect(view.overview).toMatchObject({ assigneeCount: 1, submittedCount: 0, missing: [{ personId: w.s3.personId }] });
      expect(view.overview!.submissions).toHaveLength(1);
      expect(view.overview!.submissions[0]).toMatchObject({ studentPersonId: w.s1.personId, studentRemoved: true, body: "پاسخ" });
      await expect(as(tx, w.teacher, (t) => findDownload(t, w.teacher, file.id))).resolves.toMatchObject({ kind: "pdf" });
    });
  });

  it("the audit trail carries ids, sizes and types — never a file name or the پاسخ text; stale pending uploads expire on the next upload", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const a = await upload(tx, w.teacher, { purpose: "work_item", name: "نام‌محرمانهٴ-فایل.pdf" }, pdf("audit"));
      const itemId = await classItem(tx, w, [a.id]);
      const answer = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "پاسخ-شخصی.txt" }, text("متن"));
      await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: "متنِ خصوصیِ پاسخ", addFileIds: [answer.id], removeFileIds: [] }));
      const rows = await tx
        .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(inArray(auditLog.action, ["files.file_object.uploaded", "workspace.work_item.files_changed", "workspace.work_item_submission.saved"]));
      expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["files.file_object.uploaded", "workspace.work_item.files_changed", "workspace.work_item_submission.saved"]));
      const trail = JSON.stringify(rows);
      for (const secret of ["نام‌محرمانهٴ", "پاسخ-شخصی", "متنِ خصوصیِ پاسخ", "%PDF"]) expect(trail, secret).not.toContain(secret);
      const uploaded = rows.find((r) => r.action === "files.file_object.uploaded" && (r.after as { purpose: string }).purpose === "submission");
      expect(uploaded?.after).toMatchObject({ purpose: "submission", workItemId: itemId, sizeBytes: 6, mime: "text/plain; charset=utf-8" });
      const saved = rows.find((r) => r.action === "workspace.work_item_submission.saved");
      expect(saved?.after).toMatchObject({ workItemId: itemId, first: true, bodyLength: "متنِ خصوصیِ پاسخ".length, fileCount: 1 });

      // A pending upload older than a day — SOMEONE ELSE's, which app_rw no longer sees since 0025 — is archived by the
      // next upload of the organization through app.expire_stale_uploads (its key handed back for deletion); another
      // organization's stale upload is out of its reach.
      const staleId = await rawFileRow(tx, w.teacherA2, { createdAt: new Date(Date.now() - FILE_LIMITS.pendingTtlMs - 60_000) });
      const fresh = await rawFileRow(tx, w.teacherA2);
      const staleB = uuidv7();
      await as(tx, adminB, (t) =>
        t.insert(fileObject).values({
          id: staleB,
          organizationId: f.ORG_B,
          storageKey: storageKeyFor(f.ORG_B, staleB, new Date()),
          mime: "application/pdf",
          sizeBytes: 10,
          sha256: "d".repeat(64),
          uploadedByPersonId: f.PERSON_B1,
          purpose: "work_item",
          createdAt: new Date(Date.now() - FILE_LIMITS.pendingTtlMs - 60_000),
        }),
      );
      const ticket = await as(tx, w.teacher, (t) => authorizeUpload(t, w.teacher, { purpose: "work_item", name: "b.pdf" }, 10));
      const received = await receiveToTemp(streamOf(pdf("b")), { tempDir: tempDir(), maxBytes: FILE_LIMITS.maxFileBytes, idleTimeoutMs: 5000, totalTimeoutMs: 10_000 });
      const res = await as(tx, w.teacher, (t) =>
        recordUpload(t, w.teacher, { purpose: "work_item", name: "b.pdf" }, { fileId: ticket.fileId, storageKey: ticket.storageKey }, { tempPath: received.tempPath, sizeBytes: received.size, sha256: received.sha256, kind: "pdf" }),
      );
      // The teacher cannot even read teacherA2's rows any more; their uploader can.
      expect(await as(tx, w.teacher, (t) => t.select({ id: fileObject.id }).from(fileObject).where(inArray(fileObject.id, [staleId, fresh])))).toEqual([]);
      const [stale] = await as(tx, w.teacherA2, (t) => t.select({ status: fileObject.status, key: fileObject.storageKey }).from(fileObject).where(eq(fileObject.id, staleId)));
      expect(stale.status).toBe("archived");
      expect(res.expiredKeys).toContain(stale.key);
      const [kept] = await as(tx, w.teacherA2, (t) => t.select({ status: fileObject.status }).from(fileObject).where(and(eq(fileObject.id, fresh))));
      expect(kept.status).toBe("pending");
      const [otherTenant] = await as(tx, adminB, (t) => t.select({ status: fileObject.status }).from(fileObject).where(eq(fileObject.id, staleB)));
      expect(otherTenant.status).toBe("pending");
      expect(res.expiredKeys.some((k) => k.startsWith(f.ORG_B))).toBe(false);
      const [expired] = await as(tx, w.teacher, (t) => t.select({ after: auditLog.after }).from(auditLog).where(eq(auditLog.action, "files.file_object.expired")));
      expect((expired.after as { ids: string[] }).ids).toContain(staleId);
    });
  });

  it("0025: file rows fail closed — a classmate, another class, a guardian, a counselor read none of another's files and archive nothing (P1, P1b, P2, P3)", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const given = await upload(tx, w.teacher, { purpose: "work_item", name: "کاربرگ.pdf" }, pdf("given"));
      const itemId = await classItem(tx, w, [given.id]);
      const answer = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "پاسخ-لیلا.pdf" }, pdf("answer"));
      await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: "پاسخ", addFileIds: [answer.id], removeFileIds: [] }));
      const draft = await upload(tx, w.s1.actor, { purpose: "submission", workItemId: itemId, name: "پیش‌نویس.pdf" }, pdf("draft"));
      const sub = <T>(fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
      const ids = [given.id, answer.id, draft.id];

      // P1 / P1b: whatever a query asks for, a person reads their own uploads and the files they may open — nothing else.
      const readable = async (who: Actor) => (await as(tx, who, (t) => t.select({ id: fileObject.id, name: fileObject.originalName, key: fileObject.storageKey }).from(fileObject))).map((r) => r.id).sort();
      expect(await readable(w.s1.actor)).toEqual([...ids].sort());
      expect(await readable(w.s3.actor), "a classmate: the giver's file of a تکلیف given to them, nothing of s1's").toEqual([given.id]);
      for (const [label, who] of [
        ["another class's student", w.s2.actor],
        ["s1's guardian", w.guardian],
        ["the school's counselor", w.counselor],
        ["another class's teacher", w.teacherA2],
        ["another tenant's admin", adminB],
      ] as const) {
        expect(await readable(who), label).toEqual([]);
      }
      // The giver and a manager: the تکلیف's file and the پاسخ's — never s1's pending draft.
      expect(await readable(w.teacher)).toEqual([given.id, answer.id].sort());
      expect(await readable(w.principal)).toEqual([given.id, answer.id].sort());

      // P2: nobody archives a file row they do not manage — not even one they may read.
      const archive = (who: Actor, fileIds: string[]) =>
        as(tx, who, () => sub((sp) => sp.update(fileObject).set({ status: "archived", archivedAt: sql`now()` }).where(inArray(fileObject.id, fileIds)).returning({ id: fileObject.id })));
      for (const who of [w.s3.actor, w.s2.actor, w.guardian, w.counselor, w.teacherA2]) expect(await archive(who, ids)).toEqual([]);
      expect(await archive(w.s1.actor, [given.id]), "a student and the giver's file").toEqual([]);
      expect(await archive(w.teacher, [draft.id]), "the giver and a student's pending draft").toEqual([]);
      // …and a pending upload is attached only by its uploader, through an attachment row they added.
      await as(tx, w.s1.actor, async () => {
        await expect(sub((sp) => sp.update(fileObject).set({ status: "attached" }).where(eq(fileObject.id, draft.id)))).rejects.toMatchObject({ cause: { code: "42501" } });
      });

      // P3: no student archives — or adds — a giver's attachment row; nobody touches another student's پاسخ row.
      const archiveLinks = (who: Actor, where: SQL) =>
        as(tx, who, () => sub((sp) => sp.update(workItemAttachment).set({ archivedAt: sql`now()` }).where(where).returning({ id: workItemAttachment.id })));
      for (const who of [w.s1.actor, w.s3.actor, w.s2.actor, w.guardian, w.counselor, w.teacherA2]) {
        expect(await archiveLinks(who, sql`${workItemAttachment.submissionId} is null`), "the giver's rows").toEqual([]);
      }
      for (const who of [w.s3.actor, w.s2.actor, w.guardian, w.counselor, w.teacherA2]) {
        expect(await archiveLinks(who, sql`${workItemAttachment.submissionId} is not null`), "s1's پاسخ rows").toEqual([]);
      }
      await as(tx, w.s1.actor, async () => {
        await expect(
          sub((sp) => sp.insert(workItemAttachment).values({ organizationId: f.ORG_A, workItemId: itemId, fileId: draft.id, addedByPersonId: w.s1.personId, sequence: 9 })),
          "a student's upload smuggled in as a giver's file",
        ).rejects.toMatchObject({ cause: { code: "42501" } });
      });
      // A file row in someone else's name, or born attached, is refused.
      await as(tx, w.s3.actor, async () => {
        const id = uuidv7();
        const row = { id, organizationId: f.ORG_A, storageKey: storageKeyFor(f.ORG_A, id, new Date()), mime: "application/pdf", sizeBytes: 10, sha256: "c".repeat(64), purpose: "work_item" as const };
        await expect(sub((sp) => sp.insert(fileObject).values({ ...row, uploadedByPersonId: w.s1.personId }))).rejects.toMatchObject({ cause: { code: "42501" } });
        await expect(sub((sp) => sp.insert(fileObject).values({ ...row, uploadedByPersonId: w.s3.personId, status: "attached" }))).rejects.toMatchObject({ cause: { code: "42501" } });
      });

      // The legitimate paths still hold: a manager who did not upload it removes the giver's file (row + file archived),
      // and the پاسخ's student replaces their own file.
      const removed = await as(tx, w.principal, (t) => updateWorkItem(t, w.principal, { workItemId: itemId, files: { add: [], remove: [given.id] } }));
      expect(removed.unlinkKeys).toHaveLength(1);
      const [givenNow] = await as(tx, w.teacher, (t) => t.select({ status: fileObject.status }).from(fileObject).where(eq(fileObject.id, given.id)));
      expect(givenNow.status).toBe("archived");
      const swapped = await as(tx, w.s1.actor, (t) => saveSubmission(t, w.s1.actor, { workItemId: itemId, body: "پاسخ", addFileIds: [draft.id], removeFileIds: [answer.id] }));
      expect(swapped).toMatchObject({ changed: true, fileCount: 1 });
      await expect(as(tx, w.teacher, (t) => findDownload(t, w.teacher, draft.id))).resolves.toMatchObject({ kind: "pdf" });
    });
  });

  it("0025: app.work_item_manager is managesItem — the creator, or a broad holder who is NOT an assignee; app.live_file_ids needs a bound organization", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const classTask = await classItem(tx, w);
      const toPrincipal = (await as(tx, w.admin, (t) => createWorkItem(t, w.admin, { typeCode: "task", title: "گزارش هفتگی", priority: "normal", recipients: { kind: "persons", ids: [w.principal.personId] } }))).id;
      const manages = async (who: Actor, item: string) => (await as(tx, who, (t) => t.execute<{ m: boolean | null }>(sql`select app.work_item_manager(${item}::uuid) as m`))).rows[0].m === true;
      expect(await manages(w.teacher, classTask), "the giver").toBe(true);
      expect(await manages(w.principal, classTask), "a broad manager, not assigned").toBe(true);
      expect(await manages(w.s1.actor, classTask), "an assignee student").toBe(false);
      expect(await manages(w.teacherA2, classTask), "another class's teacher").toBe(false);
      expect(await manages(w.admin, toPrincipal), "its creator").toBe(true);
      expect(await manages(w.principal, toPrincipal), "a broad holder who IS an assignee").toBe(false);
      expect(await manages(w.admin, uuidv7()), "an unknown id").toBe(false);

      // A pending upload of the teacher's, a stale one archived by app.expire_stale_uploads (which any member's upload
      // runs), and an unknown id.
      const file = await upload(tx, w.teacher, { purpose: "work_item", name: "a.pdf" }, pdf("live"));
      const staleId = await rawFileRow(tx, w.teacher, { createdAt: new Date(Date.now() - FILE_LIMITS.pendingTtlMs - 60_000) });
      const expired = await as(tx, w.s2.actor, (t) => t.execute<{ file_id: string; file_storage_key: string }>(sql`select file_id, file_storage_key from app.expire_stale_uploads(50)`));
      expect(expired.rows).toContainEqual({ file_id: staleId, file_storage_key: storageKeyFor(f.ORG_A, staleId, new Date()) });
      const unknown = uuidv7();
      const live = async (who: { orgId: string; personId: string }) =>
        (await as(tx, who, (t) => t.execute<{ id: string }>(sql`select id from app.live_file_ids(${`{${[file.id, staleId, unknown].join(",")}}`}::uuid[]) as id`))).rows.map((r) => r.id);
      // Any member of the organization gets the answer (the sweeper runs as whoever uploaded); archived and unknown ids are not live.
      expect(await live(w.s2.actor)).toEqual([file.id]);
      expect(await live(adminB)).toEqual([]);
      const sub = <T>(fn: (sp: Tx) => Promise<T>) => tx.transaction((sp) => fn(sp));
      await expect(
        sub(async (sp) => {
          await sp.execute(sql`select set_config('app.current_org_id', '', true)`);
          return sp.execute(sql`select * from app.live_file_ids(array[${file.id}]::uuid[])`);
        }),
        "no organization bound: an error, never an empty answer",
      ).rejects.toMatchObject({ cause: { code: "42501" } });
      const tooMany = `{${Array.from({ length: 1001 }, () => uuidv7()).join(",")}}`;
      await expect(as(tx, w.teacher, () => sub((sp) => sp.execute(sql`select * from app.live_file_ids(${tooMany}::uuid[])`)))).rejects.toMatchObject({ cause: { code: "22023" } });
    });
  });

  it("D6: the orphan sweep deletes the old bytes no live row names — an orphan, an archived row's — and keeps live and young ones", async () => {
    await rolledBack(async (tx) => {
      const w = await buildWorld(tx);
      const old = (key: string) => {
        const t = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
        utimesSync(storagePathIn(filesRoot(), key), t, t);
      };
      const place = (key: string, ageOld: boolean) => {
        const p = storagePathIn(filesRoot(), key);
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, "orphan");
        if (ageOld) old(key);
      };
      // A live upload, last written three days ago: kept.
      const live = await upload(tx, w.teacher, { purpose: "work_item", name: "زنده.pdf" }, pdf("live"));
      const liveKey = storageKeyFor(f.ORG_A, live.id, new Date());
      old(liveKey);
      // Bytes with no row at all (a crash between the rename and the commit), three days old: deleted.
      const orphanKey = storageKeyFor(f.ORG_A, uuidv7(), new Date());
      place(orphanKey, true);
      // An archived row whose bytes were never removed: deleted.
      const staleId = await rawFileRow(tx, w.teacher, { createdAt: new Date(Date.now() - FILE_LIMITS.pendingTtlMs - 60_000) });
      await as(tx, w.teacher, (t) => t.execute(sql`select * from app.expire_stale_uploads(50)`));
      const archivedKey = storageKeyFor(f.ORG_A, staleId, new Date());
      place(archivedKey, true);
      // No row yet but written an hour ago (an upload between its rename and its commit): kept.
      const youngKey = storageKeyFor(f.ORG_A, uuidv7(), new Date());
      place(youngKey, false);

      const report = await as(tx, w.s2.actor, (t) => sweepOrphanFiles(t, w.s2.actor));
      expect(report).toMatchObject({ organizationId: f.ORG_A, deleted: 2, braked: false, lookupFailed: false });
      const there = (key: string) => existsSync(storagePathIn(filesRoot(), key));
      expect({ live: there(liveKey), orphan: there(orphanKey), archived: there(archivedKey), young: there(youngKey) }).toEqual({ live: true, orphan: false, archived: false, young: true });
      // Another organization's sweep never walks this one's directory.
      place(orphanKey, true);
      expect(await as(tx, adminB, (t) => sweepOrphanFiles(t, adminB))).toMatchObject({ organizationId: f.ORG_B, deleted: 0 });
      expect(there(orphanKey)).toBe(true);
      rmSync(storagePathIn(filesRoot(), orphanKey), { force: true });
    });
  });
});
