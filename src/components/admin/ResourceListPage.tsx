import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pagination, SearchForm, lastPage } from "@/components/admin/AdminPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { getAdminShell } from "@/lib/admin/admin-shell";
import { ADMIN_SECTION_KEYS, schoolsLabelFa } from "@/lib/admin/nav";
import { ResourceForm } from "@/components/admin/ResourceForm";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { Button } from "@/components/ui/button";
import { formFieldsOf, type AnyResourceDef } from "@/lib/admin/defineResource";
import { adminResourceList } from "@/lib/admin/queries";
import { formatNumberFa } from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A structure page still renders inside the admin shell but is no longer one of its SECTIONS (round 5: the admin
 * nav is people and roles, the structure pages are Home tiles). Its way back is therefore Home — the place its
 * tile is on — never a section list that no longer contains it. Nested resources keep their parent's back link.
 */
function backOutOfAdmin(key: string): { href: string; label: string } | undefined {
  return ADMIN_SECTION_KEYS.has(key) ? undefined : { href: "/home", label: "خانه" };
}

/**
 * The generic list page of a resource: header (+ create form), search, table, pagination. `basePath` is where
 * pagination links point (defaults to /admin/<key>); `parent` is the parent id of a nested resource.
 */
export async function ResourceListPage({ def, sp, parent, basePath, back }: { def: AnyResourceDef; sp: SearchParams; parent?: string; basePath?: string; back?: { href: string; label: string } }) {
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  const parentId = parent ?? (def.parentParam ? one(sp[def.parentParam.name]) : "");
  if (def.parentParam && !UUID_RE.test(parentId)) notFound();

  const result = await adminResourceList({ resource: def.key, q, page, parent: parentId || undefined });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  // `canWrite` (edit/archive) and `canCreate` («… جدید») come from the same server-side gate as the mutation action:
  // a principal edits schools but never creates one, a vice principal edits offerings (main teacher) but defines none.
  const { rows, total, pageSize, options, canWrite, canCreate } = result.data;
  const fixed = def.parentParam ? { [def.parentParam.field]: parentId } : undefined;
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (def.parentParam && !basePath) params.set(def.parentParam.name, parentId);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `${basePath ?? `/admin/${def.key}`}${s ? `?${s}` : ""}`;
  };
  if (page > lastPage(total, pageSize)) redirect(hrefFor(lastPage(total, pageSize)));
  // «مدرسه» for a principal of exactly one school, «مدرسه‌ها» otherwise (owner's rule; the same cached scope read as the nav).
  const title = def.key === "schools" ? schoolsLabelFa((await getAdminShell()).scope ?? { kind: "organization" }) : def.labelFaPlural;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        count={`${formatNumberFa(total)} مورد`}
        description={def.descriptionFa}
        back={back ?? (def.parentParam ? { href: def.parentParam.backHref(parentId), label: def.parentParam.labelFa } : backOutOfAdmin(def.key))}
        actions={
          <>
            {def.links?.map((l) => (
              <Button key={l.href} asChild variant="outline">
                <Link href={l.href}>{l.labelFa}</Link>
              </Button>
            ))}
            {canCreate ? <ResourceForm resource={def.key} labelFa={def.labelFa} fields={formFieldsOf(def, options)} options={options} mode="create" fixed={fixed} /> : null}
          </>
        }
      />
      {def.orgOnly && !canWrite ? <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-2 text-sm text-text">این فهرست در سطح سازمان تعریف می‌شود و برای شما فقط‌خواندنی است.</p> : null}
      {!def.parentParam ? <SearchForm q={q} placeholder={`جست‌وجو در ${title}`} /> : null}
      <ResourceTable def={def} rows={rows} options={options} canWrite={canWrite} fixed={fixed} />
      <Pagination page={page} pageSize={pageSize} total={total} href={hrefFor} />
    </div>
  );
}
