import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyClassCard, MyClassFacts, NoClassYet } from "@/components/my-class/MyClassParts";
import { myClassQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "کلاس من" };

/**
 * The class itself — its name, school, the number of هم‌کلاسی‌ها and درس‌ها — the hub layout's «کلاس من» Home tile
 * (docs/decisions-pending/home-hub-tiles.md). There is no classmates list in phase 1, so this is the class-info
 * destination: the two sections of «کلاس من» that are neither the week nor the درس list, from the same read.
 */
export default async function MyClassInfoPage() {
  const result = await myClassQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="کلاس من در دسترس نیست" description={result.message} />;
  }
  const cls = result.data;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <PageHeader title="کلاس من" back={{ href: "/home", label: "خانه" }} />
      {cls === null ? (
        <NoClassYet />
      ) : (
        <>
          <MyClassCard cls={cls} />
          <MyClassFacts cls={cls} />
        </>
      )}
    </ContentWidth>
  );
}
