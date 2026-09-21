import Link from "next/link";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { indefiniteFa, newLabelFa, type AnyResourceDef, type SelectOption } from "@/lib/admin/defineResource";
import { ArchiveButton } from "./ArchiveButton";
import { ResourceForm, type FormValue } from "./ResourceForm";

/**
 * Server-rendered table of a generic resource. Columns marked `secondary` disappear below `md`; the first column
 * carries the row link when the resource has a detail page. Each row ends with edit (form dialog) and, when
 * defined, archive.
 */
export function ResourceTable({
  def,
  rows,
  options,
  canWrite,
  fixed,
}: {
  def: AnyResourceDef;
  rows: Array<{ id: string } & Record<string, unknown>>;
  options: Record<string, SelectOption[]>;
  canWrite: boolean;
  fixed?: Record<string, string>;
}) {
  if (rows.length === 0) {
    return <EmptyState title={`هنوز ${indefiniteFa(def.labelFa)} ثبت نشده`} description={canWrite ? `با «${newLabelFa(def.labelFa)}» شروع کنید.` : undefined} className="rounded-card bg-surface shadow-1 py-10" />;
  }
  return (
    <div className="overflow-x-auto rounded-card bg-surface shadow-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-text-muted">
            {def.columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2 text-start font-medium", c.secondary && "hidden md:table-cell", c.className)}>
                {c.labelFa}
              </th>
            ))}
            {canWrite ? (
              <th scope="col" className="w-24 px-2 py-2">
                <span className="sr-only">عملیات</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const href = def.rowHref?.(row);
            return (
              <tr key={row.id} className="hover:bg-surface-sunken">
                {def.columns.map((c, i) => {
                  const content = c.render ? c.render(row) : formatCell(row[c.key]);
                  return (
                    <td key={c.key} className={cn("px-3 py-2 align-middle text-text", c.secondary && "hidden md:table-cell", c.className)}>
                      {i === 0 && href ? (
                        <Link href={href} className="flex min-h-11 items-center font-medium text-primary-700 hover:underline">
                          <bdi>{content}</bdi>
                        </Link>
                      ) : (
                        <span className="flex min-h-11 items-center">
                          <bdi>{content}</bdi>
                        </span>
                      )}
                    </td>
                  );
                })}
                {canWrite ? (
                  <td className="px-2 py-1 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      <ResourceForm resource={def.key} labelFa={def.labelFa} fields={def.formFields} options={options} mode="edit" id={row.id} initial={initialOf(def, row)} fixed={fixed} trigger="icon" />
                      {def.archive ? <ArchiveButton resource={def.key} id={row.id} labelFa={def.archive.labelFa} confirmFa={def.archive.confirmFa} /> : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "✓" : "";
  return String(v);
}

function initialOf(def: AnyResourceDef, row: { id: string } & Record<string, unknown>): Record<string, FormValue> {
  if (def.formValues) return def.formValues(row);
  const out: Record<string, FormValue> = {};
  for (const f of def.formFields) {
    const v = row[f.name];
    out[f.name] = v === undefined ? null : (v as FormValue);
  }
  return out;
}
