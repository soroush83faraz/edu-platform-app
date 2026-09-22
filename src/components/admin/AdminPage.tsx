import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumberFa } from "@/lib/format";

/** Every admin page's title row is the product's one `PageHeader` (context bar on desktop, title + actions). */
export { PageHeader as AdminHeader } from "@/components/layout/PageHeader";

/** GET form: `?q=` search that keeps the other query parameters. */
export function SearchForm({ q, hidden, placeholder = "جست‌وجو…" }: { q: string; hidden?: Record<string, string | undefined>; placeholder?: string }) {
  return (
    <form method="get" role="search" className="relative">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="جست‌وجو" className="ps-9" enterKeyHint="search" />
    </form>
  );
}

/** `?page=99` past the end → the last page that exists (1 when the list is empty). */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** «قبلی / بعدی» links with the count; hidden when everything fits on one page. */
export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="صفحه‌بندی" className="flex items-center justify-between gap-3 text-sm text-text-muted">
      <Button asChild variant="outline" aria-disabled={page <= 1}>
        <Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          قبلی
        </Link>
      </Button>
      <span className="tabular">
        صفحهٴ {formatNumberFa(page)} از {formatNumberFa(pages)} · {formatNumberFa(total)} مورد
      </span>
      <Button asChild variant="outline" aria-disabled={page >= pages}>
        <Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          بعدی
        </Link>
      </Button>
    </nav>
  );
}
