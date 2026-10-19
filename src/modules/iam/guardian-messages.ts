// iam/guardian-messages — «ارتباط ولی و مدرسه» (owner, 2026-10-19; docs/decisions.md): a guardian sends a question /
// suggestion / criticism about ONE of their children to the child's school, and follows the answer.
//
// Mechanism — the counselor's referrals, reused: each message is a CONFIDENTIAL work item of the system type
// `parent_message` («پیام ولی», `createConfidentialWorkItem`) given to the addressees the guardian picked, plus one
// `workspace.guardian_message` row (migration 0022) that says who sent it, about whom, of which kind and to which
// destination. The guardian is the item's creator but NOT a participant (workspace/manage-policy
// `creatorParticipates`): no watcher or inbox row, they never open the item (its trail, who else it reached, who
// answered) — they read their message's status and the answer through their own rows here, as the counseling file
// reads its referrals. The addressees answer it with «ثبت پاسخ» (the first answer closes it; its note — required — is
// the answer): teachers and the school's managers in «پنل من», a counselor — who holds no `workspace.*` permission —
// in «مشاوره» › «پیام‌های اولیا» (`answerAddressedMessage`, through workspace `answerAsAddressee`).
//
// The rules, all decided here inside the caller's transaction (never from input):
//   • the child must be one of the caller's LIVE children and the caller must hold `iam.guardian_message.send` at that
//     child's student scope (`requireChild` — both halves; NOT_FOUND otherwise, a removed student included);
//   • destinations resolve at the child's school NOW (the live school enrollment, counseling `findStudentAnchor`):
//     a teacher with a current teaching of an open offering of the child's active class there (the pair درس × دبیر the
//     guardian picked), or the live holders of the school's «مشاور» / «معاون» / «مدیر مدرسه» system role there — never
//     the caller; nobody → a Persian VALIDATION error naming the office;
//   • the owner's rule: «انتقاد» never to a teacher (VALIDATION; the CHECK of 0022 says it once more);
//   • at most `MESSAGE_RATE_LIMIT` messages per guardian and child per hour (RATE_LIMITED), counted under the live
//     link's row lock so two sends at once cannot both slip under it; a replayed form (idempotency key) returns the
//     message already sent and is not counted;
//   • no editing after sending (nothing here updates a message, app_rw may not UPDATE the row, and the item has no
//     manager), no attachments.
// Privacy: the audit rows carry ids, kinds and lengths only — never the subject or the body; the addressees' bell names
// the kind and the child (the item's title), the guardian's bell the child only (`notifyGuardianOfMessageAnswer`); a
// guardian learns nothing about an addressee but the درس × دبیر they picked themselves (after a re-route, the درس's
// teacher now — whom the form lists to them anyway).
// A message nobody can answer any more — its last live addressee removed, out of the office or no longer teaching the
// درس — is handed on in that same write (./guardian-message-routing, security review 2026-10-19 D1); the guardian's
// tag is derived when read: «ارسال‌شده», «در انتظار پاسخ» after a week, «در حال ارجاع به مدیریت» while nobody is left
// on it, «پاسخ داده شد» (`messageState`).
//
// Lock order (iam/removal «Concurrency»): the guardian's and the recipients' person rows FOR KEY SHARE (ascending,
// `lockActivePersons`) → the live guardian link FOR NO KEY UPDATE → the work item rows (`createConfidentialWorkItem`) →
// the message row. An unlink in flight is waited for at the link and then seen (NOT_FOUND); a removal of an addressee
// is waited for at their person row and then leaves them out.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import { notFound, rateLimited, validation } from "@/lib/errors";
import { findStudentAnchor, lockActivePersons } from "@/modules/counseling/repo";
import { guardianMessage } from "@/modules/workspace/schema";
import { answerAsAddressee, createConfidentialWorkItem } from "@/modules/workspace/service";
import {
  COUNSELOR_MESSAGES_HREF,
  GUARDIAN_MESSAGE_MESSAGES as MSG,
  MESSAGE_BODY_MAX,
  MESSAGE_RATE_LIMIT,
  MESSAGE_RATE_WINDOW_MINUTES,
  MESSAGE_SUBJECT_MAX,
  NO_HOLDER_MESSAGE,
  answerOf,
  cleanBody,
  cleanSubject,
  guardianMessageDescription,
  guardianMessageTitle,
  isAllowedDestination,
  isMessageDestination,
  isMessageKind,
  messageState,
  splitGuardianMessageDescription,
  type MessageDestination,
  type MessageKind,
  type MessageState,
} from "./guardian-message-policy";
import { OFFICE_ROLE, officeHolders, type Office } from "./guardian-message-routing";
import { requireChild, type ChildContext, type GuardianChild, type GuardianViewCtx } from "./guardian-views";

export type GuardianMessageCtx = GuardianViewCtx & AuditCtx;

/** The permission every guardian-message read and write names (the derived «ولی» role only). */
export const GUARDIAN_MESSAGE_PERMISSION = "iam.guardian_message.send" as const;

/** Where a counselor reads and answers the guardians' messages addressed to them (./guardian-message-policy). */
export { COUNSELOR_MESSAGES_HREF };

const fail = (field: string, message: string) => validation({ fieldErrors: { [field]: [message] } }, message);

// ---------------------------------------------------------------------------------------------------------------
// who a message can go to
// ---------------------------------------------------------------------------------------------------------------

/** A درس of the child with one of its current teachers — one row of the destination list «<درس> — <دبیر>». */
export interface TeacherDestination {
  classOfferingId: string;
  subjectName: string;
  teacherPersonId: string;
  teacherName: string;
}

export interface MessageDestinations {
  /** The school the child belongs to NOW (null: no live school enrollment — nothing can be sent). */
  schoolId: string | null;
  teachers: TeacherDestination[];
  /** The offices of the child's school that have a live holder (never who). */
  offices: Office[];
}

/**
 * The teachers of the child NOW: a current teaching (`valid_to` null) of an open offering of the child's active class
 * at that school, active persons with a staff profile, never `exceptPersonId` (a teacher who is the parent).
 */
async function teachersOfChild(tx: Tx, classGroupId: string | null, exceptPersonId: string): Promise<TeacherDestination[]> {
  if (!classGroupId) return [];
  const res = await tx.execute<{ class_offering_id: string; subject_name: string; person_id: string; first_name: string; last_name: string }>(sql`
    select o.id as class_offering_id, subj.name as subject_name, p.id as person_id, p.first_name, p.last_name
    from tenancy.class_offering o
    join tenancy.class_group cg on cg.id = o.class_group_id and cg.status = 'active'
    join tenancy.subject subj on subj.id = o.subject_id
    join academic.teacher_assignment ta on ta.class_offering_id = o.id and ta.valid_to is null
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join iam.person p on p.id = stp.person_id and p.status = 'active'
    where o.class_group_id = ${classGroupId}::uuid and o.status <> 'closed' and p.id <> ${exceptPersonId}::uuid
    order by subj.name, p.last_name, p.first_name, o.id, p.id`);
  const seen = new Set<string>();
  const out: TeacherDestination[] = [];
  for (const r of res.rows) {
    const key = `${r.class_offering_id}:${r.person_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ classOfferingId: r.class_offering_id, subjectName: r.subject_name, teacherPersonId: r.person_id, teacherName: `${r.first_name} ${r.last_name}` });
  }
  return out;
}

async function destinationsOf(tx: Tx, ctx: GuardianMessageCtx, child: GuardianChild): Promise<MessageDestinations & { classGroupId: string | null; holders: Record<Office, string[]> }> {
  const anchor = await findStudentAnchor(tx, child.studentProfileId);
  const empty = { counselor: [], vice_principal: [], principal: [] };
  if (!anchor) return { schoolId: null, classGroupId: null, teachers: [], offices: [], holders: empty };
  const teachers = await teachersOfChild(tx, anchor.classGroupId, ctx.personId);
  const holders = await officeHolders(tx, anchor.schoolId, ctx.personId);
  const offices = (Object.keys(OFFICE_ROLE) as Office[]).filter((o) => holders[o].length > 0);
  return { schoolId: anchor.schoolId, classGroupId: anchor.classGroupId, teachers, offices, holders };
}

// ---------------------------------------------------------------------------------------------------------------
// the guardian's page: the form's options and «پیام‌های من»
// ---------------------------------------------------------------------------------------------------------------

export interface MyMessageRow {
  id: string;
  kind: MessageKind;
  destination: MessageDestination;
  /**
   * A teacher message: the درس, and the teacher it is with — an addressee who teaches (or taught) that درس, the one who
   * teaches it now first (after a re-route, the درس's new teacher); null once no such addressee is left on the item
   * (it went to the school's management — never named here).
   */
  subjectName: string | null;
  teacherName: string | null;
  subject: string;
  body: string;
  sentAt: Date;
  state: MessageState;
  /** The answer that closed it (`answerOf`) — never another note of the item, never who answered. */
  answer: string | null;
  answeredAt: Date | null;
}

/**
 * The caller's own messages about ONE child, newest first (`guardian_person_id` = the caller — RLS says the same,
 * 0022): status, the answer and its date. The child has passed `requireChild`. The tag (`messageState`) is derived
 * here, at `now`: whether the item is open, and whether any assignee of an active person is left on it at all
 * (none: «در حال ارجاع به مدیریت» — ./guardian-message-routing found nobody to take it).
 */
async function listMyMessages(tx: Tx, ctx: GuardianMessageCtx, studentProfileId: string, now: Date): Promise<MyMessageRow[]> {
  const res = await tx.execute<{
    id: string;
    kind: string;
    destination_kind: string;
    created_at: string;
    description: string | null;
    subject_name: string | null;
    teacher_name: string | null;
    open: boolean;
    orphaned: boolean;
    last_note: string | null;
    last_at: string | null;
    last_category: string | null;
    last_by_addressee: boolean | null;
  }>(sql`
    select gm.id, gm.kind, gm.destination_kind, gm.created_at, wi.description, subj.name as subject_name,
      case when gm.destination_kind = 'teacher' then (
        select tp.first_name || ' ' || tp.last_name
        from workspace.work_item_assignee a join iam.person tp on tp.id = a.person_id
        where a.work_item_id = wi.id and a.role = 'assignee'
          and exists (
            select 1 from academic.teacher_assignment ta join iam.staff_profile stp on stp.id = ta.staff_profile_id
            where ta.class_offering_id = gm.class_offering_id and stp.person_id = a.person_id)
        order by (exists (
            select 1 from academic.teacher_assignment ta join iam.staff_profile stp on stp.id = ta.staff_profile_id
            where ta.class_offering_id = gm.class_offering_id and ta.valid_to is null and stp.person_id = a.person_id)) desc,
          tp.last_name, tp.first_name
        limit 1
      ) end as teacher_name,
      (wi.archived_at is null and s.category in ('todo', 'doing')) as open,
      not exists (
        select 1 from workspace.work_item_assignee a join iam.person ap on ap.id = a.person_id and ap.status = 'active'
        where a.work_item_id = wi.id and a.role = 'assignee'
      ) as orphaned,
      lt.note as last_note, lt.at as last_at, lt.category as last_category, lt.by_addressee as last_by_addressee
    from workspace.guardian_message gm
    join workspace.work_item wi on wi.id = gm.work_item_id
    join workspace.work_item_status s on s.id = wi.status_id
    left join tenancy.class_offering o on o.id = gm.class_offering_id
    left join tenancy.subject subj on subj.id = o.subject_id
    left join lateral (
      -- The LATEST transition only: an answer counts while it is what closed the message.
      select t.note, t.at, ts.category,
             exists (select 1 from workspace.work_item_assignee a where a.work_item_id = wi.id and a.person_id = t.by_person_id and a.role = 'assignee') as by_addressee
      from workspace.work_item_transition t
      join workspace.work_item_status ts on ts.id = t.to_status_id
      where t.work_item_id = wi.id
      order by t.at desc, t.id desc
      limit 1
    ) lt on true
    where gm.guardian_person_id = ${ctx.personId}::uuid and gm.student_profile_id = ${studentProfileId}::uuid
    order by gm.created_at desc, gm.id desc
    limit 100`);
  return res.rows.map((r) => {
    const answer = answerOf({ category: r.last_category, byAddressee: r.last_by_addressee, note: r.last_note });
    const text = splitGuardianMessageDescription(r.description);
    return {
      id: r.id,
      kind: isMessageKind(r.kind) ? r.kind : "question",
      destination: isMessageDestination(r.destination_kind) ? r.destination_kind : "principal",
      subjectName: r.subject_name,
      teacherName: r.teacher_name,
      subject: text.subject,
      body: text.body,
      sentAt: new Date(r.created_at),
      state: messageState(answer, { open: r.open, orphaned: r.orphaned, sentAt: new Date(r.created_at) }, now),
      answer,
      answeredAt: answer && r.last_at ? new Date(r.last_at) : null,
    };
  });
}

export interface ChildMessagesPage extends ChildContext {
  destinations: MessageDestinations;
  messages: MyMessageRow[];
}

/**
 * «پیام به مدرسه» of one child: the form's destinations and the caller's messages — `requireChild` first (NOT_FOUND).
 * `now` dates the «در انتظار پاسخ» tag (tests pass their own).
 */
export async function childMessagesPage(tx: Tx, ctx: GuardianMessageCtx, requested: string | undefined, now = new Date()): Promise<ChildMessagesPage> {
  const c = await requireChild(tx, ctx, requested, GUARDIAN_MESSAGE_PERMISSION);
  const d = await destinationsOf(tx, ctx, c.child);
  return { ...c, destinations: { schoolId: d.schoolId, teachers: d.teachers, offices: d.offices }, messages: await listMyMessages(tx, ctx, c.child.studentProfileId, now) };
}

// ---------------------------------------------------------------------------------------------------------------
// «ارسال پیام»
// ---------------------------------------------------------------------------------------------------------------

export interface SendMessageInput {
  /** The child (`?child=` of the page — validated against the caller's own live children). */
  studentProfileId: string;
  kind: MessageKind;
  destination: MessageDestination;
  /** A teacher destination: the درس (offering) and the teacher of the pair the guardian picked. */
  classOfferingId?: string | null;
  teacherPersonId?: string | null;
  subject: string;
  body: string;
  idempotencyKey?: string | null;
}

export interface SendMessageResult {
  messageId: string;
  workItemId: string;
  recipients: number;
  duplicate: boolean;
}

/** A replayed form: the message this guardian already sent with this key (the work item's 10-minute window). */
async function findReplayedMessage(tx: Tx, ctx: GuardianMessageCtx, studentProfileId: string, key: string | null | undefined): Promise<SendMessageResult | null> {
  if (!key) return null;
  const res = await tx.execute<{ id: string; work_item_id: string; n: number }>(sql`
    select gm.id, gm.work_item_id,
      (select count(*)::int from workspace.work_item_assignee a where a.work_item_id = wi.id and a.role = 'assignee') as n
    from workspace.guardian_message gm
    join workspace.work_item wi on wi.id = gm.work_item_id
    where gm.guardian_person_id = ${ctx.personId}::uuid and gm.student_profile_id = ${studentProfileId}::uuid
      and wi.created_by_person_id = ${ctx.personId}::uuid and wi.idempotency_key = ${key}::uuid
      and wi.created_at > now() - interval '10 minutes'
    limit 1`);
  const r = res.rows[0];
  return r ? { messageId: r.id, workItemId: r.work_item_id, recipients: Number(r.n), duplicate: true } : null;
}

/**
 * Sends one message (module header for every rule). Returns the message, its work item and how many addressees it
 * reached; a replayed form returns the first send (`duplicate`).
 */
export async function sendGuardianMessage(tx: Tx, ctx: GuardianMessageCtx, input: SendMessageInput): Promise<SendMessageResult> {
  const { child } = await requireChild(tx, ctx, input.studentProfileId, GUARDIAN_MESSAGE_PERMISSION);
  // `requireChild` without a requested id would pick the first child — a send always names one, and only that one.
  if (child.studentProfileId !== input.studentProfileId) throw notFound();

  const subject = cleanSubject(input.subject);
  if (subject === "") throw fail("subject", MSG.subjectRequired);
  if (subject.length > MESSAGE_SUBJECT_MAX) throw fail("subject", MSG.subjectTooLong);
  const body = cleanBody(input.body);
  if (body === "") throw fail("body", MSG.bodyRequired);
  if (body.length > MESSAGE_BODY_MAX) throw fail("body", MSG.bodyTooLong);
  if (!isAllowedDestination(input.kind, input.destination)) throw fail("destination", MSG.teacherCriticism);

  const d = await destinationsOf(tx, ctx, child);
  if (!d.schoolId) throw fail("destination", MSG.noSchool);
  let wanted: string[];
  let classOfferingId: string | null = null;
  if (input.destination === "teacher") {
    if (!input.classOfferingId || !input.teacherPersonId) throw fail("destination", MSG.pickTeacher);
    const pair = d.teachers.find((t) => t.classOfferingId === input.classOfferingId && t.teacherPersonId === input.teacherPersonId);
    if (!pair) throw fail("destination", MSG.notTheirTeacher);
    wanted = [pair.teacherPersonId];
    classOfferingId = pair.classOfferingId;
  } else {
    wanted = d.holders[input.destination];
    if (wanted.length === 0) throw fail("destination", NO_HOLDER_MESSAGE[input.destination]);
  }

  // Person rows before everything else (the guardian is the item's creator and the message's sender).
  const locked = new Set(await lockActivePersons(tx, [ctx.personId, ...wanted]));
  if (!locked.has(ctx.personId)) throw notFound();
  const recipients = wanted.filter((id) => locked.has(id));
  if (recipients.length === 0) throw fail("destination", input.destination === "teacher" ? MSG.notTheirTeacher : NO_HOLDER_MESSAGE[input.destination]);

  // The live link, locked: an unlink in flight is waited for and then seen; two sends serialise on the rate limit.
  const link = await tx.execute<{ id: string }>(sql`
    select gl.id from iam.guardian_link gl
    where gl.guardian_person_id = ${ctx.personId}::uuid and gl.student_profile_id = ${child.studentProfileId}::uuid and gl.status = 'active'
    for no key update`);
  if (link.rows.length === 0) throw notFound();

  const replay = await findReplayedMessage(tx, ctx, child.studentProfileId, input.idempotencyKey);
  if (replay) return replay;
  const recent = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from workspace.guardian_message gm
    where gm.guardian_person_id = ${ctx.personId}::uuid and gm.student_profile_id = ${child.studentProfileId}::uuid
      and gm.created_at > now() - make_interval(mins => ${MESSAGE_RATE_WINDOW_MINUTES}::int)`);
  if (Number(recent.rows[0]?.n ?? 0) >= MESSAGE_RATE_LIMIT) throw rateLimited(MSG.rateLimited);

  const title = guardianMessageTitle(input.kind, `${child.firstName} ${child.lastName}`);
  const wi = await createConfidentialWorkItem(tx, ctx, {
    typeCode: "parent_message",
    title,
    description: guardianMessageDescription(subject, body),
    priority: "normal",
    dueAt: null,
    recipientIds: recipients,
    notificationTitle: title,
    // A counselor holds no «پنل من»: their bell opens «مشاوره» › «پیام‌های اولیا» instead of the work-item page.
    deepLink: input.destination === "counselor" ? COUNSELOR_MESSAGES_HREF : undefined,
    idempotencyKey: input.idempotencyKey ?? null,
    auditContext: { studentProfileId: child.studentProfileId, schoolId: d.schoolId, guardianMessage: { kind: input.kind, destination: input.destination } },
  });
  if (wi.duplicate) {
    // A key the work item knows but no message row was written for cannot happen (one transaction) — fail closed.
    const again = await findReplayedMessage(tx, ctx, child.studentProfileId, input.idempotencyKey);
    if (!again) throw notFound();
    return again;
  }
  const [row] = await tx
    .insert(guardianMessage)
    .values({
      organizationId: ctx.orgId,
      schoolId: d.schoolId,
      guardianPersonId: ctx.personId,
      studentProfileId: child.studentProfileId,
      workItemId: wi.id,
      kind: input.kind,
      destinationKind: input.destination,
      classOfferingId,
    })
    .returning({ id: guardianMessage.id });
  await audit(
    ctx,
    "workspace.guardian_message.created",
    { schema: "workspace", table: "guardian_message", id: row.id },
    null,
    {
      studentProfileId: child.studentProfileId,
      schoolId: d.schoolId,
      workItemId: wi.id,
      kind: input.kind,
      destination: input.destination,
      classOfferingId,
      recipients: wi.assigneeCount,
      subjectLength: subject.length,
      bodyLength: body.length,
    },
    tx,
  );
  return { messageId: row.id, workItemId: wi.id, recipients: wi.assigneeCount, duplicate: false };
}

// ---------------------------------------------------------------------------------------------------------------
// the addressee's side in «مشاوره» (a counselor has no «پنل من»)
// ---------------------------------------------------------------------------------------------------------------

export interface AddressedMessageRow {
  workItemId: string;
  title: string;
  kind: MessageKind;
  /** The guardian's name as the school stored it. */
  fromName: string;
  studentName: string;
  subject: string;
  body: string;
  sentAt: Date;
  /** Still waiting for an answer (nobody answered it yet). */
  open: boolean;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: Date | null;
}

/**
 * The guardians' messages given to the CALLER (their own inbox rows of type `parent_message` — exactly what
 * `canViewWorkItem` lets them open), open ones first, then the latest answered. RLS (0022): the message rows the
 * caller is an addressee of.
 */
export async function listAddressedMessages(tx: Tx, ctx: { personId: string }): Promise<AddressedMessageRow[]> {
  const res = await tx.execute<{
    work_item_id: string;
    title: string;
    kind: string;
    description: string | null;
    created_at: string;
    category: string;
    from_name: string;
    student_name: string;
    last_note: string | null;
    last_at: string | null;
    last_by: string | null;
    last_category: string | null;
    last_by_addressee: boolean | null;
  }>(sql`
    select wi.id as work_item_id, wi.title, gm.kind, wi.description, wi.created_at, s.category,
      cp.first_name || ' ' || cp.last_name as from_name,
      sp_p.first_name || ' ' || sp_p.last_name as student_name,
      lt.note as last_note, lt.at as last_at, lt.by_name as last_by, lt.category as last_category, lt.by_addressee as last_by_addressee
    from workspace.inbox_entry ie
    join workspace.work_item wi on wi.id = ie.work_item_id and wi.archived_at is null
    join workspace.work_item_type t on t.id = wi.type_id and t.code = 'parent_message'
    join workspace.work_item_status s on s.id = wi.status_id
    join workspace.guardian_message gm on gm.work_item_id = wi.id
    join iam.person cp on cp.id = wi.created_by_person_id
    join iam.student_profile sp on sp.id = gm.student_profile_id
    join iam.person sp_p on sp_p.id = sp.person_id
    left join lateral (
      select t2.note, t2.at, ts.category, bp.first_name || ' ' || bp.last_name as by_name,
             exists (select 1 from workspace.work_item_assignee a where a.work_item_id = wi.id and a.person_id = t2.by_person_id and a.role = 'assignee') as by_addressee
      from workspace.work_item_transition t2
      join workspace.work_item_status ts on ts.id = t2.to_status_id
      join iam.person bp on bp.id = t2.by_person_id
      where t2.work_item_id = wi.id
      order by t2.at desc, t2.id desc
      limit 1
    ) lt on true
    where ie.person_id = ${ctx.personId}::uuid and ie.state <> 'archived'
      and exists (select 1 from workspace.work_item_assignee me where me.work_item_id = wi.id and me.person_id = ie.person_id and me.role = 'assignee')
    order by (s.category in ('todo', 'doing')) desc, wi.created_at desc, wi.id desc
    limit 100`);
  return res.rows.map((r) => {
    const answer = answerOf({ category: r.last_category, byAddressee: r.last_by_addressee, note: r.last_note });
    const text = splitGuardianMessageDescription(r.description);
    return {
      workItemId: r.work_item_id,
      title: r.title,
      kind: isMessageKind(r.kind) ? r.kind : "question",
      fromName: r.from_name,
      studentName: r.student_name,
      subject: text.subject,
      body: text.body,
      sentAt: new Date(r.created_at),
      open: r.category === "todo" || r.category === "doing",
      answer,
      answeredBy: answer ? r.last_by : null,
      answeredAt: answer && r.last_at ? new Date(r.last_at) : null,
    };
  });
}

/**
 * «ثبت پاسخ» of a guardian's message from «مشاوره»: the caller must be one of its addressees (`answerAsAddressee`
 * checks the item is visible to them, is a `parent_message`, open, and that they are an assignee) — the same
 * transition, notification and audit as an answer in «پنل من».
 */
export async function answerAddressedMessage(tx: Tx, ctx: GuardianMessageCtx, input: { workItemId: string; answer: string }): Promise<{ closed: boolean }> {
  const r = await answerAsAddressee(tx, ctx, { workItemId: input.workItemId, typeCode: "parent_message", note: input.answer });
  return { closed: r.itemChanged };
}
