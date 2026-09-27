import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { MySubjectsList, NoClassYet } from "@/components/my-class/MyClassParts";
import { myClassQuery } from "@/modules/academic/queries";

export const metadata: Metadata = { title: "درس‌ها و دبیران" };

/**
 * «درس‌ها و دبیران» on its own page — the hub layout's Home tile (docs/decisions-pending/home-hub-tiles.md). The
 * same list as the section of «کلاس من» (`MySubjectsList`), the same read; each row opens the درس.
 */
export default async function MySubjectsPage() {
  const result = await myClassQuery();
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    return <EmptyState title="درس‌ها در دسترس نیست" description={result.message} />;
  }
  const cls = result.data;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <PageHeader title="درس‌ها و دبیران" count={cls?.teachers.length} back={{ href: "/home", label: "خانه" }} />
      {cls === null ? <NoClassYet /> : <MySubjectsList teachers={cls.teachers} />}
    </ContentWidth>
  );
}
