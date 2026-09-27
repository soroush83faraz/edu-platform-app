import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClassesActions, NoOfferingsYet, OfferingsGrid, offeringsSummaryFa } from "@/components/classes/ClassesParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireContext } from "@/lib/ctx";
import { canAtAnyScope } from "@/modules/iam/can";
import { hatsQuery } from "@/modules/iam/hats";

export const metadata: Metadata = { title: "کلاس‌های من" };

/**
 * A teacher's درس‌ها on their own page — the hub layout's «کلاس‌های من» Home tile (docs/decisions-pending/
 * home-hub-tiles.md): the offering cards and the page actions of `/classes`, without the week (which has its own
 * tile, `/classes/timetable`). Same parts, same reads; the full page stays as it is.
 */
export default async function MyOfferingsPage() {
  const hats = await hatsQuery();
  if (!hats.ok) {
    if (hats.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس‌ها در دسترس نیست" description={hats.message} />;
  }
  // A student who lands here belongs on their own class page, as on `/classes`.
  if (hats.data.isStudent && hats.data.teachingOfferings.length === 0) redirect("/my-class/info");
  const ctx = await requireContext();
  const canCreate = canAtAnyScope(ctx.assignments, "workspace.work_item.create");
  const offerings = hats.data.teachingOfferings;
  return (
    <ContentWidth className="gap-4">
      <PageHeader
        title="کلاس‌های من"
        description={offeringsSummaryFa(offerings.length)}
        back={{ href: "/home", label: "خانه" }}
        actions={<ClassesActions hasOfferings={offerings.length > 0} canCreate={canCreate} />}
      />
      {offerings.length === 0 ? <NoOfferingsYet /> : <OfferingsGrid offerings={offerings} />}
    </ContentWidth>
  );
}
