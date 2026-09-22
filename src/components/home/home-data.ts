// The reads Home shares between its two renderings — the phone grid and the desktop dashboard are both in the
// server tree (CSS decides which one shows), so every read is wrapped in React `cache` and runs once per request.
// Home is the person's OWN work (docs/decisions.md «one home per destination»): no admin counters are read here —
// the management overview belongs to /admin.
import { cache } from "react";
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

export const getMyTimetable = cache(async () => {
  const r = await myTimetableQuery();
  return r.ok ? r.data : null;
});

export interface HomeTiles {
  tiles: HomeTile[];
  hats: Hats | null;
  /** The person's own hats — what the desktop board renders (the admin hat picks no board: /admin is the hub). */
  isStudent: boolean;
  isTeacher: boolean;
}

/** The live tiles of a person (hats + permissions), and the hats the desktop board branches on. */
export const resolveHomeTiles = cache(async (ctx: Ctx): Promise<HomeTiles> => {
  const has = (p: Permission) => canAtAnyScope(ctx.assignments, p);
  const hats = await getHats();
  const isStudent = hats?.isStudent ?? false;
  const isTeacher = (hats?.teachingOfferings.length ?? 0) > 0;
  const adminScope = hats?.adminScope ?? null;
  const tiles = homeTilesFor({ isStudent, isTeacher, isAdmin: adminScope !== null, adminScope }, has);
  return { tiles, hats, isStudent, isTeacher };
});
