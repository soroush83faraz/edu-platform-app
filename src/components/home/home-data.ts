// The reads Home shares between its two renderings — the phone grid and the desktop dashboard are both in the
// server tree (CSS decides which one shows), so every read is wrapped in React `cache` and runs once per request.
// Home is the person's OWN work (docs/decisions.md «one home per destination»): no admin counters are read here —
// the management overview belongs to /admin.
import { cache } from "react";
import type { Ctx } from "@/lib/ctx";
import { homeTilesFor, showUpcomingOnHome, upcomingTilesFor, type HomeTile, type UpcomingTile } from "@/lib/modules-registry";
import { getUiVariant, type UiVariant } from "@/lib/ui-variant";
import { myClassQuery, myTimetableQuery, pendingLeaveCountQuery, reportCardReachQuery } from "@/modules/academic/queries";
import type { FlagKey } from "@/modules/config/flags";
import { isEnabled } from "@/modules/config/queries";
import { canAtAnyScope, schoolLevelScope } from "@/modules/iam/can";
import { myChildrenQuery, type GuardianChild } from "@/modules/iam/guardian-queries";
import { hatsQuery, type Hats } from "@/modules/iam/hats";
import type { Permission } from "@/modules/iam/permissions";
import { homeOpenItemsQuery } from "@/modules/workspace/queries";

export const getHats = cache(async (): Promise<Hats | null> => {
  const r = await hatsQuery();
  return r.ok ? r.data : null;
});

export const getMyTimetable = cache(async () => {
  const r = await myTimetableQuery();
  return r.ok ? r.data : null;
});

/** The student's class and its درس‌ها (the «درس‌ها و دبیران» read) — the «درس‌های من» course cards draw from it. */
export const getMyClass = cache(async () => {
  const r = await myClassQuery();
  return r.ok ? r.data : null;
});

/** Does the child's school take leave requests (switch `leave_requests`)? — the guardian's «درخواست مرخصی» tile. */
export const leaveRequestsOpen = cache(async (schoolId: string | null): Promise<boolean> => schoolId !== null && (await isEnabled("leave_requests", schoolId)));

/** «فرزندان» (2026-10-18): a guardian's live children — read only for a session that wears the «ولی» hat. */
export const getMyChildren = cache(async (): Promise<GuardianChild[]> => {
  const r = await myChildrenQuery();
  return r.ok ? r.data : [];
});

/** «تکالیف نزدیک» — both renderings draw the card (`NearbyCard`), so its list is read once per request too. */
export const getNearbyItems = cache(async () => {
  const r = await homeOpenItemsQuery({ limit: 5 });
  return r.ok ? r.data : [];
});

export interface HomeTiles {
  tiles: HomeTile[];
  /**
   * The hub Home's grey «به‌زودی» tiles for this person (`upcomingTilesFor`) — none in the classic layout, and none
   * for anyone but an admin (`showUpcomingOnHome`, owner 2026-09-27).
   */
  upcoming: UpcomingTile[];
  hats: Hats | null;
  /** The person's own hats — what the desktop board renders (the admin hat picks no board: /admin is the hub). */
  isStudent: boolean;
  isTeacher: boolean;
  /** The viewer's layout (`getUiVariant()`): the hub has no nav, so the board's own links open the hub's pages. */
  variant: UiVariant;
  /** Guardians' leave requests waiting for the caller's schools — the badge of the «درخواست‌های مرخصی» tile (0 when there is none). */
  pendingLeaves: number;
}

/** The live tiles of a person (hats + permissions + the viewer's layout variant), and the hats the desktop board branches on. */
export const resolveHomeTiles = cache(async (ctx: Ctx): Promise<HomeTiles> => {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  const hats = await getHats();
  const isStudent = hats?.isStudent ?? false;
  const isTeacher = (hats?.teachingOfferings.length ?? 0) > 0;
  const adminScope = hats?.adminScope ?? null;
  // The experimental «hub» layout (no nav) turns every former nav destination into a tile; classic is unchanged.
  const variant = await getUiVariant();
  // The report-card tiles exist for primary classes only: one more read, and only for someone who holds the permission.
  const reach = has("academic.objective_rating.read") ? await reportCardReachQuery() : null;
  const reportCard = reach?.ok ? reach.data : { staff: false, student: false };
  const tileHats = { isStudent, isTeacher, isAdmin: adminScope !== null, adminScope, singleSchoolId: hats?.adminSingleSchoolId ?? null, reportCard };
  // Tiles behind a feature switch: the organization's value, or — for a school-overridable switch and an admin of ONE
  // school — that school's.
  const requestCenter = adminScope !== null && (await isEnabled("request_center"));
  const leaveRequests = adminScope !== null && (await isEnabled("leave_requests", hats?.adminSingleSchoolId ?? null));
  const flagOn = (k: FlagKey) => (k === "request_center" && requestCenter) || (k === "leave_requests" && leaveRequests);
  // A tile whose page acts AT the school (`decideLeave`, the settings' school level) is hidden from whoever holds the
  // permission only below it (a branch-scoped vice principal) — the page would refuse them (security review F9).
  const atSchool: Partial<Record<string, Permission>> = { "admin-leave": "academic.leave.decide", settings: "config.settings.manage" };
  const tiles = homeTilesFor(tileHats, has, { variant, flags: flagOn }).filter((t) => {
    const p = atSchool[t.code];
    return !p || schoolLevelScope(ctx.assignments, p) !== null;
  });
  const upcoming = variant === "hub" && showUpcomingOnHome(tileHats) ? upcomingTilesFor(tileHats) : [];
  // One more read, only for a person whose Home carries the «درخواست‌های مرخصی» tile.
  const leave = tiles.some((t) => t.code === "admin-leave") ? await pendingLeaveCountQuery() : null;
  const pendingLeaves = leave?.ok ? leave.data : 0;
  return { tiles, upcoming, hats, isStudent, isTeacher, variant, pendingLeaves };
});
