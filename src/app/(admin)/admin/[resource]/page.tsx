import { notFound } from "next/navigation";
import { ResourceListPage, type SearchParams } from "@/components/admin/ResourceListPage";
import { RESOURCES } from "@/lib/admin/resources";

/** Generic list page of every structure resource: /admin/schools, /admin/years, /admin/terms?year=…, … */
export default async function ResourcePage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SearchParams> }) {
  const { resource } = await params;
  const def = RESOURCES[resource];
  if (!def || resource === "offerings") notFound(); // offerings live under /admin/classes/[id]/offerings
  return <ResourceListPage def={def} sp={await searchParams} />;
}
