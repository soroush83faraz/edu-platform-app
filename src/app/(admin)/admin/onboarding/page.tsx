import { Check, ChevronLeft, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { AdminHeader } from "@/components/admin/AdminPage";
import { ResourceForm } from "@/components/admin/ResourceForm";
import { formFieldsOf } from "@/lib/admin/defineResource";
import { onboardingSteps } from "@/lib/admin/onboarding";
import { adminOverviewQuery } from "@/lib/admin/overview";
import { adminResourceList } from "@/lib/admin/queries";
import { schoolResource } from "@/lib/admin/resources";
import { formatNumberFa } from "@/lib/format";

export const metadata: Metadata = { title: "راه‌اندازی مدرسه" };

/**
 * /admin/onboarding — what is done and what is missing before students can log in on ۱ مهر. Organization admins
 * only (owner's rule: whoever defines schools sets them up); a school-scoped admin who types the URL gets the
 * Persian not-found page like every other organization-only page — the scope comes from the database
 * (`adminOverviewQuery().scope`), not from the hidden section or nav entry.
 *
 * Step one is the only ACTIONABLE one: «مدرسهٴ جدید» is the page's primary action and opens the very dialog the
 * schools list opens — the same resource definition, the same strict schema, the same `adminResourceMutate` and
 * therefore the same gate (`tenancy.structure.write` plus an organization scope, `createNeedsOrgScope`). After a
 * save the form refreshes this route, the checklist recomputes from fresh counters, and with exactly one school
 * the first row goes on to THAT school's hub (سال تحصیلی → کلاس‌ها → کارکنان). Every other step stays a computed
 * link to the section that fixes it.
 */
export default async function OnboardingPage() {
  const result = await adminOverviewQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    redirect("/home");
  }
  if (result.data.scope.kind !== "organization") notFound();
  // The same read the schools list does: `canCreate` is the server-side gate of «مدرسهٴ جدید» and the rows tell
  // us whether there is exactly ONE school to send step one on to.
  const schools = await adminResourceList({ resource: schoolResource.key, q: "", page: 1 });
  if (!schools.ok) notFound();
  const onlySchool = schools.data.total === 1 ? String(schools.data.rows[0].id) : null;
  const list = onboardingSteps(result.data.counts, onlySchool);
  const done = list.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title="راه‌اندازی مدرسه"
        description="ترتیب پیشنهادی از بالا به پایین؛ هر ردیف به بخش مربوط می‌رود."
        actions={
          schools.data.canCreate ? (
            <ResourceForm resource={schoolResource.key} labelFa={schoolResource.labelFa} fields={formFieldsOf(schoolResource, schools.data.options)} options={schools.data.options} mode="create" />
          ) : null
        }
      />
      <div className="surface-panel flex items-center gap-3 px-4 py-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done}>
          <div className={cn("h-full rounded-full", done === list.length ? "bg-success" : "bg-sky")} style={{ width: `${Math.round((done / list.length) * 100)}%` }} />
        </div>
        <span className="tabular text-sm font-medium text-text">
          {formatNumberFa(done)}/{formatNumberFa(list.length)}
        </span>
      </div>
      <ol className="surface-work divide-y divide-line/70">
        {list.map((s, i) => (
          <li key={`${s.href}-${i}`}>
            <Link href={s.href} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
              {s.done ? <Check className="size-5 shrink-0 text-success" aria-label="انجام شده" /> : <CircleDashed className={cn("size-5 shrink-0", s.warn ? "text-warning-text" : "text-text-faint")} aria-label="انجام نشده" />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-row", s.done ? "text-text" : "font-medium text-text")}>{s.title}</span>
                <span className={cn("text-meta", s.warn && !s.done ? "text-warning-text" : "text-text-muted")}>{s.detail}</span>
              </span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
