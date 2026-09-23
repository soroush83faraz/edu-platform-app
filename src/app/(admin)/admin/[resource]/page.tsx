import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResourceListPage, type SearchParams } from "@/components/admin/ResourceListPage";
import { RESOURCES } from "@/lib/admin/resources";

/** «مدرسه‌ها | مدیریت», «کلاس‌ها | مدیریت», … — one title per resource (was the layout's generic «مدیریت»). */
export async function generateMetadata({ params }: { params: Promise<{ resource: string }> }): Promise<Metadata> {
  const { resource } = await params;
  const def = RESOURCES[resource];
  return { title: def && resource !== "offerings" ? `${def.labelFaPlural} | مدیریت` : "مدیریت" };
}

/** Generic list page of every structure resource: /admin/schools, /admin/years, /admin/terms?year=…, … */
export default async function ResourcePage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SearchParams> }) {
  const { resource } = await params;
  const def = RESOURCES[resource];
  if (!def || resource === "offerings") notFound(); // offerings live under /admin/classes/[id]/offerings
  return <ResourceListPage def={def} sp={await searchParams} />;
}
