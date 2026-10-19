// iam/guardian-message-routing — «ارتباط ولی و مدرسه»: a guardian's message that nobody can answer any more goes on to
// whoever can (security review 2026-10-19, D1; docs/decisions.md). Before this, a message whose only addressee was
// removed, lost the office or stopped teaching the درس stayed open for ever: «ارسال‌شده» for the guardian, nobody to
// answer it.
//
// WHEN — inside every write that ends a capacity a message is addressed through, at its end:
//   • a removal (iam/removal `removePerson`: `prepareGuardianMessageReroute` before `withdrawRemovedAssignee`,
//     `applyGuardianMessageReroute` after it, under the locks it took);
//   • a role revoke (iam/service `revokeRoleAssignment` — «مشاور», «معاون», «مدیر مدرسه»);
//   • an ended teaching (academic/service `endTeacherAssignment`; the offerings form and «افزودن تدریس» put the next
//     teacher in right after, so they pass `rerouteGuardianMessages: false` and re-route once that teacher is in).
// Not: a role that runs out by its date, a closed offering, a child who changed class or school (no event — the
// guardian's list says «در انتظار پاسخ» after a week, ./guardian-message-policy), nor anyone appointed later (nothing
// is routed TO a new office holder).
//
// WHICH — the OPEN `parent_message` items (todo / doing, not archived) the person is an assignee of that have no LIVE
// addressee left: an assignee who is an active person AND still holds, at the message's school, a capacity it may be
// answered through — the office it went to (the SYSTEM role «مشاور» / «معاون» / «مدیر مدرسه», live, school- or
// branch-scoped there), a current teaching of its درس (a teacher message), or one of the school's managers («مدیر
// مدرسه», «معاون» — the chain below). An addressee who keeps their row but lost the office counts as gone; they keep
// reading the item (docs/decisions.md «Open (owner)»).
//
// TO WHOM — at the message's school, never the guardian who wrote it nor the person whose capacity ended:
//   1. the same destination: the current teachers of that درس who teach the child now (a teacher message), or the
//      live holders of that office;
//   2. else the school's principals; 3. else its vice principals;
//   4. else nobody: the item stays open with no live addressee — while no assignee is left at all the guardian reads
//      «در حال ارجاع به مدیریت» (./guardian-messages). Never the organization admin (docs/decisions.md, «ارتباط ولی و
//      مدرسه» open item (f)).
// The new addressees get what a send gives them: an assignee row, an unread inbox row and the standard
// `work_item.assigned` bell (the item's title, the guardian's name; a counselor's opens «مشاوره» › «پیام‌های اولیا»);
// the actor no bell. One audit row per message decided (`workspace.guardian_message.rerouted`): the reason, the person
// whose capacity ended, the step, the persons added — ids and kinds only, never the text.
//
// THE ROUTING FACTS of a message (school, child, destination, درس) live on `workspace.guardian_message`, which only its
// guardian and its addressees may select (0022). The admin re-routing it is neither: the facts come from
// `app.guardian_message_routes(person)` (migration 0023 — SECURITY DEFINER, those columns only, OPEN messages of that
// person only, and only at a school where the CURRENT person holds the permission of one of the writes above).
//
// LOCKS (iam/removal «Concurrency»: person rows → work item rows). `prepareGuardianMessageReroute` takes the chain's
// candidates' person rows FOR KEY SHARE SKIP LOCKED (ascending) before any item is locked: a candidate whose row a
// removal holds FOR UPDATE — the one mode KEY SHARE waits for — is being removed and is passed over, never waited for
// (two removals of a school's two office holders would otherwise wait for each other in a circle). The inserts' foreign
// keys then reference only rows already held. `applyGuardianMessageReroute` decides and writes under the items' locks
// (FOR NO KEY UPDATE, ascending — taken there, or already held by the removal's `withdrawRemovedAssignee`): an answer,
// a withdrawal or another re-route of the same item runs wholly before or after it. The office and teaching rows are
// not locked: two changes to two DIFFERENT office holders of one school committed at the same instant may hand a
// message to the one whose change commits second (accepted — docs/decisions.md).
//
// A leaf of iam (no service import — iam/service, academic/service and iam/removal all call it without a cycle).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/actions";
import { audit, type AuditCtx } from "@/lib/audit";
import type { AssignmentLike } from "@/lib/work-item-words";
import { notifyMany } from "@/modules/notif/service";
import { notifiable } from "@/modules/workspace/notify-policy";
import { inboxEntry, workItem, workItemAssignee } from "@/modules/workspace/schema";
import { COUNSELOR_MESSAGES_HREF, isMessageDestination, type MessageDestination } from "./guardian-message-policy";
import { person } from "./schema";

/** The school's offices a guardian writes to (the destinations but «دبیر»). */
export type Office = Exclude<MessageDestination, "teacher">;

/** The school's offices and the SYSTEM role whose live holders they are. */
export const OFFICE_ROLE: Record<Office, string> = { counselor: "counselor", vice_principal: "vice_principal", principal: "school_principal" };

const OFFICES = Object.keys(OFFICE_ROLE) as Office[];

/**
 * The live holders of the school's offices: active persons with a valid assignment of the SYSTEM role (organization_id
 * NULL — a tenant role with the same code never counts) scoped to the school or one of its branches. Never
 * `exceptPersonId`. One query for the three offices — what a send offers (./guardian-messages) and the chain here.
 */
export async function officeHolders(tx: Tx, schoolId: string, exceptPersonId: string): Promise<Record<Office, string[]>> {
  const res = await tx.execute<{ role_code: string; person_id: string }>(sql`
    select distinct r.code as role_code, ra.person_id
    from iam.role_assignment ra
    join iam.role r on r.id = ra.role_id and r.organization_id is null
    join iam.person p on p.id = ra.person_id and p.status = 'active'
    where r.code in ('counselor', 'vice_principal', 'school_principal')
      and ra.revoked_at is null
      and (ra.valid_from is null or ra.valid_from <= current_date)
      and (ra.valid_to is null or ra.valid_to >= current_date)
      and ra.person_id <> ${exceptPersonId}::uuid
      and ((ra.scope_type = 'school' and ra.school_id = ${schoolId}::uuid)
           or (ra.scope_type = 'branch' and exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = ${schoolId}::uuid)))
    order by r.code, ra.person_id`);
  const out: Record<Office, string[]> = { counselor: [], vice_principal: [], principal: [] };
  for (const r of res.rows) {
    const office = OFFICES.find((o) => OFFICE_ROLE[o] === r.role_code);
    if (office) out[office].push(r.person_id);
  }
  return out;
}

/** Why a re-route ran (its audit row). */
export type RerouteReason = "removed" | "role_revoked" | "teaching_ended";
/** Where the chain landed: the same destination, the principals, the vice principals, or nobody. */
export type RerouteStep = "same" | "principal" | "vice_principal" | "nobody";

/** The actor (assignments only narrow the bell, `notifiable`; academic's context carries none — an admin's write). */
export type RerouteCtx = AuditCtx & { orgId: string; personId: string; assignments?: readonly AssignmentLike[] };

interface PlannedMessage {
  workItemId: string;
  schoolId: string;
  destination: MessageDestination;
  classOfferingId: string | null;
  title: string;
  creatorName: string;
  /** The chain's steps in order, each with its candidates — active, locked FOR KEY SHARE. */
  chain: Array<{ step: Exclude<RerouteStep, "nobody">; personIds: string[] }>;
}

export interface ReroutePlan {
  /** The person whose capacity ended. */
  personId: string;
  messages: PlannedMessage[];
}

export interface ReroutedMessage {
  workItemId: string;
  step: RerouteStep;
  addedPersonIds: string[];
}

/** The current teachers of the درس who teach the child NOW (an open offering of the child's active class), active persons. */
async function teachersOfOfferingForChild(tx: Tx, classOfferingId: string, studentProfileId: string): Promise<string[]> {
  const res = await tx.execute<{ person_id: string }>(sql`
    select distinct p.id as person_id
    from academic.teacher_assignment ta
    join tenancy.class_offering o on o.id = ta.class_offering_id and o.status <> 'closed'
    join tenancy.class_group cg on cg.id = o.class_group_id and cg.status = 'active'
    join iam.staff_profile stp on stp.id = ta.staff_profile_id
    join iam.person p on p.id = stp.person_id and p.status = 'active'
    where ta.class_offering_id = ${classOfferingId}::uuid and ta.valid_to is null
      and exists (
        select 1 from academic.class_enrollment ce
        where ce.student_profile_id = ${studentProfileId}::uuid and ce.status = 'active' and ce.class_group_id = o.class_group_id)
    order by p.id`);
  return res.rows.map((r) => r.person_id);
}

/**
 * Phase 1, BEFORE any work item is locked: the open messages `personId` is an addressee of (the routing facts through
 * migration 0023's function), and for each the chain's candidates, their person rows taken FOR KEY SHARE SKIP LOCKED.
 * Decides nothing — `applyGuardianMessageReroute` does, under the items' locks.
 */
export async function prepareGuardianMessageReroute(tx: Tx, personId: string): Promise<ReroutePlan> {
  const routes = await tx.execute<{ work_item_id: string; school_id: string; student_profile_id: string; destination_kind: string; class_offering_id: string | null }>(sql`
    select r.work_item_id, r.school_id, r.student_profile_id, r.destination_kind, r.class_offering_id
    from app.guardian_message_routes(${personId}::uuid) r`);
  if (routes.rows.length === 0) return { personId, messages: [] };
  const items = await tx.execute<{ id: string; created_by_person_id: string; title: string; first_name: string; last_name: string }>(sql`
    select wi.id, wi.created_by_person_id, wi.title, cp.first_name, cp.last_name
    from workspace.work_item wi
    join iam.person cp on cp.id = wi.created_by_person_id
    where wi.id = any(${sql.param(routes.rows.map((r) => r.work_item_id), undefined)}::uuid[])`);
  const itemById = new Map(items.rows.map((i) => [i.id, i]));

  const holdersBySchool = new Map<string, Record<Office, string[]>>();
  const messages: PlannedMessage[] = [];
  for (const r of routes.rows) {
    const item = itemById.get(r.work_item_id);
    if (!item || !isMessageDestination(r.destination_kind)) continue;
    let holders = holdersBySchool.get(r.school_id);
    if (!holders) {
      holders = await officeHolders(tx, r.school_id, personId);
      holdersBySchool.set(r.school_id, holders);
    }
    const destination = r.destination_kind;
    const same = destination === "teacher" ? (r.class_offering_id ? await teachersOfOfferingForChild(tx, r.class_offering_id, r.student_profile_id) : []) : holders[destination];
    // Never the guardian who wrote it, never the person whose capacity ended.
    const keep = (ids: readonly string[]) => ids.filter((id) => id !== personId && id !== item.created_by_person_id);
    messages.push({
      workItemId: r.work_item_id,
      schoolId: r.school_id,
      destination,
      classOfferingId: r.class_offering_id,
      title: item.title,
      creatorName: `${item.first_name} ${item.last_name}`,
      chain: [
        { step: "same", personIds: keep(same) },
        { step: "principal", personIds: keep(holders.principal) },
        { step: "vice_principal", personIds: keep(holders.vice_principal) },
      ],
    });
  }

  // Person rows before any item: KEY SHARE, ascending, SKIP LOCKED — a candidate being removed is passed over.
  const candidates = [...new Set(messages.flatMap((m) => m.chain.flatMap((s) => s.personIds)))].sort();
  if (candidates.length > 0) {
    const locked = await tx
      .select({ id: person.id })
      .from(person)
      .where(and(inArray(person.id, candidates), eq(person.status, "active")))
      .orderBy(asc(person.id))
      .for("key share", { skipLocked: true });
    const held = new Set(locked.map((p) => p.id));
    for (const m of messages) for (const s of m.chain) s.personIds = s.personIds.filter((id) => held.has(id));
  }
  return { personId, messages };
}

/**
 * The assignees among `assigneeIds` who still can answer the message — active, and holding at its school its office,
 * a current teaching of its درس (a teacher message), or the principal's or a vice principal's role.
 */
async function liveAddressees(tx: Tx, m: PlannedMessage, assigneeIds: readonly string[]): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const codes = ["school_principal", "vice_principal", ...(m.destination === "teacher" ? [] : [OFFICE_ROLE[m.destination]])];
  const res = await tx.execute<{ id: string }>(sql`
    select p.id
    from iam.person p
    where p.id = any(${sql.param([...assigneeIds], undefined)}::uuid[]) and p.status = 'active'
      and (
        exists (
          select 1
          from iam.role_assignment ra
          join iam.role r on r.id = ra.role_id and r.organization_id is null
          where ra.person_id = p.id and r.code = any(${sql.param(codes, undefined)}::text[])
            and ra.revoked_at is null
            and (ra.valid_from is null or ra.valid_from <= current_date)
            and (ra.valid_to is null or ra.valid_to >= current_date)
            and ((ra.scope_type = 'school' and ra.school_id = ${m.schoolId}::uuid)
                 or (ra.scope_type = 'branch' and exists (select 1 from tenancy.branch b where b.id = ra.branch_id and b.school_id = ${m.schoolId}::uuid))))
        or exists (
          select 1
          from academic.teacher_assignment ta
          join iam.staff_profile stp on stp.id = ta.staff_profile_id
          where ta.class_offering_id = ${m.classOfferingId}::uuid and ta.valid_to is null and stp.person_id = p.id))`);
  return res.rows.map((r) => r.id);
}

/**
 * Phase 2, under the items' locks (taken here in ascending order, or `lockedItemIds` — already held by the caller —
 * when only those are to be decided): every planned message still open with no live addressee goes to the first step
 * of its chain that has a candidate (assignee + unread inbox row + bell + audit), or is recorded as left with nobody.
 */
export async function applyGuardianMessageReroute(
  tx: Tx,
  ctx: RerouteCtx,
  plan: ReroutePlan,
  opts: { reason: RerouteReason; lockedItemIds?: readonly string[] },
): Promise<ReroutedMessage[]> {
  const held = opts.lockedItemIds ? new Set(opts.lockedItemIds) : null;
  const targets = plan.messages.filter((m) => !held || held.has(m.workItemId)).sort((a, b) => (a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0));
  if (targets.length === 0) return [];
  if (!held) {
    await tx
      .select({ id: workItem.id })
      .from(workItem)
      .where(inArray(workItem.id, targets.map((m) => m.workItemId)))
      .orderBy(asc(workItem.id))
      .for("no key update");
  }

  const out: ReroutedMessage[] = [];
  for (const m of targets) {
    // The item as committed now (an answer that closed it meanwhile is seen here and ends this).
    const state = await tx.execute<{ open: boolean }>(sql`
      select (wi.archived_at is null and s.category in ('todo', 'doing')) as open
      from workspace.work_item wi join workspace.work_item_status s on s.id = wi.status_id
      where wi.id = ${m.workItemId}::uuid`);
    if (state.rows[0]?.open !== true) continue;
    const assignees = (
      await tx
        .select({ personId: workItemAssignee.personId })
        .from(workItemAssignee)
        .where(and(eq(workItemAssignee.workItemId, m.workItemId), eq(workItemAssignee.role, "assignee")))
    ).map((a) => a.personId);
    if ((await liveAddressees(tx, m, assignees)).length > 0) continue;

    const current = new Set(assignees);
    const next = m.chain.find((s) => s.personIds.some((id) => !current.has(id)));
    const added = next ? next.personIds.filter((id) => !current.has(id)) : [];
    if (next) {
      await tx
        .insert(workItemAssignee)
        .values(added.map((personId) => ({ workItemId: m.workItemId, personId, organizationId: ctx.orgId, role: "assignee" as const, state: "pending" as const })))
        .onConflictDoNothing();
      await tx
        .insert(inboxEntry)
        .values(added.map((personId) => ({ organizationId: ctx.orgId, personId, workItemId: m.workItemId, relation: "assignee" as const, state: "unread" as const })))
        .onConflictDoUpdate({ target: [inboxEntry.personId, inboxEntry.workItemId], set: { relation: "assignee", state: "unread" } });
      // The bell a send gives (`createConfidentialWorkItem`); a counselor answers in «مشاوره», everyone else in «پنل من».
      const deepLink = next.step === "same" && m.destination === "counselor" ? COUNSELOR_MESSAGES_HREF : `/inbox/${m.workItemId}`;
      await notifyMany(
        tx,
        ctx,
        notifiable(ctx.assignments ?? [], added.filter((id) => id !== ctx.personId)),
        {
          typeCode: "work_item.assigned",
          title: m.title,
          body: m.creatorName,
          sourceKind: "work_item",
          sourceId: m.workItemId,
          deepLink,
          dedupeKey: (personId) => `wi:${m.workItemId}:assigned:${personId}`,
        },
      );
    }
    const step: RerouteStep = next ? next.step : "nobody";
    await audit(
      ctx,
      "workspace.guardian_message.rerouted",
      { schema: "workspace", table: "work_item", id: m.workItemId },
      { assigneeIds: assignees },
      { reason: opts.reason, fromPersonId: plan.personId, schoolId: m.schoolId, destination: m.destination, step, addedPersonIds: added },
      tx,
    );
    out.push({ workItemId: m.workItemId, step, addedPersonIds: added });
  }
  return out;
}

/** Both phases, for a write that has locked no work item yet (a role revoked, a teaching ended). */
export async function rerouteGuardianMessagesOf(tx: Tx, ctx: RerouteCtx, personId: string, reason: RerouteReason): Promise<ReroutedMessage[]> {
  const plan = await prepareGuardianMessageReroute(tx, personId);
  return applyGuardianMessageReroute(tx, ctx, plan, { reason });
}
