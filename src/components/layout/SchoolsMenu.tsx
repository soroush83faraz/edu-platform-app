"use client";

import { ChevronDown, School } from "lucide-react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatNumberFa } from "@/lib/format";

/**
 * The «۲ مدرسه» chip of the desktop header bar: an admin whose scope holds more than one school is never told the
 * name of whichever school sorts first (owner, QA round 3). The chip opens the list, each row going to that
 * school's hub. Rendered only from `lg:` — on phones the /admin landing carries the same list as a section.
 */
export function SchoolsMenu({ schools }: { schools: ReadonlyArray<{ id: string; name: string }> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="-mx-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-meta text-text-muted hover:text-text" aria-label={`${formatNumberFa(schools.length)} مدرسه در دامنهٴ شما`}>
          <School className="size-4 text-text-faint" strokeWidth={1.75} aria-hidden />
          <span className="tabular">{formatNumberFa(schools.length)}</span> مدرسه
          <ChevronDown className="size-3.5 text-text-faint" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {schools.map((s) => (
          <DropdownMenuItem key={s.id} asChild className="min-h-10">
            <Link href={`/admin/schools/${s.id}`}>
              <bdi>{s.name}</bdi>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
