import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { EmptyState } from "@/components/EmptyState";
import { indefiniteFa, newLabelFa, type AnyResourceDef, type Column, type SelectOption } from "@/lib/admin/defineResource";
import type { FormValue } from "./ResourceForm";
import { RowActions } from "./RowActions";

type Row = { id: string } & Record<string, unknown>;

/**
 * Server-rendered list of a generic resource in two shapes. Phones (`md:hidden`): one card row per record — the
 * first column as the `text-row` title (linked when the resource has a detail page), the columns marked
 * `mobileMeta` as two quiet meta lines, the «⋯» menu at the end. From `md`: the table — `secondary` columns
 * appear from `lg`, the first column carries the row link, the last cell is the same «⋯» menu (ویرایش / چاپ / بایگانی)
 * instead of a row of always-visible buttons.
 */
export function ResourceTable({ def, rows, options, canWrite, fixed }: { def: AnyResourceDef; rows: Row[]; options: Record<string, SelectOption[]>; canWrite: boolean; fixed?: Record<string, string> }) {
  if (rows.length === 0) {
    return <EmptyState title={`هنوز ${indefiniteFa(def.labelFa)} ثبت نشده`} description={canWrite ? `با «${newLabelFa(def.labelFa)}» شروع کنید.` : undefined} className="surface-work py-10" />;
  }
  const [first, ...rest] = def.columns as Column<Row>[];
  const metaLines: [Column<Row>[], Column<Row>[]] = [rest.filter((c) => c.mobileMeta === true || c.mobileMeta === 1), rest.filter((c) => c.mobileMeta === 2)];
  const actions = (row: Row) =>
    canWrite ? (
      <RowActions
        resource={def.key}
        labelFa={def.labelFa}
        fields={def.formFields}
        options={options}
        id={row.id}
        initial={initialOf(def, row)}
        fixed={fixed}
        archive={def.archive ? { labelFa: def.archive.labelFa, confirmFa: def.archive.confirmFa } : undefined}
        print={def.printHref ? { href: def.printHref(row), labelFa: "چاپ" } : undefined}
      />
    ) : null;

  return (
    <>
      <ul className="surface-work divide-y divide-line/70 md:hidden">
        {rows.map((row) => {
          const href = def.rowHref?.(row);
          const title = <bdi>{cellOf(first, row)}</bdi>;
          const lines = metaLines.map((cols) => metaOf(cols, row)).filter((l) => l.length > 0);
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-row font-medium text-text">{title}</span>
                {lines.map((parts, i) => (
                  <span key={i} className="truncate text-meta text-text-muted">
                    {parts.map((p, j) => (
                      <span key={j}>
                        {j > 0 ? <span aria-hidden> · </span> : null}
                        {p}
                      </span>
                    ))}
                  </span>
                ))}
              </span>
              {href ? <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden /> : null}
            </>
          );
          return (
            <li key={row.id} className="flex items-center gap-1 pe-1">
              {href ? (
                <Link href={href} className="pressable flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
                  {body}
                </Link>
              ) : (
                <span className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2">{body}</span>
              )}
              {actions(row)}
            </li>
          );
        })}
      </ul>

      <div className="surface-work hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-meta text-text-muted">
              {def.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2 text-start font-medium", c.secondary && "hidden lg:table-cell", c.className)}>
                  {c.labelFa}
                </th>
              ))}
              {canWrite ? (
                <th scope="col" className="w-14 px-2 py-2">
                  <span className="sr-only">گزینه‌ها</span>
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
                    const content = cellOf(c, row);
                    return (
                      <td key={c.key} className={cn("px-3 py-2 align-middle text-text", i === 0 && "text-row", c.secondary && "hidden lg:table-cell", c.className)}>
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
                      <div className="flex items-center justify-end">{actions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function cellOf(c: Column<Row>, row: Row): React.ReactNode {
  return c.render ? c.render(row) : formatCell(row[c.key]);
}

/** The parts of one phone meta line: a boolean column contributes its label when true, others their rendered cell (empty and «—» skipped). */
function metaOf(cols: Column<Row>[], row: Row): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  for (const c of cols) {
    const raw = row[c.key];
    if (typeof raw === "boolean") {
      if (raw) parts.push(c.labelFa);
      continue;
    }
    if (!c.render && (raw === null || raw === undefined || raw === "")) continue;
    parts.push(cellOf(c, row));
  }
  return parts;
}

function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "✓" : "";
  return String(v);
}

function initialOf(def: AnyResourceDef, row: Row): Record<string, FormValue> {
  if (def.formValues) return def.formValues(row);
  const out: Record<string, FormValue> = {};
  for (const f of def.formFields) {
    const v = row[f.name];
    out[f.name] = v === undefined ? null : (v as FormValue);
  }
  return out;
}
