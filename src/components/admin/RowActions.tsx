"use client";

import { Archive, Ellipsis, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FormField, SelectOption } from "@/lib/admin/defineResource";
import { ArchiveButton } from "./ArchiveButton";
import { ResourceForm, type FormValue } from "./ResourceForm";

/**
 * The row's one control: a «⋯» kebab (44 px on phones, 36 px in tables) opening ویرایش / چاپ / بایگانی. The edit
 * dialog and the archive confirm stay mounted with no trigger of their own and open through `openSignal`, so a
 * row never shows a row of always-visible buttons.
 */
export function RowActions({
  resource,
  labelFa,
  fields,
  options,
  id,
  initial,
  fixed,
  archive,
  print,
}: {
  resource: string;
  labelFa: string;
  fields: FormField[];
  options: Record<string, SelectOption[]>;
  id: string;
  initial: Record<string, FormValue>;
  fixed?: Record<string, string>;
  archive?: { labelFa: string; confirmFa: string };
  print?: { href: string; labelFa: string };
}) {
  const [edit, setEdit] = useState(0);
  const [arch, setArch] = useState(0);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={`گزینه‌های ${labelFa}`} className="size-11 text-text-muted md:size-9">
            <Ellipsis className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => setEdit((n) => n + 1)} className="min-h-10">
            <Pencil aria-hidden />
            ویرایش
          </DropdownMenuItem>
          {print ? (
            <DropdownMenuItem asChild className="min-h-10">
              <Link href={print.href}>
                <Printer aria-hidden />
                {print.labelFa}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {archive ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArch((n) => n + 1)} className="min-h-10">
                <Archive aria-hidden />
                {archive.labelFa}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ResourceForm resource={resource} labelFa={labelFa} fields={fields} options={options} mode="edit" id={id} initial={initial} fixed={fixed} trigger="none" openSignal={edit} />
      {archive ? <ArchiveButton resource={resource} id={id} labelFa={archive.labelFa} confirmFa={archive.confirmFa} trigger="none" openSignal={arch} /> : null}
    </>
  );
}
