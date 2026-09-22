// The reads Home shares between its two renderings — the phone grid and the desktop dashboard are both in the
// server tree (CSS decides which one shows), so every read is wrapped in React `cache` and runs once per request.
import { cache } from "react";
import { onboardingProgress } from "@/lib/admin/onboarding";
import { adminOverviewQuery, type AdminCounts } from "@/lib/admin/overview";
import type { Ctx } from "@/lib/ctx";
import { homeTilesFor, type HomeTile } from "@/lib/modules-registry";
import { myTimetableQuery } from "@/modules/academic/queries";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery, type Hats } from "@/modules/iam/hats";
import type { Permission } from "@/modules/iam/permissions";

export const getHats = cache(async (): Promise<Hats | null> => {
  const r = await hatsQuery();
  return r.ok ? r.data : null;
});

export const getAdminCounts = cache(async (): Promise<AdminCounts | null> => {
  const r = await adminOverviewQuery();
  return r.ok ? r.data.counts : null;
});

export const getMyTimetable = cache(async () => {
  const r = await myTimetableQuery();
  return r.ok ? r.data : null;
});

export interface HomeTiles {
  tiles: HomeTile[];
  hats: Hats | null;
  isAdmin: boolean;
  /** Read only for admins; drives the glance card and the onboarding badge / progress. */
  counts: AdminCounts | null;
  onboarding: { done: number; total: number } | null;
}

/** The live tiles of a person (hats + permissions) and the admin facts the grid decorates them with. */
export const resolveHomeTiles = cache(async (ctx: Ctx): Promise<HomeTiles> => {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  const hats = await getHats();
  const isStudent = hats?.isStudent ?? false;
  const isTeacher = (hats?.teachingOfferings.length ?? 0) > 0;
  const adminScope = hats?.adminScope ?? null;
  const isAdmin = adminScope !== null;
  const tiles = homeTilesFor({ isStudent, isTeacher, isAdmin, adminScope }, has);
  const counts = isAdmin ? await getAdminCounts() : null;
  const onboarding = counts && adminScope === "organization" ? onboardingProgress(counts) : null;
  return { tiles, hats, isAdmin, counts, onboarding };
});
