import { redirect } from "next/navigation";
import { requireContext } from "@/lib/ctx";
import { navRoleFor } from "@/modules/iam/can";

/**
 * «برنامهٴ کلاسی» has no page of its own: the timetable lives where each hat already looks — a student's
 * «کلاس من», a teacher's «کلاس‌های من», an admin's class pages. This route is the product map's link target.
 */
export default async function TimetablePage() {
  const ctx = await requireContext();
  const role = navRoleFor(ctx.assignments);
  redirect(role === "student" ? "/my-class" : role === "teacher" ? "/classes" : role === "admin" ? "/admin/classes" : "/home");
}
