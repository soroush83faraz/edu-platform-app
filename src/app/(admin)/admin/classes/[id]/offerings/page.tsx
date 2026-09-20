import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResourceListPage, type SearchParams } from "@/components/admin/ResourceListPage";
import { offeringResource } from "@/lib/admin/resources";

export const metadata: Metadata = { title: "ارائهٴ درس‌ها | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/classes/[id]/offerings — subject × term × main teacher of one class. */
export default async function ClassOfferingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return <ResourceListPage def={offeringResource} sp={await searchParams} parent={id} basePath={`/admin/classes/${id}/offerings`} />;
}
